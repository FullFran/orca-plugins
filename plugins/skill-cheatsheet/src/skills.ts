// Pure logic: which skills you have to invoke by hand, and a one-line summary of each.
// File access is passed in so tests run without touching ~/.claude.
import type { SkillEntry, SkillMode } from './protocol'

export type Fs = {
  /** File contents, or null when it does not exist or cannot be read. */
  readFile(path: string): Promise<string | null>
  /** Names of the subdirectories, or [] when the directory does not exist. */
  listDirs(path: string): Promise<string[]>
}

const MAX_SUMMARY = 120

/** Reads `name`, `description` and `disable-model-invocation` from a SKILL.md frontmatter. */
export function parseFrontmatter(text: string): {
  name: string | null
  description: string
  disableModelInvocation: boolean
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const lines = match ? match[1].split(/\r?\n/) : []
  const fields: Record<string, string> = {}
  let current: string | null = null
  for (const line of lines) {
    const key = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (key) {
      current = key[1]
      fields[current] = key[2]
    } else if (current && /^\s/.test(line)) {
      fields[current] += ` ${line.trim()}`
    }
  }
  const clean = (value: string | undefined) =>
    (value ?? '')
      .replace(/^[>|][-+]?\s*/, '')
      .replace(/^(['"])([\s\S]*)\1$/, '$2')
      .replace(/\s+/g, ' ')
      .trim()
  return {
    name: clean(fields.name) || null,
    description: clean(fields.description),
    disableModelInvocation: clean(fields['disable-model-invocation']) === 'true'
  }
}

/**
 * The shortest useful summary: drops a leading `Trigger: ...` sentence (that says when, not what)
 * and keeps the next sentence, cut to MAX_SUMMARY characters.
 */
export function summarize(description: string): string {
  // A sentence ends at . ! or ? followed by a space, so URLs like www.example.com stay whole.
  const sentences = description.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  const what = sentences.find((s) => !/^trigger\b/i.test(s)) ?? sentences[0] ?? ''
  return what.length > MAX_SUMMARY ? `${what.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : what
}

/** `skillOverrides` merged from the settings files in order: later files win. */
export function mergeOverrides(settingsTexts: (string | null)[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const text of settingsTexts) {
    if (!text) continue
    try {
      const overrides = JSON.parse(text)?.skillOverrides
      if (overrides && typeof overrides === 'object') {
        for (const [name, value] of Object.entries(overrides)) {
          if (typeof value === 'string') merged[name] = value
        }
      }
    } catch {
      // A broken settings file contributes nothing; Claude Code would reject it too.
    }
  }
  return merged
}

type FoundSkill = {
  command: string
  name: string
  description: string
  disableModelInvocation: boolean
  source: string
}

async function readSkill(fs: Fs, dir: string, fallbackName: string) {
  const text = await fs.readFile(`${dir}/SKILL.md`)
  if (text === null) return null
  const front = parseFrontmatter(text)
  return { ...front, name: front.name ?? fallbackName }
}

/** Personal skills (`~/.claude/skills/<name>`) and plugin skills (`plugins/cache/<market>/<plugin>/<version>/skills/<name>`). */
export async function findSkills(fs: Fs, claudeDir: string): Promise<FoundSkill[]> {
  const found: FoundSkill[] = []
  const personal = `${claudeDir}/skills`
  for (const dir of (await fs.listDirs(personal)).sort()) {
    if (dir.startsWith('.') || dir === 'synced') continue
    const skill = await readSkill(fs, `${personal}/${dir}`, dir)
    if (skill) found.push({ ...skill, command: `/${skill.name}`, source: 'personal' })
  }
  const cache = `${claudeDir}/plugins/cache`
  const byCommand = new Map<string, FoundSkill>()
  for (const market of await fs.listDirs(cache)) {
    for (const plugin of await fs.listDirs(`${cache}/${market}`)) {
      // Versions sort so the newest one is read last and wins.
      for (const version of (await fs.listDirs(`${cache}/${market}/${plugin}`)).sort()) {
        const skillsDir = `${cache}/${market}/${plugin}/${version}/skills`
        for (const dir of await fs.listDirs(skillsDir)) {
          const skill = await readSkill(fs, `${skillsDir}/${dir}`, dir)
          if (!skill) continue
          const command = `/${plugin}:${skill.name}`
          byCommand.set(command, { ...skill, command, source: plugin })
        }
      }
    }
  }
  return [...found, ...byCommand.values()]
}

/** Skills you must invoke by hand, then the ones the model only sees by name. */
export function buildCheatSheet(
  skills: FoundSkill[],
  overrides: Record<string, string>
): SkillEntry[] {
  const entries: SkillEntry[] = []
  const seen = new Set<string>()
  const add = (command: string, mode: SkillMode, description: string, source: string) => {
    if (seen.has(command)) return
    seen.add(command)
    entries.push({ command, mode, summary: summarize(description), source })
  }
  for (const skill of skills) {
    // skillOverrides only applies to non-plugin skills, keyed by name.
    const override = skill.source === 'personal' ? overrides[skill.name] : undefined
    if (override === 'user-invocable-only' || skill.disableModelInvocation) {
      add(skill.command, 'manual', skill.description, skill.source)
    } else if (override === 'name-only') {
      add(skill.command, 'name-only', skill.description, skill.source)
    }
  }
  // Overrides naming a skill with no SKILL.md on disk: bundled skills such as dataviz.
  for (const [name, value] of Object.entries(overrides)) {
    const mode: SkillMode | null =
      value === 'user-invocable-only' ? 'manual' : value === 'name-only' ? 'name-only' : null
    if (mode) add(`/${name}`, mode, '', 'not found')
  }
  const rank = (mode: SkillMode) => (mode === 'manual' ? 0 : 1)
  return entries.sort((a, b) => rank(a.mode) - rank(b.mode) || a.command.localeCompare(b.command))
}

/** Case-insensitive filter over command, summary and source. */
export function filterSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return skills
  return skills.filter((s) => `${s.command} ${s.summary} ${s.source}`.toLowerCase().includes(q))
}
