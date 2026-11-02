import { assert, test } from 'orca/testing'
import { resolveWorkspace, type OrcaRunner } from './workspace'

const worktree = (path: string, branch: string, displayName = branch.replace('refs/heads/', '')) => ({
  path,
  branch,
  displayName,
  isArchived: false
})

/** Answers `orca worktree list` and `orca terminal list` the way the CLI's `result` looks. */
function runner(
  worktrees: unknown[],
  terminals: unknown[] = []
): OrcaRunner & { calls: string[][] } {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'worktree') return { worktrees }
    if (args[0] === 'terminal') return { terminals }
    throw new Error(`unexpected ${args.join(' ')}`)
  }
  return Object.assign(run, { calls })
}

const context = (branch: string, displayName: string, terminals: string[] = []) => ({
  branch,
  displayName,
  terminals: terminals.map((id) => ({ id }))
})

test('a unique branch and name match resolves to its folder', async () => {
  const run = runner([
    worktree('/repos/app', 'refs/heads/feat/x'),
    worktree('/repos/other', 'refs/heads/main')
  ])
  const result = await resolveWorkspace(context('feat/x', 'feat/x'), run)
  assert.deepEqual(result, { kind: 'unique', path: '/repos/app' })
})

test('the context branch matches with or without refs/heads/', async () => {
  const run = runner([worktree('/repos/app', 'refs/heads/main')])
  assert.deepEqual(await resolveWorkspace(context('refs/heads/main', 'main'), run), {
    kind: 'unique',
    path: '/repos/app'
  })
})

test('several worktrees with the same branch and name are ambiguous', async () => {
  const run = runner([
    worktree('/repos/a', 'refs/heads/main'),
    worktree('/repos/b', 'refs/heads/main'),
    worktree('/repos/c', 'refs/heads/dev')
  ])
  const result = await resolveWorkspace(context('main', 'main'), run)
  assert.deepEqual(result, {
    kind: 'ambiguous',
    candidates: [
      { path: '/repos/a', displayName: 'main', branch: 'main' },
      { path: '/repos/b', displayName: 'main', branch: 'main' }
    ]
  })
})

test('the workspace terminals settle an ambiguous name', async () => {
  const run = runner(
    [worktree('/repos/a', 'refs/heads/main'), worktree('/repos/b', 'refs/heads/main')],
    [
      { handle: 'term_1', ptyId: 'pty-1', worktreePath: '/repos/b' },
      { handle: 'term_2', ptyId: 'pty-2', worktreePath: '/repos/a' }
    ]
  )
  assert.deepEqual(await resolveWorkspace(context('main', 'main', ['term_1']), run), {
    kind: 'unique',
    path: '/repos/b'
  })
})

test('terminals in two folders do not pick one', async () => {
  const run = runner(
    [worktree('/repos/a', 'refs/heads/main'), worktree('/repos/b', 'refs/heads/main')],
    [
      { handle: 'term_1', worktreePath: '/repos/a' },
      { handle: 'term_2', worktreePath: '/repos/b' }
    ]
  )
  const result = await resolveWorkspace(context('main', 'main', ['term_1', 'term_2']), run)
  assert.equal(result.kind, 'ambiguous')
})

test('a terminal folder outside the matching worktrees is ignored', async () => {
  const run = runner(
    [worktree('/repos/a', 'refs/heads/main')],
    [{ handle: 'term_1', worktreePath: '/elsewhere' }]
  )
  assert.deepEqual(await resolveWorkspace(context('main', 'main', ['term_1']), run), {
    kind: 'unique',
    path: '/repos/a'
  })
})

test('no matching worktree is none, and archived ones do not count', async () => {
  const run = runner([{ ...worktree('/repos/a', 'refs/heads/main'), isArchived: true }])
  assert.deepEqual(await resolveWorkspace(context('main', 'main'), run), { kind: 'none' })
})

test('a terminal listing failure falls back to the name match', async () => {
  const run: OrcaRunner = async (args) => {
    if (args[0] === 'worktree') return { worktrees: [worktree('/repos/a', 'refs/heads/main')] }
    throw new Error('terminal list failed')
  }
  assert.deepEqual(await resolveWorkspace(context('main', 'main', ['term_1']), run), {
    kind: 'unique',
    path: '/repos/a'
  })
})
