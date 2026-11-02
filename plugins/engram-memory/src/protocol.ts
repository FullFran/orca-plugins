// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
// Every request is a read: the plugin never writes to Engram.
export {}

/** What `workspace.readContext` and `workspace.changed` report for the focused workspace. */
export type WorkspaceContext = {
  branch: string
  displayName: string
  terminals: { id: string; title?: string }[]
}

/** A memory as the panel shows it, parsed from an Engram observation. */
export type Memory = {
  id: number
  title: string
  type: string
  scope: string
  topicKey: string | null
  /** `updated_at` from Engram, as Engram wrote it (UTC). */
  updatedAt: string
  createdAt: string
  /** The first characters of the content on one line. */
  preview: string
  /** Full content; only filled by `memory.get`. */
  content: string | null
  /** Engram's lifecycle state: `needs_review` once `review_after` has passed. */
  state: 'active' | 'needs_review'
  /** True when a newer memory superseded this one. */
  superseded: boolean
}

export type WorkspaceCandidate = { path: string; displayName: string; branch: string }

/** Every state the list view can be in. */
export type MemoriesResult =
  | { kind: 'no-workspace' }
  | { kind: 'workspace-none'; branch: string; displayName: string }
  | { kind: 'workspace-ambiguous'; candidates: WorkspaceCandidate[] }
  | { kind: 'project-ambiguous'; path: string; availableProjects: string[]; hint: string }
  | { kind: 'project-none'; path: string; hint: string }
  | { kind: 'engram-down'; message: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok'
      path: string
      project: string
      projectSource: string
      query: string
      memories: Memory[]
    }

export type MemoryResult =
  | { kind: 'ok'; memory: Memory }
  | { kind: 'not-found'; id: number }
  | { kind: 'engram-down'; message: string }
  | { kind: 'error'; message: string }

declare module 'orca' {
  interface PluginRequests {
    /**
     * Resolves the workspace's folder and Engram project, then lists its recent memories, or the
     * ones matching `query` when it is not blank. `choice` is a folder the person picked when the
     * workspace was ambiguous; it is used only when it is one of the candidates.
     */
    'memories.load': {
      input: { context: WorkspaceContext | null; query: string; choice: string | null }
      output: MemoriesResult
    }
    /** One memory with its full content. */
    'memory.get': { input: { id: number }; output: MemoryResult }
  }
}
