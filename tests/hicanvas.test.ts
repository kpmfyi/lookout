import { expect, test } from 'claude-code/testing'

import { luminance } from '../hooks/canvas.ts'
import { HiCanvas, MASK_TO_GLYPH, NONE, glyphToMask } from '../hooks/hicanvas.ts'

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

function printableBmp(cp: number): boolean {
  return cp >= 0x20 && cp <= 0xffff && !(cp >= 0x7f && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff)
}

/** Paint the sub-pixels of a one-cell canvas whose mask bit (row * 2 + col) is set; the rest stay `off`. */
function cell(mask: number, on: number, off: number = NONE): [number, number, number] {
  const c = new HiCanvas(1, 1)
  for (let i = 0; i < 8; i++) c.set(i % 2, Math.floor(i / 2), mask & (1 << i) ? on : off)
  const w = decode(c.encode())
  return [w[0]!, w[1]!, w[2]!]
}

// Masks written out from the glyph shapes: rows of the 2 × 4 grid, '#' lit.
const BLOCKS: [string, string[]][] = [
  ['█', ['##', '##', '##', '##']],
  ['▀', ['##', '##', '..', '..']],
  ['▄', ['..', '..', '##', '##']],
  ['▌', ['#.', '#.', '#.', '#.']],
  ['▐', ['.#', '.#', '.#', '.#']],
  ['▂', ['..', '..', '..', '##']],
  ['▆', ['..', '##', '##', '##']],
  ['▘', ['#.', '#.', '..', '..']],
  ['▝', ['.#', '.#', '..', '..']],
  ['▖', ['..', '..', '#.', '#.']],
  ['▗', ['..', '..', '.#', '.#']],
  ['▚', ['#.', '#.', '.#', '.#']],
  ['▞', ['.#', '.#', '#.', '#.']],
  ['▛', ['##', '##', '#.', '#.']],
  ['▜', ['##', '##', '.#', '.#']],
  ['▙', ['#.', '#.', '##', '##']],
  ['▟', ['.#', '.#', '##', '##']],
]

function maskOf(rows: string[]): number {
  let m = 0
  rows.forEach((r, row) => [...r].forEach((ch, col) => ch === '#' && (m |= 1 << (row * 2 + col))))
  return m
}

/** Braille dots for a mask, from the Unicode dot layout: dot n at (col, row). */
function brailleOf(mask: number): number {
  const DOTS: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]] // dots 1..8
  let bits = 0
  DOTS.forEach(([col, row], n) => mask & (1 << (row * 2 + col)) && (bits |= 1 << n))
  return 0x2800 | bits
}

test('every block glyph mask encodes as that glyph, over NONE and over a darker colour', () => {
  for (const [glyph, rows] of BLOCKS) {
    const m = maskOf(rows)
    const want = glyph.codePointAt(0)!
    expect(cell(m, 0xf0c060)[0]).toBe(want)
    if (m !== 0xff) {
      const [cp, fg, bg] = cell(m, 0xf0c060, 0x202040)
      expect(cp).toBe(want)
      expect(fg).toBe(0xf0c060)
      expect(bg).toBe(0x202040)
    }
    expect(glyphToMask(want)).toBe(m)
  }
})

test('a mixed mask encodes as the matching braille character', () => {
  const m = 0b01001001 // bits 0, 3, 6: (c0,r0), (c1,r1), (c0,r3)
  expect(brailleOf(m)).toBe(0x2800 | 0b01010001) // dots 1, 5, 7
  expect(cell(m, 0xffffff)[0]).toBe(brailleOf(m))
  for (let mask = 1; mask < 256; mask++) {
    const block = BLOCKS.find(([, r]) => maskOf(r) === mask)
    const want = block ? block[0].codePointAt(0)! : brailleOf(mask)
    expect(MASK_TO_GLYPH[mask]).toBe(want)
    expect(cell(mask, 0x80c0ff)[0]).toBe(want)
    expect(glyphToMask(brailleOf(mask))).toBe(mask)
  }
  expect(glyphToMask(0x41)).toBe(null)
  expect(glyphToMask(0x20)).toBe(0)
})

test('a cell entirely NONE is a space on NONE', () => {
  expect(cell(0, 0x123456)).toEqual([0x20, NONE, NONE])
})

test('a cell of one colour is a full block with that fg and bg NONE', () => {
  expect(cell(0xff, 0x3ec9c0)).toEqual([0x2588, 0x3ec9c0, NONE])
})

test('NONE plus one colour: the mask is the coloured sub-pixels, bg NONE', () => {
  const m = 0b10010110
  expect(cell(m, 0x8f6fe8)).toEqual([brailleOf(m), 0x8f6fe8, NONE])
})

test('a two-colour gradient cell: fg is the lighter mean, both within the inputs', () => {
  const lo = 0x102030
  const hi = 0x80c0f0
  const c = new HiCanvas(1, 1)
  const ch = (v: number, k: number) => Math.round(((lo >> k) & 255) + (((hi >> k) & 255) - ((lo >> k) & 255)) * v)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 2; x++) {
      const v = (y * 2 + x) / 7
      c.set(x, y, (ch(v, 16) << 16) | (ch(v, 8) << 8) | ch(v, 0))
    }
  }
  const [cp, fg, bg] = decode(c.encode())
  expect(fg !== bg).toBe(true)
  expect(luminance(fg!)).toBeGreaterThan(luminance(bg!))
  for (const col of [fg!, bg!]) {
    for (const k of [16, 8, 0]) {
      const v = (col >> k) & 255
      expect(v >= ((lo >> k) & 255) && v <= ((hi >> k) & 255)).toBe(true)
    }
  }
  expect(cp).toBe(0x2584) // the lighter bottom half
})

test('label picks light ink over dark and dark ink over light', () => {
  const c = new HiCanvas(4, 2)
  c.rect(0, 0, 8, 4, 0x101018)
  c.rect(0, 4, 8, 4, 0xf0f0e0)
  c.label(0, 0, 'ab', 0xffffff, 0x000000)
  c.label(0, 1, 'cd', 0xffffff, 0x000000)
  c.label(2, 0, 'z', 0xffffff, 0x000000) // over a cell still mostly dark
  const w = decode(c.encode())
  expect([w[0], w[1], w[2]]).toEqual([0x61, 0xffffff, 0x101018])
  expect([w[12], w[13], w[14]]).toEqual([0x63, 0x000000, 0xf0f0e0])
  expect(w[7]).toBe(0xffffff)
  const empty = new HiCanvas(2, 1)
  empty.label(0, 0, 'x')
  expect(decode(empty.encode())[2]).toBe(NONE)
})

test('the encoding is columns × rows cells of printable BMP code points', () => {
  for (const [columns, rows] of [[1, 1], [40, 5], [144, 15]] as const) {
    const c = new HiCanvas(columns, rows)
    c.fill((x, y) => ((x * 7 + y * 13) % 11 === 0 ? NONE : ((x * 37) << 16) ^ (y * 5011) ^ (x * y)) & 0xffffff)
    c.label(1, 0, 'hello ✓ 世界')
    const cells = c.encode()
    expect(atob(cells).length).toBe(columns * rows * 12)
    const w = decode(cells)
    for (let i = 0; i < w.length; i += 3) {
      if (!printableBmp(w[i]!)) throw new Error(`cell ${i / 3}: 0x${w[i]!.toString(16)} is not printable`)
    }
  }
})

test('line draws both endpoints; rect and frame stay in bounds', () => {
  const c = new HiCanvas(10, 3)
  c.line(1, 2, 17, 9, 0xff0000)
  expect(c.get(1, 2)).toBe(0xff0000)
  expect(c.get(17, 9)).toBe(0xff0000)
  c.line(5, 0, 5, 0, 0x00ff00)
  expect(c.get(5, 0)).toBe(0x00ff00)
  let lit = 0
  for (const v of c.px) if (v === 0xff0000) lit++
  expect(lit).toBe(17) // one sub-pixel per step along the longer axis
  c.rect(-3, -3, 50, 50, 0x0000ff)
  c.frame(0, 0, 20, 12, 0xffffff)
  expect(c.get(19, 11)).toBe(0xffffff)
  expect(c.get(1, 1)).toBe(0x0000ff)
})

test('a 144 × 15 canvas encodes quickly', () => {
  const c = new HiCanvas(144, 15)
  c.fill((x, y) => (((x * 2654435761) ^ (y * 40503)) >>> 0) & 0xffffff)
  c.encode() // warm up
  const t0 = performance.now()
  const runs = 10
  for (let i = 0; i < runs; i++) c.encode()
  const ms = (performance.now() - t0) / runs
  expect(ms).toBeLessThan(50)
})
