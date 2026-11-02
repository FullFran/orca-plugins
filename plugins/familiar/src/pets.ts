// Which gallery pet sits in for which agent: a pin if the person chose one, else a stable hash.

/** FNV-1a, 32-bit: the same key gives the same number on every run. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const sorted = (gallery: readonly string[]) => [...gallery].sort()

export function assignPet(agentKey: string, gallery: readonly string[], pins: Record<string, string>): string | null {
  if (gallery.length === 0) return null
  const pinned = Object.prototype.hasOwnProperty.call(pins, agentKey) ? pins[agentKey] : undefined
  if (pinned !== undefined && gallery.includes(pinned)) return pinned
  const pets = sorted(gallery)
  return pets[stableHash(agentKey) % pets.length]
}

/** The pet after `current` in the sorted gallery, wrapping around. */
export function nextPet(current: string | null, gallery: readonly string[]): string | null {
  const pets = sorted(gallery)
  if (pets.length === 0) return null
  const index = current === null ? -1 : pets.indexOf(current)
  return pets[(index + 1) % pets.length]
}
