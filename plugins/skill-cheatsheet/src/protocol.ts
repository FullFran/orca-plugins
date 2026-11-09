// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
// Every request is a read: the plugin never writes to ~/.claude.
export {}

/** Why the skill is in the cheat sheet. */
export type SkillMode =
  /** Hidden from the model: `skillOverrides: "user-invocable-only"` or `disable-model-invocation: true`. */
  | 'manual'
  /** Listed to the model by name only (`skillOverrides: "name-only"`). */
  | 'name-only'

export type SkillEntry = {
  /** What you type, for example `/diapositivas-fran` or `/codex:rescue`. */
  command: string
  mode: SkillMode
  /** One short sentence from the SKILL.md description; empty when no SKILL.md was found. */
  summary: string
  /** Where it came from: `personal`, a plugin name, or `not found` (bundled skills live in Claude Code). */
  source: string
}

export type CheatSheetResult =
  | { kind: 'ok'; skills: SkillEntry[]; settingsFiles: string[] }
  | { kind: 'error'; message: string }
