import { assert, test } from 'orca/testing'
import { assignPet, nextPet, stableHash } from './pets'

const GALLERY = ['ayaka', 'elaina', 'iria', 'neko']

test('the hash is stable and spreads keys', () => {
  assert.equal(stableHash('tab:1'), stableHash('tab:1'))
  assert.notEqual(stableHash('tab:1'), stableHash('tab:2'))
  assert.ok(stableHash('x') >= 0)
})

test('the same agent always gets the same pet from the gallery', () => {
  const first = assignPet('t1', GALLERY, {})
  assert.ok(first && GALLERY.includes(first))
  for (let i = 0; i < 5; i++) assert.equal(assignPet('t1', GALLERY, {}), first)
  assert.equal(assignPet('t1', [...GALLERY].reverse(), {}), first, 'gallery order does not matter')
})

test('different agents spread over the gallery', () => {
  const pets = new Set(Array.from({ length: 40 }, (_, i) => assignPet(`agent-${i}`, GALLERY, {})))
  assert.ok(pets.size >= 3)
})

test('a pin overrides the hash while the pinned pet exists', () => {
  const hashed = assignPet('t1', GALLERY, {})
  const other = GALLERY.find((p) => p !== hashed)!
  assert.equal(assignPet('t1', GALLERY, { t1: other }), other)
  assert.equal(assignPet('t1', GALLERY, { t1: 'gone' }), hashed)
})

test('an empty gallery assigns nothing', () => {
  assert.equal(assignPet('t1', [], {}), null)
})

test('nextPet cycles through the sorted gallery', () => {
  assert.equal(nextPet('ayaka', GALLERY), 'elaina')
  assert.equal(nextPet('neko', GALLERY), 'ayaka')
  assert.equal(nextPet(null, GALLERY), 'ayaka')
  assert.equal(nextPet('x', []), null)
})
