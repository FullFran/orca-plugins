# Familiar

A right-sidebar "classroom": one [familiard](https://github.com/FullFran/familiard) pet per coding
agent Orca knows about, each one playing the clip of its agent's state. Each card shows the agent's
title and kind, its workspace (repo and name) and how long it has been in that state. Cards that
need you come first:

| Agent state           | Clip      | Order |
| --------------------- | --------- | ----- |
| `blocked`, `waiting`  | `waiting` | 1st   |
| `working`             | `working` | 2nd   |
| `done`                | `done`    | 3rd   |

- **Who is in class.** The panel seeds the roster from the focused workspace's agents
  (`agents.list`) when it opens and when focus moves, and adds or updates an agent on every
  `agent.status.changed`, from any workspace. The roster is kept in plugin storage, so reopening
  the panel keeps it. A `done` agent leaves after 30 minutes without news, and any agent after
  12 hours.
- **Which pet.** Each agent gets a pet from the familiard gallery by a stable hash of its terminal
  (or pane), so the same agent keeps the same pet. Click a card to give it the next pet; that pick
  is remembered.
- **Read-only.** It only runs `familiard pets --json`, `familiard frames <pet> --rows 8` and
  `orca worktree list --json`. It never summons, dismisses, adds or edits pets.

## Access it asks for

- **trusted-worker** (`src/worker.ts`): panels cannot run programs, so a small Node worker runs the
  three read-only commands above (with `execFile`, no shell) and hands their JSON to the panel. It
  caches each pet's frames and the workspace names (30 s). It looks for `familiard` on `PATH`,
  then in `~/.local/bin` and `~/.cargo/bin`, and for `orca-ide`/`orca` on `PATH`.
- **agent:read**: `agents.list` and `agent.status.changed`, to know the agents and their states.
- **workspace:read**: `workspace.readContext` and `workspace.changed`, for the focused workspace's
  name and to re-read its agents when focus moves.
- **storage:own**: the roster (key `roster`) and the pets you picked per agent (key `pins`).

## Layout

- `src/panel.html`, `src/panel.css`, `src/panel.ts`: the panel frame (HTML, because pet colors need
  real CSS colors; Orca components only take tones). Chrome uses Orca's `--orca-*` theme variables.
- `src/controller.ts`: panel state (roster, pets, pins, workspace names), free of the DOM.
- `src/roster.ts`: the roster reducer: seed, update, ordering, expiry and its stored shape.
- `src/pets.ts`: stable pet assignment and the click-to-cycle order.
- `src/ansi.ts`: turns familiard's 24-bit ANSI frames into colored segments.
- `src/status.ts`: agent state to clip.
- `src/familiard.ts`, `src/worker.ts`: runs and parses familiard and `orca worktree list`.

## Develop

```sh
orca plugin validate .
orca plugin test .          # roster, pets, controller, ansi, status and worker tests (CLIs mocked)
orca plugin dev watch .     # load into Orca; needs approval (trusted-worker)
orca plugin dev request . familiar.workspaces
```
