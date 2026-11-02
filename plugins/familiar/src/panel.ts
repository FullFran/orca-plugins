// The panel frame: one card per agent, its pet playing that agent's clip. Logic lives in
// src/controller.ts (tested); this file only touches the DOM and window.orca.
import { parseAnsi, type Segment } from './ansi'
import { createController, type Card, type PanelHost, type ViewState } from './controller'
import type { PetFrames, PetSummary } from './protocol'
import type { ListedAgent } from './roster'
import type { Clip } from './status'

interface FrameOrca {
  host: { call(method: string, params?: unknown): Promise<any> }
  on(event: string, handler: (payload: any) => void): { dispose(): void }
}

const orca = (window as unknown as { orca: FrameOrca }).orca

async function request<T>(name: string, input?: unknown): Promise<T> {
  const params = input === undefined ? { name, timeoutMs: 20_000 } : { name, input, timeoutMs: 20_000 }
  return (await orca.host.call('plugin.request', params)).output as T
}

const host: PanelHost = {
  now: () => Date.now(),
  pets: async () => (await request<{ pets: PetSummary[] }>('familiar.pets')).pets,
  frames: (id) => request<PetFrames>('familiar.frames', { id }),
  workspaces: async () => (await request<{ workspaces: Record<string, string> }>('familiar.workspaces')).workspaces,
  listAgents: async () => (await orca.host.call('agents.list', {})).agents as ListedAgent[],
  focusedWorkspace: async () => ((await orca.host.call('workspace.readContext', {})) ?? null)?.displayName ?? null,
  storageGet: async (key) => (await orca.host.call('storage.get', { key })).value,
  storageSet: async (key, value) => {
    await orca.host.call('storage.set', { key, value })
  }
}

const LABELS: Record<Clip, string> = { idle: 'Idle', working: 'Working', waiting: 'Needs you', done: 'Done' }

const classroom = document.getElementById('class') as HTMLElement
const emptyLine = document.getElementById('empty') as HTMLParagraphElement
const errorLine = document.getElementById('error') as HTMLParagraphElement

/** Parsed frames per pet and clip, built once. */
const parsed = new Map<string, Partial<Record<Clip, { fps: number; lines: Segment[][][] }>>>()

function clipsOf(frames: PetFrames) {
  let entry = parsed.get(frames.id)
  if (!entry) {
    entry = {}
    for (const [name, clip] of Object.entries(frames.clips)) {
      if (clip) entry[name as Clip] = { fps: clip.fps, lines: clip.frames.map(parseAnsi) }
    }
    parsed.set(frames.id, entry)
  }
  return entry
}

interface CardView {
  root: HTMLButtonElement
  sprite: HTMLPreElement
  name: HTMLElement
  meta: HTMLElement
  badge: HTMLElement
  time: HTMLElement
  card: Card
  drawn: string
}

const views = new Map<string, CardView>()

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) {
  const node = document.createElement(tag)
  node.className = className
  parent?.append(node)
  return node
}

function draw(sprite: HTMLPreElement, lines: Segment[][]): void {
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

function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function createView(card: Card): CardView {
  const root = el('button', 'card')
  root.type = 'button'
  const stage = el('div', 'stage', root)
  const sprite = el('pre', 'sprite', stage)
  sprite.setAttribute('aria-hidden', 'true')
  const name = el('div', 'name', root)
  const meta = el('div', 'meta', root)
  const state = el('div', 'state', root)
  const badge = el('span', 'badge', state)
  const time = el('span', 'time', state)
  const view: CardView = { root, sprite, name, meta, badge, time, card, drawn: '' }
  root.addEventListener('click', () => void controller.cyclePet(view.card.petKey))
  return view
}

function animate(now: number): void {
  for (const view of views.values()) {
    const { card } = view
    const clips = card.frames ? clipsOf(card.frames) : undefined
    const clip = clips?.[card.clip] ?? clips?.idle // a pet without this clip idles
    if (!clip) {
      if (view.drawn !== '') view.sprite.replaceChildren()
      view.drawn = ''
      continue
    }
    const index = Math.floor((now * clip.fps) / 1000) % clip.lines.length
    const stamp = `${card.pet}:${card.clip}:${index}`
    if (stamp !== view.drawn) {
      draw(view.sprite, clip.lines[index])
      view.drawn = stamp
    }
  }
}

function render(state: ViewState): void {
  const now = Date.now()
  const seen = new Set<string>()
  const order: HTMLElement[] = []
  for (const card of state.cards) {
    seen.add(card.key)
    const view = views.get(card.key) ?? createView(card)
    views.set(card.key, view)
    view.card = card
    view.root.dataset.clip = card.clip
    view.name.textContent = card.title
    view.meta.textContent = [card.kind && card.kind !== card.title ? card.kind : null, card.workspace]
      .filter(Boolean)
      .join(' · ')
    view.badge.textContent = LABELS[card.clip]
    view.time.textContent = elapsed(card.since, now)
    const petName = state.pets.find((pet) => pet.id === card.pet)?.name ?? card.pet ?? 'no pet'
    view.root.title = `${card.title}: ${LABELS[card.clip]}. Pet: ${petName}. Click for another pet.`
    view.root.setAttribute('aria-label', `${card.title}, ${card.workspace}, ${LABELS[card.clip]} for ${view.time.textContent}`)
    order.push(view.root)
  }
  for (const [key, view] of views) {
    if (!seen.has(key)) {
      view.root.remove()
      views.delete(key)
    }
  }
  // Re-append in order only when it changed, so focus and hover survive updates.
  const current = [...classroom.children]
  if (current.length !== order.length || order.some((node, i) => current[i] !== node)) classroom.replaceChildren(...order)
  emptyLine.hidden = state.cards.length > 0
  errorLine.hidden = state.error === null
  errorLine.textContent = state.error ?? ''
  animate(now)
}

const controller = createController(host, render)

setInterval(() => {
  if (!document.hidden) animate(Date.now())
}, 125)
setInterval(() => void controller.tick(), 30_000)

void controller.start().then(() => {
  orca.on('agent.status.changed', (payload) => void controller.onStatus(payload))
  orca.on('workspace.changed', (payload) => void controller.onWorkspace(payload?.context ?? null))
})
