// HiCanvas: a 2 × 4 sub-pixel grid per terminal cell (docs/DESIGN.md §13). Authoring notes:
// - A sub-pixel is 1/2 cell wide and 1/4 cell tall; with cells near 1:2 they are about square.
// - Each cell shows only two colours (fg and bg), fitted from its 8 sub-pixels; NONE is always bg.
// - Masks that match a block glyph (█ ▀ ▄ ▌ ▐ ▘ ▝ ▖ ▗ ▚ ▞ ▛ ▜ ▙ ▟ ▂ ▆) draw solid; any other mask
//   becomes braille, which reads lighter, as texture or dots (stars, dithered soft edges).
// - Avoid colour clash: keep gradients smooth (neighbouring sub-pixels close in colour), outline
//   an object in one colour, and do not put three distinct colours in the same cell.
// - Align solid shapes to cell edges (even x, multiples of 4 in y) where they should look solid.
// - Text replaces a whole cell (glyph on the mean of its sub-pixels): keep text on its own row,
//   under objects rather than over them, and clamp it with `cut`.
// Import everything a hi-res scene needs from this one module.

import { cut, hash, layout, luminance, mix, NONE, printable, ramp, rgb, scale } from './canvas.ts'
import type { Glyph, Layout, RGB } from './canvas.ts'
import { INK, PAPER } from './canvas.ts'

export { cut, hash, luminance, mix, NONE, ramp, rgb, scale }
export type { Layout, RGB }

/** The scene breakpoints, as for the half-block canvas. */
export function hiLayout(columns: number): Layout {
  return layout(columns)
}

// ── Mask ↔ glyph. Mask bit i = row * 2 + col over the cell's 2 × 4 sub-pixels (bit 0 top-left).

/** Block glyphs whose shape is exactly a 2 × 4 mask. */
const BLOCKS: [number, number][] = [
  [0xff, 0x2588], // █
  [0x0f, 0x2580], // ▀ rows 0–1
  [0xf0, 0x2584], // ▄ rows 2–3
  [0x55, 0x258c], // ▌ column 0
  [0xaa, 0x2590], // ▐ column 1
  [0xc0, 0x2582], // ▂ row 3
  [0xfc, 0x2586], // ▆ rows 1–3
  [0x05, 0x2598], // ▘ upper left
  [0x0a, 0x259d], // ▝ upper right
  [0x50, 0x2596], // ▖ lower left
  [0xa0, 0x2597], // ▗ lower right
  [0xa5, 0x259a], // ▚
  [0x5a, 0x259e], // ▞
  [0x5f, 0x259b], // ▛
  [0xaf, 0x259c], // ▜
  [0xf5, 0x2599], // ▙
  [0xfa, 0x259f], // ▟
]

/** Braille dot bit for each mask bit: dots 1–3 = col 0 rows 0–2, 4–6 = col 1 rows 0–2, 7/8 = row 3. */
const DOT = [0, 3, 1, 4, 2, 5, 6, 7]

function braille(mask: number): number {
  let dots = 0
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) dots |= 1 << DOT[i]!
  return 0x2800 + dots
}

/** The code point for each foreground mask, 256 entries, built once. */
export const MASK_TO_GLYPH: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let m = 0; m < 256; m++) t[m] = braille(m)
  t[0] = 0x20
  for (const [m, cp] of BLOCKS) t[m] = cp
  return t
})()

const GLYPH_TO_MASK = new Map<number, number>()
for (let m = 0; m < 256; m++) GLYPH_TO_MASK.set(MASK_TO_GLYPH[m]!, m)
for (let m = 0; m < 256; m++) GLYPH_TO_MASK.set(braille(m), m) // braille too, even where a block wins

/** The sub-pixel mask a block, braille or space code point lights, or null for any other glyph. */
export function glyphToMask(cp: number): number | null {
  return GLYPH_TO_MASK.get(cp) ?? null
}

// The encoder's scratch, shared by every canvas (encode never re-enters): one cell's sub-pixels.
const SUB = new Int32Array(8)

// Allocation-free colour helpers for the encoder.
// Math.round for the non-negative means of at most 8 channel values (x + 0.5 never lands on an
// integer by rounding: no mean is that close to a half), without the call.
const pack = (r: number, g: number, b: number): number => (((r + 0.5) | 0) << 16) | (((g + 0.5) | 0) << 8) | ((b + 0.5) | 0)
const lum = (c: number): number => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

export class HiCanvas {
  readonly columns: number
  readonly rows: number
  readonly w: number
  readonly h: number
  readonly px: Uint32Array
  private readonly glyph: Uint32Array // code point per cell, 0 = none
  private readonly ink: Uint32Array

  /**
   * A canvas `columns × rows` cells. With `shared` (a canvas of that size), a view onto its pixels
   * and text instead of a fresh canvas: what one draws, the other holds (hooks/panel.ts `clipped`).
   */
  constructor(columns: number, rows: number, shared?: HiCanvas) {
    this.columns = columns
    this.rows = rows
    this.w = columns * 2
    this.h = rows * 4
    this.px = shared ? shared.px : new Uint32Array(this.w * this.h).fill(NONE)
    this.glyph = shared ? shared.glyph : new Uint32Array(columns * rows)
    this.ink = shared ? shared.ink : new Uint32Array(columns * rows)
  }

  set(x: number, y: number, c: RGB): void {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = c
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return NONE
    return this.px[y * this.w + x]!
  }

  fill(fn: (x: number, y: number) => number): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.px[y * this.w + x] = fn(x, y)
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }

  /** A one-sub-pixel outline of the rect. */
  frame(x: number, y: number, w: number, h: number, c: RGB): void {
    if (w <= 0 || h <= 0) return
    this.hline(x, x + w - 1, y, c)
    this.hline(x, x + w - 1, y + h - 1, c)
    this.vline(x, y, y + h - 1, c)
    this.vline(x + w - 1, y, y + h - 1, c)
  }

  hline(x0: number, x1: number, y: number, c: RGB): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c)
  }

  vline(x: number, y0: number, y1: number, c: RGB): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c)
  }

  /** A Bresenham line between two sub-pixels, both ends included. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    x0 = Math.round(x0)
    y0 = Math.round(y0)
    x1 = Math.round(x1)
    y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x0, y0, c)
      if (x0 === x1 && y0 === y1) return
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  /** Lay text over the cells of one row, starting at `col`; characters outside BMP width-1 become '·'. */
  text(col: number, row: number, s: string, fg: RGB): void {
    let x = col
    for (const ch of s) {
      if (x >= this.columns) break
      if (x >= 0 && row >= 0 && row < this.rows) {
        this.glyph[row * this.columns + x] = printable(ch.codePointAt(0) ?? 32)
        this.ink[row * this.columns + x] = fg
      }
      x++
    }
  }

  /** The mean of a cell's non-NONE sub-pixels, or NONE when all are. */
  private under(col: number, row: number): number {
    let r = 0, g = 0, b = 0, n = 0
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 2; i++) {
        const c = this.get(col * 2 + i, row * 4 + j)
        if (c === NONE) continue
        r += (c >> 16) & 255
        g += (c >> 8) & 255
        b += c & 255
        n++
      }
    }
    return n === 0 ? NONE : pack(r / n, g / n, b / n)
  }

  /** Text that picks light or dark ink against the mean colour of each cell beneath it. */
  label(col: number, row: number, s: string, light: RGB = PAPER, dark: RGB = INK, noneIsLight = false): void {
    let x = col
    for (const ch of s) {
      const u = this.under(x, row)
      this.text(x, row, ch, u === NONE ? (noneIsLight ? dark : light) : luminance(u) < 0.55 ? light : dark)
      x++
    }
  }

  /** The text laid over the cells, read-only (office-hd's ambience keeps its specks off it, docs/DESIGN.md 42.2). */
  *glyphs(): Iterable<Glyph> {
    for (let i = 0; i < this.glyph.length; i++) {
      const ch = this.glyph[i]!
      if (ch !== 0) yield { col: i % this.columns, row: Math.floor(i / this.columns), ch, fg: this.ink[i]! }
    }
  }

  /**
   * The cells, packed as the Raster element wants them: [codePoint, fg, bg] per cell. Each cell's
   * 8 sub-pixels are fitted to two colours: NONE is always the background; one colour (over NONE
   * or not) is the foreground of its mask's glyph; otherwise the most distant pair seeds two
   * clusters, every sub-pixel joins the nearer seed, and the brighter cluster's mean is the
   * foreground. Text replaces a cell's glyph, on the mean of its sub-pixels.
   */
  encode(): string {
    const { columns, rows, w, px, glyph, ink } = this
    const out = new Uint32Array(columns * rows * 3)
    const sub = SUB
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const cell = row * columns + col
        let p = row * 4 * w + col * 2
        // The cell's sub-pixels (bit i = row * 2 + col), and whether any is NONE or all are alike.
        const s0 = px[p]!
        let hasNone = false
        let alike = true
        for (let j = 0; j < 8; j += 2) {
          const a = px[p]!
          const b = px[p + 1]!
          sub[j] = a
          sub[j + 1] = b
          if (a === NONE || b === NONE) hasNone = true
          if (a !== s0 || b !== s0) alike = false
          p += w
        }
        let ch: number, fg: number, bg: number
        const g = glyph[cell]!
        if (g !== 0) {
          // Text: the glyph on the mean of the cell's sub-pixels (NONE when all are).
          ch = g
          fg = ink[cell]!
          let r = 0, gg = 0, b = 0, n = 0
          for (let i = 0; i < 8; i++) {
            const c = sub[i]!
            if (c === NONE) continue
            r += (c >> 16) & 255
            gg += (c >> 8) & 255
            b += c & 255
            n++
          }
          bg = n === 0 ? NONE : pack(r / n, gg / n, b / n)
        } else if (alike) {
          // One colour over the whole cell (the common case): a full block, or nothing.
          if (s0 === NONE) {
            ch = 0x20
            fg = NONE
          } else {
            ch = 0x2588
            fg = s0
          }
          bg = NONE
        } else if (hasNone) {
          // One cluster of colour over NONE: its mean is the foreground.
          let mask = 0, r = 0, gg = 0, b = 0, n = 0
          for (let i = 0; i < 8; i++) {
            const c = sub[i]!
            if (c === NONE) continue
            mask |= 1 << i
            r += (c >> 16) & 255
            gg += (c >> 8) & 255
            b += c & 255
            n++
          }
          ch = MASK_TO_GLYPH[mask]!
          fg = pack(r / n, gg / n, b / n)
          bg = NONE
        } else {
          // Two clusters, seeded with the most distant pair (the first found on a tie).
          let seedA = 0, seedB = 1, far = -1
          for (let i = 0; i < 7; i++) {
            const a = sub[i]!
            const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
            for (let k = i + 1; k < 8; k++) {
              const b = sub[k]!
              const dr = ar - ((b >> 16) & 255)
              const dg = ag - ((b >> 8) & 255)
              const db = ab - (b & 255)
              const d = dr * dr + dg * dg + db * db
              if (d > far) {
                far = d
                seedA = i
                seedB = k
              }
            }
          }
          const A = sub[seedA]!
          const B = sub[seedB]!
          const ar = (A >> 16) & 255, ag = (A >> 8) & 255, ab = A & 255
          const br = (B >> 16) & 255, bgr = (B >> 8) & 255, bb0 = B & 255
          let maskA = 0, ra = 0, ga = 0, ba = 0, na = 0, rb = 0, gb = 0, bb = 0, nb = 0
          for (let i = 0; i < 8; i++) {
            const c = sub[i]!
            const r = (c >> 16) & 255, gr = (c >> 8) & 255, bl = c & 255
            const da = (r - ar) * (r - ar) + (gr - ag) * (gr - ag) + (bl - ab) * (bl - ab)
            const db = (r - br) * (r - br) + (gr - bgr) * (gr - bgr) + (bl - bb0) * (bl - bb0)
            if (da <= db) {
              maskA |= 1 << i
              ra += r
              ga += gr
              ba += bl
              na++
            } else {
              rb += r
              gb += gr
              bb += bl
              nb++
            }
          }
          const meanA = pack(ra / na, ga / na, ba / na)
          const meanB = pack(rb / nb, gb / nb, bb / nb)
          if (lum(meanA) >= lum(meanB)) {
            ch = MASK_TO_GLYPH[maskA]!
            fg = meanA
            bg = meanB
          } else {
            ch = MASK_TO_GLYPH[~maskA & 255]!
            fg = meanB
            bg = meanA
          }
        }
        const o = cell * 3
        out[o] = ch
        out[o + 1] = fg
        out[o + 2] = bg
      }
    }
    // Uint8Array.prototype.toBase64 exists in the hooks environment; the es2023 lib doesn't declare it.
    return (new Uint8Array(out.buffer) as unknown as { toBase64(): string }).toBase64()
  }
}
