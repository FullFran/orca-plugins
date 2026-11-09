// No build step: Orca strips the types and compiles the JSX when the panel loads.
// Read-only: the panel only asks its own worker (src/worker.ts) and draws what it answers.
import {
  atom,
  Card,
  EmptyState,
  Heading,
  IconButton,
  plugin,
  Progress,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { PaceRow, PaceSnapshot } from './pace'

/** What the worker last answered; null until it does. */
const snapshot = atom<PaceSnapshot | null>(null)
const busy = atom(false)

function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

function pp(value: number): string {
  return `${value.toFixed(1)} pp`
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isAfterMidnight(at: number): boolean {
  const d = new Date(at)
  return at > new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + 60_000
}

async function refresh(): Promise<void> {
  set(busy, true)
  try {
    set(snapshot, await plugin.request('pace.refresh'))
  } finally {
    set(busy, false)
  }
}

/** Runs once before the first render; what it pushes to `subscriptions` ends with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('pace.changed', (payload) => set(snapshot, payload)))
  void plugin.request('pace.get').then((answer) => set(snapshot, answer))
}

/** Where today's starting point comes from, so the numbers can be trusted at the right level. */
export function baselineNote(row: PaceRow): string {
  const start = `${Math.round(row.usedAtStart)}% used`
  if (row.baselineSource === 'history') {
    return isAfterMidnight(row.baselineSince)
      ? `Counting from claudeops' first reading today (${clock(row.baselineSince)}, ${start}).`
      : `Start of today from claudeops: ${start}.`
  }
  if (row.baselineSource === 'estimate') {
    return `Start of today estimated from Orca's token statistics: about ${start}.`
  }
  return isAfterMidnight(row.baselineSince)
    ? `Counting from the first reading today (${clock(row.baselineSince)}, ${start}).`
    : `Start of today: ${start}.`
}

/** Explains the forecast status and whether it is measured or estimated. */
export function forecastNote(row: PaceRow): string {
  if (row.forecastStatus === 'insufficient_data') {
    return 'Forecast: gathering usage history (insufficient data).'
  }
  if (row.forecastStatus === 'stale') {
    return 'Forecast: readings are older than 45 minutes (stale).'
  }
  if (row.forecastStatus === 'exhausted') {
    return 'Forecast: weekly limit reached.'
  }
  return 'Forecast: estimated from recent usage slope.'
}

/** Explains the profile status when uniform fallback is in effect. */
export function profileNote(row: PaceRow): string | null {
  if (row.remainingTodayAdaptive != null) return null
  return row.profileNote ?? null
}

function PacePill({ row }: { row: PaceRow }) {
  if (row.forecastStatus === 'insufficient_data') {
    return <Text muted size="xs">Pace: learning (insufficient data)</Text>
  }
  if (row.forecastStatus === 'stale') {
    return <Text muted size="xs">Pace: stale readings (&gt;45m)</Text>
  }
  if (row.forecastStatus === 'exhausted') {
    return <Text tone="warning" size="xs">Pace: quota exhausted (100% used)</Text>
  }
  if (row.forecastStatus === 'spike') {
    return (
      <Text tone="warning" size="xs">
        {`Current pace: ${(row.currentBurnRate ?? 0).toFixed(2)} pp/h (${row.paceMultiplier ?? 1}x, brief spike)`}
      </Text>
    )
  }
  if (row.forecastStatus === 'unsustainable') {
    return (
      <Text tone="warning" size="xs">
        {`Current pace: ${(row.currentBurnRate ?? 0).toFixed(2)} pp/h (${row.paceMultiplier ?? 1}x, unsustainable)`}
      </Text>
    )
  }
  return (
    <Text muted size="xs">
      {`Current pace: ${(row.currentBurnRate ?? 0).toFixed(2)} pp/h (${row.paceMultiplier ?? 1}x pace)`}
    </Text>
  )
}

function WindowCard({ row }: { row: PaceRow }) {
  const ratio = row.allowanceToday > 0 ? (row.usedToday / row.allowanceToday) * 100 : row.usedToday > 0 ? 100 : 0
  const days = (row.daysUntilReset ?? row.daysLeft).toFixed(1)
  const live = row.remainingTodayLive != null ? row.remainingTodayLive : row.remainingToday
  const sustainable = row.sustainablePerHour != null ? row.sustainablePerHour : 0

  return (
    <Card title={row.label}>
      <Stack gap="xs">
        {row.overBudget ? (
          <Text tone="warning" weight="semibold">
            {`${pct(-row.remainingToday)} over today's ${pct(row.allowanceToday)}`}
          </Text>
        ) : (
          <Text weight="semibold">{`${pct(row.remainingToday)} left today of ${pct(row.allowanceToday)}`}</Text>
        )}
        <Progress
          label={`Used today: ${pct(row.usedToday)} of ${pct(row.allowanceToday)}`}
          value={Math.min(100, Math.round(ratio * 10) / 10)}
        />
        <Text size="xs">
          {`Live allowance: ${pp(live)} · Sustainable: ${sustainable.toFixed(2)} pp/h`}
        </Text>
        {row.remainingTodayAdaptive != null ? (
          <Text size="xs">
            {`Live allowance (adaptive): ${pp(row.remainingTodayAdaptive)} (estimated, ${row.profileDays ?? 0}d profile)`}
          </Text>
        ) : null}
        <PacePill row={row} />
        {row.estimatedExhaustionAt != null ? (
          <Text tone="warning" size="xs">
            {`Projected exhaustion: ${clock(row.estimatedExhaustionAt)} (before reset)`}
          </Text>
        ) : null}
        <Text muted size="xs">
          {`${Math.round(row.remainingWeekly)}% of the week left · resets ${
            row.resetDescription ?? clock(row.resetsAt)
          } (in ${days} days)`}
        </Text>
        <Text muted size="xs">{baselineNote(row)}</Text>
        <Text muted size="xs">{forecastNote(row)}</Text>
        {profileNote(row) ? <Text muted size="xs">{profileNote(row)}</Text> : null}
      </Stack>
    </Card>
  )
}

function Issues({ snap }: { snap: PaceSnapshot }) {
  const errors = snap.issues.filter((i) => i.status !== 'unavailable')
  const unavailable = snap.issues.filter((i) => i.status === 'unavailable').map((i) => i.provider)
  return (
    <Stack gap="xs">
      {errors.map((issue) => (
        <Text key={issue.provider} tone="warning" size="xs">{`${issue.provider}: ${issue.error}`}</Text>
      ))}
      {unavailable.length > 0 ? <Text muted size="xs">{`Not connected: ${unavailable.join(', ')}`}</Text> : null}
    </Stack>
  )
}

export default function Panel() {
  const snap = read(snapshot)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Today's pace</Heading>
        <IconButton icon="refresh" label="Refresh" variant="ghost" disabled={read(busy)} onPress={refresh} />
      </Row>
      {snap === null ? (
        <Spinner label="Reading quotas" />
      ) : (
        <Stack gap="sm">
          {snap.rows.length === 0 ? (
            <EmptyState title="No weekly quotas" description={snap.error ?? 'No provider reported a weekly window.'} />
          ) : (
            snap.rows.map((row) => <WindowCard key={row.key} row={row} />)
          )}
          {snap.error && snap.rows.length > 0 ? (
            <Text tone="warning" size="xs">{`Last read failed: ${snap.error}`}</Text>
          ) : null}
          <Issues snap={snap} />
          {snap.fetchedAt !== null ? <Text muted size="xs">{`Updated ${clock(snap.fetchedAt)}`}</Text> : null}
        </Stack>
      )}
    </Stack>
  )
}
