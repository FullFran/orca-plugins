// `orca plugin check` renders the panel once per scenario. Requests are stubbed so check never
// runs the Orca CLI or reaches Engram.
import { defineCheck } from 'orca/testing'

const context = { branch: 'main', displayName: 'main', terminals: [] }

const memory = (id: number, title: string, state: 'active' | 'needs_review' = 'active') => ({
  id,
  title,
  type: 'decision',
  scope: 'project',
  topicKey: 'architecture/example',
  createdAt: '2026-11-01 10:00:00',
  updatedAt: '2026-11-01 10:05:00',
  preview: `What: ${title}. Why: an example memory for the check scenario.`,
  content: null,
  state,
  superseded: false
})

export default defineCheck({
  'no workspace': {},
  memories: {
    results: { 'workspace.readContext': context },
    requests: {
      'memories.load': {
        kind: 'ok',
        path: '/repos/app',
        project: 'app',
        projectSource: 'git_remote',
        query: '',
        memories: [memory(1, 'Chose hexagonal layout'), memory(2, 'Old port', 'needs_review')]
      }
    }
  },
  'engram down': {
    results: { 'workspace.readContext': context },
    requests: {
      'memories.load': {
        kind: 'engram-down',
        message: 'No answer from Engram at http://127.0.0.1:7437 (fetch failed).'
      }
    }
  },
  'ambiguous workspace': {
    results: { 'workspace.readContext': context },
    requests: {
      'memories.load': {
        kind: 'workspace-ambiguous',
        candidates: [
          { path: '/repos/a', displayName: 'main', branch: 'main' },
          { path: '/repos/b', displayName: 'main', branch: 'main' }
        ]
      }
    }
  },
  'ambiguous project': {
    results: { 'workspace.readContext': context },
    requests: {
      'memories.load': {
        kind: 'project-ambiguous',
        path: '/home/me',
        availableProjects: ['dotfiles', 'sandbox'],
        hint: 'ambiguous project: multiple git repos found in cwd'
      }
    }
  }
})
