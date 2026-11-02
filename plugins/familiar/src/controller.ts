// Classroom panel state: one card per agent, each with its own pet and clip. Kept free of the
// DOM so it runs under `orca plugin test`; src/panel.ts wires it to window.orca.
import { assignPet, nextPet } from './pets'
import type { PetFrames, PetSummary } from './protocol'
import {
  applyEvent,
  emptyRoster,
  ordered,
  parseRoster,
  prune,
  seedRoster,
  type ListedAgent,
  type Roster,
  type RosterAgent,
  type StatusEvent
} from './roster'
import { clipFor, type AgentState, type Clip } from './status'

export const ROSTER_KEY = 'roster'
export const PINS_KEY = 'pins'
export const UNKNOWN_WORKSPACE = '—'

/** What the panel needs from Orca and its worker. */
export interface PanelHost {
  now(): number
  pets(): Promise<PetSummary[]>
  frames(id: string): Promise<PetFrames>
  workspaces(): Promise<Record<string, string>>
  listAgents(): Promise<ListedAgent[]>
  focusedWorkspace(): Promise<string | null>
  storageGet(key: string): Promise<unknown>
  storageSet(key: string, value: unknown): Promise<void>
}

export interface Card {
  key: string
  /** Stable across agents.list seeds and events: what pins and the pet hash use. */
  petKey: string
  title: string
  kind: string | null
  state: AgentState
  clip: Clip
  since: number
  workspace: string
  pet: string | null
  frames: PetFrames | null
}

export interface ViewState {
  cards: Card[]
  pets: PetSummary[]
  error: string | null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parsePins(value: unknown): Record<string, string> {
  const pins: Record<string, string> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return pins
  for (const [key, pet] of Object.entries(value)) if (typeof pet === 'string') pins[key] = pet
  return pins
}

export const petKeyOf = (agent: RosterAgent) => agent.terminalId ?? agent.key

export function createController(host: PanelHost, onChange: (state: ViewState) => void) {
  let roster: Roster = emptyRoster()
  let pins: Record<string, string> = {}
  let pets: PetSummary[] = []
  let workspaces: Record<string, string> = {}
  let error: string | null = null
  const frames = new Map<string, PetFrames>()
  const pending = new Set<string>()
  let saving = false
  let dirty = false

  function cards(): Card[] {
    const gallery = pets.map((pet) => pet.id)
    return ordered(roster).map((agent) => {
      const petKey = petKeyOf(agent)
      const pet = assignPet(petKey, gallery, pins)
      return {
        key: agent.key,
        petKey,
        title: agent.title ?? agent.agent ?? 'Agent',
        kind: agent.agent,
        state: agent.state,
        clip: clipFor([agent.state]),
        since: agent.since,
        workspace:
          agent.workspaceName ?? (agent.workspaceId ? workspaces[agent.workspaceId] : undefined) ?? UNKNOWN_WORKSPACE,
        pet,
        frames: pet ? (frames.get(pet) ?? null) : null
      }
    })
  }

  const emit = () => onChange({ cards: cards(), pets, error })

  async function loadMissingFrames(): Promise<void> {
    const wanted = new Set(cards().flatMap((card) => (card.pet && !frames.has(card.pet) ? [card.pet] : [])))
    const loads = [...wanted]
      .filter((pet) => !pending.has(pet))
      .map(async (pet) => {
        pending.add(pet)
        try {
          frames.set(pet, await host.frames(pet))
        } catch (failure) {
          error = message(failure)
        } finally {
          pending.delete(pet)
        }
        emit()
      })
    await Promise.all(loads)
  }

  async function persist(): Promise<void> {
    // One write at a time; a burst of events coalesces into the next write.
    if (saving) {
      dirty = true
      return
    }
    saving = true
    try {
      do {
        dirty = false
        await host.storageSet(ROSTER_KEY, roster).catch(() => undefined)
      } while (dirty)
    } finally {
      saving = false
    }
  }

  async function resolveWorkspaces(): Promise<void> {
    try {
      workspaces = await host.workspaces()
    } catch {
      workspaces = {}
    }
  }

  async function changed(): Promise<void> {
    emit()
    await Promise.all([persist(), loadMissingFrames()])
  }

  async function seed(name: string | null): Promise<void> {
    let listed: ListedAgent[] = []
    try {
      listed = await host.listAgents()
    } catch {
      listed = []
    }
    roster = seedRoster(roster, listed, name, host.now())
  }

  async function start(): Promise<void> {
    const [stored, storedPins, gallery, focused] = await Promise.all([
      host.storageGet(ROSTER_KEY).catch(() => null),
      host.storageGet(PINS_KEY).catch(() => null),
      host.pets().catch((failure) => {
        error = message(failure)
        return [] as PetSummary[]
      }),
      host.focusedWorkspace().catch(() => null)
    ])
    roster = prune(parseRoster(stored), host.now())
    pins = parsePins(storedPins)
    pets = gallery
    if (pets.length === 0 && error === null) error = 'The familiard gallery is empty. Add a pet with `familiard add`.'
    await Promise.all([seed(focused), resolveWorkspaces()])
    await changed()
  }

  async function onStatus(event: StatusEvent): Promise<void> {
    roster = applyEvent(roster, event, host.now())
    if (event.workspaceId && !(event.workspaceId in workspaces)) await resolveWorkspaces()
    await changed()
  }

  async function onWorkspace(context: { displayName?: string } | null): Promise<void> {
    await seed(context?.displayName ?? null)
    await changed()
  }

  async function tick(): Promise<void> {
    const before = roster.agents.length
    roster = prune(roster, host.now())
    if (roster.agents.length !== before) await changed()
    else emit() // time in state moves on
  }

  async function cyclePet(petKey: string): Promise<void> {
    const card = cards().find((c) => c.petKey === petKey)
    const next = card ? nextPet(card.pet, pets.map((pet) => pet.id)) : null
    if (!card || !next) return
    pins = { ...pins, [petKey]: next }
    emit()
    await Promise.all([host.storageSet(PINS_KEY, pins).catch(() => undefined), loadMissingFrames()])
  }

  return { start, onStatus, onWorkspace, tick, cyclePet }
}
