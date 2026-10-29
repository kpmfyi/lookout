import { expect, test } from 'claude-code/testing'

import { Canvas, NONE, mix, scale } from '../hooks/canvas.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { blit, blitHi, frameOf, sprite } from '../hooks/sprite.ts'

const R = 0xf0605d
const G = 0x7ed492
const B = 0x5a5fc4
const PAL = { r: R, g: G, b: B }

// An L of red with a green heel and a blue dot, transparent elsewhere; indented like scene code.
const L = sprite(
  `
    r..
    r.b
    rgg
  `,
  PAL,
)

test('a picture parses to its size, colours and transparent pixels', () => {
  expect(L.w).toBe(3)
  expect(L.h).toBe(3)
  expect(L.at(0, 0)).toBe(R)
  expect(L.at(1, 0)).toBe(null)
  expect(L.at(2, 1)).toBe(B)
  expect(L.at(1, 2)).toBe(G)
  // Outside the sprite reads as transparent.
  expect(L.at(-1, 0)).toBe(null)
  expect(L.at(3, 0)).toBe(null)
  expect(L.at(0, 3)).toBe(null)
})

test('short rows are padded transparent; spaces are transparent', () => {
  const sp = sprite('rrr\nr\n r', PAL)
  expect(sp.w).toBe(3)
  expect(sp.at(2, 1)).toBe(null)
  expect(sp.at(0, 2)).toBe(null)
  expect(sp.at(1, 2)).toBe(R)
})

test('an unknown character throws, naming it', () => {
  expect(() => sprite('rx', PAL)).toThrow("no colour for 'x'")
})

test('blit draws the opaque pixels and leaves the transparent ones alone', () => {
  const c = new Canvas(6, 3) // 6 × 6 pixels
  c.fill(() => 0x111111)
  blit(c, L, 1, 2)
  expect(c.get(1, 2)).toBe(R)
  expect(c.get(2, 2)).toBe(0x111111)
  expect(c.get(3, 3)).toBe(B)
  expect(c.get(2, 4)).toBe(G)
  expect(c.get(0, 0)).toBe(0x111111)
})

test('flipX mirrors the sprite', () => {
  const c = new Canvas(3, 2)
  blit(c, L, 0, 0, { flipX: true })
  expect(c.get(2, 0)).toBe(R)
  expect(c.get(0, 0)).toBe(NONE)
  expect(c.get(0, 1)).toBe(B)
  expect(c.get(0, 2)).toBe(G)
  expect(c.get(1, 2)).toBe(G)
})

test('tint and scale recolour every pixel', () => {
  const c = new Canvas(3, 2)
  blit(c, L, 0, 0, { tint: 0xffffff, tintBy: 0.25, scale: 0.5 })
  expect(c.get(0, 0)).toBe(scale(mix(R, 0xffffff, 0.25), 0.5))
  const d = new Canvas(3, 2)
  blit(d, L, 0, 0, { scale: 0.5 })
  expect(d.get(2, 1)).toBe(scale(B, 0.5))
})

test('blit clips at every canvas edge without throwing', () => {
  const c = new Canvas(4, 2) // 4 × 4 pixels
  blit(c, L, -2, -1) // only the sprite's right column, from its second row
  expect(c.get(0, 0)).toBe(B)
  expect(c.get(0, 1)).toBe(G)
  expect(c.get(1, 0)).toBe(NONE)
  const d = new Canvas(4, 2)
  blit(d, L, 3, 3) // only the top-left pixel lands
  expect(d.get(3, 3)).toBe(R)
  let painted = 0
  for (const p of d.px) if (p !== NONE) painted++
  expect(painted).toBe(1)
  // Entirely off the canvas: nothing drawn.
  const e = new Canvas(4, 2)
  for (const [x, y] of [[-3, 0], [4, 0], [0, -3], [0, 4], [1e6, 1e6]] as const) blit(e, L, x, y)
  expect([...e.px].every(p => p === NONE)).toBe(true)
  // It still encodes to columns × rows cells.
  expect(atob(c.encode()).length).toBe(4 * 2 * 3 * 4)
})

test('blitHi draws on the 2 × 4 sub-pixel grid', () => {
  const c = new HiCanvas(2, 1) // 4 × 4 sub-pixels
  blitHi(c, L, 1, 1)
  expect(c.get(1, 1)).toBe(R)
  expect(c.get(3, 2)).toBe(B)
  expect(c.get(2, 3)).toBe(G)
  expect(c.get(2, 1)).toBe(NONE)
  blitHi(c, L, 2, 2, { flipX: true }) // clipped at the right and bottom: only the blue dot lands
  expect(c.get(2, 3)).toBe(B)
  expect(c.get(3, 2)).toBe(B)
  expect(atob(c.encode()).length).toBe(2 * 1 * 3 * 4)
})

test('frameOf steps through a frame list', () => {
  const frames = ['a', 'b', 'c']
  expect([0, 1, 2, 3, 4, 5, 6].map(f => frameOf(frames, f, 2)).join('')).toBe('aabbcca')
  expect(frameOf(frames, -5)).toBe('a')
})
