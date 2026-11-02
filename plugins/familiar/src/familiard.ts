// Parses what the familiard CLI prints. Only read-only subcommands are ever run.
import type { ClipFrames, PetFrames, PetSummary } from './protocol'
import { CLIPS } from './status'

/** Sprite height in terminal rows: small enough that several cards fit the right sidebar. */
export const ROWS = 8

const PET_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export function isPetId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && PET_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePets(output: string): PetSummary[] {
  const data: unknown = JSON.parse(output)
  if (!Array.isArray(data)) throw new Error('familiard pets --json did not print a list')
  return data.flatMap((item) =>
    isRecord(item) && isPetId(item.id)
      ? [
          {
            id: item.id,
            name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id,
            default: item.default === true
          }
        ]
      : []
  )
}

function parseClip(value: unknown): ClipFrames | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) return null
  const frames = value.frames.filter((frame): frame is string => typeof frame === 'string')
  if (frames.length === 0) return null
  const fps = typeof value.fps === 'number' && value.fps > 0 ? Math.min(value.fps, 30) : 4
  return { fps, frames }
}

export function parseFrames(output: string): PetFrames {
  const data: unknown = JSON.parse(output)
  if (!isRecord(data) || !isRecord(data.clips)) throw new Error('familiard frames did not print clips')
  const clips: PetFrames['clips'] = {}
  for (const name of CLIPS) {
    const clip = parseClip(data.clips[name])
    if (clip) clips[name] = clip
  }
  return {
    id: typeof data.id === 'string' ? data.id : '',
    name: typeof data.name === 'string' ? data.name : '',
    rows: typeof data.rows === 'number' ? data.rows : ROWS,
    clips
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** `orca worktree list --json` → every id a workspace may go by, mapped to "repo · name". */
export function parseWorkspaces(output: string): Record<string, string> {
  const data: unknown = JSON.parse(output)
  const rows = isRecord(data) && isRecord(data.result) ? data.result.worktrees : undefined
  const map: Record<string, string> = {}
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    if (!isRecord(row)) continue
    const repo = typeof row.path === 'string' ? basename(row.path) : ''
    const branch = typeof row.branch === 'string' ? row.branch.replace(/^refs\/heads\//, '') : ''
    const name = typeof row.displayName === 'string' && row.displayName !== '' ? row.displayName : branch
    const label = [repo, name].filter(Boolean).join(' · ')
    if (!label) continue
    const ids = [row.id, isRecord(row.identity) ? row.identity.key : undefined, row.instanceId]
    for (const id of ids) if (typeof id === 'string' && id !== '') map[id] = label
  }
  return map
}
