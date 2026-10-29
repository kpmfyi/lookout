// A small pixel canvas for the terminal's Raster element. Each cell holds two pixels stacked
// vertically, drawn as '▀' with the top pixel as foreground and the bottom one as background,
// so a canvas of `columns × rows` cells is `columns × 2·rows` pixels. Text can be laid over it.

export const NONE = 0x01000000 // the terminal's default color (transparent here)

export type RGB = number // 0xRRGGBB

export function rgb(r: number, g: number, b: number): RGB {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

function parts(c: RGB): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const [ar, ag, ab] = parts(a)
  const [br, bg, bb] = parts(b)
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

export function scale(c: RGB, f: number): RGB {
  const [r, g, b] = parts(c)
  return rgb(r * f, g * f, b * f)
}

/** A color ramp through evenly spaced stops, `t` in 0..1. */
export function ramp(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0]!
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i]!, stops[i + 1]!, x - i)
}

export function luminance(c: RGB): number {
  const [r, g, b] = parts(c)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// Palettes
export const INK = 0x14121c
export const PAPER = 0xf4efe6
export const DIM = 0x6b6577
export const TOOLS = 0x5cc8c0
export const GOOD = 0x7ed492
export const BAD = 0xf0605d
export const WARN = 0xf2c25b

/** A code point a Raster cell takes (printable, width-1, in the BMP), or '·' in its place. */
export function printable(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp > 0xffff) return 0xb7
  if (cp >= 0x300 && cp <= 0x36f) return 0xb7 // combining marks: no width
  if (cp >= 0xd800 && cp <= 0xdfff) return 0xb7 // lone surrogates
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || cp === 0x200b || cp === 0xfeff
  ) return 0xb7 // wide or zero-width
  return cp
}

/** One character laid over a canvas cell with `text`/`label`. */
export type Glyph = { col: number; row: number; ch: number; fg: RGB }

export class Canvas {
  readonly columns: number
  readonly rows: number
  readonly w: number
  readonly h: number
  readonly px: Uint32Array
  private readonly glyphMap = new Map<number, { ch: number; fg: RGB }>()

  constructor(columns: number, rows: number) {
    this.columns = columns
    this.rows = rows
    this.w = columns
    this.h = rows * 2
    this.px = new Uint32Array(this.w * this.h).fill(NONE)
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

  /** Lay text over the cells of one row, starting at `col`; characters outside BMP width-1 become '·'. */
  text(col: number, row: number, s: string, fg: RGB): void {
    let x = col
    for (const ch of s) {
      if (x >= this.columns) break
      const cp = printable(ch.codePointAt(0) ?? 32)
      if (x >= 0 && row >= 0 && row < this.rows) this.glyphMap.set(row * this.columns + x, { ch: cp, fg })
      x++
    }
  }

  /**
   * Text that picks light or dark ink against what lies beneath it. The terminal's own colour
   * (NONE) counts as dark, unless `noneIsLight` (a light terminal: the `paper` palette).
   */
  label(col: number, row: number, s: string, light: RGB = PAPER, dark: RGB = INK, noneIsLight = false): void {
    let x = col
    for (const ch of s) {
      const under = this.get(x, row * 2) === NONE ? this.get(x, row * 2 + 1) : this.get(x, row * 2)
      const ink = under === NONE ? (noneIsLight ? dark : light) : luminance(under) < 0.55 ? light : dark
      this.text(x, row, ch, ink)
      x++
    }
  }

  /** The cells, packed as the Raster element wants them. */
  encode(): string {
    const out = new Uint32Array(this.columns * this.rows * 3)
    for (let row = 0; row < this.rows; row++) {
      for (let x = 0; x < this.columns; x++) {
        const i = row * this.columns + x
        const top = this.get(x, row * 2)
        const bot = this.get(x, row * 2 + 1)
        const g = this.glyphMap.get(i)
        let ch: number, fg: number, bg: number
        if (g) {
          // A glyph sits on the cell's background: the darker-weighted mix of its two pixels.
          ch = g.ch
          fg = g.fg
          bg = top === NONE ? bot : bot === NONE ? top : mix(top, bot, 0.5)
        } else if (top === NONE && bot === NONE) {
          ch = 32
          fg = NONE
          bg = NONE
        } else if (top === NONE) {
          ch = 0x2584 // ▄
          fg = bot
          bg = NONE
        } else if (bot === NONE || top === bot) {
          ch = top === bot ? 0x2588 : 0x2580 // █ or ▀
          fg = top
          bg = NONE
        } else {
          ch = 0x2580
          fg = top
          bg = bot
        }
        out[i * 3] = ch
        out[i * 3 + 1] = fg
        out[i * 3 + 2] = bg
      }
    }
    // Uint8Array.prototype.toBase64 exists in the hooks environment; the es2023 lib doesn't declare it.
    return (new Uint8Array(out.buffer) as unknown as { toBase64(): string }).toBase64()
  }
}

// ── Shared drawing helpers for the scenes. They live here, not in scenes/index.ts, so a scene
// module never imports the registry that imports it; scenes/index.ts re-exports them.

export type Rect = { x: number; y: number; w: number; h: number }

export function rect(c: Canvas, b: Rect, col: RGB): void {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) c.set(x, y, col)
}

export function frameRect(c: Canvas, b: Rect, col: RGB): void {
  for (let x = b.x; x < b.x + b.w; x++) {
    c.set(x, b.y, col)
    c.set(x, b.y + b.h - 1, col)
  }
  for (let y = b.y; y < b.y + b.h; y++) {
    c.set(b.x, y, col)
    c.set(b.x + b.w - 1, y, col)
  }
}

/** Points of an L-shaped cable from a to b: across, then down or up, then across. */
export function cable(a: [number, number], b: [number, number]): [number, number][] {
  const pts: [number, number][] = []
  const [ax, ay] = a
  const [bx, by] = b
  const midX = Math.round((ax + bx) / 2)
  for (let x = ax; x !== midX; x += Math.sign(midX - ax) || 1) pts.push([x, ay])
  for (let y = ay; y !== by; y += Math.sign(by - ay) || 1) pts.push([midX, y])
  for (let x = midX; x !== bx; x += Math.sign(bx - midX) || 1) pts.push([x, by])
  pts.push([bx, by])
  return pts
}

/** A stable pseudo-random number in 0..1 for an integer seed. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

/** Cut a string to `n` characters, ending in '…' when it was longer. */
export function cut(s: string, n: number): string {
  if (n <= 0) return ''
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…'
}

export type Layout = 'narrow' | 'mid' | 'wide'

/** The scene breakpoints: narrow below 60 columns, mid 60..99, wide from 100. */
export function layout(columns: number): Layout {
  return columns < 60 ? 'narrow' : columns < 100 ? 'mid' : 'wide'
}
