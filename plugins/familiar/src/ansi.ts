// Turns familiard's ANSI frames (24-bit SGR colors) into plain colored segments the panel can draw.

export interface Segment {
  text: string
  fg?: string
  bg?: string
}

const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g

function channel(value: string | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(255, Math.max(0, Math.round(n)))
}

function rgb(r?: string, g?: string, b?: string): string {
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
}

interface Pen {
  fg?: string
  bg?: string
}

function applySgr(pen: Pen, params: string): Pen {
  const codes = params === '' ? ['0'] : params.split(';')
  const next: Pen = { ...pen }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] === '' ? 0 : Number(codes[i])
    if (code === 0) {
      delete next.fg
      delete next.bg
    } else if (code === 39) {
      delete next.fg
    } else if (code === 49) {
      delete next.bg
    } else if ((code === 38 || code === 48) && codes[i + 1] === '2') {
      const color = rgb(codes[i + 2], codes[i + 3], codes[i + 4])
      if (code === 38) next.fg = color
      else next.bg = color
      i += 4
    } else if ((code === 38 || code === 48) && codes[i + 1] === '5') {
      i += 2 // 256-color palette: familiard does not emit it; skip its argument.
    }
  }
  return next
}

function push(line: Segment[], text: string, pen: Pen): void {
  if (text === '') return
  const last = line[line.length - 1]
  if (last && last.fg === pen.fg && last.bg === pen.bg) {
    last.text += text
    return
  }
  const segment: Segment = { text }
  if (pen.fg) segment.fg = pen.fg
  if (pen.bg) segment.bg = pen.bg
  line.push(segment)
}

/** One array of segments per line; colors are CSS `rgb()` strings, escapes never reach the text. */
export function parseAnsi(frame: string): Segment[][] {
  const lines: Segment[][] = [[]]
  let pen: Pen = {}
  const emit = (text: string) => {
    const parts = text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      push(lines[lines.length - 1], part.replace(/\x1b/g, ''), pen)
    })
  }
  let cursor = 0
  for (const match of frame.matchAll(CSI)) {
    emit(frame.slice(cursor, match.index))
    if (match[2] === 'm') pen = applySgr(pen, match[1])
    cursor = (match.index ?? 0) + match[0].length
  }
  emit(frame.slice(cursor))
  return lines
}
