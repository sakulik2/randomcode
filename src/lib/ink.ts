/**
 * Language to ink.
 *
 * A Riso press holds a handful of ink drums, so a language gets one of four —
 * not its official GitHub color. Sixty accurate hex values would read as a
 * legend, not a print run. Mapping is deterministic, so a language keeps the
 * same ink across draws and sessions.
 */

export type Ink = 'federal' | 'fluoro' | 'yellow' | 'black'

const INKS: readonly Ink[] = ['federal', 'fluoro', 'yellow', 'black']

/**
 * Hand-assigned inks for languages common enough that a viewer builds a memory
 * of them. Spread across drums so a typical batch shows all four.
 */
const PINNED: Readonly<Record<string, Ink>> = {
  typescript: 'federal',
  javascript: 'yellow',
  python: 'federal',
  rust: 'fluoro',
  go: 'federal',
  java: 'fluoro',
  'c++': 'black',
  c: 'black',
  'c#': 'fluoro',
  ruby: 'fluoro',
  php: 'federal',
  swift: 'fluoro',
  kotlin: 'fluoro',
  dart: 'federal',
  shell: 'black',
  html: 'yellow',
  css: 'federal',
  scss: 'federal',
  vue: 'yellow',
  svelte: 'fluoro',
  lua: 'federal',
  zig: 'yellow',
  elixir: 'fluoro',
  haskell: 'federal',
  ocaml: 'yellow',
  clojure: 'federal',
  scala: 'fluoro',
  perl: 'federal',
  r: 'federal',
  julia: 'fluoro',
  solidity: 'black',
  'jupyter notebook': 'yellow',
  'objective-c': 'federal',
  assembly: 'black',
  nix: 'federal',
  dockerfile: 'federal',
  makefile: 'black',
  tex: 'black',
  'vim script': 'black',
  'emacs lisp': 'fluoro',
  powershell: 'federal',
  batchfile: 'black',
}

/** FNV-1a so unpinned languages still land on a stable drum. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function inkFor(language: string | null): Ink {
  if (!language) return 'black'
  const key = language.toLowerCase()
  const pinned = PINNED[key]
  if (pinned) return pinned
  return INKS[hash(key) % INKS.length] as Ink
}

/**
 * Card weight from star count. Bigger repos print heavier and wider, so the grid
 * reads as a press sheet rather than a row of equal tiles.
 *
 * Raw mode returns almost entirely zero-star repos — measured 0 of 100 with any
 * stars — so the scale has to stay legible when everything sits at weight 1.
 */
export type CardWeight = 1 | 2 | 3 | 4

export function weightFor(stars: number): CardWeight {
  if (stars >= 2000) return 4
  if (stars >= 200) return 3
  if (stars >= 20) return 2
  return 1
}
