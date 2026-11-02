import { assert, test } from 'orca/testing'
import { createController, type PanelHost, type ViewState } from './controller'
import type { PetFrames } from './protocol'
import type { AgentState } from './status'

const PETS = [
  { id: 'ayaka', name: 'Ayaka', default: false },
  { id: 'iria', name: 'Iria', default: true }
]

function frames(id: string): PetFrames {
  return { id, name: id, rows: 10, clips: { idle: { fps: 3, frames: [`${id}-idle`] } } }
}

function fakeHost(options: { stored?: unknown; agents?: AgentState[] } = {}) {
  const storage = new Map<string, unknown>()
  if (options.stored !== undefined) storage.set('pet', options.stored)
  const host = {
    agents: options.agents ?? [],
    framesAsked: [] as string[],
    storage,
    async pets() {
      return PETS
    },
    async frames(id: string) {
      host.framesAsked.push(id)
      return frames(id)
    },
    async agentStates() {
      return host.agents
    },
    async storageGet(key: string) {
      return storage.has(key) ? storage.get(key) : null
    },
    async storageSet(key: string, value: unknown) {
      storage.set(key, value)
    }
  }
  return host satisfies PanelHost
}

function track() {
  const states: ViewState[] = []
  return { states, last: () => states[states.length - 1], onChange: (s: ViewState) => states.push(s) }
}

test('starts with the familiard default pet when nothing is stored', async () => {
  const host = fakeHost({ agents: ['working'] })
  const view = track()
  await createController(host, view.onChange).start()
  assert.equal(view.last().selected, 'iria')
  assert.equal(view.last().frames?.id, 'iria')
  assert.equal(view.last().clip, 'working')
  assert.equal(view.last().error, null)
  assert.deepEqual(host.framesAsked, ['iria'])
})

test('uses the remembered pet and remembers a new pick', async () => {
  const host = fakeHost({ stored: 'ayaka' })
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  assert.equal(view.last().selected, 'ayaka')
  await controller.selectPet('iria')
  assert.equal(view.last().selected, 'iria')
  assert.equal(view.last().frames?.id, 'iria')
  assert.equal(host.storage.get('pet'), 'iria')
})

test('falls back to the default when the remembered pet is gone', async () => {
  const host = fakeHost({ stored: 'removed-pet' })
  const view = track()
  await createController(host, view.onChange).start()
  assert.equal(view.last().selected, 'iria')
})

test('ignores picks that are not in the gallery', async () => {
  const host = fakeHost()
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  await controller.selectPet('--all')
  assert.equal(view.last().selected, 'iria')
  assert.equal(host.storage.has('pet'), false)
})

test('switches clip when the agents change', async () => {
  const host = fakeHost({ agents: [] })
  const view = track()
  const controller = createController(host, view.onChange)
  await controller.start()
  assert.equal(view.last().clip, 'idle')
  host.agents = ['working', 'blocked']
  await controller.refreshAgents()
  assert.equal(view.last().clip, 'waiting')
  host.agents = ['done']
  await controller.refreshAgents()
  assert.equal(view.last().clip, 'done')
})

test('shows an error when familiard cannot be reached', async () => {
  const host = fakeHost()
  host.pets = async () => {
    throw Object.assign(new Error('familiard pets failed: spawn familiard ENOENT'), { code: 'action_failed' })
  }
  const view = track()
  await createController(host, view.onChange).start()
  assert.match(view.last().error ?? '', /ENOENT/)
  assert.equal(view.last().frames, null)
})

test('an agent lookup failure keeps the pet idle instead of breaking', async () => {
  const host = fakeHost()
  host.agentStates = async () => {
    throw Object.assign(new Error('denied'), { code: 'capability_denied' })
  }
  const view = track()
  await createController(host, view.onChange).start()
  assert.equal(view.last().clip, 'idle')
  assert.equal(view.last().frames?.id, 'iria')
})
