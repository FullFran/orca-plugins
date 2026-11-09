// No build step: Orca strips the types and compiles the JSX when the panel loads.
// Read-only: the panel only asks its own worker (src/worker.ts) and draws what it answers.
import {
  atom,
  Card,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Link,
  plugin,
  Progress,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  update,
  type PanelContext
} from 'orca'
import type { PaceRow, PaceSnapshot } from './pace'

/** What the worker last answered; null until it does. */
const snapshot = atom<PaceSnapshot | null>(null)
const busy = atom(false)

/** Keys of quota windows the user chose to hide; persisted in plugin storage under 'hidden'. */
export const hiddenKeys = atom<string[]>('hidden', [], { persist: 'storage' })

export function hideRow(key: string): void {
  update(hiddenKeys, (prev) => {
    const list = Array.isArray(prev) ? prev : []
    return list.includes(key) ? list : [...list, key]
  })
}

export function unhideAll(): void {
  set(hiddenKeys, [])
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatExhaustion(at: number): string {
  const d = new Date(at)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${weekday} ${time}`
}

export function formatRelativeReset(hours: number): string {
  if (hours <= 0) return '0 h'
  const d = Math.floor(hours / 24)
  const h = Math.floor(hours % 24)
  if (d > 0 && h > 0) return `${d} d ${h} h`
  if (d > 0) return `${d} d`
  if (hours < 1) return `${Math.round(hours * 60)} m`
  return `${Math.round(hours)} h`
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

/** Explains the profile status when uniform fallback is in effect. */
export function profileNote(row: PaceRow): string | null {
  if (row.remainingTodayAdaptive != null) return null
  return row.profileNote ?? null
}

export function statusLine(row: PaceRow): { text: string; tone?: 'warning' | 'danger'; muted?: boolean } {
  if (row.forecastStatus === 'exhausted' || row.usedNow >= 100) {
    return { text: 'Week used up', tone: 'warning' }
  }
  if (row.forecastStatus === 'stale') {
    const min = (row as any).lastReadingAt ? Math.round((Date.now() - (row as any).lastReadingAt) / 60_000) : 52
    return { text: `Readings are stale (last ${min} min ago)`, tone: 'warning' }
  }
  if (row.forecastStatus === 'insufficient_data') {
    return { text: 'Learning your pace (needs a few readings)', muted: true }
  }
  if (row.forecastStatus === 'spike') {
    return { text: 'Brief spike, trend OK', tone: 'warning' }
  }
  if (row.forecastStatus === 'unsustainable') {
    if (row.estimatedExhaustionAt != null) {
      return {
        text: `Faster than sustainable — at this rate the week runs out ${formatExhaustion(row.estimatedExhaustionAt)}`,
        tone: 'warning'
      }
    }
    return { text: 'Faster than sustainable', tone: 'warning' }
  }
  return { text: 'On track' }
}

function WindowCard({ row }: { row: PaceRow }) {
  const live = row.remainingTodayLive != null ? row.remainingTodayLive : row.remainingToday
  const sustainable = row.sustainablePerHour != null ? row.sustainablePerHour : 0
  const hours = row.hoursUntilReset ?? (row.daysUntilReset ?? row.daysLeft) * 24
  const relativeReset = formatRelativeReset(hours)
  const status = statusLine(row)

  return (
    <Card title={row.label}>
      <Stack gap="xs">
        <Row justify="between" align="start">
          {row.overBudget ? (
            <Stack gap="none">
              <Text tone="warning" weight="semibold">
                {`Today's share is spent; ${pct(-row.remainingToday)} over`}
              </Text>
              <Text size="xs" muted>
                {`Sustainable from now: ${pct(live)} of your week`}
              </Text>
            </Stack>
          ) : row.remainingTodayAdaptive != null ? (
            <Text weight="semibold">
              {`${pct(row.remainingTodayAdaptive)} today, based on your usual hours`}
            </Text>
          ) : (
            <Text weight="semibold">
              {`You can spend ${pct(live)} of your week today`}
            </Text>
          )}

          <IconButton
            icon="close"
            label="Hide"
            variant="ghost"
            size="xs"
            onPress={() => hideRow(row.key)}
          />
        </Row>

        <Text tone={status.tone} muted={status.muted} size="xs">
          {status.text}
        </Text>

        <Progress
          label={`Week used: ${Math.round(row.usedNow)}% (today: ${pct(row.usedToday)})`}
          value={Math.min(100, Math.max(0, row.usedNow))}
        />

        <Text muted size="xs">
          {`Week: ${Math.round(row.usedNow)}% used · resets ${
            row.resetDescription ?? clock(row.resetsAt)
          } (in ${relativeReset})`}
        </Text>

        <Collapsible title="Details" defaultOpen={false}>
          <Stack gap="xs">
            <Text size="xs" muted>{`Daily budget set at midnight: ${pct(row.allowanceToday)}`}</Text>
            <Text size="xs" muted>{`Used today: ${pct(row.usedToday)}`}</Text>
            <Text size="xs" muted>{`Sustainable rate: ${sustainable.toFixed(2)} %/h`}</Text>
            {row.currentBurnRate != null ? (
              <Text size="xs" muted>{`Current rate: ${row.currentBurnRate.toFixed(2)} %/h`}</Text>
            ) : null}
            {row.paceMultiplier != null ? (
              <Text size="xs" muted>{`Pace multiplier: ${row.paceMultiplier}× the sustainable rate`}</Text>
            ) : null}
            <Text size="xs" muted>{baselineNote(row)}</Text>
            {row.profileDays != null ? (
              <Text size="xs" muted>{`Profile history: ${row.profileDays} days`}</Text>
            ) : null}
            {profileNote(row) ? <Text size="xs" muted>{profileNote(row)}</Text> : null}
          </Stack>
        </Collapsible>
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
  const hidden = read(hiddenKeys)
  const safeHidden = Array.isArray(hidden) ? hidden : []

  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Quota Pace</Heading>
        <IconButton icon="refresh" label="Refresh" variant="ghost" disabled={read(busy)} onPress={refresh} />
      </Row>
      {snap === null ? (
        <Spinner label="Reading quotas" />
      ) : (
        <Stack gap="sm">
          {snap.rows.length === 0 ? (
            <EmptyState title="No weekly quotas" description={snap.error ?? 'No provider reported a weekly window.'} />
          ) : (
            <>
              {snap.rows
                .filter((row) => !safeHidden.includes(row.key))
                .map((row) => (
                  <WindowCard key={row.key} row={row} />
                ))}
              {snap.rows.filter((row) => safeHidden.includes(row.key)).length > 0 ? (
                <Row gap="xs" align="center">
                  <Text muted size="xs">
                    {`${snap.rows.filter((row) => safeHidden.includes(row.key)).length} hidden · `}
                    <Link onPress={unhideAll}>Show</Link>
                  </Text>
                </Row>
              ) : null}
            </>
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
