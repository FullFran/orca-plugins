import { assert, test } from 'orca/testing'
import {
  applyEvent,
  DONE_TTL_MS,
  emptyRoster,
  ordered,
  parseRoster,
  prune,
  seedRoster,
  STALE_TTL_MS,
  type Roster
} from './roster'

const T0 = 1_700_000_000_000

test('seeds from agents.list with the focused workspace name', () => {
  const roster = seedRoster(
    emptyRoster(),
    [
      { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: T0 - 5000 },
      { terminalId: null, title: 'Codex', agent: 'codex', state: 'done', stateStartedAt: T0 - 1000 }
    ],
    'feat/x',
    T0
  )
  assert.deepEqual(roster.agents, [
    {
      key: 't:t1',
      terminalId: 't1',
      title: 'Claude',
      agent: 'claude',
      state: 'working',
      since: T0 - 5000,
      updatedAt: T0,
      workspaceId: null,
      workspaceName: 'feat/x'
    },
    {
      key: 'seed:Codex',
      terminalId: null,
      title: 'Codex',
      agent: 'codex',
      state: 'done',
      since: T0 - 1000,
      updatedAt: T0,
      workspaceId: null,
      workspaceName: 'feat/x'
    }
  ])
})

test('an event adds a new agent keyed by paneKey', () => {
  const roster = applyEvent(
    emptyRoster(),
    { workspaceId: 'wt-1', paneKey: 'tab:1', terminalId: 't9', title: 'Claude', state: 'blocked', receivedAt: T0 },
    T0
  )
  assert.equal(roster.agents.length, 1)
  assert.deepEqual(roster.agents[0], {
    key: 'tab:1',
    terminalId: 't9',
    title: 'Claude',
    agent: null,
    state: 'blocked',
    since: T0,
    updatedAt: T0,
    workspaceId: 'wt-1',
    workspaceName: null
  })
})

test('an event updates the seeded agent with the same terminal instead of duplicating it', () => {
  const seeded = seedRoster(
    emptyRoster(),
    [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: T0 }],
    'main',
    T0
  )
  const next = applyEvent(
    seeded,
    { workspaceId: 'wt-1', paneKey: 'tab:1', terminalId: 't1', state: 'waiting', receivedAt: T0 + 10 },
    T0 + 10
  )
  assert.equal(next.agents.length, 1)
  const agent = next.agents[0]
  assert.equal(agent.key, 'tab:1')
  assert.equal(agent.state, 'waiting')
  assert.equal(agent.since, T0 + 10)
  assert.equal(agent.title, 'Claude', 'keeps the title it already knew')
  assert.equal(agent.agent, 'claude')
  assert.equal(agent.workspaceName, 'main')
  assert.equal(agent.workspaceId, 'wt-1')
})

test('the same state again keeps the time in state', () => {
  const event = { workspaceId: null, paneKey: 'p', state: 'working' as const, receivedAt: T0 }
  const once = applyEvent(emptyRoster(), event, T0)
  const twice = applyEvent(once, { ...event, receivedAt: T0 + 99 }, T0 + 99)
  assert.equal(twice.agents[0].since, T0)
  assert.equal(twice.agents[0].updatedAt, T0 + 99)
})

test('mainAgent.stateStartedAt is the time in state when present', () => {
  const roster = applyEvent(
    emptyRoster(),
    {
      workspaceId: null,
      paneKey: 'p',
      state: 'done',
      receivedAt: T0,
      mainAgent: { state: 'done', stateStartedAt: T0 - 777 }
    },
    T0
  )
  assert.equal(roster.agents[0].since, T0 - 777)
})

test('orders waiting and blocked first, then working, then done', () => {
  let roster: Roster = emptyRoster()
  const states = ['done', 'working', 'blocked', 'waiting', 'working'] as const
  states.forEach((state, i) => {
    roster = applyEvent(roster, { workspaceId: null, paneKey: `p${i}`, state, receivedAt: T0 + i }, T0 + i)
  })
  assert.deepEqual(
    ordered(roster).map((a) => `${a.key}:${a.state}`),
    ['p2:blocked', 'p3:waiting', 'p1:working', 'p4:working', 'p0:done']
  )
})

test('drops done agents after 30 minutes and anything after 12 hours', () => {
  let roster: Roster = emptyRoster()
  roster = applyEvent(roster, { workspaceId: null, paneKey: 'done', state: 'done', receivedAt: T0 }, T0)
  roster = applyEvent(roster, { workspaceId: null, paneKey: 'busy', state: 'working', receivedAt: T0 }, T0)
  assert.deepEqual(prune(roster, T0 + DONE_TTL_MS - 1).agents.map((a) => a.key), ['done', 'busy'])
  assert.deepEqual(prune(roster, T0 + DONE_TTL_MS + 1).agents.map((a) => a.key), ['busy'])
  assert.deepEqual(prune(roster, T0 + STALE_TTL_MS + 1).agents.map((a) => a.key), [])
  assert.equal(DONE_TTL_MS, 30 * 60 * 1000)
  assert.equal(STALE_TTL_MS, 12 * 60 * 60 * 1000)
})

test('persists as versioned JSON and reads it back, dropping malformed rows', () => {
  const roster = applyEvent(emptyRoster(), { workspaceId: 'w', paneKey: 'p', state: 'working', receivedAt: T0 }, T0)
  const stored = JSON.parse(JSON.stringify(roster))
  assert.equal(stored.version, 1)
  assert.deepEqual(parseRoster(stored), roster)
  assert.deepEqual(parseRoster({ version: 1, agents: [stored.agents[0], { key: 3 }, null] }), roster)
  assert.deepEqual(parseRoster(null), emptyRoster())
  assert.deepEqual(parseRoster({ version: 99, agents: stored.agents }), emptyRoster())
})
