import { assert, test } from 'orca/testing'
import { parseAnsi } from './ansi'

const ESC = '\x1b'

test('splits a frame into lines of colored segments', () => {
  const frame = `  ${ESC}[38;2;10;20;30m▄${ESC}[0m \n${ESC}[38;2;1;2;3;48;2;4;5;6m▀${ESC}[0m`
  assert.deepEqual(parseAnsi(frame), [
    [
      { text: '  ' },
      { text: '▄', fg: 'rgb(10, 20, 30)' },
      { text: ' ' }
    ],
    [{ text: '▀', fg: 'rgb(1, 2, 3)', bg: 'rgb(4, 5, 6)' }]
  ])
})

test('merges neighbours that share colors and never leaks escapes', () => {
  const frame = `${ESC}[38;2;9;9;9mab${ESC}[0m${ESC}[38;2;9;9;9mc${ESC}[0m`
  const lines = parseAnsi(frame)
  assert.deepEqual(lines, [[{ text: 'abc', fg: 'rgb(9, 9, 9)' }]])
  for (const line of lines) for (const seg of line) assert.ok(!seg.text.includes(ESC))
})

test('handles separate fg and bg codes, 39/49 resets and bare reset', () => {
  const frame = `${ESC}[48;2;1;1;1m${ESC}[38;2;2;2;2mx${ESC}[39my${ESC}[49mz${ESC}[mw`
  assert.deepEqual(parseAnsi(frame), [
    [
      { text: 'x', fg: 'rgb(2, 2, 2)', bg: 'rgb(1, 1, 1)' },
      { text: 'y', bg: 'rgb(1, 1, 1)' },
      { text: 'zw' }
    ]
  ])
})

test('drops unknown escape sequences and clamps out-of-range channels', () => {
  const frame = `${ESC}[1m${ESC}[2Ka${ESC}[38;2;300;0;0mb`
  assert.deepEqual(parseAnsi(frame), [[{ text: 'a' }, { text: 'b', fg: 'rgb(255, 0, 0)' }]])
})

test('keeps empty lines so the sprite keeps its height', () => {
  assert.deepEqual(parseAnsi('a\n\nb'), [[{ text: 'a' }], [], [{ text: 'b' }]])
})
