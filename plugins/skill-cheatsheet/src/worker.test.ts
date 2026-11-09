// Runs the worker's handler over a mock host, with ~/.claude replaced by an in-memory tree.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { Fs } from './skills'
import { activateWith } from './worker'

function start(fs: Fs) {
  return mountWorker({ default: (orca: never) => activateWith(orca, { fs, claudeDir: '/c' }) }, { host: mockHost() })
}

const files: Record<string, string> = {
  '/c/settings.json': JSON.stringify({ skillOverrides: { slides: 'user-invocable-only' } }),
  '/c/skills/slides/SKILL.md': '---\nname: slides\ndescription: Trigger: slides. Build a deck.\n---\n'
}

const fs: Fs = {
  readFile: async (path) => files[path] ?? null,
  listDirs: async (path) => (path === '/c/skills' ? ['slides'] : [])
}

test('skills.load reads the settings files and the skills', async () => {
  const worker = await start(fs)
  const result = await worker.request('skills.load', {})
  assert.deepEqual(result, {
    kind: 'ok',
    skills: [{ command: '/slides', mode: 'manual', summary: 'Build a deck.', source: 'personal' }],
    settingsFiles: ['settings.json']
  })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a missing ~/.claude gives an empty cheat sheet, not an error', async () => {
  const worker = await start({ readFile: async () => null, listDirs: async () => [] })
  assert.deepEqual(await worker.request('skills.load', {}), { kind: 'ok', skills: [], settingsFiles: [] })
  await worker.deactivate()
})

test('a failing file reader becomes an error result', async () => {
  const worker = await start({
    readFile: async () => {
      throw new Error('EACCES')
    },
    listDirs: async () => []
  })
  assert.deepEqual(await worker.request('skills.load', {}), { kind: 'error', message: 'EACCES' })
  await worker.deactivate()
})
