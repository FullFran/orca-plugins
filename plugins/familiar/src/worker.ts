// The plugin's worker: the panel cannot run programs, so this runs the CLIs for it. Only
// read-only commands are run: `familiard pets --json`, `familiard frames <id> --rows N` and
// `orca worktree list --json`. It never summons, dismisses or edits pets.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { isPetId, parseFrames, parsePets, parseWorkspaces, ROWS } from './familiard'
import type { PetFrames } from './protocol'

export type Program = 'familiard' | 'orca'

/** Runs a program with these arguments (no shell) and resolves with its stdout. */
export type Runner = (args: string[], program?: Program) => Promise<string>

const WORKSPACES_TTL_MS = 30_000

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { detail: String(stderr).trim() }))
      else resolve(String(stdout))
    })
  })
}

function candidates(program: Program): string[] {
  const home = homedir()
  return program === 'orca'
    ? ['orca-ide', 'orca', join(home, '.local/bin/orca-ide'), '/usr/bin/orca-ide']
    : ['familiard', join(home, '.local/bin/familiard'), join(home, '.cargo/bin/familiard')]
}

/** The program on PATH, else its usual install folders (a desktop launch may lack them). */
export const execRunner: Runner = async (args, program = 'familiard') => {
  let lastError: unknown
  for (const file of candidates(program)) {
    try {
      return await run(file, args)
    } catch (error) {
      lastError = error
      if ((error as { code?: unknown }).code !== 'ENOENT') break
    }
  }
  const detail = (lastError as { detail?: string })?.detail
  throw new Error(detail || (lastError as Error)?.message || `${program} failed`)
}

async function call<T>(runner: Runner, args: string[], parse: (output: string) => T): Promise<T> {
  let output: string
  try {
    output = await runner(args, 'familiard')
  } catch (error) {
    throw codedError('action_failed', `familiard ${args[0]} failed: ${(error as Error).message}`)
  }
  try {
    return parse(output)
  } catch (error) {
    throw codedError('action_failed', `familiard ${args[0]} printed something unexpected: ${(error as Error).message}`)
  }
}

export function createActivate(runner: Runner) {
  return function activate(orca: OrcaWorkerApi): void {
    // Frames do not change while the worker runs; one fetch per pet.
    const frames = new Map<string, Promise<PetFrames>>()
    let workspaces: { at: number; map: Record<string, string> } | null = null

    orca.panels.handle('familiar.pets', async () => ({
      pets: await call(runner, ['pets', '--json'], parsePets)
    }))

    orca.panels.handle('familiar.frames', async (input) => {
      const id = (input as { id?: unknown } | undefined)?.id
      if (!isPetId(id)) throw codedError('invalid_params', 'familiar.frames needs a pet id')
      let pending = frames.get(id)
      if (!pending) {
        pending = call(runner, ['frames', id, '--rows', String(ROWS)], parseFrames)
        frames.set(id, pending)
        pending.catch(() => frames.delete(id))
      }
      return pending
    })

    orca.panels.handle('familiar.workspaces', async () => {
      if (workspaces && Date.now() - workspaces.at < WORKSPACES_TTL_MS) return { workspaces: workspaces.map }
      let map: Record<string, string> = {}
      try {
        map = parseWorkspaces(await runner(['worktree', 'list', '--json'], 'orca'))
      } catch (error) {
        orca.log(`orca worktree list failed: ${(error as Error).message}`)
      }
      workspaces = { at: Date.now(), map }
      return { workspaces: map }
    })
  }
}

export default createActivate(execRunner)
