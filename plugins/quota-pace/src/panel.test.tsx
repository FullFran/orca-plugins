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
    baselineSource: 'reading',
    resetsAt: MIDNIGHT + 2.5 * 86_400_000,
    resetDescription: 'jue, 12:00',
    daysLeft: 2.5,
    allowanceToday: 16,
    usedToday: 10,
    remainingToday: 6,
    remainingWeekly: 30,
    overBudget: false,
    remainingTodayLive: 4.8,
    sustainablePerHour: 0.5,
    hoursUntilReset: 60,
    daysUntilReset: 2.5,
    reservePercent: 0,
    dailyBudget: 16,
    dailyDeviation: -6,
    currentBurnRate: 0.35,
    sustainableBurnRate: 0.5,
    paceMultiplier: 0.7,
    estimatedExhaustionAt: null,
    projectedRemainingAtReset: 9,
    forecastStatus: 'normal',
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
  assert.match(all, /You can spend 4\.8% of your week today/)
  assert.match(all, /On track/)
  assert.match(all, /Week: 70% used · resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2} \(in 2 d 12 h\)/)
  const bar = view.find({ type: 'Progress' })
  assert.equal(bar?.props?.value, 70)
  assert.equal(bar?.props?.label, 'Week used: 70% (today: 10.0%)')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('over budget shows by how much in the warning tone', async () => {
  const over = snapshot({
    rows: [paceRow({ usedNow: 80, usedToday: 20, remainingToday: -4, overBudget: true, remainingTodayLive: 2.0 })]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => over } }) })
  const warning = view.find({ type: 'Text', text: /Today's share is spent; 4\.0% over/ })
  assert.ok(warning)
  assert.equal(warning.props?.tone, 'warning')
  assert.match(texts(view), /Sustainable from now: 2\.0% of your week/)
  assert.equal(view.find({ type: 'Progress' })?.props?.value, 80)
  await view.unmount()
})

test('says when the baseline is the first reading after midnight', async () => {
  const late = snapshot({ rows: [paceRow({ baselineSince: MIDNIGHT + 9 * 3_600_000 })] })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => late } }) })
  await view.toggle({ type: 'Collapsible' })
  assert.match(texts(view), /Counting from the first reading today/)
  await view.unmount()
})

test('refresh asks the worker again and shows the new numbers', async () => {
  let current = snapshot()
  const host = mockHost({
    requests: { 'pace.get': () => current, 'pace.refresh': () => current }
  })
  const view = await mount(panel, { host })
  current = snapshot({ rows: [paceRow({ remainingToday: 2, remainingTodayLive: 2, usedToday: 14, usedNow: 74 })] })
  await view.press({ label: 'Refresh' })
  assert.match(texts(view), /You can spend 2\.0% of your week today/)
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

test('says where the start of today comes from', async () => {
  const both = snapshot({
    rows: [
      paceRow({ key: 'a', baselineSource: 'history', baselineSince: MIDNIGHT }),
      paceRow({ key: 'b', baselineSource: 'estimate', baselineSince: MIDNIGHT })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => both } }) })
  const collapsibles = view.findAll({ type: 'Collapsible' })
  for (const c of collapsibles) {
    await view.toggle(c)
  }
  assert.match(texts(view), /Start of today from claudeops/)
  assert.match(texts(view), /estimated from Orca's token statistics/)
  await view.unmount()
})

test('shows live allowance, sustainable pace and burn rate status', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        remainingTodayLive: 4.8,
        sustainablePerHour: 0.5,
        currentBurnRate: 0.35,
        paceMultiplier: 0.7,
        forecastStatus: 'normal'
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  assert.match(texts(view), /You can spend 4\.8% of your week today/)
  assert.match(texts(view), /On track/)
  await view.toggle({ type: 'Collapsible' })
  const all = texts(view)
  assert.match(all, /Sustainable rate: 0\.50 %\/h/)
  assert.match(all, /Current rate: 0\.35 %\/h/)
  assert.match(all, /Pace multiplier: 0\.7× the sustainable rate/)
  await view.unmount()
})

test('shows warning when pace is unsustainable and projected exhaustion is before reset', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        forecastStatus: 'unsustainable',
        currentBurnRate: 2.5,
        paceMultiplier: 5.0,
        estimatedExhaustionAt: MIDNIGHT + 20 * 36e5
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  const all = texts(view)
  assert.match(all, /Faster than sustainable — at this rate the week runs out/)
  const warning = view.find({ type: 'Text', text: /Faster than sustainable/ })
  assert.equal(warning?.props?.tone, 'warning')
  await view.unmount()
})

test('shows both live allowance and adaptive live allowance when profile is in use', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        remainingTodayLive: 4.8,
        sustainablePerHour: 0.5,
        remainingTodayAdaptive: 5.2,
        profileDays: 30
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  assert.match(texts(view), /5\.2% today, based on your usual hours/)
  await view.toggle({ type: 'Collapsible' })
  assert.match(texts(view), /Profile history: 30 days/)
  await view.unmount()
})

test('shows profile fallback note when uniform fallback is in effect', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        remainingTodayLive: 4.8,
        remainingTodayAdaptive: null,
        profileNote: 'profile has 7 days, needs 14'
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  assert.match(texts(view), /You can spend 4\.8% of your week today/)
  await view.toggle({ type: 'Collapsible' })
  assert.match(texts(view), /profile has 7 days, needs 14/)
  await view.unmount()
})

// Rule-specific tests
test('rule 1: no "pp" anywhere in rendered output', async () => {
  const host = mockHost({
    requests: {
      'pace.get': () =>
        snapshot({
          rows: [
            paceRow({
              remainingTodayLive: 4.8,
              sustainablePerHour: 0.5,
              remainingTodayAdaptive: 6.1,
              profileDays: 30,
              currentBurnRate: 0.35,
              paceMultiplier: 0.7
            })
          ]
        })
    }
  })
  const view = await mount(panel, { host })
  await view.toggle({ type: 'Collapsible' })
  const all = texts(view)
  assert.doesNotMatch(all, /\bpp\b/)
  assert.doesNotMatch(all, /pp\/h/)
  await view.unmount()
})

test('rule 2: headline uses adaptive when present and uniform otherwise', async () => {
  // Adaptive
  const adaptiveSnap = snapshot({
    rows: [paceRow({ remainingTodayAdaptive: 6.1, profileDays: 30 })]
  })
  let view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => adaptiveSnap } }) })
  assert.match(texts(view), /6\.1% today, based on your usual hours/)
  await view.unmount()

  // Uniform
  const uniformSnap = snapshot({
    rows: [paceRow({ remainingTodayAdaptive: null, remainingTodayLive: 4.8 })]
  })
  view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => uniformSnap } }) })
  assert.match(texts(view), /You can spend 4\.8% of your week today/)
  await view.unmount()
})

test('rule 2: over-budget headline shows overspend and sustainable amount', async () => {
  const overSnap = snapshot({
    rows: [
      paceRow({
        overBudget: true,
        remainingToday: -2.3,
        remainingTodayLive: 1.5
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => overSnap } }) })
  const all = texts(view)
  assert.match(all, /Today's share is spent; 2\.3% over/)
  assert.match(all, /Sustainable from now: 1\.5% of your week/)
  const warning = view.find({ type: 'Text', text: /Today's share is spent; 2\.3% over/ })
  assert.equal(warning?.props?.tone, 'warning')
  await view.unmount()
})

test('rule 3: each status line state renders with the correct tone and text', async () => {
  const cases: {
    status: PaceRow['forecastStatus']
    usedNow?: number
    estimatedExhaustionAt?: number | null
    pattern: RegExp
    tone?: string
    muted?: boolean
  }[] = [
    { status: 'normal', pattern: /On track/ },
    {
      status: 'unsustainable',
      estimatedExhaustionAt: new Date(2026, 10, 4, 18, 0).getTime(),
      pattern: /Faster than sustainable — at this rate the week runs out Wed 18:00/,
      tone: 'warning'
    },
    { status: 'spike', pattern: /Brief spike, trend OK/, tone: 'warning' },
    { status: 'insufficient_data', pattern: /Learning your pace \(needs a few readings\)/, muted: true },
    { status: 'stale', pattern: /Readings are stale \(last \d+ min ago\)/, tone: 'warning' },
    { status: 'exhausted', pattern: /Week used up/, tone: 'warning' }
  ]

  for (const c of cases) {
    const snap = snapshot({
      rows: [
        paceRow({
          forecastStatus: c.status,
          usedNow: c.usedNow ?? 70,
          estimatedExhaustionAt: c.estimatedExhaustionAt ?? null
        })
      ]
    })
    const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
    const elem = view.find({ type: 'Text', text: c.pattern })
    assert.ok(elem, `Expected to find status text matching ${c.pattern}`)
    if (c.tone) {
      assert.equal(elem.props?.tone, c.tone)
    }
    if (c.muted) {
      assert.equal(elem.props?.muted, true)
    }
    await view.unmount()
  }
})

test('rule 4: week line with relative reset time', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        usedNow: 66,
        resetDescription: 'Thu 11:00',
        hoursUntilReset: 68.65
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  const all = texts(view)
  assert.match(all, /Week: 66% used · resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2} \(in 2 d 20 h\)/)
  const bar = view.find({ type: 'Progress' })
  assert.equal(bar?.props?.value, 66)
  assert.match(String(bar?.props?.label), /Week used: 66%/)
  await view.unmount()
})

test('rule 5: details collapsed by default and expandable', async () => {
  const snap = snapshot({
    rows: [
      paceRow({
        allowanceToday: 16,
        usedToday: 10,
        sustainablePerHour: 0.5,
        currentBurnRate: 0.8,
        paceMultiplier: 1.6,
        profileDays: 30
      })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })

  // Collapsed by default: details elements are not visible
  assert.equal(view.find({ type: 'Text', text: /Daily budget set at midnight/ }), null)
  assert.equal(view.find({ type: 'Text', text: /1\.6× the sustainable rate/ }), null)

  // Expand
  await view.toggle({ type: 'Collapsible' })

  // Now visible
  assert.ok(view.find({ type: 'Text', text: /Daily budget set at midnight: 16\.0%/ }))
  assert.ok(view.find({ type: 'Text', text: /Used today: 10\.0%/ }))
  assert.ok(view.find({ type: 'Text', text: /Sustainable rate: 0\.50 %\/h/ }))
  assert.ok(view.find({ type: 'Text', text: /Current rate: 0\.80 %\/h/ }))
  assert.ok(view.find({ type: 'Text', text: /1\.6× the sustainable rate/ }))
  assert.ok(view.find({ type: 'Text', text: /Profile history: 30 days/ }))

  await view.unmount()
})

test('hide persists: hiding card writes to storage and survives restart', async () => {
  const host = mockHost({ requests: { 'pace.get': () => snapshot() } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Claude' }))
  await view.press({ label: 'Hide' })
  assert.equal(view.find({ label: 'Claude' }), null)
  assert.deepEqual(view.persisted.storage['hidden'], ['claude.weekly'])
  await view.unmount()

  // Restart panel with persisted storage
  const host2 = mockHost({
    storage: { hidden: ['claude.weekly'] },
    requests: { 'pace.get': () => snapshot() }
  })
  const view2 = await mount(panel, { host: host2 })
  assert.equal(view2.find({ label: 'Claude' }), null)
  assert.match(texts(view2), /1 hidden · Show/)
  await view2.unmount()
})

test('footer count: increments as cards are hidden', async () => {
  const snap = snapshot({
    rows: [
      paceRow({ key: 'claude.weekly', label: 'Claude' }),
      paceRow({ key: 'codex.weekly', label: 'Codex' })
    ]
  })
  const view = await mount(panel, { host: mockHost({ requests: { 'pace.get': () => snap } }) })
  assert.doesNotMatch(texts(view), /hidden · Show/)

  // Hide first card
  assert.equal(view.findAll({ label: 'Hide' }).length, 2)
  await view.press({ label: 'Hide' })
  assert.match(texts(view), /1 hidden · Show/)

  // Wait for storage cycle
  await new Promise((r) => setTimeout(r, 10))

  // Hide second card
  assert.equal(view.findAll({ label: 'Hide' }).length, 1)
  await view.press({ label: 'Hide' })
  assert.match(texts(view), /2 hidden · Show/)
  await view.unmount()
})

test('unhide restores: clicking Show clears hidden keys and restores cards', async () => {
  const snap = snapshot({
    rows: [
      paceRow({ key: 'claude.weekly', label: 'Claude' }),
      paceRow({ key: 'codex.weekly', label: 'Codex' })
    ]
  })
  const host = mockHost({
    storage: { hidden: ['claude.weekly', 'codex.weekly'] },
    requests: { 'pace.get': () => snap }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ label: 'Claude' }), null)
  assert.equal(view.find({ label: 'Codex' }), null)
  assert.match(texts(view), /2 hidden · Show/)

  // Click Show
  await view.press({ text: 'Show' })
  assert.ok(view.find({ label: 'Claude' }))
  assert.ok(view.find({ label: 'Codex' }))
  assert.doesNotMatch(texts(view), /hidden · Show/)
  assert.deepEqual(view.persisted.storage['hidden'], [])
  await view.unmount()
})

test('reset and exhaustion times share one English 24 h format, ignoring the CLI locale', () => {
  const at = new Date(2026, 10, 12, 18, 5).getTime() // local Thu 12 Nov 2026, 18:05
  assert.equal(panel.weekdayTime(at), 'Thu 18:05')
  assert.equal(panel.weekdayTime(new Date(2026, 10, 12, 0, 30).getTime()), 'Thu 00:30')
})
