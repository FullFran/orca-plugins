// Runs the worker's handlers over a mock host, with the Orca CLI and Engram replaced by fakes.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { EngramUnavailable, type EngramClient } from './engram'
import type { Memory } from './protocol'
import { activateWith, type WorkerDeps } from './worker'
import type { OrcaRunner } from './workspace'

const memory = (id: number, title: string): Memory => ({
  id,
  title,
  type: 'decision',
  scope: 'project',
  topicKey: null,
  createdAt: '2026-11-01 10:00:00',
  updatedAt: '2026-11-01 10:00:00',
  preview: title,
  content: null,
  state: 'active',
  superseded: false
})

const worktrees: OrcaRunner = async (args) => {
  if (args[0] === 'worktree') {
    return {
      worktrees: [
        { path: '/repos/app', branch: 'refs/heads/feat/x', displayName: 'feat/x' },
        { path: '/repos/a', branch: 'refs/heads/main', displayName: 'main' },
        { path: '/repos/b', branch: 'refs/heads/main', displayName: 'main' }
      ]
    }
  }
  return { terminals: [] }
}

function fakeEngram(overrides: Partial<EngramClient> = {}): EngramClient & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    currentProject: async (cwd) => {
      asked.push(`project ${cwd}`)
      return { kind: 'unique', project: 'app', source: 'git_remote' }
    },
    recent: async (project, limit) => {
      asked.push(`recent ${project} ${limit}`)
      return [memory(1, 'First'), memory(2, 'Second')]
    },
    search: async (project, query) => {
      asked.push(`search ${project} ${query}`)
      return [memory(2, 'Second')]
    },
    get: async (id) => (id === 1 ? { ...memory(1, 'First'), content: 'Full text' } : null),
    ...overrides
  }
}

async function start(deps: WorkerDeps) {
  return mountWorker({ default: (orca: never) => activateWith(orca, deps) }, { host: mockHost() })
}

const ctx = (branch: string, displayName = branch) => ({ branch, displayName, terminals: [] })

test('lists the recent memories of the workspace project', async () => {
  const engram = fakeEngram()
  const worker = await start({ run: worktrees, engram: () => engram })
  const result = await worker.request('memories.load', {
    context: ctx('feat/x'),
    query: '',
    choice: null
  })
  assert.equal(result.kind, 'ok')
  assert.deepEqual(engram.asked, ['project /repos/app', 'recent app 30'])
  if (result.kind === 'ok') {
    assert.equal(result.project, 'app')
    assert.deepEqual(
      result.memories.map((m) => m.title),
      ['First', 'Second']
    )
  }
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a query searches instead of listing', async () => {
  const engram = fakeEngram()
  const worker = await start({ run: worktrees, engram: () => engram })
  const result = await worker.request('memories.load', {
    context: ctx('feat/x'),
    query: '  second ',
    choice: null
  })
  assert.deepEqual(engram.asked, ['project /repos/app', 'search app second'])
  assert.equal(result.kind === 'ok' && result.query, 'second')
  await worker.deactivate()
})

test('no focused workspace, no match and ambiguity are reported, not guessed', async () => {
  const engram = fakeEngram()
  const worker = await start({ run: worktrees, engram: () => engram })
  assert.deepEqual(await worker.request('memories.load', { context: null, query: '', choice: null }), {
    kind: 'no-workspace'
  })
  assert.deepEqual(
    await worker.request('memories.load', { context: ctx('gone'), query: '', choice: null }),
    { kind: 'workspace-none', branch: 'gone', displayName: 'gone' }
  )
  const ambiguous = await worker.request('memories.load', {
    context: ctx('main'),
    query: '',
    choice: null
  })
  assert.equal(ambiguous.kind, 'workspace-ambiguous')
  assert.deepEqual(engram.asked, [], 'Engram is not asked until the folder is known')
  await worker.deactivate()
})

test('a choice among the candidates settles the ambiguity; any other choice does not', async () => {
  const engram = fakeEngram()
  const worker = await start({ run: worktrees, engram: () => engram })
  const chosen = await worker.request('memories.load', {
    context: ctx('main'),
    query: '',
    choice: '/repos/b'
  })
  assert.equal(chosen.kind, 'ok')
  assert.equal(chosen.kind === 'ok' && chosen.path, '/repos/b')
  const foreign = await worker.request('memories.load', {
    context: ctx('main'),
    query: '',
    choice: '/etc'
  })
  assert.equal(foreign.kind, 'workspace-ambiguous')
  await worker.deactivate()
})

test('an ambiguous Engram project is shown with its candidates', async () => {
  const engram = fakeEngram({
    currentProject: async () => ({
      kind: 'ambiguous',
      availableProjects: ['dotfiles', 'sandbox'],
      hint: 'ambiguous project: multiple git repos found in cwd'
    })
  })
  const worker = await start({ run: worktrees, engram: () => engram })
  assert.deepEqual(
    await worker.request('memories.load', { context: ctx('feat/x'), query: '', choice: null }),
    {
      kind: 'project-ambiguous',
      path: '/repos/app',
      availableProjects: ['dotfiles', 'sandbox'],
      hint: 'ambiguous project: multiple git repos found in cwd'
    }
  )
  await worker.deactivate()
})

test('Engram down is its own state, for the list and for one memory', async () => {
  const down = async () => {
    throw new EngramUnavailable('http://127.0.0.1:7437', new Error('ECONNREFUSED'))
  }
  const engram = fakeEngram({ currentProject: down, get: down })
  const worker = await start({ run: worktrees, engram: () => engram })
  const list = await worker.request('memories.load', {
    context: ctx('feat/x'),
    query: '',
    choice: null
  })
  assert.equal(list.kind, 'engram-down')
  const one = await worker.request('memory.get', { id: 1 })
  assert.equal(one.kind, 'engram-down')
  await worker.deactivate()
})

test('memory.get returns the full memory or not-found', async () => {
  const worker = await start({ run: worktrees, engram: () => fakeEngram() })
  const found = await worker.request('memory.get', { id: 1 })
  assert.equal(found.kind === 'ok' && found.memory.content, 'Full text')
  assert.deepEqual(await worker.request('memory.get', { id: 7 }), { kind: 'not-found', id: 7 })
  await worker.deactivate()
})

test('a failing Orca CLI is an error, not a crash', async () => {
  const run: OrcaRunner = async () => {
    throw new Error('orca-ide: command not found')
  }
  const worker = await start({ run, engram: () => fakeEngram() })
  const result = await worker.request('memories.load', {
    context: ctx('feat/x'),
    query: '',
    choice: null
  })
  assert.deepEqual(result, { kind: 'error', message: 'orca-ide: command not found' })
  await worker.deactivate()
})
