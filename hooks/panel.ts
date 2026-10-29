// The panel style (docs/DESIGN.md 15, polished in 23): slate monitor frames around dark phosphor
// screens, readings as terminal text, and a few graphics beside them (thin meters with scale ticks,
// stacked class bars, tick strips, traces, lamps). Shared by the instrument modules
// (hooks/modules/*). Boxes are in CELLS ({ col, row, w, h }); the helpers convert to sub-pixels
// (2 per cell across, 4 per cell down) inside.
//
// Rules that keep everything crisp (the encoder gives each cell two colours and a glyph):
// - Edges are half cells (2 sub-rows: ▀ ▄) or single sub-columns (▌ ▐): those masks are blocks.
//   A lone 1-sub-row line is braille (⠉), so horizontal edges are never one sub-row thick.
// - Meters, bars, ticks and traces are drawn on the QUAD grid: a quad is 1 sub-pixel wide and
//   2 sub-rows tall, so any set of quads in a cell is one of the 16 quadrant blocks (▘ ▝ ▖ ▗ ▀ ▄ ▌
//   ▐ ▚ ▞ ▛ ▜ ▙ ▟ █ or space), never braille. Only a trace's graticule is dots, on purpose.
// - Every number is text, on whole cells of the screen colour, cut to its room. Nothing is drawn
//   from pixels to look like a digit.
// The frame copies, not imports, the office-hd monitor material (hooks/scenes/office-hd.ts), so the
// scene can change on its own.
// Colours (docs/DESIGN.md 27): every module paints from `panelOf(paletteOf(ctx))`, the panel's
// tones for the active palette. A module is a screen, and screens stay dark in every palette, so
// in `paper` the frame is the palette's slate and the inks on the screen stay light. `PANEL` is
// the `night` set, kept for the tests and as the helpers' default.
import type { ToolClass } from '../types'
import { BAD, DIM, GOOD, PAPER, TOOLS, WARN } from './canvas.ts'
import { HiCanvas, cut, mix, scale } from './hicanvas.ts'
import type { RGB } from './hicanvas.ts'
import { PALETTES, perPalette, shade, shadeBy } from './palette.ts'
import type { Palette } from './palette.ts'

export { cut, mix, scale }
export type { RGB }

/** A rectangle of cells. */
export type CellBox = { col: number; row: number; w: number; h: number }

/** The panel palette: slate frames, one phosphor accent on dark screens, amber for warnings, red for errors. */
export const PANEL = {
  /** The frame: the office-hd monitor material and its highlight. */
  mon: 0x55506a,
  bevel: 0x8f89a6,
  screen: 0x0a0e0a,
  /** The scope's faint graticule. */
  grid: 0x16261a,
  /** A meter's unlit track and its scale ticks. */
  track: 0x1f3a26,
  phosphor: 0x62e07e,
  phosphorDim: 0x2c6b3b,
  phosphorGlow: 0x9ff2b0,
  ink: 0xe9e9e1,
  /** Titles and labels: the office's key-cap grey. */
  inkDim: 0x8a8399,
  amber: 0xf2c25b,
  red: 0xf0605d,
  green: GOOD,
  lampOff: 0x2a2a30,
  /** A dim red mark on a screen (the scope's 80 % line). */
  redDim: 0x5a2226,
} as const

/** The panel's tones in one palette: `PANEL`'s keys, plus the class and meaning colours the modules paint. */
export type PanelTones = { [K in keyof typeof PANEL]: RGB } & {
  classes: Record<ToolClass, RGB>
  think: RGB
  tools: RGB
  model: RGB
  /** A class with no calls yet. */
  dim: RGB
}

/** The panel's tones for palette `p`, worked out once per palette. `panelOf(night)` is `PANEL`. */
export const panelOf = perPalette((p: Palette): PanelTones => ({
  mon: p.mon,
  bevel: p.bevel,
  screen: p.screen,
  grid: p.grid,
  track: shade(p, 'phosphorDim', PANEL.track),
  phosphor: p.phosphor,
  phosphorDim: p.phosphorDim,
  phosphorGlow: p.phosphorGlow,
  // On the dark screen: a light palette's ink is dark, so the screen takes the wall's tone instead.
  ink: p.light ? p.wall : shade(p, 'ink', PANEL.ink),
  inkDim: p.light ? p.bevel : p.inkDim,
  amber: p.warn,
  red: p.bad,
  green: p.good,
  lampOff: p.light ? shade(p, 'screen', PANEL.lampOff) : p.lampOff,
  // Red even in phosphor, where `bad` is the one colour that is not green.
  redDim: p.id === 'phosphor' ? mix(p.screen, p.bad, 0.35) : shadeBy(p, p.bad, PALETTES.night.bad, PANEL.redDim),
  classes: p.classes,
  think: p.think,
  tools: p.tools,
  model: p.model,
  dim: p.dim,
}))

/** The panel tones of a module's context (night when it carries no palette). */
export function panelFor(ctx: { palette?: Palette } | null | undefined): PanelTones {
  return panelOf(ctx?.palette ?? PALETTES.night)
}

/** The night panel tones (`PANEL` with the class and meaning colours), the helpers' default. */
const NIGHT_TONES = (): PanelTones => panelOf(PALETTES.night)

/** The tool classes' colours in `night`; modules draw `panelFor(ctx).classes`. */
export const CLASS_COLOR: Record<ToolClass, RGB> = {
  shell: TOOLS,
  read: 0x9fb4ff,
  edit: 0xf2a65a,
  search: 0xc9a0ff,
  web: 0x6fd3ff,
  agent: 0xf08a5d,
  other: DIM,
}

/** Short names per class: full, short, one letter. */
export const CLASS_NAME: Record<ToolClass, [string, string, string]> = {
  shell: ['$', '$', '$'],
  read: ['read', 'rd', 'r'],
  edit: ['edit', 'ed', 'e'],
  search: ['grep', 'gr', 'g'],
  web: ['web', 'web', 'w'],
  agent: ['agent', 'ag', 'a'],
  other: ['other', 'ot', 'o'],
}

/** The six classes the panels show, in order. */
export const CLASSES: ToolClass[] = ['shell', 'read', 'edit', 'search', 'web', 'agent']

export { BAD, DIM, GOOD, PAPER, WARN }

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** A model id for a label: the last path segment, no `claude-`, its first two words ("opus 5"). */
export function shortModel(id: string | null | undefined): string {
  if (!id) return ''
  return (id.split('/').at(-1) ?? '').replace(/^claude-/, '').split('-').slice(0, 2).join(' ')
}

/** A reading's ink: `col` (phosphor by default) while live; dimmed once the run is done. */
export function lit(done: boolean, col?: RGB, P: PanelTones = NIGHT_TONES()): RGB {
  const c = col ?? P.phosphor
  if (!done) return c
  return c === P.phosphor ? P.phosphorDim : mix(c, P.screen, 0.4)
}

/** Fill whole cells with one colour. */
export function fillCells(c: HiCanvas, box: CellBox, col: RGB): void {
  if (box.w <= 0 || box.h <= 0) return
  c.rect(box.col * 2, box.row * 4, box.w * 2, box.h * 4, col)
}

/**
 * A view of `c` that drops every write outside `box` (sub-pixels and text alike); reads pass
 * through. The grid draws each module through one, so a module squeezed under its `minW` on a
 * narrow pane can never paint over its neighbours. A HiCanvas sharing `c`'s pixels and text, so
 * every drawing method (rect, line, label, …) goes through its clipped `set` and `text`; `fill`
 * does nothing.
 */
export function clipped(c: HiCanvas, box: CellBox): HiCanvas {
  return new ClippedCanvas(c, box)
}

class ClippedCanvas extends HiCanvas {
  private readonly x0: number
  private readonly y0: number
  private readonly x1: number
  private readonly y1: number
  private readonly box: CellBox

  constructor(c: HiCanvas, box: CellBox) {
    super(c.columns, c.rows, c)
    this.box = box
    this.x0 = box.col * 2
    this.y0 = box.row * 4
    this.x1 = (box.col + box.w) * 2
    this.y1 = (box.row + box.h) * 4
  }

  override set(x: number, y: number, col: RGB): void {
    if (x >= this.x0 && x < this.x1 && y >= this.y0 && y < this.y1) super.set(x, y, col)
  }

  override text(col: number, row: number, text: string, fg: RGB): void {
    const { box } = this
    if (row < box.row || row >= box.row + box.h) return
    let x = col
    for (const ch of text) {
      if (x >= box.col && x < box.col + box.w) super.text(x, row, ch, fg)
      x++
    }
  }

  override fill(): void {}
}

/** The inside of a frame: everything but the one-cell ring. */
export function innerOf(box: CellBox): CellBox {
  return { col: box.col + 1, row: box.row + 1, w: Math.max(0, box.w - 2), h: Math.max(0, box.h - 2) }
}

/**
 * A module's frame and title row over `box`: the screen fills the box, the slate ring is one cell
 * that reads half a cell thick (the highlight on the top half-row ▀ and the left sub-column ▌, the
 * monitor slate on the bottom half-row ▄ and the right sub-column ▐, the other half of each edge
 * cell screen). The first inner row carries `title` on the left in key-cap grey and `headline` on
 * the right in phosphor (or `hot`). Returns the content box: the inner rows under the title.
 */
export function plate(c: HiCanvas, box: CellBox, title: string, headline?: string, hot?: RGB, P: PanelTones = NIGHT_TONES()): CellBox {
  const { col, row, w, h } = box
  if (w <= 0 || h <= 0) return { col, row, w: 0, h: 0 }
  fillCells(c, box, P.screen)
  if (w >= 2 && h >= 2) {
    const X0 = col * 2
    const Y0 = row * 4
    const W = w * 2
    const H = h * 4
    c.rect(X0 + W - 1, Y0 + 2, 1, H - 2, P.mon) // right ▐
    c.rect(X0, Y0 + H - 2, W, 2, P.mon) // bottom ▄
    c.rect(X0, Y0, W, 2, P.bevel) // top ▀
    c.rect(X0, Y0, 1, H - 2, P.bevel) // left ▌
  }
  const inner = innerOf(box)
  if (inner.w <= 0 || inner.h <= 0) return { col: inner.col, row: inner.row, w: 0, h: 0 }
  const hw = headline ? Math.min(inner.w, [...headline].length) : 0
  if (headline) writeRight(c, inner.col, inner.row, inner.w, headline, hot ?? P.phosphor, undefined, P)
  const room = inner.w - hw - (hw > 0 ? 1 : 0)
  if (room > 0) write(c, inner.col, inner.row, room, title, P.inkDim, undefined, P)
  return { col: inner.col, row: inner.row + 1, w: inner.w, h: inner.h - 1 }
}

/** A dark screen over `box` with a faint dotted graticule (a dot every `every` cells, on the bottom sub-row). */
export function screen(c: HiCanvas, box: CellBox, grid = true, every = 3, P: PanelTones = NIGHT_TONES()): void {
  fillCells(c, box, P.screen)
  if (!grid || box.w < 3) return
  for (let r = 0; r < box.h; r++) {
    for (let x = every - 1; x < box.w - 1; x += every) c.set((box.col + x) * 2 + 1, (box.row + r) * 4 + 3, P.grid)
  }
}

/**
 * Text clipped to `w` cells, with ✓ and ✖ in green and red. `bg` repaints the cells under it first
 * (so pixels drawn there earlier do not tint the text's background). Returns the cells written.
 */
export function write(c: HiCanvas, col: number, row: number, w: number, text: string, ink: RGB, bg?: RGB, P: PanelTones = NIGHT_TONES()): number {
  if (w <= 0) return 0
  const sh = cut(text, w)
  if (bg != null) c.rect(col * 2, row * 4, [...sh].length * 2, 4, bg)
  let i = 0
  for (const ch of sh) {
    c.text(col + i, row, ch, ch === '✓' ? P.green : ch === '✖' ? P.red : ink)
    i++
  }
  return i
}

/** Text right-aligned to end at `col + w - 1`. Returns its first column. */
export function writeRight(c: HiCanvas, col: number, row: number, w: number, text: string, ink: RGB, bg?: RGB, P: PanelTones = NIGHT_TONES()): number {
  const sh = cut(text, w)
  const start = col + w - [...sh].length
  write(c, start, row, w, sh, ink, bg, P)
  return start
}

/** A run of differently inked pieces from `col`, cut at `w` cells. Returns the cells written. */
export function writeRuns(c: HiCanvas, col: number, row: number, w: number, runs: [string, RGB][], P: PanelTones = NIGHT_TONES()): number {
  let x = 0
  for (const [text, ink] of runs) {
    if (x >= w) break
    // A separator with no room for anything after it is left off.
    if (text.trim() === '·' && w - x - text.length < 3) break
    x += write(c, col + x, row, w - x, text, ink, undefined, P)
  }
  return x
}

// ── The quad grid: 1 sub-pixel wide, 2 sub-rows tall; quads always encode as blocks.

/** Light the quad at sub-pixel column `x`, quad row `qy` (sub-rows 2qy and 2qy+1). */
export function quad(c: HiCanvas, x: number, qy: number, col: RGB): void {
  c.set(x, qy * 2, col)
  c.set(x, qy * 2 + 1, col)
}

/** A line on the quad grid between sub-pixel points (y is halved onto quad rows). */
export function qline(c: HiCanvas, x0: number, y0: number, x1: number, y1: number, col: RGB): void {
  let X0 = Math.round(x0)
  let Y0 = Math.floor(y0 / 2)
  const X1 = Math.round(x1)
  const Y1 = Math.floor(y1 / 2)
  const dx = Math.abs(X1 - X0)
  const dy = -Math.abs(Y1 - Y0)
  const sx = X0 < X1 ? 1 : -1
  const sy = Y0 < Y1 ? 1 : -1
  let err = dx + dy
  for (let guard = 0; guard < 4096; guard++) {
    quad(c, X0, Y0, col)
    if (X0 === X1 && Y0 === Y1) return
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      X0 += sx
    }
    if (e2 <= dx) {
      err += dx
      Y0 += sy
    }
  }
}

// ── Meters and bars: on the upper half of one text row (2 sub-rows, ▀), scale ticks hanging
// from them in the lower half, so a meter sits between text rows without crowding them.

export type MeterOpts = {
  /** The lit part's colour (phosphor by default). */
  fill?: RGB
  /** The unlit track's colour, also the ticks' colour under it. */
  track?: RGB
  /** Scale ticks at these fractions, single quads under the bar in the bar's colour above them. */
  ticks?: number[]
  /** A peak-hold mark (a fraction): the cell at the peak in `peakInk`. */
  peak?: number | null
  peakInk?: RGB
  /** The palette's panel tones, for the defaults above (night when absent). */
  tones?: PanelTones
}

/**
 * A thin horizontal meter on cell row `row` from `col`, `w` cells wide, lit to `frac` (0..1) at
 * half-cell steps. Everything on quads, so every cell is a block glyph.
 */
export function meter(c: HiCanvas, col: number, row: number, w: number, frac: number, opts: MeterOpts = {}): void {
  if (w <= 0) return
  const P = opts.tones ?? NIGHT_TONES()
  const fill = opts.fill ?? P.phosphor
  const track = opts.track ?? P.track
  const X0 = col * 2
  const W = w * 2
  const Y = row * 4
  const n = Math.round(clamp(Number.isFinite(frac) ? frac : 0, 0, 1) * W)
  c.rect(X0, Y, W, 2, track)
  if (n > 0) c.rect(X0, Y, n, 2, fill)
  let peakCell = -1
  if (opts.peak != null && Number.isFinite(opts.peak)) {
    peakCell = clamp(Math.ceil(clamp(opts.peak, 0, 1) * w) - 1, 0, w - 1)
    c.rect((col + peakCell) * 2, Y, 2, 2, opts.peakInk ?? P.phosphorGlow)
  }
  for (const f of opts.ticks ?? []) {
    const x = X0 + clamp(Math.floor(f * W), 0, W - 1)
    const above = (x >> 1) - col === peakCell ? opts.peakInk ?? P.phosphorGlow : x - X0 < n ? fill : track
    quad(c, x, (Y >> 1) + 1, above)
  }
}

/**
 * Cell widths for `values` over `w` cells, proportional, every non-zero value at least one cell
 * when there is room (largest remainder, so the widths add up to `w` exactly when any is non-zero).
 */
export function shares(values: number[], w: number): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0)
  const out = values.map(() => 0)
  if (total <= 0 || w <= 0) return out
  const nz = values.filter(v => v > 0).length
  const floor = nz <= w ? 1 : 0
  const rest = w - floor * nz
  const raw = values.map(v => (v > 0 ? (Math.max(0, v) / total) * rest : 0))
  let used = 0
  raw.forEach((r, i) => {
    out[i] = values[i]! > 0 ? floor + Math.floor(r) : 0
    used += out[i]!
  })
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).filter(([, i]) => values[i]! > 0).sort((a, b) => b[0] - a[0])
  for (let k = 0; used < w && k < order.length; k++, used++) out[order[k]![1]]!++
  return out
}

/** One segment of a stacked bar as drawn: its first cell and its width in cells. */
export type Segment = { col: number; w: number }

/**
 * A stacked bar on cell row `row`: one segment per value in its colour, cell-aligned (so two
 * colours never share a cell), on the upper half of the row (or the whole row when `full`).
 * Returns each value's segment.
 */
export function stackBar(c: HiCanvas, col: number, row: number, w: number, parts: { n: number; color: RGB }[], full = false): Segment[] {
  const ws = shares(parts.map(p => p.n), w)
  let x = col
  return parts.map((p, i) => {
    const seg = { col: x, w: ws[i]! }
    if (seg.w > 0) c.rect(x * 2, row * 4, seg.w * 2, full ? 4 : 2, p.color)
    x += seg.w
    return seg
  })
}

/** One lamp of a lamp row: its colour, and a label printed before it. */
export type Lamp = { color: RGB; label?: string }

/**
 * A row of round lamps (●, in their colour) from `col`, each after its label, one cell apart;
 * stops at `w` cells. Returns the cells used.
 */
export function lampRow(c: HiCanvas, col: number, row: number, w: number, lamps: Lamp[], labelInk?: RGB, P: PanelTones = NIGHT_TONES()): number {
  const ink = labelInk ?? P.inkDim
  let x = 0
  for (const lamp of lamps) {
    const lab = lamp.label ? `${lamp.label} ` : ''
    const need = [...lab].length + 1
    if (x + need > w) break
    if (lab) write(c, col + x, row, lab.length, lab, ink, undefined, P)
    x += [...lab].length
    c.text(col + x, row, '●', lamp.color)
    x += 2
  }
  return Math.min(w, Math.max(0, x - 1))
}
