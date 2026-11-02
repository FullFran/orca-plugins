import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createActivate, type Runner } from './worker'

const PETS = JSON.stringify([
  { id: 'ayaka', name: 'Ayaka', default: false, open: false },
  { id: 'iria', name: 'Iria', default: true, open: true }
])

const FRAMES = JSON.stringify({
  id: 'iria',
  name: 'Iria',
  rows: 10,
  columns: 18,
  clips: {
    idle: { fps: 3, frames: ['a', 'b'] },
    working: { fps: 8, frames: ['c'] },
    waiting: { fps: 4, frames: ['d'] },
    done: { fps: 3, frames: ['e'] }
  }
})

const WORKTREES = JSON.stringify({
  ok: true,
  result: {
    worktrees: [
      {
        id: 'repo-1::/home/fran/code/orca-plugins',
        identity: { key: 'wt2:local:inst-1' },
        instanceId: 'inst-1',
        path: '/home/fran/code/orca-plugins',
        displayName: 'main'
      },
      { id: 'repo-2::/srv/blog', path: '/srv/blog', displayName: '' , branch: 'refs/heads/draft' },
      { displayName: 'no id' },
      7
    ]
  }
})

function fakeRunner(calls: string[][]): Runner {
  return async (args, program) => {
    calls.push(program === 'orca' ? ['orca', ...args] : args)
    if (program === 'orca' && args[0] === 'worktree') return WORKTREES
    if (args[0] === 'pets') return PETS
    if (args[0] === 'frames') return FRAMES
    throw new Error('unexpected command')
  }
}

test('lists pets from familiard pets --json', async () => {
  const calls: string[][] = []
  const worker = await mountWorker({ default: createActivate(fakeRunner(calls)) }, { host: mockHost() })
  const answer = await worker.request('familiar.pets')
  assert.deepEqual(answer, {
    pets: [
      { id: 'ayaka', name: 'Ayaka', default: false },
      { id: 'iria', name: 'Iria', default: true }
    ]
  })
  assert.deepEqual(calls, [['pets', '--json']])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('loads a pet frames with the panel row count', async () => {
  const calls: string[][] = []
  const worker = await mountWorker({ default: createActivate(fakeRunner(calls)) }, { host: mockHost() })
  const answer = await worker.request('familiar.frames', { id: 'iria' })
  assert.deepEqual(calls, [['frames', 'iria', '--rows', '8']])
  assert.equal(answer.id, 'iria')
  assert.equal(answer.rows, 10)
  assert.deepEqual(answer.clips.idle, { fps: 3, frames: ['a', 'b'] })
  assert.deepEqual(Object.keys(answer.clips).sort(), ['done', 'idle', 'waiting', 'working'])
  await worker.deactivate()
})

test('refuses pet ids that could be read as options', async () => {
  const calls: string[][] = []
  const worker = await mountWorker({ default: createActivate(fakeRunner(calls)) }, { host: mockHost() })
  await assert.rejects(worker.request('familiar.frames', { id: '--all' }), { code: 'invalid_params' })
  await assert.rejects(worker.request('familiar.frames', { id: 'a b' }), { code: 'invalid_params' })
  assert.deepEqual(calls, [])
  await worker.deactivate()
})

test('drops malformed pets and clips instead of failing', async () => {
  const runner: Runner = async (args) =>
    args[0] === 'pets'
      ? JSON.stringify([{ id: 'ok', name: 'Ok', default: false }, { name: 'no id' }, 7])
      : JSON.stringify({ id: 'ok', name: 'Ok', rows: 10, clips: { idle: { fps: 2, frames: ['x', 3] }, bogus: {} } })
  const worker = await mountWorker({ default: createActivate(runner) }, { host: mockHost() })
  assert.deepEqual(await worker.request('familiar.pets'), { pets: [{ id: 'ok', name: 'Ok', default: false }] })
  const frames = await worker.request('familiar.frames', { id: 'ok' })
  assert.deepEqual(frames.clips, { idle: { fps: 2, frames: ['x'] } })
  await worker.deactivate()
})

test('reports familiard failures as action_failed', async () => {
  const runner: Runner = async () => {
    throw new Error("familiard: no pet 'nope' in the gallery")
  }
  const worker = await mountWorker({ default: createActivate(runner) }, { host: mockHost() })
  await assert.rejects(worker.request('familiar.frames', { id: 'nope' }), { code: 'action_failed' })
  await assert.rejects(worker.request('familiar.pets'), { code: 'action_failed' })
  await worker.deactivate()
})

test('reports unparseable output as action_failed', async () => {
  const worker = await mountWorker({ default: createActivate(async () => 'not json') }, { host: mockHost() })
  await assert.rejects(worker.request('familiar.pets'), { code: 'action_failed' })
  await worker.deactivate()
})

test('caches frames per pet', async () => {
  const calls: string[][] = []
  const worker = await mountWorker({ default: createActivate(fakeRunner(calls)) }, { host: mockHost() })
  await worker.request('familiar.frames', { id: 'iria' })
  await worker.request('familiar.frames', { id: 'iria' })
  assert.deepEqual(calls, [['frames', 'iria', '--rows', '8']])
  await worker.deactivate()
})

test('resolves workspace ids to repo and name from orca worktree list', async () => {
  const calls: string[][] = []
  const worker = await mountWorker({ default: createActivate(fakeRunner(calls)) }, { host: mockHost() })
  const answer = await worker.request('familiar.workspaces')
  assert.deepEqual(calls, [['orca', 'worktree', 'list', '--json']])
  assert.deepEqual(answer, {
    workspaces: {
      'repo-1::/home/fran/code/orca-plugins': 'orca-plugins · main',
      'wt2:local:inst-1': 'orca-plugins · main',
      'inst-1': 'orca-plugins · main',
      'repo-2::/srv/blog': 'blog · draft'
    }
  })
  await worker.request('familiar.workspaces')
  assert.equal(calls.length, 1, 'answers from a short cache')
  await worker.deactivate()
})

test('an orca CLI failure gives an empty workspace map, not an error', async () => {
  const runner: Runner = async (_args, program) => {
    if (program === 'orca') throw new Error('orca not running')
    return PETS
  }
  const worker = await mountWorker({ default: createActivate(runner) }, { host: mockHost() })
  assert.deepEqual(await worker.request('familiar.workspaces'), { workspaces: {} })
  await worker.deactivate()
})
