// A read-only client for Engram's local HTTP API (`engram serve`, port 7437 by default).
// It only sends GET requests to the routes below; it has no way to save, edit or delete.
//
//   GET /project/current?cwd=<folder>        which project a folder belongs to
//   GET /observations/recent?project=&limit= newest memories of a project
//   GET /search?q=&project=&limit=           full-text search within a project
//   GET /observations/{id}                   one memory with its full content
import type { Memory } from './protocol'

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<Response>

export type ProjectResolution =
  | { kind: 'unique'; project: string; source: string }
  | { kind: 'ambiguous'; availableProjects: string[]; hint: string }
  | { kind: 'none'; hint: string }

export interface EngramClient {
  currentProject(cwd: string): Promise<ProjectResolution>
  recent(project: string, limit: number): Promise<Memory[]>
  search(project: string, query: string, limit: number): Promise<Memory[]>
  /** Null when Engram has no memory with that id. */
  get(id: number): Promise<Memory | null>
}

/** Engram did not answer at all: not running, wrong port, or not HTTP. */
export class EngramUnavailable extends Error {
  constructor(baseUrl: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`No answer from Engram at ${baseUrl} (${reason}). Is \`engram serve\` running?`)
    this.name = 'EngramUnavailable'
  }
}

/** Engram answered with an error status. */
export class EngramError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(typeof body.error === 'string' ? body.error : `Engram answered HTTP ${status}`)
    this.name = 'EngramError'
  }
}

const PREVIEW_LENGTH = 160
const TIMEOUT_MS = 8000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Engram writes `2006-01-02 15:04:05` in UTC, or RFC 3339; mirrors its parseObservationTime. */
function parseEngramTime(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00Z`
      : trimmed
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Engram's lifecycle state is derived, not stored: a memory needs review once its
 * `review_after` time has passed (store.Observation.State in Engram).
 */
function lifecycleState(reviewAfter: unknown, now: number): Memory['state'] {
  const at = parseEngramTime(text(reviewAfter))
  return at !== null && at <= now ? 'needs_review' : 'active'
}

function previewOf(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH)}…` : oneLine
}

/** Parses one observation (or search result) from Engram; null when it is not one. */
export function parseMemory(
  raw: unknown,
  options: { withContent?: boolean; now: number }
): Memory | null {
  if (!isRecord(raw) || typeof raw.id !== 'number' || !Number.isFinite(raw.id)) return null
  const content = text(raw.content)
  return {
    id: raw.id,
    title: text(raw.title) || `Memory ${raw.id}`,
    type: text(raw.type) || 'memory',
    scope: text(raw.scope),
    topicKey: text(raw.topic_key) || null,
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at) || text(raw.created_at),
    preview: previewOf(content),
    content: options.withContent ? content : null,
    state: lifecycleState(raw.review_after, options.now),
    superseded: text(raw.superseded_by_sync_id) !== ''
  }
}

export function createEngramClient(options: {
  baseUrl: string
  fetch?: FetchLike
  now?: () => number
}): EngramClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = options.now ?? Date.now

  async function getJson(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const query = new URLSearchParams(params).toString()
    const url = `${baseUrl}${path}${query ? `?${query}` : ''}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (error) {
      throw new EngramUnavailable(baseUrl, error)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new EngramUnavailable(baseUrl, error)
    }
    if (!response.ok) throw new EngramError(response.status, isRecord(body) ? body : {})
    return body
  }

  const memories = (body: unknown) =>
    (Array.isArray(body) ? body : [])
      .map((raw) => parseMemory(raw, { now: now() }))
      .filter((memory): memory is Memory => memory !== null)

  /** A project with no memories yet is `unknown_project` to Engram: read it as empty. */
  async function listOrEmpty(path: string, params: Record<string, string>) {
    try {
      return memories(await getJson(path, params))
    } catch (error) {
      if (error instanceof EngramError && error.body.code === 'unknown_project') return []
      throw error
    }
  }

  return {
    async currentProject(cwd) {
      const body = await getJson('/project/current', { cwd })
      const record = isRecord(body) ? body : {}
      const available = Array.isArray(record.available_projects)
        ? record.available_projects.filter((name): name is string => typeof name === 'string')
        : []
      const hint = text(record.error_hint) || text(record.warning)
      // Engram lists candidates only when it cannot tell one project: never pick among them.
      if (available.length > 0 || record.project_source === 'ambiguous') {
        return { kind: 'ambiguous', availableProjects: available, hint }
      }
      const project = text(record.project)
      if (!project) return { kind: 'none', hint }
      return { kind: 'unique', project, source: text(record.project_source) }
    },
    recent: (project, limit) =>
      listOrEmpty('/observations/recent', { project, limit: String(limit) }),
    search: (project, query, limit) =>
      listOrEmpty('/search', { q: query, project, limit: String(limit) }),
    async get(id) {
      try {
        return parseMemory(await getJson(`/observations/${id}`), { withContent: true, now: now() })
      } catch (error) {
        if (error instanceof EngramError && error.status === 404) return null
        throw error
      }
    }
  }
}
