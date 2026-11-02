// The plugin's own worker. It runs `orca-ide account list --json` (a panel cannot start
// processes), turns every weekly quota window into today's pace and answers the panel. Orca starts
// it on the panel's first plugin.request and may stop it when idle; the daily baselines live in
// orca.storage (storage:own), so a restart keeps them.
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  buildRows,
  extractWeeklyWindows,
  parseClaudeopsHistory,
  parseOrcaDailyUsage,
  type Baseline,
  type DailyUsage,
  type PaceSnapshot,
  type UsageHistory
} from './pace'

export const POLL_MS = 5 * 60_000
const BASELINES = 'baselines'
const CLI_TIMEOUT_MS = 20_000

export interface WorkerDeps {
  /** Runs `account list --json` and resolves with its stdout. */
  run(): Promise<string>
  now(): number
  /** Calls `fn` every `ms`; returns the cancel. */
  schedule(fn: () => Promise<void> | void, ms: number): () => void
  /** Reads and parses a JSON file; rejects when it is missing or unreadable. Optional in tests. */
  readJson?(file: string): Promise<unknown>
}

/** Orca's data folder, where it keeps its usage statistics. */
function orcaDataDir(home: string): string {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca')
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'orca')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'orca')
}

async function tryRead(deps: WorkerDeps, file: string): Promise<unknown> {
  if (!deps.readJson) return null
  try {
    return await deps.readJson(file)
  } catch {
    return null
  }
}

/**
 * Usage recorded before this plugin ran: claudeops' log of Claude's weekly utilization, and Orca's
 * daily token statistics for Claude (all models, and Fable alone) and Codex. All optional.
 */
async function readUsageSources(deps: WorkerDeps): Promise<{ history: UsageHistory; daily: DailyUsage }> {
  const home = os.homedir()
  const data = orcaDataDir(home)
  const [claudeops, claude, codex] = await Promise.all([
    tryRead(deps, path.join(home, '.claudeops', 'snapshot-cache.json')),
    tryRead(deps, path.join(data, 'orca-claude-usage.json')),
    tryRead(deps, path.join(data, 'orca-codex-usage.json'))
  ])
  return {
    history: parseClaudeopsHistory(claudeops),
    daily: {
      'claude.weekly': parseOrcaDailyUsage(claude),
      'claude.fableWeekly': parseOrcaDailyUsage(claude, 'fable'),
      'codex.weekly': parseOrcaDailyUsage(codex)
    }
  }
}

/** The CLI candidates: the one shipped next to the running Orca first, then PATH. */
function cliCandidates(): string[] {
  const appDir = path.dirname(process.execPath)
  const bundled = [
    path.join(appDir, 'resources', 'bin', 'orca-ide'), // Linux, Windows
    path.join(appDir, '..', 'Resources', 'bin', 'orca-ide') // macOS
  ].filter((file) => {
    try {
      return existsSync(file) && statSync(file).isFile()
    } catch {
      return false
    }
  })
  return [...bundled, 'orca-ide', 'orca']
}

function execOnce(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    // The worker runs as Electron-in-Node; the CLI launches its own Electron and must not inherit it.
    delete env.ELECTRON_RUN_AS_NODE
    execFile(
      file,
      ['account', 'list', '--json'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env },
      (error, stdout) => {
        // The CLI exits non-zero with a JSON error body; let the parser read it.
        if (stdout && stdout.trim().startsWith('{')) resolve(stdout)
        else if (error) reject(error)
        else resolve(stdout)
      }
    )
  })
}

export async function runAccountList(): Promise<string> {
  let lastError: unknown = null
  for (const file of cliCandidates()) {
    try {
      return await execOnce(file)
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('orca-ide not found')
}

function parseRateLimits(stdout: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('orca-ide account list did not answer JSON')
  }
  const answer = parsed as { ok?: boolean; error?: { message?: string }; result?: { rateLimits?: unknown } }
  if (answer?.ok === false) throw new Error(answer.error?.message ?? 'orca-ide account list failed')
  return answer?.result?.rateLimits ?? {}
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function storedBaselines(orca: OrcaWorkerApi): Promise<Record<string, Baseline>> {
  const value = await orca.storage.get(BASELINES)
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Baseline>) : {}
}

/** The worker's activate/deactivate pair, with the CLI, clock and timer injected. */
export function createWorker(deps: WorkerDeps) {
  let latest: PaceSnapshot | null = null
  let inFlight: Promise<PaceSnapshot> | null = null
  let cancel: (() => void) | null = null

  async function read(orca: OrcaWorkerApi): Promise<PaceSnapshot> {
    const now = deps.now()
    let snapshot: PaceSnapshot
    try {
      const { windows, issues } = extractWeeklyWindows(parseRateLimits(await deps.run()))
      const { history, daily } = await readUsageSources(deps)
      const { rows, baselines } = buildRows(windows, await storedBaselines(orca), now, history, daily)
      await orca.storage.set(BASELINES, baselines)
      snapshot = { fetchedAt: now, rows, issues, error: null }
    } catch (error) {
      orca.log(`quota-pace: ${message(error)}`)
      snapshot = { fetchedAt: now, rows: latest?.rows ?? [], issues: latest?.issues ?? [], error: message(error) }
    }
    latest = snapshot
    orca.panels.post('pace.changed', snapshot)
    return snapshot
  }

  function refresh(orca: OrcaWorkerApi): Promise<PaceSnapshot> {
    // One CLI run at a time: a poll and a button press share it.
    inFlight ??= read(orca).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    default(orca: OrcaWorkerApi): void {
      orca.panels.handle('pace.get', async () => {
        const fresh = latest?.fetchedAt != null && deps.now() - latest.fetchedAt < POLL_MS
        return fresh && latest ? latest : refresh(orca)
      })
      orca.panels.handle('pace.refresh', () => refresh(orca))
      cancel = deps.schedule(async () => {
        await refresh(orca)
      }, POLL_MS)
    },
    deactivate(): void {
      cancel?.()
      cancel = null
    }
  }
}

const worker = createWorker({
  run: runAccountList,
  now: () => Date.now(),
  readJson: async (file) => JSON.parse(await readFile(file, 'utf8')),
  schedule: (fn, ms) => {
    const timer = setInterval(() => void fn(), ms)
    return () => clearInterval(timer)
  }
})

export default worker.default
export const deactivate = worker.deactivate
