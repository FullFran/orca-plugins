// Finds the folder of the focused Orca workspace. `workspace.readContext` names the workspace by
// branch and display name only, so the folder comes from the Orca CLI's own listings. When the
// listings cannot tell one folder, the answer says so; it never picks one.
import type { WorkspaceCandidate, WorkspaceContext } from './protocol'

/** Runs `orca <args> --json` and resolves with the parsed `result` field. */
export type OrcaRunner = (args: string[]) => Promise<unknown>

export type WorkspaceResolution =
  | { kind: 'unique'; path: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: WorkspaceCandidate[] }

const shortBranch = (branch: string) => branch.replace(/^refs\/heads\//, '')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function listOf(result: unknown, field: string): Record<string, unknown>[] {
  const list = isRecord(result) ? result[field] : undefined
  return Array.isArray(list) ? list.filter(isRecord) : []
}

/** The folders the workspace's own terminals run in, by terminal id. */
async function terminalFolders(context: WorkspaceContext, run: OrcaRunner): Promise<Set<string>> {
  const ids = new Set(context.terminals.map((terminal) => terminal.id))
  const folders = new Set<string>()
  if (ids.size === 0) return folders
  let result: unknown
  try {
    result = await run(['terminal', 'list', '--limit', '500'])
  } catch {
    return folders // The name match below still applies.
  }
  for (const terminal of listOf(result, 'terminals')) {
    // Orca names a terminal by `handle`; older listings only had the pty id.
    const id = [text(terminal.handle), text(terminal.ptyId)].find((value) => ids.has(value))
    const folder = text(terminal.worktreePath)
    if (id && folder) folders.add(folder)
  }
  return folders
}

export async function resolveWorkspace(
  context: WorkspaceContext,
  run: OrcaRunner
): Promise<WorkspaceResolution> {
  const branch = shortBranch(context.branch)
  const worktrees = listOf(await run(['worktree', 'list', '--limit', '500']), 'worktrees')
  const candidates: WorkspaceCandidate[] = worktrees
    .filter(
      (worktree) =>
        worktree.isArchived !== true &&
        text(worktree.path) !== '' &&
        shortBranch(text(worktree.branch)) === branch &&
        text(worktree.displayName) === context.displayName
    )
    .map((worktree) => ({
      path: text(worktree.path),
      displayName: text(worktree.displayName),
      branch: shortBranch(text(worktree.branch))
    }))

  if (candidates.length === 0) return { kind: 'none' }
  if (candidates.length === 1) return { kind: 'unique', path: candidates[0].path }

  // Same branch and name in several repositories: the workspace's terminals may settle it.
  const folders = await terminalFolders(context, run)
  const settled = candidates.filter((candidate) => folders.has(candidate.path))
  if (settled.length === 1) return { kind: 'unique', path: settled[0].path }
  return { kind: 'ambiguous', candidates }
}
