// The plugin's worker. Panels cannot read files, so this Node process reads ~/.claude for them:
// the settings files (for `skillOverrides`) and every SKILL.md. It never writes.
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { OrcaWorkerApi } from 'orca/worker'
import type { CheatSheetResult } from './protocol'
import { buildCheatSheet, findSkills, mergeOverrides, type Fs } from './skills'

export type WorkerDeps = { fs: Fs; claudeDir: string }

export const nodeFs: Fs = {
  async readFile(path) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  async listDirs(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name)
    } catch {
      return []
    }
  }
}

/** Same order Claude Code applies them: user settings, then the local overrides `/skills` writes. */
export const SETTINGS_FILES = ['settings.json', 'settings.local.json']

export async function loadCheatSheet(deps: WorkerDeps): Promise<CheatSheetResult> {
  try {
    const texts = await Promise.all(
      SETTINGS_FILES.map((file) => deps.fs.readFile(`${deps.claudeDir}/${file}`))
    )
    const overrides = mergeOverrides(texts)
    const skills = await findSkills(deps.fs, deps.claudeDir)
    return {
      kind: 'ok',
      skills: buildCheatSheet(skills, overrides),
      settingsFiles: SETTINGS_FILES.filter((_, i) => texts[i] !== null)
    }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

export function activateWith(orca: OrcaWorkerApi, deps: WorkerDeps): void {
  orca.panels.handle('skills.load', async () => loadCheatSheet(deps))
}

export default function activate(orca: OrcaWorkerApi): void {
  activateWith(orca, { fs: nodeFs, claudeDir: `${homedir()}/.claude` })
}
