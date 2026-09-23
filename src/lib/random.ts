/**
 * Seeded randomness. Every draw is reproducible from its seed, which is what
 * makes a shared URL show the same batch — the "print run" number in the UI.
 */

/** mulberry32: small, fast, good enough distribution for picking repos. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a, so a hex seed string maps to a stable 32-bit number. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A fresh 6-hex-digit seed, the format shown as the print run number. */
export function newSeed(): string {
  const n = Math.floor(Math.random() * 0xffffff)
  return n.toString(16).padStart(6, '0')
}

export function randomInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  if (maxInclusive <= minInclusive) return minInclusive
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1))
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return out
}
