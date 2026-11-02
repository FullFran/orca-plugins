# Engram Memory

A right-sidebar panel for [Orca](https://github.com/stablyai/orca) that shows the
[Engram](https://github.com/Gentleman-Programming/engram) memories of the project you are working
in. It follows the focused workspace: switch workspace and the list switches with it.

- **Recent memories** of the workspace's Engram project, newest first, each with its title, type,
  date (UTC) and a one-line preview.
- **Search** within that project (press Enter; clear the box to go back to recent ones).
- **Detail view** with the full content, scope, topic key and dates.
- **Lifecycle**: a memory Engram considers stale (`review_after` has passed, state
  `needs_review`) carries a *Needs review* badge, and superseded ones a *Superseded* badge.

It is strictly **read-only**. It only sends `GET` requests to Engram and never saves, edits,
deletes, pins or judges a memory.

## How it finds the project

1. Orca tells the panel the focused workspace's branch, name and terminals
   (`workspace.readContext`, then `workspace.changed`). It does not say which folder that is.
2. The worker looks the folder up with `orca-ide worktree list --json`, matching branch and name.
   When several worktrees share them (many repositories are on `main`), it uses
   `orca-ide terminal list --json` to see which of those folders the workspace's terminals run in.
3. If that still leaves no folder or several, the panel says so and, for several, lists them so
   you can pick one (remembered for that workspace). It never guesses.
4. The folder goes to Engram's `GET /project/current?cwd=<folder>`. When Engram cannot tell the
   project (it answers with `available_projects`, for example a folder that holds several
   repositories), the panel shows the candidates and stops there.
5. Memories come from `GET /observations/recent`, `GET /search` and `GET /observations/{id}`,
   always with the resolved `project`.

## Requirements

- Orca 1.4.246 or newer, with the `orca-ide` CLI on `PATH` (Orca installs it).
- `engram serve` running; by default on `http://127.0.0.1:7437`. If Engram is not reachable the
  panel says so and offers a retry.

## Access it asks for

| Access | Why |
| --- | --- |
| `trusted-worker` (a Node process) | Panels have no network and cannot run programs. The worker runs `orca-ide worktree list` / `terminal list` to find the workspace folder and makes the `GET` requests to Engram. |
| `workspace:read` | To know which workspace is focused (branch, name and terminal ids) and follow changes. |
| `settings:own` | To read the one setting below. |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Engram server URL (`serverUrl`) | `http://127.0.0.1:7437` | Where `engram serve` listens. |

The routes the panel uses are not behind `ENGRAM_HTTP_TOKEN` in Engram, so no token is needed.
Orca also does not pass shell variables such as `ENGRAM_HTTP_TOKEN` to plugin workers.

## Files

- `src/panel.tsx`: the panel (Orca components, no HTML or CSS, so it follows Orca's theme).
- `src/worker.ts`: the worker's two requests, `memories.load` and `memory.get`.
- `src/workspace.ts`: workspace to folder resolution.
- `src/engram.ts`: the read-only Engram HTTP client and the observation parser.
- `src/protocol.ts`: the panel <-> worker contract.

## Develop

```sh
orca-ide plugin validate .
orca-ide plugin test .     # panel, worker, resolution and client tests, with fakes for the CLI and HTTP
orca-ide plugin check .    # renders the panel in each src/panel.check.ts scenario
orca-ide plugin dev watch . # loads the folder into Orca; Ctrl-C unloads it
```
