// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// `requests` stands in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Memory, MemoriesResult } from './protocol'

const context = { branch: 'main', displayName: 'main', terminals: [] }

const memory = (id: number, title: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  title,
  type: 'decision',
  scope: 'project',
  topicKey: 'architecture/x',
  createdAt: '2026-11-01 10:00:00',
  updatedAt: '2026-11-01 10:05:00',
  preview: `Preview of ${title}`,
  content: null,
  state: 'active',
  superseded: false,
  ...extra
})

const ok = (memories: Memory[], query = ''): MemoriesResult => ({
  kind: 'ok',
  path: '/repos/app',
  project: 'app',
  projectSource: 'git_remote',
  query,
  memories
})

function host(
  load: (input: { query: string; choice: string | null; context: unknown }) => MemoriesResult
) {
  return mockHost({
    results: { 'workspace.readContext': context },
    requests: {
      'memories.load': load,
      'memory.get': ({ id }) => ({
        kind: 'ok',
        memory: memory(id, 'First', { content: 'Line one\nLine two' })
      })
    }
  })
}

test('lists recent memories with type, date and preview, and marks stale ones', async () => {
  const view = await mount(panel, {
    host: host(() =>
      ok([memory(1, 'First'), memory(2, 'Old one', { state: 'needs_review' })])
    )
  })
  assert.ok(view.find({ text: 'app' }), 'project name shown')
  assert.ok(view.find({ label: 'First' }))
  assert.ok(view.find({ text: /decision · 2026-11-01 10:05/ }))
  assert.ok(view.find({ text: /Preview of First/ }))
  assert.ok(view.find({ text: 'Needs review' }), 'stale memory is marked')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('search submits the query to the worker', async () => {
  const queries: string[] = []
  const view = await mount(panel, {
    host: host(({ query }) => {
      queries.push(query)
      return query ? ok([memory(5, 'Found it')], query) : ok([memory(1, 'First')])
    })
  })
  await view.type({ label: 'Search memories' }, 'orca', { submit: true })
  assert.ok(view.find({ label: 'Found it' }))
  assert.equal(view.find({ label: 'First' }), null)
  assert.equal(queries.at(-1), 'orca')
  await view.unmount()
})

test('pressing a memory opens its full content; back returns to the list', async () => {
  const view = await mount(panel, { host: host(() => ok([memory(1, 'First')])) })
  await view.press({ label: 'First' })
  assert.ok(view.find({ text: 'Line one' }))
  assert.ok(view.find({ text: 'Line two' }))
  assert.ok(view.find({ text: /architecture\/x/ }))
  await view.press({ text: 'Back' })
  assert.ok(view.find({ label: 'First' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Engram down shows a message and retry loads again', async () => {
  let up = false
  const view = await mount(panel, {
    host: host(() =>
      up ? ok([memory(1, 'First')]) : { kind: 'engram-down', message: 'connection refused' }
    )
  })
  assert.ok(view.find({ label: 'Engram is not reachable' }))
  up = true
  await view.press({ text: 'Retry' })
  assert.ok(view.find({ label: 'First' }))
  await view.unmount()
})

test('an ambiguous workspace lists the folders and loads the one picked', async () => {
  const choices: (string | null)[] = []
  const view = await mount(panel, {
    host: host(({ choice }) => {
      choices.push(choice)
      return choice
        ? { ...ok([memory(1, 'First')]), path: choice }
        : {
            kind: 'workspace-ambiguous',
            candidates: [
              { path: '/repos/a', displayName: 'main', branch: 'main' },
              { path: '/repos/b', displayName: 'main', branch: 'main' }
            ]
          }
    })
  })
  assert.ok(view.find({ label: 'Several workspaces match' }))
  await view.press({ label: '/repos/b' })
  assert.equal(choices.at(-1), '/repos/b')
  assert.ok(view.find({ label: 'First' }))
  await view.unmount()
})

test('an ambiguous Engram project is shown without picking one', async () => {
  const view = await mount(panel, {
    host: host(() => ({
      kind: 'project-ambiguous',
      path: '/home/fran',
      availableProjects: ['dotfiles', 'sandbox'],
      hint: 'ambiguous project: multiple git repos found in cwd'
    }))
  })
  assert.ok(view.find({ label: 'Engram cannot tell the project' }))
  assert.ok(view.find({ text: /dotfiles, sandbox/ }))
  await view.unmount()
})

test('switching workspace reloads for the new one', async () => {
  const seen: string[] = []
  const view = await mount(panel, {
    host: host(({ context }) => {
      seen.push('load')
      return context ? ok([memory(1, 'First')]) : { kind: 'no-workspace' }
    })
  })
  const before = seen.length
  await view.emit('workspace.changed', {
    context: { branch: 'feat/y', displayName: 'feat/y', terminals: [] }
  })
  assert.equal(seen.length, before + 1)
  await view.emit('workspace.changed', { context: null })
  assert.ok(view.find({ label: 'No workspace focused' }))
  await view.unmount()
})
