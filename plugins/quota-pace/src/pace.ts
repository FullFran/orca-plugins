// Pure pace logic, shared by the worker and the panel: no Orca or Node imports.

const DAY_MS = 86_400_000
const WEEK_MINUTES = 10_080
/** resetsAt moves by a few ms between readings; a bigger move means a new window. */
const RESET_JITTER_MS = 60 * 60_000

/** One weekly quota window read from `orca account list --json`. */
export interface WeeklyWindow {
  /** `<provider>.<window>`, e.g. `claude.fableWeekly`. */
  key: string
  provider: string
  label: string
  usedPercent: number
  /** ms since the epoch. */
  resetsAt: number
  resetDescription: string | null
}

/** A provider that answered no usable window, with Orca's reason. */
export interface ProviderIssue {
  provider: string
  status: string
  error: string
}

/** The usedPercent first seen on a local day, for one window. */
export interface Baseline {
  /** Local date `YYYY-MM-DD`. */
  date: string
  usedAtStart: number
  resetsAt: number
  /** When that first reading happened (midnight or later). */
  firstSeenAt: number
}

export interface Pace {
  daysLeft: number
  allowanceToday: number
  usedToday: number
  remainingToday: number
  remainingWeekly: number
  overBudget: boolean
}

/** What the panel draws for one window. */
export interface PaceRow extends Pace {
  key: string
  provider: string
  label: string
  usedNow: number
  usedAtStart: number
  baselineSince: number
  resetsAt: number
  resetDescription: string | null
}

export interface PaceSnapshot {
  /** When the CLI was read; null before the first read. */
  fetchedAt: number | null
  rows: PaceRow[]
  issues: ProviderIssue[]
  /** Why the read failed, or null. */
  error: string | null
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function localDateKey(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  opencodeGo: 'OpenCode Go',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  grok: 'Grok',
  cursor: 'Cursor',
  zcode: 'ZCode'
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Claude" for `weekly`, "Claude · Fable" for `fableWeekly`. */
export function windowLabel(provider: string, windowKey: string): string {
  const name = PROVIDER_LABELS[provider] ?? capitalise(provider)
  if (windowKey === 'weekly') return name
  const qualifier = windowKey.replace(/Weekly$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
  return `${name} · ${capitalise(qualifier)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asWindow(value: unknown): { usedPercent: number; resetsAt: number; resetDescription: string | null } | null {
  if (!isRecord(value)) return null
  const { usedPercent, windowMinutes, resetsAt, resetDescription } = value
  if (windowMinutes !== WEEK_MINUTES) return null
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null
  return {
    usedPercent,
    resetsAt,
    resetDescription: typeof resetDescription === 'string' ? resetDescription : null
  }
}

/** Every weekly window (`windowMinutes` 10080) in `result.rateLimits`, plus providers that failed. */
export function extractWeeklyWindows(rateLimits: unknown): {
  windows: WeeklyWindow[]
  issues: ProviderIssue[]
} {
  const windows: WeeklyWindow[] = []
  const issues: ProviderIssue[] = []
  if (!isRecord(rateLimits)) return { windows, issues }
  for (const [provider, entry] of Object.entries(rateLimits)) {
    if (!isRecord(entry)) continue
    let found = 0
    for (const [windowKey, value] of Object.entries(entry)) {
      const w = asWindow(value)
      if (!w) continue
      found += 1
      windows.push({ key: `${provider}.${windowKey}`, provider, label: windowLabel(provider, windowKey), ...w })
    }
    if (found === 0 && typeof entry.error === 'string' && entry.error) {
      issues.push({
        provider,
        status: typeof entry.status === 'string' ? entry.status : 'error',
        error: entry.error
      })
    }
  }
  return { windows, issues }
}

/**
 * The baseline to use now. Keeps `previous` while it is from today and the same window; starts a
 * fresh one (from the current reading) on a new local day, once `resetsAt` has passed, when the
 * window's reset moved, or when usage dropped below the baseline (a reset Orca reported early).
 */
export function nextBaseline(previous: Baseline | undefined, window: WeeklyWindow, now: number): Baseline {
  const date = localDateKey(now)
  const keep =
    previous !== undefined &&
    previous.date === date &&
    now < previous.resetsAt &&
    Math.abs(window.resetsAt - previous.resetsAt) <= RESET_JITTER_MS &&
    window.usedPercent >= previous.usedAtStart
  if (keep) return previous
  return { date, usedAtStart: window.usedPercent, resetsAt: window.resetsAt, firstSeenAt: now }
}

/**
 * Spread what was left at the start of today evenly over the days until the reset:
 * daysLeft = (resetsAt - startOfToday) / 1 day, allowanceToday = (100 - usedAtStart) / daysLeft
 * (at most 100 - usedAtStart), remainingToday = allowanceToday - (usedNow - usedAtStart).
 */
export function computePace(input: {
  usedAtStart: number
  usedNow: number
  resetsAt: number
  now: number
}): Pace {
  const { usedAtStart, usedNow, resetsAt, now } = input
  const left = Math.max(0, 100 - usedAtStart)
  const daysLeft = (resetsAt - startOfLocalDay(now)) / DAY_MS
  const allowanceToday = daysLeft <= 0 ? left : Math.min(left, left / daysLeft)
  const usedToday = Math.max(0, usedNow - usedAtStart)
  const remainingToday = allowanceToday - usedToday
  return {
    daysLeft: Math.max(0, daysLeft),
    allowanceToday,
    usedToday,
    remainingToday,
    remainingWeekly: Math.max(0, 100 - usedNow),
    overBudget: remainingToday < 0
  }
}

/** Applies the baselines to fresh windows: the rows to draw and the baselines to store. */
export function buildRows(
  windows: WeeklyWindow[],
  stored: Record<string, Baseline>,
  now: number
): { rows: PaceRow[]; baselines: Record<string, Baseline> } {
  const baselines: Record<string, Baseline> = {}
  const rows = windows.map((w) => {
    const baseline = nextBaseline(stored[w.key], w, now)
    baselines[w.key] = baseline
    const pace = computePace({ usedAtStart: baseline.usedAtStart, usedNow: w.usedPercent, resetsAt: w.resetsAt, now })
    return {
      key: w.key,
      provider: w.provider,
      label: w.label,
      usedNow: w.usedPercent,
      usedAtStart: baseline.usedAtStart,
      baselineSince: baseline.firstSeenAt,
      resetsAt: w.resetsAt,
      resetDescription: w.resetDescription,
      ...pace
    }
  })
  return { rows, baselines }
}
