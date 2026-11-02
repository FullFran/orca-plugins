# orca-plugins

Objective: personal Orca plugins in their own repo, installed from dotfiles. Branch: main (new repo). Delivery: ask-on-risk. Test runner: `orca-ide plugin test <dir> --json`.

## Specs

- S1. Plugin code lives in its own repo; dotfiles only reference it. User: "vale, pues un repo propio y que en dotfiles se llame! me gusta"
- S2. First plugin: a cheat sheet panel for Fran's custom Orca shortcuts (the Ctrl+Shift layer mirroring his tmux, Ctrl+E dictation, Alt+* panels, Ctrl+h/j/k/l left to the terminal), searchable.
- S3. Second plugin: milestones and issues of the current repo (via `gh` from a worker), with a way to launch an agent on an issue.
- S4. Dotfiles: `scripts/orca-settings.sh apply|save|diff` against a versioned JSON (keybindings and settings), following the `zen-shortcuts.sh` pattern, plus the plugin catalog reference.
- S6. Idea (2026-11-02, user): "podriamos hacer un plugin de familiard xD" — not specified yet.
- S5. Publishing to GitHub (visibility, catalog) only when the user asks.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done | repo created, `plugin create --template components` |
| T2 | S2 | inline | done (pending load in Orca) | 89e2039; RED 0/3 → GREEN 3/3 `plugin test`; `plugin validate` ok; `plugin check` 82 elements, 0 errors |
| T3 | S4 | inline | done | dotfiles 34bf606 (`scripts/orca-settings.sh`, `orca/`), test 18/18 `scripts/tests/orca-settings-test.sh`, live `save`+`diff` in sync |
| T4 | S3 | inline | pending | |
| T5 | S5 | inline | partial | private repo FullFran/orca-plugins created and pushed 2026-11-02 (user: "haz push de todo lo que necesites"); public catalog still pending a visibility decision |

## Log

- L1 (2026-11-02, user): "vale, pues un repo propio y que en dotfiles se llame! me gusta"
- L2: Orca 1.4.246 `.deb` lacks `resources/plugins/declarative/orca.d.ts`, so `plugin create`/`plugin types` cannot write `.orca/types`; panels still load (no build step), only `tsc` type-checking is lost.
- L3: Shortcut source of truth for now is the overrides JSON applied on 2026-11-02 (copy at `~/.config/orca/keybindings-fran.json`); T3 moves it into dotfiles.
- L4 (2026-11-02, user): "podriamos hacer un plugin de familiard xD"
