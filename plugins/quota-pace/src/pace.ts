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
  /**
   * Where it came from: this plugin's own first reading, a recorded reading (claudeops), or an
   * estimate from Orca's daily token statistics. Missing on baselines stored by 0.1.0.
   */
  source?: BaselineSource
}

export type BaselineSource = 'reading' | 'history' | 'estimate'

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
  baselineSource: BaselineSource
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
  return { date, usedAtStart: window.usedPercent, resetsAt: window.resetsAt, firstSeenAt: now, source: 'reading' }
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

/** One past reading of a window's usedPercent. */
export interface UsageSample {
  /** ms since the epoch. */
  at: number
  used: number
}

/** Past readings per window key, from a source that recorded them before this plugin ran. */
export type UsageHistory = Record<string, UsageSample[]>

const WEEK_MS = 7 * DAY_MS

/**
 * Today's baseline from recorded history: the last reading before local midnight in the current
 * week window, or else the first reading of today. Readings from an earlier week window, or above
 * the current usage, are ignored. Undefined when nothing fits.
 */
export function baselineFromHistory(
  samples: UsageSample[],
  window: WeeklyWindow,
  now: number
): Baseline | undefined {
  const midnight = startOfLocalDay(now)
  const weekStart = window.resetsAt - WEEK_MS
  const valid = samples
    .filter((s) => s.at >= weekStart && s.at <= now && s.used <= window.usedPercent)
    .sort((a, b) => a.at - b.at)
  const beforeMidnight = valid.filter((s) => s.at < midnight).pop()
  const date = localDateKey(now)
  if (beforeMidnight) {
    return { date, usedAtStart: beforeMidnight.used, resetsAt: window.resetsAt, firstSeenAt: midnight, source: 'history' }
  }
  const firstToday = valid.find((s) => s.at >= midnight)
  if (firstToday) {
    return { date, usedAtStart: firstToday.used, resetsAt: window.resetsAt, firstSeenAt: firstToday.at, source: 'history' }
  }
  return undefined
}

/**
 * Claude's weekly utilization log from claudeops (`~/.claudeops/snapshot-cache.json`,
 * `history.windows["7d"]`, entries `{ at: ISO time, utilization: percent }`), as `claude.weekly`.
 * Anything malformed is dropped.
 */
export function parseClaudeopsHistory(json: unknown): UsageHistory {
  const windows = (json as { history?: { windows?: unknown } } | null)?.history?.windows
  if (!windows || typeof windows !== 'object') return {}
  const week = (windows as Record<string, unknown>)['7d']
  if (!Array.isArray(week)) return {}
  const samples: UsageSample[] = []
  for (const entry of week) {
    const at = Date.parse(String((entry as { at?: unknown })?.at))
    const used = (entry as { utilization?: unknown })?.utilization
    if (Number.isFinite(at) && typeof used === 'number' && Number.isFinite(used)) samples.push({ at, used })
  }
  return samples.length > 0 ? { 'claude.weekly': samples } : {}
}

/** Tokens spent on one local day (`YYYY-MM-DD`). */
export interface DailyTokens {
  day: string
  tokens: number
}

/** Daily token totals per window key, from Orca's usage statistics. */
export type DailyUsage = Record<string, DailyTokens[]>

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Orca's daily usage aggregates (`orca-<provider>-usage.json`, `dailyAggregates`) as tokens per
 * day, optionally only for models whose name contains `model`. Cache reads are left out (Claude's
 * `cacheReadTokens`, Codex's `cachedInputTokens` inside `inputTokens`): they cost almost no quota.
 */
export function parseOrcaDailyUsage(json: unknown, model?: string): DailyTokens[] {
  const rows = (json as { dailyAggregates?: unknown } | null)?.dailyAggregates
  if (!Array.isArray(rows)) return []
  const byDay = new Map<string, number>()
  for (const row of rows as Record<string, unknown>[]) {
    const day = row?.day
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    if (model && !String(row.model ?? '').toLowerCase().includes(model)) continue
    const input = Math.max(0, num(row.inputTokens) - num(row.cachedInputTokens))
    const tokens = input + num(row.outputTokens) + num(row.cacheWriteTokens)
    byDay.set(day, (byDay.get(day) ?? 0) + tokens)
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, tokens]) => ({ day, tokens }))
}

function localDayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/**
 * Today's baseline estimated from Orca's daily tokens: usedAtStart = usedNow x (1 - share), where
 * share = today's tokens / this week window's tokens. Each day counts by how much of it falls inside
 * the window (the first day only partly). Undefined without tokens today or this week.
 */
export function estimateBaselineFromDaily(
  daily: DailyTokens[],
  window: WeeklyWindow,
  now: number
): Baseline | undefined {
  const midnight = startOfLocalDay(now)
  const weekStart = window.resetsAt - WEEK_MS
  const today = localDateKey(now)
  let week = 0
  let todayTokens = 0
  for (const { day, tokens } of daily) {
    const start = localDayStart(day)
    const end = start + DAY_MS
    const overlap = Math.min(end, now) - Math.max(start, weekStart)
    if (overlap <= 0 || tokens <= 0) continue
    const span = day === today ? overlap : DAY_MS
    week += tokens * Math.min(1, overlap / span)
    if (day === today) todayTokens += tokens
  }
  if (todayTokens <= 0 || week <= 0) return undefined
  const share = Math.min(1, todayTokens / week)
  return {
    date: today,
    usedAtStart: window.usedPercent * (1 - share),
    resetsAt: window.resetsAt,
    firstSeenAt: midnight,
    source: 'estimate'
  }
}

const SOURCE_RANK: Record<BaselineSource, number> = { history: 0, estimate: 1, reading: 2 }

/**
 * Applies the baselines to fresh windows: the rows to draw and the baselines to store. Of the
 * candidates (recorded history, an estimate from Orca's daily tokens, this plugin's own first
 * reading), the one that starts earliest today wins, because it saw usage the others missed; on a
 * tie, recorded history beats an estimate, which beats a plain reading.
 */
export function buildRows(
  windows: WeeklyWindow[],
  stored: Record<string, Baseline>,
  now: number,
  history: UsageHistory = {},
  daily: DailyUsage = {}
): { rows: PaceRow[]; baselines: Record<string, Baseline> } {
  const baselines: Record<string, Baseline> = {}
  const rows = windows.map((w) => {
    const candidates = [
      baselineFromHistory(history[w.key] ?? [], w, now),
      estimateBaselineFromDaily(daily[w.key] ?? [], w, now),
      nextBaseline(stored[w.key], w, now)
    ].filter((b): b is Baseline => b !== undefined)
    const rank = (b: Baseline) => SOURCE_RANK[b.source ?? 'reading']
    let baseline = candidates.reduce((best, b) =>
      b.firstSeenAt < best.firstSeenAt || (b.firstSeenAt === best.firstSeenAt && rank(b) < rank(best)) ? b : best
    )
    if (baseline.source === 'estimate') {
      // Usage only grows during a window, so the start of today is at most any real reading today.
      const lowestReal = Math.min(...candidates.filter((b) => b.source !== 'estimate').map((b) => b.usedAtStart))
      if (lowestReal < baseline.usedAtStart) baseline = { ...baseline, usedAtStart: lowestReal }
    }
    baselines[w.key] = baseline
    const pace = computePace({ usedAtStart: baseline.usedAtStart, usedNow: w.usedPercent, resetsAt: w.resetsAt, now })
    return {
      key: w.key,
      provider: w.provider,
      label: w.label,
      usedNow: w.usedPercent,
      usedAtStart: baseline.usedAtStart,
      baselineSince: baseline.firstSeenAt,
      baselineSource: baseline.source ?? 'reading',
      resetsAt: w.resetsAt,
      resetDescription: w.resetDescription,
      ...pace
    }
  })
  return { rows, baselines }
}
