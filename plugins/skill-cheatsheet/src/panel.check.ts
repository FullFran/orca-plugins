// `orca plugin check` renders the panel once per scenario. Requests are stubbed so check never
// reads ~/.claude.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  'cheat sheet': {
    requests: {
      'skills.load': {
        kind: 'ok',
        settingsFiles: ['settings.json'],
        skills: [
          { command: '/diapositivas-fran', mode: 'manual', summary: 'Build a fullfran-style explainer deck and render it to PDF.', source: 'personal' },
          { command: '/whisper-transcription', mode: 'manual', summary: 'Install and use Whisper for local transcription.', source: 'personal' },
          { command: '/codex:rescue', mode: 'manual', summary: 'Delegate investigation or a fix to Codex.', source: 'codex' },
          { command: '/dataviz', mode: 'name-only', summary: '', source: 'not found' }
        ]
      }
    }
  },
  empty: { requests: { 'skills.load': { kind: 'ok', skills: [], settingsFiles: [] } } },
  error: { requests: { 'skills.load': { kind: 'error', message: 'EACCES: permission denied' } } }
})
