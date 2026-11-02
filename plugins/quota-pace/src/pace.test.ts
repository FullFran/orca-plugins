// Pure pace logic: the formula, the daily baseline and parsing `orca account list --json`.
import { assert, test } from 'orca/testing'
import {
  baselineFromHistory,
  buildRows,
  computePace,
  estimateBaselineFromDaily,
  parseOrcaDailyUsage,
  parseClaudeopsHistory,
  extractWeeklyWindows,
  nextBaseline,
  localDateKey as localDateKeyAt,
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
    firstSeenAt: firstSeen,
    source: 'reading'
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

// History: claudeops keeps a log of Claude's weekly utilization, so today's baseline can come
// from before the plugin first ran.
const HOUR = 3_600_000

test('history: the last reading before midnight is the baseline', () => {
  const samples = [
    { at: MIDNIGHT - 5 * HOUR, used: 40 },
    { at: MIDNIGHT - 1 * HOUR, used: 47 },
    { at: MIDNIGHT + 12 * HOUR, used: 55 }
  ]
  const b = baselineFromHistory(samples, window({ usedPercent: 60 }), MIDNIGHT + 22 * HOUR)
  assert.equal(b?.usedAtStart, 47)
  assert.equal(b?.firstSeenAt, MIDNIGHT)
})

test('history: without a reading before midnight, the first reading of today', () => {
  const samples = [
    { at: MIDNIGHT + 13 * HOUR, used: 49 },
    { at: MIDNIGHT + 12 * HOUR, used: 48 }
  ]
  const b = baselineFromHistory(samples, window({ usedPercent: 60 }), MIDNIGHT + 22 * HOUR)
  assert.equal(b?.usedAtStart, 48)
  assert.equal(b?.firstSeenAt, MIDNIGHT + 12 * HOUR)
})

test('history: readings from a previous week window are ignored', () => {
  const w = window({ usedPercent: 10, resetsAt: MIDNIGHT + 6.5 * DAY })
  // This week started half a day ago; a 90% reading from last week is not a baseline.
  const samples = [{ at: MIDNIGHT - 1 * HOUR, used: 90 }]
  assert.equal(baselineFromHistory(samples, w, MIDNIGHT + 2 * HOUR), undefined)
})

test('history: a reading above the current usage is ignored', () => {
  const samples = [{ at: MIDNIGHT + 1 * HOUR, used: 70 }]
  assert.equal(baselineFromHistory(samples, window({ usedPercent: 60 }), MIDNIGHT + 2 * HOUR), undefined)
})

test('buildRows prefers an earlier history baseline over the first plugin reading', () => {
  const now = MIDNIGHT + 22 * HOUR
  const stored: Record<string, Baseline> = {
    'claude.weekly': { date: '2026-11-02', usedAtStart: 60, resetsAt: MIDNIGHT + 2.5 * DAY, firstSeenAt: now - HOUR }
  }
  const history = { 'claude.weekly': [{ at: MIDNIGHT + 12 * HOUR, used: 48 }] }
  const { rows, baselines } = buildRows([window({ usedPercent: 60 })], stored, now, history)
  assert.equal(rows[0].usedAtStart, 48)
  assert.equal(rows[0].usedToday, 12)
  assert.equal(baselines['claude.weekly'].usedAtStart, 48)
})

test('buildRows keeps windows without history as before', () => {
  const now = MIDNIGHT + 22 * HOUR
  const { rows } = buildRows([window({ key: 'codex.weekly', usedPercent: 37 })], {}, now, {
    'claude.weekly': [{ at: MIDNIGHT + 12 * HOUR, used: 48 }]
  })
  assert.equal(rows[0].usedAtStart, 37)
  assert.equal(rows[0].usedToday, 0)
})

test('parseClaudeopsHistory maps the 7d window to claude.weekly', () => {
  const json = {
    history: {
      windows: {
        '5h': [{ at: '2026-11-02T10:00:00Z', utilization: 3 }],
        '7d': [
          { at: '2026-11-02T11:52:09.99+01:00', utilization: 48 },
          { at: 'not a date', utilization: 50 },
          { at: '2026-11-02T12:02:10+01:00', utilization: 'x' }
        ]
      }
    }
  }
  const h = parseClaudeopsHistory(json)
  assert.deepEqual(Object.keys(h), ['claude.weekly'])
  assert.equal(h['claude.weekly'].length, 1)
  assert.equal(h['claude.weekly'][0].used, 48)
  assert.equal(h['claude.weekly'][0].at, Date.parse('2026-11-02T11:52:09.99+01:00'))
  assert.deepEqual(parseClaudeopsHistory(null), {})
  assert.deepEqual(parseClaudeopsHistory({ history: 'nope' }), {})
})

// Orca's own statistics: tokens per local day. Cache reads are left out because they cost
// almost no quota; with them the share of today is badly overstated.
test('estimate: today\'s share of this week\'s tokens gives the baseline at midnight', () => {
  // The week started 4.5 days before midnight: half of that first day counts, then four full days
  // and today, so today's share is 100 / (50 + 400 + 100).
  const w = window({ usedPercent: 60, resetsAt: MIDNIGHT + 2.5 * DAY })
  const day = (offset: number) => localDateKeyAt(MIDNIGHT + offset * DAY)
  const daily = [
    { day: day(-5), tokens: 100 }, // before the week window: weekStart = MIDNIGHT - 4.5 days
    { day: day(-4), tokens: 100 },
    { day: day(-3), tokens: 100 },
    { day: day(-2), tokens: 100 },
    { day: day(-1), tokens: 100 },
    { day: day(0), tokens: 100 }
  ]
  const now = MIDNIGHT + 12 * HOUR
  const b = estimateBaselineFromDaily(daily, w, now)
  // Overlaps: day -5 counts 0.5, days -4..-1 count 1, today counts fully (up to now).
  const share = 100 / (50 + 400 + 100)
  assert.ok(b)
  assert.ok(Math.abs((b?.usedAtStart ?? 0) - 60 * (1 - share)) < 1e-9)
  assert.equal(b?.firstSeenAt, MIDNIGHT)
  assert.equal(b?.source, 'estimate')
})

test('estimate: no tokens today or no week data gives no estimate', () => {
  const w = window({ usedPercent: 60 })
  const now = MIDNIGHT + 12 * HOUR
  assert.equal(estimateBaselineFromDaily([], w, now), undefined)
  assert.equal(estimateBaselineFromDaily([{ day: localDateKeyAt(MIDNIGHT - DAY), tokens: 50 }], w, now), undefined)
})

test('parseOrcaDailyUsage sums Claude tokens per day without cache reads, optionally by model', () => {
  const json = {
    dailyAggregates: [
      { day: '2026-11-02', model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 20, cacheReadTokens: 9999, cacheWriteTokens: 5 },
      { day: '2026-11-02', model: 'claude-fable-5-1', inputTokens: 1, outputTokens: 2, cacheReadTokens: 9999, cacheWriteTokens: 0 },
      { day: '2026-11-01', model: 'claude-opus-5-5', inputTokens: 3, outputTokens: 4, cacheReadTokens: 1, cacheWriteTokens: 0 },
      { day: 'bad', model: 'x', inputTokens: 1 }
    ]
  }
  assert.deepEqual(parseOrcaDailyUsage(json), [
    { day: '2026-11-01', tokens: 7 },
    { day: '2026-11-02', tokens: 38 }
  ])
  assert.deepEqual(parseOrcaDailyUsage(json, 'fable'), [{ day: '2026-11-02', tokens: 3 }])
  assert.deepEqual(parseOrcaDailyUsage(null), [])
})

test('parseOrcaDailyUsage leaves cached input out of Codex input', () => {
  const json = { dailyAggregates: [{ day: '2026-11-02', inputTokens: 100, cachedInputTokens: 80, outputTokens: 5 }] }
  assert.deepEqual(parseOrcaDailyUsage(json), [{ day: '2026-11-02', tokens: 25 }])
})

test('buildRows: a measured reading before midnight beats an estimate; an estimate beats a later reading', () => {
  const now = MIDNIGHT + 22 * HOUR
  const w = window({ usedPercent: 60 })
  const daily = { 'claude.weekly': [{ day: localDateKeyAt(MIDNIGHT - DAY), tokens: 400 }, { day: localDateKeyAt(MIDNIGHT), tokens: 100 }] }
  const measured = { 'claude.weekly': [{ at: MIDNIGHT - HOUR, used: 47 }] }
  assert.equal(buildRows([w], {}, now, measured, daily).rows[0].baselineSource, 'history')
  const later = { 'claude.weekly': [{ at: MIDNIGHT + 12 * HOUR, used: 48 }] }
  const est = buildRows([w], {}, now, later, daily).rows[0]
  assert.equal(est.baselineSource, 'estimate')
  assert.equal(est.baselineSince, MIDNIGHT)
  assert.equal(buildRows([w], {}, now).rows[0].baselineSource, 'reading')
})

test('buildRows: an estimate never starts above a real reading from today (usage only grows)', () => {
  const now = MIDNIGHT + 22 * HOUR
  const w = window({ usedPercent: 61 })
  // Tokens say ~19% of the week was today -> about 49.4 at midnight, but 48 was measured at noon.
  const daily = { 'claude.weekly': [{ day: localDateKeyAt(MIDNIGHT - DAY), tokens: 420 }, { day: localDateKeyAt(MIDNIGHT), tokens: 100 }] }
  const history = { 'claude.weekly': [{ at: MIDNIGHT + 12 * HOUR, used: 48 }] }
  const r = buildRows([w], {}, now, history, daily).rows[0]
  assert.equal(r.baselineSource, 'estimate')
  assert.equal(r.usedAtStart, 48)
  assert.equal(r.usedToday, 13)
})
