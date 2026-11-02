// Pure pace logic: the formula, the daily baseline and parsing `orca account list --json`.
import { assert, test } from 'orca/testing'
import {
  computePace,
  extractWeeklyWindows,
  nextBaseline,
  startOfLocalDay,
  type Baseline,
  type WeeklyWindow
} from './pace'
import { REAL_RATE_LIMITS } from './fixtures'

const DAY = 86_400_000
// Local midnight, so the tests hold in any time zone.
const MIDNIGHT = new Date(2026, 10, 2, 0, 0, 0, 0).getTime()

function window(overrides: Partial<WeeklyWindow> = {}): WeeklyWindow {
  return {
    key: 'claude.weekly',
    provider: 'claude',
    label: 'Claude',
    usedPercent: 60,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    resetDescription: 'jue, 12:00',
    ...overrides
  }
}

test('startOfLocalDay is local midnight', () => {
  assert.equal(startOfLocalDay(MIDNIGHT + 13 * 3_600_000), MIDNIGHT)
})

test('worked example: 60% used at midnight, reset 2.5 days later, 70% now', () => {
  const pace = computePace({
    usedAtStart: 60,
    usedNow: 70,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    now: MIDNIGHT + 10 * 3_600_000
  })
  assert.equal(pace.daysLeft, 2.5)
  assert.equal(pace.allowanceToday, 16)
  assert.equal(pace.usedToday, 10)
  assert.equal(pace.remainingToday, 6)
  assert.equal(pace.remainingWeekly, 30)
  assert.equal(pace.overBudget, false)
})

test('over budget: remaining today goes negative', () => {
  const pace = computePace({
    usedAtStart: 60,
    usedNow: 80,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    now: MIDNIGHT + 10 * 3_600_000
  })
  assert.equal(pace.remainingToday, -4)
  assert.equal(pace.overBudget, true)
})

test('allowance is capped at what is left when the reset is less than a day away', () => {
  const pace = computePace({
    usedAtStart: 90,
    usedNow: 90,
    resetsAt: MIDNIGHT + 0.5 * DAY,
    now: MIDNIGHT + 3_600_000
  })
  assert.equal(pace.allowanceToday, 10)
  assert.equal(pace.remainingToday, 10)
})

test('a reset at or before midnight does not divide by zero', () => {
  const pace = computePace({ usedAtStart: 20, usedNow: 20, resetsAt: MIDNIGHT, now: MIDNIGHT + 1 })
  assert.equal(pace.allowanceToday, 80)
  assert.ok(Number.isFinite(pace.daysLeft))
})

test('usage below the baseline never counts as negative use', () => {
  const pace = computePace({
    usedAtStart: 60,
    usedNow: 55,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    now: MIDNIGHT + 1
  })
  assert.equal(pace.usedToday, 0)
})

test('first observation of the day sets the baseline, even after midnight', () => {
  const firstSeen = MIDNIGHT + 9 * 3_600_000
  const baseline = nextBaseline(undefined, window({ usedPercent: 64 }), firstSeen)
  assert.deepEqual(baseline, {
    date: '2026-11-02',
    usedAtStart: 64,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    firstSeenAt: firstSeen
  })
  // Later readings the same day keep it.
  const later = nextBaseline(baseline, window({ usedPercent: 70 }), firstSeen + 3_600_000)
  assert.deepEqual(later, baseline)
})

test('a new local day starts a new baseline from the current reading', () => {
  const yesterday: Baseline = {
    date: '2026-11-01',
    usedAtStart: 40,
    resetsAt: MIDNIGHT + 2.5 * DAY,
    firstSeenAt: MIDNIGHT - 5 * 3_600_000
  }
  const baseline = nextBaseline(yesterday, window({ usedPercent: 60 }), MIDNIGHT + 60_000)
  assert.equal(baseline.date, '2026-11-02')
  assert.equal(baseline.usedAtStart, 60)
})

test('reset rollover: once resetsAt passes, the baseline starts fresh the same day', () => {
  const oldReset = MIDNIGHT + 10 * 3_600_000
  const before: Baseline = {
    date: '2026-11-02',
    usedAtStart: 95,
    resetsAt: oldReset,
    firstSeenAt: MIDNIGHT
  }
  const after = nextBaseline(
    before,
    window({ usedPercent: 1, resetsAt: oldReset + 7 * DAY }),
    oldReset + 60_000
  )
  assert.equal(after.usedAtStart, 1)
  assert.equal(after.resetsAt, oldReset + 7 * DAY)
  assert.equal(after.firstSeenAt, oldReset + 60_000)
})

test('millisecond jitter in resetsAt keeps the same baseline', () => {
  const baseline = nextBaseline(undefined, window({ resetsAt: MIDNIGHT + 2.5 * DAY }), MIDNIGHT + 1)
  const later = nextBaseline(
    baseline,
    window({ usedPercent: 70, resetsAt: MIDNIGHT + 2.5 * DAY - 325 }),
    MIDNIGHT + 3_600_000
  )
  assert.equal(later.usedAtStart, 60)
})

test('parses the real `orca account list --json` shape: weekly windows only, null skipped', () => {
  const { windows, issues } = extractWeeklyWindows(REAL_RATE_LIMITS)
  assert.deepEqual(
    windows.map((w) => [w.key, w.label, w.usedPercent]),
    [
      ['claude.weekly', 'Claude', 60],
      ['claude.fableWeekly', 'Claude · Fable', 0],
      ['codex.weekly', 'Codex', 37],
      ['antigravity.weekly', 'Antigravity', 0]
    ]
  )
  assert.equal(windows[0]?.resetsAt, 1793872799675)
  assert.equal(windows[0]?.resetDescription, 'jue, 10:59')
  assert.deepEqual(issues, [
    {
      provider: 'gemini',
      status: 'unavailable',
      error: 'Gemini CLI OAuth is disabled in settings'
    },
    {
      provider: 'opencodeGo',
      status: 'error',
      error: 'The OpenCode Go API key was rejected.'
    }
  ])
})

test('ignores malformed provider entries', () => {
  const { windows, issues } = extractWeeklyWindows({
    broken: 'nope',
    other: { weekly: { usedPercent: 'x', windowMinutes: 10080, resetsAt: 1 } },
    missing: null
  })
  assert.deepEqual(windows, [])
  assert.deepEqual(issues, [])
})
