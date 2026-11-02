import { assert, test } from 'orca/testing'
import { createController, PINS_KEY, ROSTER_KEY, type PanelHost, type ViewState } from './controller'
import { assignPet } from './pets'
import type { PetFrames } from './protocol'
import { applyEvent, DONE_TTL_MS, emptyRoster, type ListedAgent } from './roster'

const T0 = 1_700_000_000_000
const PETS = [
  { id: 'ayaka', name: 'Ayaka', default: false },
  { id: 'elaina', name: 'Elaina', default: false },
  { id: 'iria', name: 'Iria', default: true }
]
const GALLERY = PETS.map((p) => p.id)

function frames(id: string): PetFrames {
  return { id, name: id, rows: 8, clips: { idle: { fps: 3, frames: [`${id}-idle`] } } }
}

function fakeHost(options: { agents?: ListedAgent[]; storage?: Record<string, unknown>; focused?: string | null } = {}) {
  const storage = new Map<string, unknown>(Object.entries(options.storage ?? {}))
  const host = {
    clock: T0,
    agents: options.agents ?? [],
    focused: options.focused === undefined ? 'main' : options.focused,
    workspaceMap: { 'wt-1': 'orca-plugins · main' } as Record<string, string>,
    framesAsked: [] as string[],
    workspacesAsked: 0,
    storage,
    now: () => host.clock,
    pets: async () => PETS,
    frames: async (id: string) => {
      host.framesAsked.push(id)
      return frames(id)
    },
    workspaces: async () => {
      host.workspacesAsked++
      return host.workspaceMap
    },
    listAgents: async () => host.agents,
    focusedWorkspace: async () => host.focused,
    storageGet: async (key: string) => (storage.has(key) ? storage.get(key) : null),
    storageSet: async (key: string, value: unknown) => {
      storage.set(key, JSON.parse(JSON.stringify(value)))
    }
  }
  return host satisfies PanelHost
}

function track() {
  const states: ViewState[] = []
  return { last: () => states[states.length - 1], onChange: (s: ViewState) => states.push(s) }
}

const claude: ListedAgent = { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: T0 - 60_000 }

test('seeds one card per agent of the focused workspace, each with its own clip', async () => {
  const host = fakeHost({
    agents: [claude, { terminalId: 't2', title: 'Codex', agent: 'codex', state: 'blocked', stateStartedAt: T0 }]
  })
  const view = track()
  await createController(host, view.onChange).start()
  const cards = view.last().cards
  assert.deepEqual(
    cards.map((c) => [c.title, c.kind, c.clip, c.workspace]),
    [
      ['Codex', 'codex', 'waiting', 'main'],
      ['Claude', 'claude', 'working', 'main']
    ]
  )
  assert.equal(cards[1].since, T0 - 60_000)
  assert.equal(cards[1].pet, assignPet('t1', GALLERY, {}))
  assert.ok(cards.every((c) => c.frames?.id === c.pet))
  assert.equal(view.last().error, null)
})

test('events from any workspace add cards, with the workspace name resolved', async () => {
  const host = fakeHost()
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  await controller.onStatus({ workspaceId: 'wt-1', paneKey: 'p1', title: 'Claude', state: 'done', receivedAt: T0 })
  await controller.onStatus({ workspaceId: 'wt-gone', paneKey: 'p2', state: 'working', receivedAt: T0 })
  const cards = view.last().cards
  assert.deepEqual(
    cards.map((c) => [c.key, c.clip, c.workspace]),
    [
      ['p2', 'working', '—'],
      ['p1', 'done', 'orca-plugins · main']
    ]
  )
})

test('keeps the roster in storage and restores it, pruned, on the next open', async () => {
  const host = fakeHost({ agents: [claude] })
  await createController(host, () => {}).start()
  const stored = host.storage.get(ROSTER_KEY) as { version: number; agents: { key: string }[] }
  assert.equal(stored.version, 1)
  assert.deepEqual(stored.agents.map((a) => a.key), ['t:t1'])

  let old = applyEvent(emptyRoster(), { workspaceId: null, paneKey: 'old', state: 'done', receivedAt: T0 }, T0)
  old = applyEvent(old, { workspaceId: null, paneKey: 'busy', state: 'working', receivedAt: T0 }, T0)
  const reopened = fakeHost({ agents: [], storage: { [ROSTER_KEY]: old } })
  reopened.clock = T0 + DONE_TTL_MS + 1
  const view = track()
  await createController(reopened, view.onChange).start()
  assert.deepEqual(view.last().cards.map((c) => c.key), ['busy'])
})

test('tick drops expired agents', async () => {
  const host = fakeHost()
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  await controller.onStatus({ workspaceId: null, paneKey: 'p', state: 'done', receivedAt: T0 })
  assert.equal(view.last().cards.length, 1)
  host.clock = T0 + DONE_TTL_MS + 1
  await controller.tick()
  assert.equal(view.last().cards.length, 0)
})

test('clicking a card pins the next pet and remembers it', async () => {
  const host = fakeHost({ agents: [claude] })
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  const before = view.last().cards[0].pet
  await controller.cyclePet(view.last().cards[0].petKey)
  const after = view.last().cards[0].pet
  assert.notEqual(after, before)
  assert.deepEqual(host.storage.get(PINS_KEY), { t1: after })
  assert.equal(view.last().cards[0].frames?.id, after)

  const reopened = fakeHost({ agents: [claude], storage: { [PINS_KEY]: { t1: after } } })
  const view2 = track()
  await createController(reopened, view2.onChange).start()
  assert.equal(view2.last().cards[0].pet, after)
})

test('fetches frames once per pet', async () => {
  const host = fakeHost()
  host.storage.set(PINS_KEY, { a: 'iria', b: 'iria' })
  const controller = createController(host, () => {})
  await controller.start()
  await controller.onStatus({ workspaceId: null, paneKey: 'a', state: 'working', receivedAt: T0 })
  await controller.onStatus({ workspaceId: null, paneKey: 'b', state: 'done', receivedAt: T0 })
  await controller.onStatus({ workspaceId: null, paneKey: 'a', state: 'waiting', receivedAt: T0 })
  assert.deepEqual(host.framesAsked, ['iria'])
})

test('re-seeds on workspace.changed with the new workspace name', async () => {
  const host = fakeHost()
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  host.agents = [{ terminalId: 't7', title: 'Pi', agent: 'pi', state: 'waiting', stateStartedAt: T0 }]
  await controller.onWorkspace({ displayName: 'feat/x' })
  assert.deepEqual(view.last().cards.map((c) => [c.key, c.workspace]), [['t:t7', 'feat/x']])
})

test('shows an error when familiard cannot be reached, and still lists agents', async () => {
  const host = fakeHost({ agents: [claude] })
  host.pets = async () => {
    throw new Error('familiard pets failed: spawn familiard ENOENT')
  }
  const view = track()
  await createController(host, view.onChange).start()
  assert.match(view.last().error ?? '', /ENOENT/)
  assert.equal(view.last().cards.length, 1)
  assert.equal(view.last().cards[0].pet, null)
})
