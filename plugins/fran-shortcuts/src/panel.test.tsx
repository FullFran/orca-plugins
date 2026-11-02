// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mount, test } from 'orca/testing'
import * as panel from './panel'

test('lists every shortcut group', async () => {
  const view = await mount(panel)
  for (const group of ['Panes and tabs', 'Workspaces', 'Panels', 'Terminal']) {
    assert.ok(view.find({ text: group }), `missing group ${group}`)
  }
  assert.ok(view.find({ text: 'Ctrl+Shift+R' }), 'split right shortcut not shown')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('filters shortcuts by action or key', async () => {
  const view = await mount(panel)
  await view.type({ label: 'Filter shortcuts' }, 'split')
  assert.ok(view.find({ text: 'Ctrl+Shift+R' }), 'split right should stay visible')
  assert.ok(view.find({ text: 'Ctrl+Shift+F' }), 'split down should stay visible')
  assert.equal(view.find({ text: 'Ctrl+E' }), null, 'dictation should be filtered out')

  await view.type({ label: 'Filter shortcuts' }, 'ctrl+e', { replace: true })
  assert.ok(view.find({ text: 'Ctrl+E' }), 'filtering by key should match')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('shows an empty state when nothing matches', async () => {
  const view = await mount(panel)
  await view.type({ label: 'Filter shortcuts' }, 'zzz-no-match')
  assert.ok(view.find({ text: 'No shortcut matches' }))
  await view.unmount()
})
