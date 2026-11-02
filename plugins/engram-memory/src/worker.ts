// The plugin's worker. Panels cannot reach the network or run programs, so this Node process
// does both for them: it asks the Orca CLI which folder the focused workspace is, and asks
// Engram's local HTTP API for that folder's memories. Every Engram call is a GET.
import { execFile } from 'node:child_process'
import type { OrcaWorkerApi } from 'orca/worker'
import { createEngramClient, EngramUnavailable, type EngramClient } from './engram'
import type { MemoriesResult, MemoryResult, WorkspaceContext } from './protocol'
import { resolveWorkspace, type OrcaRunner } from './workspace'

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7437'
const RECENT_LIMIT = 30
const SEARCH_LIMIT = 20

export type WorkerDeps = {
  run: OrcaRunner
  engram: (serverUrl: string) => EngramClient
}

/** Runs the Orca CLI that ships with the app and returns its JSON `result`. */
export const runOrcaCli: OrcaRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      'orca-ide',
      [...args, '--json'],
      { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        let parsed: { ok?: boolean; result?: unknown; error?: { message?: string } } | null = null
        try {
          parsed = JSON.parse(stdout)
        } catch {
          // Fall through to the process error below.
        }
        if (parsed?.ok === true) return resolve(parsed.result)
        const message = parsed?.error?.message ?? error?.message ?? 'orca-ide gave no answer'
        reject(new Error(message))
      }
    )
  })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function serverUrl(orca: OrcaWorkerApi): Promise<string> {
  try {
    const { settings } = await orca.host.call('settings.get', {})
    const value = settings.serverUrl
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SERVER_URL
  } catch {
    return DEFAULT_SERVER_URL
  }
}

async function load(
  deps: WorkerDeps,
  engram: EngramClient,
  input: { context: WorkspaceContext | null; query: string; choice: string | null }
): Promise<MemoriesResult> {
  const { context, choice } = input
  const query = input.query.trim()
  if (!context) return { kind: 'no-workspace' }

  let path: string
  try {
    const workspace = await resolveWorkspace(context, deps.run)
    if (workspace.kind === 'none') {
      return { kind: 'workspace-none', branch: context.branch, displayName: context.displayName }
    }
    if (workspace.kind === 'ambiguous') {
      // A folder the person picked counts only if it is one of the candidates.
      const picked = workspace.candidates.find((candidate) => candidate.path === choice)
      if (!picked) return { kind: 'workspace-ambiguous', candidates: workspace.candidates }
      path = picked.path
    } else {
      path = workspace.path
    }
  } catch (error) {
    return { kind: 'error', message: message(error) }
  }

  try {
    const project = await engram.currentProject(path)
    if (project.kind === 'ambiguous') {
      return {
        kind: 'project-ambiguous',
        path,
        availableProjects: project.availableProjects,
        hint: project.hint
      }
    }
    if (project.kind === 'none') return { kind: 'project-none', path, hint: project.hint }
    const memories = query
      ? await engram.search(project.project, query, SEARCH_LIMIT)
      : await engram.recent(project.project, RECENT_LIMIT)
    return {
      kind: 'ok',
      path,
      project: project.project,
      projectSource: project.source,
      query,
      memories
    }
  } catch (error) {
    if (error instanceof EngramUnavailable) return { kind: 'engram-down', message: error.message }
    return { kind: 'error', message: message(error) }
  }
}

async function getMemory(engram: EngramClient, id: number): Promise<MemoryResult> {
  try {
    const memory = await engram.get(id)
    return memory ? { kind: 'ok', memory } : { kind: 'not-found', id }
  } catch (error) {
    if (error instanceof EngramUnavailable) return { kind: 'engram-down', message: error.message }
    return { kind: 'error', message: message(error) }
  }
}

export function activateWith(orca: OrcaWorkerApi, deps: WorkerDeps): void {
  orca.panels.handle('memories.load', async (input) =>
    load(deps, deps.engram(await serverUrl(orca)), input)
  )
  orca.panels.handle('memory.get', async ({ id }) =>
    getMemory(deps.engram(await serverUrl(orca)), id)
  )
}

export default function activate(orca: OrcaWorkerApi): void {
  activateWith(orca, {
    run: runOrcaCli,
    engram: (baseUrl) => createEngramClient({ baseUrl })
  })
}
