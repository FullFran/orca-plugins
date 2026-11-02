# Fran Shortcuts

A right-sidebar panel written in TSX. Orca transpiles `src/panel.tsx` when the panel loads, so there is no build step and no build folder: edit, save, and the panel reloads. `orca plugin types .` (also run by `orca plugin dev watch`) writes the editor typings to `.orca/types/`, which `tsconfig.json` extends; run `npx tsc -p .` to type-check. `orca plugin test .` runs `src/panel.test.tsx` in Node with `orca/testing`, and `orca plugin check .` renders the panel once and reports errors with file:line. Import only `orca` and relative files.

## Develop

```sh
orca plugin validate .
orca plugin dev watch .    # loads this folder into Orca and prints its logs and reloads; Ctrl-C unloads it
```

Orca names the publisher after where the plugin is installed from: the GitHub or GitLab owner of
its repository, or `local` for a folder. See
https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md.
