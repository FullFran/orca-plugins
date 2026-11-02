// The classroom roster: every agent Orca has told the panel about, across workspaces. Pure
// functions over plain JSON, so it persists in plugin storage and runs under `orca plugin test`.
import type { AgentState } from './status'

export const DONE_TTL_MS = 30 * 60 * 1000
export const STALE_TTL_MS = 12 * 60 * 60 * 1000

export interface RosterAgent {
  /** paneKey from agent.status.changed; `t:<terminalId>` (or `seed:<title>`) for agents.list seeds. */
  key: string
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  /** When it entered `state` (ms since the epoch). */
  since: number
  /** Last time Orca said anything about it. */
  updatedAt: number
  workspaceId: string | null
  /** Known for agents.list seeds (the focused workspace); events only carry workspaceId. */
  workspaceName: string | null
}

export interface Roster {
  version: 1
  agents: RosterAgent[]
}

export interface ListedAgent {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  stateStartedAt: number
}

export interface StatusEvent {
  workspaceId: string | null
  paneKey: string
  terminalId?: string
  title?: string
  state: AgentState
  receivedAt: number
  mainAgent?: { state: AgentState; stateStartedAt: number; outcome?: string }
}

const STATES: readonly AgentState[] = ['working', 'blocked', 'waiting', 'done']

export function emptyRoster(): Roster {
  return { version: 1, agents: [] }
}

function findIndex(agents: RosterAgent[], key: string, terminalId: string | null): number {
  return agents.findIndex((a) => a.key === key || (terminalId !== null && a.terminalId === terminalId))
}

export function seedRoster(roster: Roster, listed: ListedAgent[], workspaceName: string | null, now: number): Roster {
  const agents = [...roster.agents]
  for (const item of listed) {
    if (!STATES.includes(item.state)) continue
    const key = item.terminalId !== null ? `t:${item.terminalId}` : `seed:${item.title ?? item.agent ?? 'agent'}`
    const index = findIndex(agents, key, item.terminalId)
    const previous = index >= 0 ? agents[index] : undefined
    const next: RosterAgent = {
      key: previous?.key ?? key,
      terminalId: item.terminalId ?? previous?.terminalId ?? null,
      title: item.title ?? previous?.title ?? null,
      agent: item.agent ?? previous?.agent ?? null,
      state: item.state,
      since: previous && previous.state === item.state ? previous.since : item.stateStartedAt || now,
      updatedAt: now,
      workspaceId: previous?.workspaceId ?? null,
      workspaceName: workspaceName ?? previous?.workspaceName ?? null
    }
    if (index >= 0) agents[index] = next
    else agents.push(next)
  }
  return { version: 1, agents }
}

export function applyEvent(roster: Roster, event: StatusEvent, now: number): Roster {
  if (!STATES.includes(event.state) || typeof event.paneKey !== 'string') return roster
  const terminalId = event.terminalId ?? null
  const agents = [...roster.agents]
  const index = findIndex(agents, event.paneKey, terminalId)
  const previous = index >= 0 ? agents[index] : undefined
  const startedAt = event.mainAgent?.state === event.state ? event.mainAgent.stateStartedAt : undefined
  const next: RosterAgent = {
    key: event.paneKey,
    terminalId: terminalId ?? previous?.terminalId ?? null,
    title: event.title ?? previous?.title ?? null,
    agent: previous?.agent ?? null,
    state: event.state,
    since:
      startedAt ?? (previous && previous.state === event.state ? previous.since : event.receivedAt || now),
    updatedAt: now,
    workspaceId: event.workspaceId ?? previous?.workspaceId ?? null,
    workspaceName: previous?.workspaceName ?? null
  }
  if (index >= 0) agents[index] = next
  else agents.push(next)
  return { version: 1, agents }
}

export function prune(roster: Roster, now: number): Roster {
  return {
    version: 1,
    agents: roster.agents.filter(
      (a) => now - a.updatedAt <= STALE_TTL_MS && !(a.state === 'done' && now - a.updatedAt > DONE_TTL_MS)
    )
  }
}

const RANK: Record<AgentState, number> = { blocked: 0, waiting: 0, working: 1, done: 2 }

/** Agents that need the person first, then busy ones, then finished ones; oldest in state first. */
export function ordered(roster: Roster): RosterAgent[] {
  return [...roster.agents].sort((a, b) => RANK[a.state] - RANK[b.state] || a.since - b.since)
}

const str = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown) => (v === null || typeof v === 'string' ? (v as string | null) : undefined)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseRoster(value: unknown): Roster {
  if (typeof value !== 'object' || value === null) return emptyRoster()
  const data = value as { version?: unknown; agents?: unknown }
  if (data.version !== 1 || !Array.isArray(data.agents)) return emptyRoster()
  const agents: RosterAgent[] = []
  for (const row of data.agents) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const fields = [r.terminalId, r.title, r.agent, r.workspaceId, r.workspaceName].map(strOrNull)
    if (!str(r.key) || !STATES.includes(r.state as AgentState) || !num(r.since) || !num(r.updatedAt)) continue
    if (fields.some((f) => f === undefined)) continue
    const [terminalId, title, agent, workspaceId, workspaceName] = fields as (string | null)[]
    agents.push({
      key: r.key,
      terminalId,
      title,
      agent,
      state: r.state as AgentState,
      since: r.since,
      updatedAt: r.updatedAt,
      workspaceId,
      workspaceName
    })
  }
  return { version: 1, agents }
}
