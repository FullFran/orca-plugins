// Panel state, kept free of the DOM so it runs under `orca plugin test`.
import type { PetFrames, PetSummary } from './protocol'
import { clipFor, type AgentState, type Clip } from './status'

export const PET_KEY = 'pet'

/** What the panel needs from Orca and its worker; src/panel.ts wires it to `window.orca`. */
export interface PanelHost {
  pets(): Promise<PetSummary[]>
  frames(id: string): Promise<PetFrames>
  agentStates(): Promise<AgentState[]>
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
}

export interface ViewState {
  pets: PetSummary[]
  selected: string | null
  frames: PetFrames | null
  clip: Clip
  loading: boolean
  error: string | null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createController(host: PanelHost, onChange: (state: ViewState) => void) {
  let state: ViewState = { pets: [], selected: null, frames: null, clip: 'idle', loading: true, error: null }
  let framesToken = 0
  let agentsToken = 0

  const change = (patch: Partial<ViewState>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  async function loadFrames(id: string): Promise<void> {
    const token = ++framesToken
    change({ selected: id, loading: true, error: null })
    try {
      const frames = await host.frames(id)
      if (token === framesToken) change({ frames, loading: false })
    } catch (error) {
      if (token === framesToken) change({ frames: null, loading: false, error: message(error) })
    }
  }

  async function refreshAgents(): Promise<void> {
    const token = ++agentsToken
    let states: AgentState[] = []
    try {
      states = await host.agentStates()
    } catch {
      states = [] // No agents we can see: the pet idles.
    }
    if (token === agentsToken) change({ clip: clipFor(states) })
  }

  async function start(): Promise<void> {
    const agents = refreshAgents()
    let pets: PetSummary[]
    let stored: unknown = null
    try {
      ;[pets, stored] = await Promise.all([host.pets(), host.storageGet(PET_KEY).catch(() => null)])
    } catch (error) {
      change({ loading: false, error: message(error) })
      await agents
      return
    }
    const pick =
      pets.find((pet) => pet.id === stored) ?? pets.find((pet) => pet.default) ?? pets[0] ?? null
    change({ pets })
    if (pick) await loadFrames(pick.id)
    else change({ loading: false, error: 'The familiard gallery is empty. Add a pet with `familiard add`.' })
    await agents
  }

  async function selectPet(id: string): Promise<void> {
    if (!state.pets.some((pet) => pet.id === id) || id === state.selected) return
    await Promise.all([loadFrames(id), host.storageSet(PET_KEY, id).catch(() => undefined)])
  }

  return { start, selectPet, refreshAgents, state: () => state }
}
