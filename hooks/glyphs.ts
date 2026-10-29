// Glyphs for words (docs/DESIGN.md 41): the one place a glyph is chosen. Every glyph here is one
// cell wide in the common monospace fonts and has no emoji presentation; tests/glyphs.test.ts holds
// the list to that. A glyph stands in for a word only where it is universal or where the same glyph
// stands beside its word somewhere on screen.
import type { ToolClass } from '../types'

export const CLASS_GLYPH: Record<ToolClass, string> = { shell: '$', read: '◇', edit: '✎', search: '⌕', web: '◎', agent: '◈', other: '·' }

export const G = {
  ok: '✓',
  failed: '✖',
  denied: '⊘',
  turns: '↻',
  time: '◷',
  commit: '◆',
  branch: '⎇',
  files: '✎',
  thinking: '…',
  reply: '»',
  earlier: '·',
  stalled: '‖',
  waiting: '○',
  approx: '≈',
} as const

/** A share 0..1 as a filling circle: ○ ◔ ◑ ◕ ●. */
export function shareGlyph(frac: number): string {
  const f = Math.max(0, Math.min(1, frac))
  return ['○', '◔', '◑', '◕', '●'][Math.round(f * 4)]!
}

/**
 * A title for `room` cells: the glyph beside its word where both fit (the glyph's legend), the word
 * alone where only it fits, else the glyph alone before the word would be cut (docs/DESIGN.md 41,
 * rule 4). An empty glyph (or one that is the word) leaves the word.
 */
export function titled(glyph: string, word: string, room: number): string {
  if (!glyph || glyph === word) return word
  if ([...glyph].length + 1 + [...word].length <= room) return `${glyph} ${word}`
  if ([...word].length <= room) return word
  return glyph
}
