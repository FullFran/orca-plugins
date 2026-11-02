# orca-plugins

Personal [Orca](https://github.com/stablyai/orca) plugins. Installed on each machine from the dotfiles; the code lives here.

| Plugin | What it does | Execution |
|---|---|---|
| [`fran-shortcuts`](plugins/fran-shortcuts) | Searchable cheat sheet of my Orca shortcuts (tmux-style Ctrl+Shift layer) | `sandboxed-ui`, no capabilities |

## Install (auto-updates)

Plugins are published through this repo's own catalog (`orca-catalog.json`). Installing from it keeps them up to date; Orca pins each release to a commit and checks its content hash.

- [Open Fran Shortcuts in Orca](https://onorca.dev/plugins/fullfran.fran-shortcuts?catalog=https://github.com/FullFran/orca-plugins.git) (or `orca://plugins/fullfran.fran-shortcuts?catalog=https://github.com/FullFran/orca-plugins.git`), then press **Install**.

## Release a new version

1. Change the plugin, bump `version` in its `orca-plugin.json`, commit and push.
2. `scripts/release.sh plugins/<id> --push`: validates, runs the tests, adds the release entry to `orca-catalog.json`, commits and pushes. Installed copies update automatically (Orca waits about 12 hours before offering releases from non-official catalogs).

## Develop

```sh
orca-ide plugin test plugins/<id> --json      # unit tests (orca/testing)
orca-ide plugin check plugins/<id> --json     # render check, runs locally
orca-ide plugin dev watch plugins/<id>        # load into Orca with hot reload (asks for approval)
```

Orca 1.4.246's Linux `.deb` does not ship `orca.d.ts`, so `.orca/types` cannot be generated and `tsc` type-checking is unavailable; panels still load because Orca transpiles without a build step.
