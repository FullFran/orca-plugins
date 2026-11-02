import { assert, test } from 'orca/testing'
import { clipFor } from './status'

test('no agents is idle', () => {
  assert.equal(clipFor([]), 'idle')
})

test('each agent state maps to its clip', () => {
  assert.equal(clipFor(['working']), 'working')
  assert.equal(clipFor(['waiting']), 'waiting')
  assert.equal(clipFor(['blocked']), 'waiting')
  assert.equal(clipFor(['done']), 'done')
})

test('waiting beats working beats done', () => {
  assert.equal(clipFor(['done', 'working', 'blocked']), 'waiting')
  assert.equal(clipFor(['done', 'waiting']), 'waiting')
  assert.equal(clipFor(['done', 'working', 'done']), 'working')
  assert.equal(clipFor(['done', 'done']), 'done')
})

test('unknown states are ignored', () => {
  assert.equal(clipFor(['something-new' as never]), 'idle')
  assert.equal(clipFor(['something-new' as never, 'done']), 'done')
})
