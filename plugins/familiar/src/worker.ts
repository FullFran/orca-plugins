// The plugin's worker: the panel cannot run programs, so this runs the familiard CLI for it.
// Only `familiard pets --json` and `familiard frames <id> --rows N` are run: it never summons,
// dismisses or edits pets.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { isPetId, parseFrames, parsePets, ROWS } from './familiard'

/** Runs familiard with these arguments and resolves with its stdout. */
export type Runner = (args: string[]) => Promise<string>

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { detail: String(stderr).trim() }))
      } else {
        resolve(String(stdout))
      }
    })
  })
}

/** familiard on PATH, else the usual per-user install folders (a desktop launch may lack them). */
export const execRunner: Runner = async (args) => {
  const candidates = ['familiard', join(homedir(), '.local/bin/familiard'), join(homedir(), '.cargo/bin/familiard')]
  let lastError: unknown
  for (const file of candidates) {
    try {
      return await run(file, args)
    } catch (error) {
      lastError = error
      if ((error as { code?: unknown }).code !== 'ENOENT') break
    }
  }
  const detail = (lastError as { detail?: string })?.detail
  throw new Error(detail || (lastError as Error)?.message || 'familiard failed')
}

async function call<T>(runner: Runner, args: string[], parse: (output: string) => T): Promise<T> {
  let output: string
  try {
    output = await runner(args)
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
    orca.panels.handle('familiar.pets', async () => ({
      pets: await call(runner, ['pets', '--json'], parsePets)
    }))

    orca.panels.handle('familiar.frames', async (input) => {
      const id = (input as { id?: unknown } | undefined)?.id
      if (!isPetId(id)) throw codedError('invalid_params', 'familiar.frames needs a pet id')
      return call(runner, ['frames', id, '--rows', String(ROWS)], parseFrames)
    })
  }
}

export default createActivate(execRunner)
