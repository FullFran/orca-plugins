// Which familiard clip matches the focused workspace's agents.

export type Clip = 'idle' | 'working' | 'waiting' | 'done'
export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

export const CLIPS: readonly Clip[] = ['idle', 'working', 'waiting', 'done']

// An agent that needs the person (blocked on a prompt or waiting for input) wins, then one that
// is busy, then one that finished. No agents at all is idle.
const PRIORITY: Record<AgentState, { clip: Clip; rank: number }> = {
  blocked: { clip: 'waiting', rank: 3 },
  waiting: { clip: 'waiting', rank: 3 },
  working: { clip: 'working', rank: 2 },
  done: { clip: 'done', rank: 1 }
}

export function clipFor(states: readonly AgentState[]): Clip {
  let best: Clip = 'idle'
  let rank = 0
  for (const state of states) {
    const entry = Object.prototype.hasOwnProperty.call(PRIORITY, state) ? PRIORITY[state] : undefined
    if (entry && entry.rank > rank) {
      best = entry.clip
      rank = entry.rank
    }
  }
  return best
}
