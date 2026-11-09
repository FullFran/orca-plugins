# Skill Cheat Sheet

A side panel for [Orca](https://github.com/stablyai/orca) that lists the Claude Code skills you
have to invoke by hand, with a one-line summary of what each one does. It reads them live from
`~/.claude`, so hiding or showing a skill changes the panel without editing the plugin.

- **Invoke by hand**: skills hidden from the model, which only run when you type `/name`:
  - `skillOverrides: { "<name>": "user-invocable-only" }` in `~/.claude/settings.json` or
    `settings.local.json` (the local file wins), or
  - `disable-model-invocation: true` in the skill's `SKILL.md` frontmatter (also for plugin skills,
    shown as `/plugin:name`).
- **Listed by name only**: `skillOverrides: "name-only"`. The model sees the name but not the
  description.
- **Summary**: the first sentence of the `description` that is not a `Trigger: ...` sentence, cut to
  120 characters. Overrides that name a skill with no `SKILL.md` on disk (bundled skills such as
  `dataviz`) appear without a summary.
- **Filter** by command, summary or plugin; **Reload** re-reads `~/.claude`.

It is strictly **read-only**: the worker reads the two settings files, `~/.claude/skills/*/SKILL.md`
and `~/.claude/plugins/cache/*/*/*/skills/*/SKILL.md`, and never writes. Skills synced from
claude.ai (`~/.claude/skills/synced`) are skipped.

## Develop

```sh
orca-ide plugin test plugins/skill-cheatsheet --json
orca-ide plugin check plugins/skill-cheatsheet --json
```
