// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// `requests` stands in for src/worker.ts.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { CheatSheetResult } from './protocol'

const sheet: CheatSheetResult = {
  kind: 'ok',
  settingsFiles: ['settings.json'],
  skills: [
    { command: '/diapositivas-fran', mode: 'manual', summary: 'Build an explainer deck.', source: 'personal' },
    { command: '/codex:rescue', mode: 'manual', summary: 'Hand work to Codex.', source: 'codex' },
    { command: '/dataviz', mode: 'name-only', summary: '', source: 'not found' }
  ]
}

const host = (answer: () => CheatSheetResult) => mockHost({ requests: { 'skills.load': answer } })

test('groups manual and name-only skills with their summaries', async () => {
  const view = await mount(panel, { host: host(() => sheet) })
  assert.ok(view.find({ text: 'Invoke by hand' }))
  assert.ok(view.find({ text: '/diapositivas-fran' }))
  assert.ok(view.find({ text: 'Build an explainer deck.' }))
  assert.ok(view.find({ text: 'codex' }), 'plugin source badge')
  assert.ok(view.find({ text: 'Listed by name only' }))
  assert.ok(view.find({ text: /bundled with Claude Code/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('filters skills', async () => {
  const view = await mount(panel, { host: host(() => sheet) })
  await view.type({ label: 'Filter skills' }, 'deck')
  assert.ok(view.find({ text: '/diapositivas-fran' }))
  assert.equal(view.find({ text: '/codex:rescue' }), null)
  assert.equal(view.find({ text: 'Listed by name only' }), null, 'empty group is hidden')
  await view.type({ label: 'Filter skills' }, 'zzz', { replace: true })
  assert.ok(view.find({ text: 'No skill matches' }))
  await view.unmount()
})

test('shows the empty and error states', async () => {
  const empty = await mount(panel, { host: host(() => ({ kind: 'ok', skills: [], settingsFiles: [] })) })
  assert.ok(empty.summary().includes('EmptyState "No hidden skills"'))
  await empty.unmount()
  const broken = await mount(panel, { host: host(() => ({ kind: 'error', message: 'EACCES' })) })
  assert.ok(broken.summary().includes('EmptyState "Could not read ~/.claude"'))
  assert.ok(JSON.stringify(broken.tree()).includes('EACCES'), 'error message shown')
  await broken.unmount()
})
