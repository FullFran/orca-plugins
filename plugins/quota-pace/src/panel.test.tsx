// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { PaceRow, PaceSnapshot } from './pace'
import * as panel from './panel'

const NOW = new Date(2026, 10, 2, 10, 0, 0, 0).getTime()
const MIDNIGHT = new Date(2026, 10, 2).getTime()

function paceRow(overrides: Partial<PaceRow> = {}): PaceRow {
  return {
    key: 'claude.weekly',
    provider: 'claude',
    label: 'Claude',
    usedNow: 70,
    usedAtStart: 60,
    baselineSince: MIDNIGHT,
    resetsAt: MIDNIGHT + 2.5 * 86_400_000,
    resetDescription: 'jue, 12:00',
    daysLeft: 2.5,
    allowanceToday: 16,
    usedToday: 10,
    remainingToday: 6,
    remainingWeekly: 30,
    overBudget: false,
    ...overrides
  }
}

function snapshot(overrides: Partial<PaceSnapshot> = {}): PaceSnapshot {
  return { fetchedAt: NOW, rows: [paceRow()], issues: [], error: null, ...overrides }
}

function texts(view: { findAll: (q: object) => { text?: string }[] }): string {
  return view
    .findAll({ type: 'Text' })
    .map((t) => t.text ?? '')
    .join('\n')
}

test('shows what is left for today, the weekly rest and the reset', async () => {
  const host = mockHost({ requests: { 'pace.get': () => snapshot(), 'pace.refresh': () => snapshot() } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Claude' }))
  const all = texts(view)
  assert.match(all, /6\.0% left today of 16\.0%/)
  assert.match(all, /30% of the week left/)
  assert.match(all, /resets jue, 12:00/)
  assert.match(all, /in 2\.5 days/)
  const bar = view.find({ type: 'Progress' })
  assert.equal(bar?.props?.value, 62.5)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('over budget shows by how much in the warning tone', async () => {
  const over = snapshot({
    rows: [paceRow({ usedNow: 80, usedToday: 20, remainingToday: -4, overBudget: true })]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => over } }) })
  const warning = view.find({ type: 'Text', text: /4\.0% over today's 16\.0%/ })
  assert.ok(warning)
  assert.equal(warning.props?.tone, 'warning')
  assert.equal(view.find({ type: 'Progress' })?.props?.value, 100)
  await view.unmount()
})

test('says when the baseline is the first reading after midnight', async () => {
  const late = snapshot({ rows: [paceRow({ baselineSince: MIDNIGHT + 9 * 3_600_000 })] })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => late } }) })
  assert.match(texts(view), /Counting from the first reading today/)
  await view.unmount()
})

test('refresh asks the worker again and shows the new numbers', async () => {
  let current = snapshot()
  const host = mockHost({
    requests: { 'pace.get': () => current, 'pace.refresh': () => current }
  })
  const view = await mount(panel, { host })
  current = snapshot({ rows: [paceRow({ remainingToday: 2, usedToday: 14, usedNow: 74 })] })
  await view.press({ label: 'Refresh' })
  assert.match(texts(view), /2\.0% left today/)
  await view.unmount()
})

test('a posted reading from the worker replaces the shown one', async () => {
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snapshot() } }) })
  await view.post('pace.changed', snapshot({ rows: [paceRow({ label: 'Codex', key: 'codex.weekly' })] }))
  assert.ok(view.find({ label: 'Codex' }))
  await view.unmount()
})

test('provider errors are listed briefly; unavailable ones in one line', async () => {
  const withIssues = snapshot({
    issues: [
      { provider: 'opencodeGo', status: 'error', error: 'The OpenCode Go API key was rejected.' },
      { provider: 'gemini', status: 'unavailable', error: 'Gemini CLI OAuth is disabled' },
      { provider: 'kimi', status: 'unavailable', error: 'Not signed in to Kimi Code' }
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => withIssues } }) })
  const all = texts(view)
  assert.match(all, /opencodeGo: The OpenCode Go API key was rejected\./)
  assert.match(all, /Not connected: gemini, kimi/)
  await view.unmount()
})

test('a CLI error with no windows shows an empty state with the reason', async () => {
  const failed = snapshot({ rows: [], error: 'spawn orca-ide ENOENT' })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => failed } }) })
  assert.ok(view.find({ type: 'EmptyState' }))
  assert.match(JSON.stringify(view.tree()), /spawn orca-ide ENOENT/)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
