// Sprites for scene authors (docs/DESIGN.md 25, docs/CONTRIBUTING.md): a picture written as text,
// one character per pixel, rows on separate lines, `.` (or a space) transparent, and a palette
// from those characters to colours. Parsed once at module load; drawn onto the half-block Canvas
// (one pixel per cell column, two per row) or the HiCanvas (2 × 4 sub-pixels per cell). Pure.
//
//   const CAT = sprite(`
//     .k...k.
//     .kkkkk.
//     kwkkkwk
//     .kkpkk.
//   `, { k: 0x3a3440, w: 0xf4efe6, p: 0xf08a5d })
//   blit(c, CAT, 10, 4)                       // pixel (10, 4) is the sprite's top-left
//   blit(c, CAT, 10, 4, { flipX: true })      // facing the other way
//   blitHi(hc, CAT, 20, 8, { scale: 0.6 })    // dimmed to 60 %
import type { Canvas, RGB } from './canvas.ts'
import { NONE, mix, scale } from './hicanvas.ts'
import type { HiCanvas } from './hicanvas.ts'

/** Character → colour. `.` and space are always transparent and need no entry. */
export type Palette = Readonly<Record<string, RGB>>

export type Sprite = {
  readonly w: number
  readonly h: number
  /** The colour at (x, y), or null where the pixel is transparent or outside the sprite. */
  at(x: number, y: number): RGB | null
}

export type BlitOptions = {
  /** Mirror left to right. */
  flipX?: boolean
  /** Mix every pixel toward this colour by `tintBy` (default 0.5). */
  tint?: RGB
  tintBy?: number
  /** Multiply every pixel's brightness (0.5 half as bright); applied after the tint. */
  scale?: number
}

const CLEAR = new Set(['.', ' '])

/**
 * Parse a picture: blank lines before and after are dropped, the common indent is removed (so a
 * template literal can be indented with the code), and short rows are padded transparent. Throws
 * on a character the palette does not name, so a typo shows when the scene loads.
 */
export function sprite(text: string, palette: Palette): Sprite {
  const lines = text.replace(/\t/g, '  ').split('\n')
  while (lines.length && lines[0]!.trim() === '') lines.shift()
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop()
  const indent = Math.min(...lines.filter(l => l.trim() !== '').map(l => l.length - l.trimStart().length), Number.POSITIVE_INFINITY)
  const rows = lines.map(l => [...l.slice(Number.isFinite(indent) ? indent : 0).trimEnd()])
  const w = Math.max(0, ...rows.map(r => r.length))
  const h = rows.length
  const px = new Uint32Array(w * h).fill(NONE)
  rows.forEach((row, y) =>
    row.forEach((ch, x) => {
      if (CLEAR.has(ch)) return
      const col = palette[ch]
      if (col === undefined) throw new Error(`sprite: no colour for '${ch}' (row ${y}, column ${x})`)
      px[y * w + x] = col
    }),
  )
  return {
    w,
    h,
    at(x: number, y: number): RGB | null {
      if (x < 0 || y < 0 || x >= w || y >= h) return null
      const c = px[y * w + x]!
      return c === NONE ? null : c
    },
  }
}

/** Anything a sprite can be drawn on: both canvases clip `set` at their edges. */
type Target = { readonly w: number; readonly h: number; set(x: number, y: number, c: RGB): void }

function draw(c: Target, sp: Sprite, x0: number, y0: number, o: BlitOptions = {}): void {
  x0 = Math.floor(x0)
  y0 = Math.floor(y0)
  // Only the part of the sprite that lands on the canvas is visited.
  const xs = Math.max(0, -x0)
  const xe = Math.min(sp.w, c.w - x0)
  const ys = Math.max(0, -y0)
  const ye = Math.min(sp.h, c.h - y0)
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      let col = sp.at(o.flipX ? sp.w - 1 - x : x, y)
      if (col == null) continue
      if (o.tint != null) col = mix(col, o.tint, o.tintBy ?? 0.5)
      if (o.scale != null && o.scale !== 1) col = scale(col, o.scale)
      c.set(x0 + x, y0 + y, col)
    }
  }
}

/** Draw `sp` onto a half-block Canvas with its top-left at pixel (x, y); clipped at the edges. */
export function blit(c: Canvas, sp: Sprite, x: number, y: number, opts?: BlitOptions): void {
  draw(c, sp, x, y, opts)
}

/** Draw `sp` onto a HiCanvas with its top-left at sub-pixel (x, y); clipped at the edges. */
export function blitHi(c: HiCanvas, sp: Sprite, x: number, y: number, opts?: BlitOptions): void {
  draw(c, sp, x, y, opts)
}

/** One of several frames, advancing every `every` ticks of `frame` (an animation as a frame list). */
export function frameOf<T>(frames: readonly T[], frame: number, every = 1): T {
  return frames[Math.floor(Math.max(0, frame) / Math.max(1, every)) % frames.length]!
}
