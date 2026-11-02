// The panel frame: draws the pet and wires the controller to window.orca. Logic lives in
// src/controller.ts (tested); this file only touches the DOM.
import { parseAnsi, type Segment } from './ansi'
import { createController, type PanelHost, type ViewState } from './controller'
import type { PetFrames, PetSummary } from './protocol'
import type { AgentState, Clip } from './status'

interface FrameOrca {
  host: { call(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<any> }
  on(event: string, handler: (payload: any) => void): { dispose(): void }
}

const orca = (window as unknown as { orca: FrameOrca }).orca

async function request<T>(name: string, input?: unknown): Promise<T> {
  const params = input === undefined ? { name, timeoutMs: 20_000 } : { name, input, timeoutMs: 20_000 }
  return (await orca.host.call('plugin.request', params)).output as T
}

const host: PanelHost = {
  pets: async () => (await request<{ pets: PetSummary[] }>('familiar.pets')).pets,
  frames: (id) => request<PetFrames>('familiar.frames', { id }),
  agentStates: async () =>
    ((await orca.host.call('agents.list', {})).agents as { state: AgentState }[]).map((a) => a.state),
  storageGet: async (key) => (await orca.host.call('storage.get', { key })).value,
  storageSet: async (key, value) => {
    await orca.host.call('storage.set', { key, value })
  }
}

const picker = document.getElementById('pet') as HTMLSelectElement
const sprite = document.getElementById('sprite') as HTMLPreElement
const statusLine = document.getElementById('status') as HTMLParagraphElement
const errorLine = document.getElementById('error') as HTMLParagraphElement

const LABELS: Record<Clip, string> = {
  idle: 'Idle',
  working: 'An agent is working',
  waiting: 'An agent needs you',
  done: 'Agents are done'
}

let parsed: Partial<Record<Clip, { fps: number; lines: Segment[][][] }>> = {}
let parsedFor: PetFrames | null = null
let playing: Clip | null = null
let timer: ReturnType<typeof setInterval> | undefined
let frameIndex = 0
let petListKey = ''

function draw(lines: Segment[][]): void {
  const fragment = document.createDocumentFragment()
  lines.forEach((line, index) => {
    if (index > 0) fragment.append('\n')
    for (const segment of line) {
      if (!segment.fg && !segment.bg) {
        fragment.append(segment.text)
        continue
      }
      const span = document.createElement('span')
      span.textContent = segment.text
      if (segment.fg) span.style.color = segment.fg
      if (segment.bg) span.style.backgroundColor = segment.bg
      fragment.append(span)
    }
  })
  sprite.replaceChildren(fragment)
}

function play(clip: Clip | null): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  playing = clip
  frameIndex = 0
  const entry = clip ? parsed[clip] : undefined
  if (!entry) {
    sprite.replaceChildren()
    return
  }
  draw(entry.lines[0])
  if (entry.lines.length > 1) {
    timer = setInterval(() => {
      if (document.hidden) return
      frameIndex = (frameIndex + 1) % entry.lines.length
      draw(entry.lines[frameIndex])
    }, 1000 / entry.fps)
  }
}

function renderPicker(state: ViewState): void {
  const key = state.pets.map((pet) => pet.id).join('\n')
  if (key !== petListKey) {
    petListKey = key
    const counts = new Map<string, number>()
    for (const pet of state.pets) counts.set(pet.name, (counts.get(pet.name) ?? 0) + 1)
    picker.replaceChildren(
      ...state.pets.map((pet) => {
        const option = document.createElement('option')
        option.value = pet.id
        option.textContent = (counts.get(pet.name) ?? 0) > 1 ? `${pet.name} (${pet.id})` : pet.name
        return option
      })
    )
  }
  if (state.selected) picker.value = state.selected
  picker.disabled = state.pets.length === 0
}

function render(state: ViewState): void {
  renderPicker(state)
  if (state.frames !== parsedFor) {
    parsedFor = state.frames
    parsed = {}
    for (const [name, clip] of Object.entries(state.frames?.clips ?? {})) {
      if (clip) parsed[name as Clip] = { fps: clip.fps, lines: clip.frames.map(parseAnsi) }
    }
    playing = null
  }
  // A pet without this clip falls back to idle.
  const wanted: Clip | null = parsed[state.clip] ? state.clip : parsed.idle ? 'idle' : null
  if (wanted !== playing) play(wanted)
  sprite.setAttribute('aria-label', `${state.frames?.name || 'familiard pet'}: ${LABELS[state.clip]}`)
  statusLine.textContent = state.loading && !state.frames ? 'Loading…' : LABELS[state.clip]
  errorLine.hidden = state.error === null
  errorLine.textContent = state.error ?? ''
}

const controller = createController(host, render)

let refreshTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRefresh(): void {
  // Events arrive in bursts; agents.list always answers for the focused workspace.
  if (refreshTimer !== undefined) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    void controller.refreshAgents()
  }, 150)
}

picker.addEventListener('change', () => void controller.selectPet(picker.value))
orca.on('agent.status.changed', scheduleRefresh)
orca.on('workspace.changed', scheduleRefresh)
void controller.start()
