// Pure pace logic, shared by the worker and the panel: no Orca or Node imports.

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS
export const WEEK_MINUTES = 10_080
export const MIN_PROFILE_DAYS = 14
export const SAMPLES_CAP = 2500
/** resetsAt moves by a few ms between readings; a bigger move means a new window. */
export const RESET_JITTER_MS = 60 * 60_000

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

export type ForecastStatus =
  | 'insufficient_data'
  | 'stale'
  | 'low'
  | 'normal'
  | 'spike'
  | 'unsustainable'
  | 'exhausted'

export interface PaceForecast {
  currentBurnRate: number | null // in pp/h (null if insufficient data or stale)
  sustainableBurnRate: number // in pp/h
  paceMultiplier: number | null // currentBurnRate / sustainableBurnRate
  estimatedExhaustionAt: number | null // timestamp ms or null
  projectedRemainingAtReset: number | null // pp or null
  forecastStatus: ForecastStatus
}

export interface PaceLive {
  remainingTodayLive: number // pp
  sustainablePerHour: number // pp/h
  hoursUntilReset: number
  daysUntilReset: number
  reservePercent: number
  dailyBudget: number
  dailyDeviation: number
  remainingTodayAdaptive?: number | null
  profileDays?: number | null
  profileNote?: string | null
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
export interface PaceRow extends Pace, PaceLive, PaceForecast {
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

/** Next local midnight, calendar-aware to handle DST changes (23h/25h days). */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime()
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
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
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

export interface ActivityProfile {
  version: 1
  generatedAt?: string
  timezone: string
  from?: string
  to?: string
  days: number
  weights: number[]
}

export interface ProfileValidationResult {
  profile: ActivityProfile | null
  note: string | null
}

export function validateProfile(raw: unknown): ProfileValidationResult {
  if (raw === null || raw === undefined) {
    return { profile: null, note: 'profile: none (uniform)' }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { profile: null, note: 'profile ignored: not an object' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) {
    return { profile: null, note: `profile ignored: unsupported version ${String(obj.version)}` }
  }
  if (typeof obj.days !== 'number' || !Number.isFinite(obj.days)) {
    return { profile: null, note: 'profile ignored: days must be finite' }
  }
  if (!Array.isArray(obj.weights) || obj.weights.length !== 168) {
    const len = Array.isArray(obj.weights) ? obj.weights.length : typeof obj.weights
    return { profile: null, note: `profile ignored: expected 168 weights, got ${len}` }
  }
  let sum = 0
  for (let i = 0; i < 168; i++) {
    const w = obj.weights[i]
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      return { profile: null, note: 'profile ignored: weights must be non-negative finite numbers' }
    }
    sum += w
  }
  if (sum <= 0) {
    return { profile: null, note: 'profile ignored: sum of weights must be positive' }
  }
  if (typeof obj.timezone !== 'string' || !obj.timezone) {
    return { profile: null, note: 'profile ignored: missing timezone' }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: obj.timezone })
  } catch {
    return { profile: null, note: `profile ignored: invalid timezone "${obj.timezone}"` }
  }
  if (obj.days < MIN_PROFILE_DAYS) {
    return { profile: null, note: `profile has ${obj.days} days, needs 14` }
  }
  return {
    profile: {
      version: 1,
      generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : undefined,
      timezone: obj.timezone,
      from: typeof obj.from === 'string' ? obj.from : undefined,
      to: typeof obj.to === 'string' ? obj.to : undefined,
      days: obj.days,
      weights: obj.weights as number[]
    },
    note: null
  }
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
}

export function createProfileIntegrator(timeZone: string, weights: number[]): (t1: number, t2: number) => number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  })

  function getInfo(ms: number) {
    const d = new Date(ms)
    const parts = fmt.formatToParts(d)
    let weekday = ''
    let hour = 0
    let minute = 0
    let second = 0
    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value
      else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24
      else if (p.type === 'minute') minute = parseInt(p.value, 10)
      else if (p.type === 'second') second = parseInt(p.value, 10)
    }
    const day = WEEKDAY_MAP[weekday] ?? 0
    const millisecond = d.getUTCMilliseconds()
    const elapsedInHour = Math.max(0, Math.min(HOUR_MS - 1, (minute * 60 + second) * 1000 + millisecond))
    return { day, hour, elapsedInHour }
  }

  return function integrate(t1: number, t2: number): number {
    if (t2 <= t1) return 0
    let cur = t1
    let sum = 0
    while (cur < t2) {
      const { elapsedInHour } = getInfo(cur)
      const remainingInHour = HOUR_MS - elapsedInHour
      const nextBoundary = cur + (remainingInHour > 0 ? remainingInHour : HOUR_MS)
      const stepEnd = Math.min(t2, nextBoundary)
      const duration = stepEnd - cur
      const mid = cur + Math.floor(duration / 2)
      const { day, hour } = getInfo(mid)
      const idx = day * 24 + hour
      const w = weights[idx] ?? 1
      sum += w * duration
      cur = stepEnd
    }
    return sum
  }
}

export function createAdaptiveBudgetStrategy(profile: ActivityProfile): BudgetStrategy {
  const integrate = createProfileIntegrator(profile.timezone, profile.weights)
  return {
    name: 'adaptive',
    weight: (t1: number, t2: number) => integrate(t1, t2)
  }
}

export interface SustainableBudgetInput {
  remainingWeekly: number
  now: number
  resetsAt: number
  nextMidnight?: number
  reserveFraction?: number
  strategy?: BudgetStrategy
}

export interface SustainableBudgetResult {
  remainingWeekly: number
  remainingTodayLive: number
  sustainablePerHour: number
  hoursUntilReset: number
  daysUntilReset: number
  reservePercent: number
  remainingTodayAdaptive?: number | null
}

/**
 * Pure function computing how much quota can be spent sustainably from now until end of today:
 * B_hoy = R * (1 - s) * max(0, min(m, T) - t) / (T - t), where T > t.
 */
export function computeSustainableBudget(input: SustainableBudgetInput): SustainableBudgetResult {
  const { remainingWeekly, now, resetsAt, reserveFraction = 0, strategy } = input
  const s = Math.max(0, Math.min(1, Number.isFinite(reserveFraction) ? reserveFraction : 0))
  const R = Math.max(0, Math.min(100, Number.isFinite(remainingWeekly) ? remainingWeekly : 0))
  const t = now
  const T = resetsAt
  const m = input.nextMidnight ?? nextLocalMidnight(t)

  const hoursUntilReset = Math.max(0, (T - t) / HOUR_MS)
  const daysUntilReset = Math.max(0, (T - t) / DAY_MS)
  const reservePercent = s * 100

  if (T <= t || R <= 0) {
    return {
      remainingWeekly: R,
      remainingTodayLive: 0,
      sustainablePerHour: 0,
      hoursUntilReset: 0,
      daysUntilReset: 0,
      reservePercent,
      remainingTodayAdaptive: strategy?.name === 'adaptive' ? 0 : null
    }
  }

  const effectiveSpanUntilMidnight = Math.max(0, Math.min(m, T) - t)
  const totalSpanUntilReset = T - t
  const remainingTodayLive = totalSpanUntilReset > 0 ? R * (1 - s) * (effectiveSpanUntilMidnight / totalSpanUntilReset) : 0
  const sustainablePerHour = hoursUntilReset > 0 ? (R * (1 - s)) / hoursUntilReset : 0

  let remainingTodayAdaptive: number | null = null
  if (strategy && strategy.name === 'adaptive') {
    if (m <= t) {
      remainingTodayAdaptive = 0
    } else {
      const b = Math.min(m, T)
      const numerator = strategy.weight(t, b)
      const denominator = strategy.weight(t, T)
      if (denominator > 0) {
        remainingTodayAdaptive = R * (1 - s) * (numerator / denominator)
      } else {
        remainingTodayAdaptive = 0
      }
    }
  }

  return {
    remainingWeekly: R,
    remainingTodayLive,
    sustainablePerHour,
    hoursUntilReset,
    daysUntilReset,
    reservePercent,
    remainingTodayAdaptive
  }
}

export function computeAdaptiveBudget(
  input: SustainableBudgetInput & { profile: ActivityProfile }
): SustainableBudgetResult {
  const strategy = createAdaptiveBudgetStrategy(input.profile)
  return computeSustainableBudget({ ...input, strategy })
}

/** Interface for activity-weighted budgeting strategies (Section 4). */
export interface BudgetStrategy {
  name: 'uniform' | 'scheduled' | 'adaptive'
  weight(t1: number, t2: number): number
}

export const uniformBudgetStrategy: BudgetStrategy = {
  name: 'uniform',
  weight: (t1: number, t2: number) => Math.max(0, t2 - t1)
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
  const midnight = startOfLocalDay(now)
  const daysLeft = (resetsAt - midnight) / DAY_MS
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

/**
 * Today's baseline from recorded history: the last reading before local midnight in the current
 * week window, or else the first reading of today. Readings from an earlier week window, or above
 * the current usage, are ignored.
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
  const firstToday = valid.find((s) => s.at >= midnight)

  if (beforeMidnight) {
    const gapMs = midnight - beforeMidnight.at
    // Bug E fix: if beforeMidnight is older than 4 hours and firstToday is closer to midnight, use firstToday.
    if (gapMs > 4 * HOUR_MS && firstToday && firstToday.at - midnight < gapMs) {
      return { date, usedAtStart: firstToday.used, resetsAt: window.resetsAt, firstSeenAt: firstToday.at, source: 'history' }
    }
    return { date, usedAtStart: beforeMidnight.used, resetsAt: window.resetsAt, firstSeenAt: midnight, source: 'history' }
  }
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
 *
 * NOTE (Bug C): This calculation assumes linear proportionality between token counts and quota percentage.
 * This is an approximation; different models and reasoning tokens carry different quota weights.
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

export interface BurnRateInput {
  samples: UsageSample[]
  now: number
  resetsAt: number
  remainingWeekly: number
  sustainablePerHour: number
}

/**
 * Calculates burn rate, pace multiplier, and exhaustion prediction across multiple observation windows.
 * Distinguishes spikes, unsustainable trends, low consumption, stale data, and insufficient data.
 */
export function computeBurnRate(input: BurnRateInput): PaceForecast {
  const { samples, now, resetsAt, remainingWeekly, sustainablePerHour } = input
  const R = Math.max(0, Math.min(100, remainingWeekly))

  if (R <= 0) {
    return {
      currentBurnRate: 0,
      sustainableBurnRate: 0,
      paceMultiplier: 0,
      estimatedExhaustionAt: now,
      projectedRemainingAtReset: 0,
      forecastStatus: 'exhausted'
    }
  }

  const cycleStart = resetsAt - WEEK_MS
  const valid = (samples ?? [])
    .filter((s) => Number.isFinite(s.at) && Number.isFinite(s.used) && s.at >= cycleStart && s.at <= now && s.used >= 0 && s.used <= 100)
    .sort((a, b) => a.at - b.at)

  // Deduplicate timestamps
  const deduped: UsageSample[] = []
  for (const s of valid) {
    if (deduped.length === 0 || deduped[deduped.length - 1].at !== s.at) {
      deduped.push(s)
    } else {
      deduped[deduped.length - 1] = s
    }
  }

  if (deduped.length < 2) {
    return {
      currentBurnRate: null,
      sustainableBurnRate: sustainablePerHour,
      paceMultiplier: null,
      estimatedExhaustionAt: null,
      projectedRemainingAtReset: null,
      forecastStatus: 'insufficient_data'
    }
  }

  const latest = deduped[deduped.length - 1]
  // Stale if latest observation is older than 45 minutes
  if (now - latest.at > 45 * 60_000) {
    return {
      currentBurnRate: null,
      sustainableBurnRate: sustainablePerHour,
      paceMultiplier: null,
      estimatedExhaustionAt: null,
      projectedRemainingAtReset: null,
      forecastStatus: 'stale'
    }
  }

  // 4-hour window (or all available)
  const window4h = deduped.filter((s) => s.at >= now - 4 * HOUR_MS)
  const primaryWindow = window4h.length >= 2 ? window4h : deduped
  const first = primaryWindow[0]
  const deltaT = latest.at - first.at

  // Need at least 10 minutes span to avoid pure quantization noise
  if (deltaT < 10 * 60_000) {
    return {
      currentBurnRate: null,
      sustainableBurnRate: sustainablePerHour,
      paceMultiplier: null,
      estimatedExhaustionAt: null,
      projectedRemainingAtReset: null,
      forecastStatus: 'insufficient_data'
    }
  }

  const deltaUsed = Math.max(0, latest.used - first.used)
  const rate4h = deltaUsed / (deltaT / HOUR_MS)

  // Short 30-minute window for spike detection
  const window30m = deduped.filter((s) => s.at >= now - 35 * 60_000)
  let rate30m = rate4h
  if (window30m.length >= 2) {
    const first30 = window30m[0]
    const deltaT30 = latest.at - first30.at
    if (deltaT30 >= 10 * 60_000) {
      rate30m = Math.max(0, latest.used - first30.used) / (deltaT30 / HOUR_MS)
    }
  }

  let burnRate = Math.round(rate4h * 100) / 100
  let status: ForecastStatus = 'normal'

  // Classify states
  if (rate30m > 2 * sustainablePerHour && rate30m > 1.5 * rate4h && rate30m > 0.1) {
    status = 'spike'
    burnRate = Math.round(rate30m * 100) / 100
  } else if (burnRate > 1.2 * sustainablePerHour && burnRate > 0.05) {
    status = 'unsustainable'
  } else if (burnRate < 0.25 * sustainablePerHour) {
    status = 'low'
  } else {
    status = 'normal'
  }

  const multiplier = sustainablePerHour > 0
    ? Math.round((burnRate / sustainablePerHour) * 100) / 100
    : burnRate > 0 ? Infinity : 1

  let estimatedExhaustionAt: number | null = null
  let projectedRemainingAtReset: number | null = null

  if (burnRate > 0) {
    const hoursToExhaustion = R / burnRate
    const exhaustionTime = now + hoursToExhaustion * HOUR_MS
    if (exhaustionTime < resetsAt) {
      estimatedExhaustionAt = exhaustionTime
      projectedRemainingAtReset = 0
    } else {
      estimatedExhaustionAt = null
      const hoursToReset = Math.max(0, (resetsAt - now) / HOUR_MS)
      projectedRemainingAtReset = Math.max(0, Math.round((R - burnRate * hoursToReset) * 10) / 10)
    }
  } else {
    estimatedExhaustionAt = null
    projectedRemainingAtReset = R
  }

  return {
    currentBurnRate: burnRate,
    sustainableBurnRate: Math.round(sustainablePerHour * 100) / 100,
    paceMultiplier: multiplier,
    estimatedExhaustionAt,
    projectedRemainingAtReset,
    forecastStatus: status
  }
}

const SOURCE_RANK: Record<BaselineSource, number> = { history: 0, estimate: 1, reading: 2 }

/**
 * Applies the baselines to fresh windows: the rows to draw and the baselines to store.
 * Supports backward-compatible calls and optional samples buffer for burn rate calculations.
 */
export function buildRows(
  windows: WeeklyWindow[],
  stored: Record<string, Baseline>,
  now: number,
  history: UsageHistory = {},
  daily: DailyUsage = {},
  samplesMap: Record<string, UsageSample[]> = {},
  options: {
    reserveFraction?: number
    profile?: ActivityProfile | null
    profileNote?: string | null
  } = {}
): {
  rows: PaceRow[]
  baselines: Record<string, Baseline>
  samples: Record<string, UsageSample[]>
} {
  const baselines: Record<string, Baseline> = {}
  const nextSamples: Record<string, UsageSample[]> = { ...samplesMap }
  const adaptiveStrategy = options.profile ? createAdaptiveBudgetStrategy(options.profile) : undefined

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

    // Collect usage samples for burn rate engine
    const windowSamples = [
      ...(samplesMap[w.key] ?? []),
      ...(history[w.key] ?? []),
      { at: now, used: w.usedPercent }
    ]
    // Keep deduplicated samples in current cycle
    const cycleStart = w.resetsAt - WEEK_MS
    const cleanSamples = windowSamples
      .filter((s) => s.at >= cycleStart && s.at <= now && Number.isFinite(s.at) && Number.isFinite(s.used))
      .sort((a, b) => a.at - b.at)

    nextSamples[w.key] = cleanSamples.slice(-SAMPLES_CAP)

    const pace = computePace({ usedAtStart: baseline.usedAtStart, usedNow: w.usedPercent, resetsAt: w.resetsAt, now })
    const sustainable = computeSustainableBudget({
      remainingWeekly: pace.remainingWeekly,
      now,
      resetsAt: w.resetsAt,
      reserveFraction: options.reserveFraction ?? 0,
      strategy: adaptiveStrategy
    })

    const forecast = computeBurnRate({
      samples: cleanSamples,
      now,
      resetsAt: w.resetsAt,
      remainingWeekly: sustainable.remainingWeekly,
      sustainablePerHour: sustainable.sustainablePerHour
    })

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
      ...pace,
      remainingTodayLive: sustainable.remainingTodayLive,
      sustainablePerHour: sustainable.sustainablePerHour,
      hoursUntilReset: sustainable.hoursUntilReset,
      daysUntilReset: sustainable.daysUntilReset,
      reservePercent: sustainable.reservePercent,
      dailyBudget: pace.allowanceToday,
      dailyDeviation: pace.usedToday - pace.allowanceToday,
      ...forecast,
      remainingTodayAdaptive: sustainable.remainingTodayAdaptive ?? null,
      profileDays: options.profile?.days ?? null,
      profileNote: options.profileNote ?? null
    }
  })

  return { rows, baselines, samples: nextSamples }
}
