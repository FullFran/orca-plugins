# Familiar

A right-sidebar panel that shows your [familiard](https://github.com/FullFran/familiard) pet as a
colored text animation and changes its clip with what the agents of the focused Orca workspace are
doing:

| Agents in the focused workspace          | Clip      |
| ---------------------------------------- | --------- |
| any agent blocked or waiting for you     | `waiting` |
| otherwise, any agent working             | `working` |
| otherwise, any agent done                | `done`    |
| no agents                                | `idle`    |

Pick the pet from the list at the top; it starts on familiard's default pet and remembers your pick.

The plugin is read-only towards familiard: it only runs `familiard pets --json` and
`familiard frames <pet> --rows 10`. It never summons, dismisses, adds or edits pets.

## Access it asks for

- **trusted-worker** (`src/worker.ts`): panels cannot run programs, so a small Node worker runs the
  two familiard commands above and hands their JSON to the panel. It looks for `familiard` on
  `PATH`, then in `~/.local/bin` and `~/.cargo/bin`.
- **agent:read**: `agents.list` and `agent.status.changed`, to pick the clip.
- **workspace:read**: `workspace.changed`, to re-read the agents when focus moves to another workspace.
- **storage:own**: remembers the chosen pet (key `pet`).

## Layout

- `src/panel.html`, `src/panel.css`, `src/panel.ts`: the panel frame (HTML, because pet colors need
  real CSS colors; Orca components only take tones). Chrome uses Orca's `--orca-*` theme variables.
- `src/controller.ts`: panel state (pet choice, frames, clip), free of the DOM.
- `src/ansi.ts`: turns familiard's 24-bit ANSI frames into colored segments.
- `src/status.ts`: agent states to clip, with the priority above.
- `src/familiard.ts`, `src/worker.ts`: runs and parses familiard.

## Develop

```sh
orca plugin validate .
orca plugin test .          # ansi, status, controller and worker tests (familiard mocked)
orca plugin dev watch .     # load into Orca; needs approval (trusted-worker)
orca plugin dev request . familiar.pets
```
