# orca-plugins

Objective: personal Orca plugins in their own repo, installed from dotfiles. Branch: main (new repo). Delivery: ask-on-risk. Test runner: `orca-ide plugin test <dir> --json`.

## Specs

- S1. Plugin code lives in its own repo; dotfiles only reference it. User: "vale, pues un repo propio y que en dotfiles se llame! me gusta"
- S2. First plugin: a cheat sheet panel for Fran's custom Orca shortcuts (the Ctrl+Shift layer mirroring his tmux, Ctrl+E dictation, Alt+* panels, Ctrl+h/j/k/l left to the terminal), searchable.
- S3. Second plugin: milestones and issues of the current repo (via `gh` from a worker), with a way to launch an agent on an issue.
- S4. Dotfiles: `scripts/orca-settings.sh apply|save|diff` against a versioned JSON (keybindings and settings), following the `zen-shortcuts.sh` pattern, plus the plugin catalog reference.
- S6. Idea (2026-11-02, user): "podriamos hacer un plugin de familiard xD" — not specified yet.
- S5. Publishing to GitHub (visibility, catalog) only when the user asks.

- S7 (familiard): user: "4 jeje hazlo!" on "**El plugin de familiard**, el que te gustó." Scope (parent decision): right-sidebar panel `fullfran.familiar` that shows a familiard pet as text animation (`familiard frames <pet> --rows N` JSON: clips idle/working/waiting/done with fps and ANSI frames) and switches clip by the focused workspace's agent status (`agents.list` + `agent.status.changed`); pet chosen from `familiard pets --json`, remembered in plugin storage. Read-only towards the system: never summons, dismisses or edits pets.
- S8 (engram): user: "el panel de engram es muy buena mierda" on "**El panel de engram**, para luego proponérselo al repo de engram." Scope (parent decision): right-sidebar panel `fullfran.engram-memory` that resolves the focused workspace's engram project and lists its recent memories, with search and a detail view, through the local engram HTTP API (127.0.0.1:7437). Read-only: no save, delete, pin or judge.

- S9 (quota pace): user (dictated): "un pequeño plugin que me muestre cuánto tengo disponible para el día con esta estimación ... yo tengo 7 días a la semana, entonces me puedo gastar hasta el porcentaje que me toca de aquí a que se res[etee] ... cada día que pasa esta cuota la puedo equispaciar entre más". Scope (parent decision): right-sidebar panel `fullfran.quota-pace` reading `orca account list --json` -> `result.rateLimits.<provider>.<window>` (`usedPercent`, `windowMinutes`, `resetsAt` ms). For every weekly window (windowMinutes 10080): today's allowance = (100 - usedPercent at local start of today) / days left from local start of today to resetsAt (fractional); remaining today = allowance - (usedNow - usedAtStartOfToday). Read-only.
## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1 | inline | done | repo created, `plugin create --template components` |
| T2 | S2 | inline | done (pending load in Orca) | 89e2039; RED 0/3 → GREEN 3/3 `plugin test`; `plugin validate` ok; `plugin check` 82 elements, 0 errors |
| T3 | S4 | inline | done | dotfiles 34bf606 (`scripts/orca-settings.sh`, `orca/`), test 18/18 `scripts/tests/orca-settings-test.sh`, live `save`+`diff` in sync |
| T4 | S3 | inline | pending | |
| T6 | L-theme | inline | done, published (catalog 781ceef, dotfiles ae90a7f) | tokyo-night 0.1.0 app theme (data plugin); `plugin validate` ok, WCAG contrast script: no pair under Orca thresholds |
| T7 | S7 | delegated (writer trigger a: parallel with T8, T9) | done local, pending live check in Orca | `plugin test` 4 files pass (22 tests), `validate` ok; html panel (components panels take no colours) |
| T8 | S8 | delegated (writer trigger a: parallel with T7) | in progress | |
| T9 | S9 | delegated (writer trigger a: parallel with T7, T8) | done local, pending live check in Orca | `plugin test` 26/26, `validate` ok, `check` 3 scenarios 0 issues; live CLI read: Claude 60%, 3.46 d, 11.6%/day |
| T5 | S5 | inline | done | repo public (user: "dejalo publico y habilita la actualizacion!"); orca-catalog.json + scripts/release.sh, fran-shortcuts 0.1.0 @ 02f7ce5 (e797d24); dotfiles 28a95ec installs from the catalog |

## Log

- L1 (2026-11-02, user): "vale, pues un repo propio y que en dotfiles se llame! me gusta"
- L2: Orca 1.4.246 `.deb` lacks `resources/plugins/declarative/orca.d.ts`, so `plugin create`/`plugin types` cannot write `.orca/types`; panels still load (no build step), only `tsc` type-checking is lost.
- L3: Shortcut source of truth for now is the overrides JSON applied on 2026-11-02 (copy at `~/.config/orca/keybindings-fran.json`); T3 moves it into dotfiles.
- L4 (2026-11-02, user): "podriamos hacer un plugin de familiard xD"
- L-theme (2026-11-02, user): "pues hazlo todo!!!!" (Tokyo Night app theme so Orca looks like the terminal).
