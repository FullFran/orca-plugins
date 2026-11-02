// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { PaceSnapshot } from './pace'

export type { PaceRow, PaceSnapshot, ProviderIssue } from './pace'

declare module 'orca' {
  interface PluginRequests {
    /** The latest snapshot; the worker reads the quotas first when it has none or it is stale. */
    'pace.get': { output: PaceSnapshot }
    /** Reads the quotas now and answers the new snapshot. */
    'pace.refresh': { output: PaceSnapshot }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after each read (poll or refresh). */
    'pace.changed': PaceSnapshot
  }
}
