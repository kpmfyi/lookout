// The glyph vocabulary (docs/DESIGN.md 41, hooks/glyphs.ts): every glyph is one code point, one cell
// wide in a monospace font (East Asian Width N, Na or A, never W or F), and has no emoji
// presentation. The width and presentation lists are written out here, no dependency: the Unicode
// ranges of wide and fullwidth characters, and the characters whose default presentation is emoji.
import { expect, test } from 'claude-code/testing'

import { CLASS_GLYPH, G, shareGlyph, titled } from '../hooks/glyphs.ts'

/** East Asian Width W and F (Unicode 15), as code point ranges, the emoji blocks among them. */
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x18aff],
  [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff],
  [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]
/**
 * Characters that are text by default but that terminals and fonts often draw as a colour emoji, two
 * cells wide (the design's examples among them): kept out of the vocabulary too.
 */
const EMOJI_PRONE = new Set([...'⚠⏱⏸⏯⏭⏮⏲⏹⏺⌨⏏☀☁☂☃☄☎☑☘☝☠☢☣☦☪☮☯☸☹☺♀♂♟♠♣♥♦♨♻♾⚒⚔⚕⚖⚗⚙⚛⚜⚧⚰⚱⛈⛏⛑⛓⛩⛰⛱⛴⛷⛸⛹✂✈✉✌✍✏✒✔✝✡✳✴❄❇❣❤➡⤴⤵⬅⬆⬇〰〽㊗㊙ℹ™©®‼⁉▪▫▶◀◻◼↔↕↖↗↘↙↩↪'])

const wide = (cp: number) => WIDE.some(([a, b]) => cp >= a && cp <= b)

function check(name: string, glyph: string): void {
  const cps = [...glyph]
  if (cps.length !== 1) throw new Error(`${name}: ${JSON.stringify(glyph)} is ${cps.length} code points`)
  const cp = glyph.codePointAt(0)!
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) throw new Error(`${name}: a control character`)
  if (wide(cp)) throw new Error(`${name}: ${glyph} (U+${cp.toString(16)}) is wide`)
  if (EMOJI_PRONE.has(glyph)) throw new Error(`${name}: ${glyph} (U+${cp.toString(16)}) draws as an emoji`)
  if (cp >= 0xfe00 && cp <= 0xfe0f) throw new Error(`${name}: a variation selector`)
}

test('glyphs: every glyph is one code point, one cell wide, with no emoji presentation', () => {
  for (const [cls, g] of Object.entries(CLASS_GLYPH)) check(`class ${cls}`, g)
  for (const [name, g] of Object.entries(G)) check(name, g)
  for (const f of [0, 0.2, 0.5, 0.7, 1]) check(`share ${f}`, shareGlyph(f))
  // The lists catch what they should.
  expect(wide('⚡'.codePointAt(0)!)).toBe(true)
  expect(wide('日'.codePointAt(0)!)).toBe(true)
  expect(EMOJI_PRONE.has('⚠')).toBe(true)
  expect(() => check('x', '⏱')).toThrow()
  expect(() => check('x', '✓✓')).toThrow()
})

test('glyphs: each class has its own glyph, and a share fills its circle in steps', () => {
  expect(new Set(Object.values(CLASS_GLYPH)).size).toBe(Object.keys(CLASS_GLYPH).length)
  expect([0, 0.2, 0.5, 0.7, 1].map(shareGlyph)).toEqual(['○', '◔', '◑', '◕', '●'])
  expect(shareGlyph(-1)).toBe('○')
  expect(shareGlyph(9)).toBe('●')
})

test('glyphs: a title keeps the word beside its glyph where both fit, the word alone, then the glyph', () => {
  expect(titled('↻', 'turns', 10)).toBe('↻ turns')
  expect(titled('↻', 'turns', 6)).toBe('turns')
  expect(titled('↻', 'turns', 4)).toBe('↻')
  expect(titled('$', '$', 1)).toBe('$')
  expect(titled('', 'files', 2)).toBe('files')
})
