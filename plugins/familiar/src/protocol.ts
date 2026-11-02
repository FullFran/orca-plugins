// The panel <-> worker contract, declared once: src/panel.ts and src/worker.ts both read it.
export {}

export interface PetSummary {
  id: string
  name: string
  default: boolean
}

export interface ClipFrames {
  fps: number
  frames: string[]
}

export interface PetFrames {
  id: string
  name: string
  rows: number
  clips: Partial<Record<'idle' | 'working' | 'waiting' | 'done', ClipFrames>>
}

declare module 'orca' {
  interface PluginRequests {
    /** The pets in the familiard gallery (`familiard pets --json`). */
    'familiar.pets': { output: { pets: PetSummary[] } }
    /** One pet's animation clips (`familiard frames <id> --rows N`). */
    'familiar.frames': { input: { id: string }; output: PetFrames }
    /** Workspace ids (any form Orca uses) to "repo · name", from `orca worktree list --json`. */
    'familiar.workspaces': { output: { workspaces: Record<string, string> } }
  }
}
