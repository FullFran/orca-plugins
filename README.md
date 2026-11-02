# orca-plugins

Personal [Orca](https://github.com/stablyai/orca) plugins. Installed on each machine from the dotfiles; the code lives here.

| Plugin | What it does | Execution |
|---|---|---|
| [`fran-shortcuts`](plugins/fran-shortcuts) | Searchable cheat sheet of my Orca shortcuts (tmux-style Ctrl+Shift layer) | `sandboxed-ui`, no capabilities |

## Develop

```sh
orca-ide plugin test plugins/<id> --json      # unit tests (orca/testing)
orca-ide plugin check plugins/<id> --json     # render check, runs locally
orca-ide plugin dev watch plugins/<id>        # load into Orca with hot reload (asks for approval)
```

Orca 1.4.246's Linux `.deb` does not ship `orca.d.ts`, so `.orca/types` cannot be generated and `tsc` type-checking is unavailable; panels still load because Orca transpiles without a build step.
