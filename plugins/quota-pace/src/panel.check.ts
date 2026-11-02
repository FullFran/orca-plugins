// `orca plugin check` renders the panel once per scenario. The worker would run the real CLI, so
// each scenario stubs the two requests with fixed snapshots.
import { defineCheck } from 'orca/testing'
import type { PaceSnapshot } from './pace'

const MIDNIGHT = new Date(2026, 10, 2).getTime()
const base = {
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
  overBudget: false
}

function stub(snapshot: PaceSnapshot) {
  return { requests: { 'pace.get': () => snapshot, 'pace.refresh': () => snapshot } }
}

export default defineCheck({
  'on pace': stub({ fetchedAt: MIDNIGHT + 36e6, rows: [base], issues: [], error: null }),
  'over budget and issues': stub({
    fetchedAt: MIDNIGHT + 36e6,
    rows: [
      { ...base, usedNow: 80, usedToday: 20, remainingToday: -4, overBudget: true },
      { ...base, key: 'codex.weekly', provider: 'codex', label: 'Codex', baselineSince: MIDNIGHT + 9 * 36e5 }
    ],
    issues: [
      { provider: 'opencodeGo', status: 'error', error: 'The OpenCode Go API key was rejected.' },
      { provider: 'gemini', status: 'unavailable', error: 'Gemini CLI OAuth is disabled' }
    ],
    error: null
  }),
  'cli failed': stub({ fetchedAt: MIDNIGHT, rows: [], issues: [], error: 'spawn orca-ide ENOENT' })
})
