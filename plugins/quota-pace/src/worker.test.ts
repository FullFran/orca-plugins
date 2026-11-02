// Runs the worker's activate(orca) over a mock host, with the `orca account list --json` runner,
// the clock and the poll timer injected, so no real CLI, clock or timer is touched.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { REAL_ACCOUNT_LIST } from './fixtures'
import type { PaceSnapshot } from './pace'
import { createWorker, POLL_MS, type WorkerDeps } from './worker'

const DAY = 86_400_000
// 2026-11-02 10:00 local; the fixture's Claude weekly window resets at 1793872799675.
const NOW = new Date(2026, 10, 2, 10, 0, 0, 0).getTime()

interface Fake {
  deps: WorkerDeps
  runs: () => number
  setOutput: (output: string | Error) => void
  setNow: (now: number) => void
  tick: () => Promise<void>
  pollEvery: () => number | null
  cancelled: () => boolean
}

function fake(output: string | Error = JSON.stringify(REAL_ACCOUNT_LIST)): Fake {
  let current = output
  let now = NOW
  let runs = 0
  let poll: (() => Promise<void> | void) | null = null
  let every: number | null = null
  let cancelled = false
  return {
    deps: {
      run: async () => {
        runs += 1
        if (current instanceof Error) throw current
        return current
      },
      now: () => now,
      schedule: (fn, ms) => {
        poll = fn
        every = ms
        return () => {
          cancelled = true
        }
      }
    },
    runs: () => runs,
    setOutput: (next) => {
      current = next
    },
    setNow: (next) => {
      now = next
    },
    tick: async () => {
      await poll?.()
    },
    pollEvery: () => every,
    cancelled: () => cancelled
  }
}

function row(snapshot: PaceSnapshot, key: string) {
  const found = snapshot.rows.find((r) => r.key === key)
  assert.ok(found, `no row ${key}`)
  return found
}

test('answers every weekly window, keeps the first reading of the day and tells open panels', async () => {
  const f = fake()
  const host = mockHost()
  const worker = await mountWorker(createWorker(f.deps), { host })

  const snapshot = (await worker.request('pace.get')) as PaceSnapshot
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.fetchedAt, NOW)
  assert.deepEqual(
    snapshot.rows.map((r) => r.label),
    ['Claude', 'Claude · Fable', 'Codex', 'Antigravity']
  )
  const claude = row(snapshot, 'claude.weekly')
  assert.equal(claude.usedNow, 60)
  assert.equal(claude.usedAtStart, 60)
  assert.equal(claude.usedToday, 0)
  assert.equal(claude.remainingWeekly, 40)
  // First reading at 10:00, not midnight: the panel says so.
  assert.equal(claude.baselineSince, NOW)
  const midnight = new Date(2026, 10, 2).getTime()
  const daysLeft = (1793872799675 - midnight) / DAY
  assert.ok(Math.abs(claude.daysLeft - daysLeft) < 1e-9)
  assert.ok(Math.abs(claude.allowanceToday - Math.min(40, 40 / daysLeft)) < 1e-9)
  assert.equal(snapshot.issues.length > 0, true)

  const stored = host.data().storage.baselines as Record<string, { usedAtStart: number }>
  assert.equal(stored['claude.weekly']?.usedAtStart, 60)
  assert.equal(stored['codex.weekly']?.usedAtStart, 37)
  assert.equal(worker.posts.length, 1)
  assert.equal(worker.posts[0]?.event, 'pace.changed')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a stored baseline from earlier today is used for today’s use', async () => {
  const f = fake()
  const midnight = new Date(2026, 10, 2).getTime()
  const host = mockHost({
    storage: {
      baselines: {
        'claude.weekly': {
          date: '2026-11-02',
          usedAtStart: 50,
          resetsAt: 1793872799675,
          firstSeenAt: midnight + 60_000
        }
      }
    }
  })
  const worker = await mountWorker(createWorker(f.deps), { host })
  const claude = row((await worker.request('pace.get')) as PaceSnapshot, 'claude.weekly')
  assert.equal(claude.usedAtStart, 50)
  assert.equal(claude.usedToday, 10)
  const daysLeft = (1793872799675 - midnight) / DAY
  assert.ok(Math.abs(claude.remainingToday - (50 / daysLeft - 10)) < 1e-9)
  await worker.deactivate()
})

test('pace.get reuses a fresh snapshot; pace.refresh reads again', async () => {
  const f = fake()
  const worker = await mountWorker(createWorker(f.deps), { host: mockHost() })
  await worker.request('pace.get')
  f.setNow(NOW + 60_000)
  await worker.request('pace.get')
  assert.equal(f.runs(), 1)
  await worker.request('pace.refresh')
  assert.equal(f.runs(), 2)
  f.setNow(NOW + POLL_MS + 120_000)
  await worker.request('pace.get')
  assert.equal(f.runs(), 3)
  await worker.deactivate()
})

test('polls every 5 minutes, posts each reading and stops on deactivate', async () => {
  const f = fake()
  const worker = await mountWorker(createWorker(f.deps), { host: mockHost() })
  assert.equal(f.pollEvery(), 300_000)
  await f.tick()
  assert.equal(f.runs(), 1)
  assert.equal(worker.posts.length, 1)
  await worker.deactivate()
  assert.equal(f.cancelled(), true)
})

test('a failing CLI answers an error snapshot instead of throwing', async () => {
  const f = fake(new Error('spawn orca-ide ENOENT'))
  const worker = await mountWorker(createWorker(f.deps), { host: mockHost() })
  const snapshot = (await worker.request('pace.refresh')) as PaceSnapshot
  assert.deepEqual(snapshot.rows, [])
  assert.match(snapshot.error ?? '', /ENOENT/)
  await worker.deactivate()
})

test('an ok:false answer from the CLI shows its message', async () => {
  const f = fake(JSON.stringify({ ok: false, error: { code: 'runtime_error', message: 'Orca is not running' } }))
  const worker = await mountWorker(createWorker(f.deps), { host: mockHost() })
  const snapshot = (await worker.request('pace.refresh')) as PaceSnapshot
  assert.equal(snapshot.error, 'Orca is not running')
  await worker.deactivate()
})

test('output that is not JSON is an error, not a crash', async () => {
  const f = fake('Orca says hi')
  const worker = await mountWorker(createWorker(f.deps), { host: mockHost() })
  const snapshot = (await worker.request('pace.refresh')) as PaceSnapshot
  assert.match(snapshot.error ?? '', /JSON/)
  await worker.deactivate()
})
