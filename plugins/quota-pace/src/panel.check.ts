// `orca plugin check` renders the panel once per scenario. The worker would run the real CLI, so
// each scenario stubs the two requests with fixed snapshots.
import { defineCheck } from 'orca/testing'
import type { PaceRow, PaceSnapshot } from './pace'

const MIDNIGHT = new Date(2026, 10, 2).getTime()
const base: PaceRow = {
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
  forecastStatus: 'normal'
}

function stub(snapshot: PaceSnapshot) {
  return { requests: { 'pace.get': () => snapshot, 'pace.refresh': () => snapshot } }
}

export default defineCheck({
  'on pace': stub({ fetchedAt: MIDNIGHT + 36e6, rows: [base], issues: [], error: null }),
  'over budget and issues': stub({
    fetchedAt: MIDNIGHT + 36e6,
    rows: [
      {
        ...base,
        usedNow: 80,
        usedToday: 20,
        remainingToday: -4,
        overBudget: true,
        remainingTodayLive: 2.0,
        forecastStatus: 'unsustainable',
        currentBurnRate: 1.2,
        paceMultiplier: 2.4,
        estimatedExhaustionAt: MIDNIGHT + 48 * 36e5
      },
      {
        ...base,
        key: 'codex.weekly',
        provider: 'codex',
        label: 'Codex',
        baselineSince: MIDNIGHT + 9 * 36e5,
        forecastStatus: 'insufficient_data',
        currentBurnRate: null,
        paceMultiplier: null
      }
    ],
    issues: [
      { provider: 'opencodeGo', status: 'error', error: 'The OpenCode Go API key was rejected.' },
      { provider: 'gemini', status: 'unavailable', error: 'Gemini CLI OAuth is disabled' }
    ],
    error: null
  }),
  'adaptive profile': stub({
    fetchedAt: MIDNIGHT + 36e6,
    rows: [
      {
        ...base,
        remainingTodayAdaptive: 6.1,
        profileDays: 30
      }
    ],
    issues: [],
    error: null
  }),
  'cli failed': stub({ fetchedAt: MIDNIGHT, rows: [], issues: [], error: 'spawn orca-ide ENOENT' })
})
