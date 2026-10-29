// Render every scene in hooks/scenes to SVG for the README: one still per scene per state
// (docs/images/<scene>-<state>.svg, from the test fixtures, at the standard size and 80 columns;
// the two offices' running and thinking stills include the orchestrator's desk), one large still per
// scene (docs/images/<scene>-large.svg: running, 100 columns) and one animated SVG per scene
// (docs/images/<scene>.svg): one loop of the demo script (hooks/demo.ts), so each animation shows
// every state and pulse, plus docs/images/hero.svg: the office's loop as the pane draws it when it
// follows this session (docs/DESIGN.md 36: the one desk, named `claude`, a Claude model, no model
// server, no hand-off, no demo tag), wide and tall enough for the whole room (HERO_COLUMNS, the
// large size) and starting HERO_START seconds into the demo's second pass, so even a still first
// frame shows a room at work; docs/images/wall.svg: the detailed layout on a wide pane, drawn as
// the wall (docs/DESIGN.md 15, 43.2), the default modules split around the office-hd scene at its large size (running, 100 columns; the
// scene and the modules told what the modules claim, as the pane tells them, docs/DESIGN.md 31), and
// docs/images/office-paper.svg and office-phosphor.svg: the running office at 80 columns in the
// other two palettes (docs/DESIGN.md 27), on a page of the terminal colour each is meant for;
// docs/images/showcase.svg: the showcase (docs/DESIGN.md 39), office-hd drawn as the ambient layout
// draws it on a tall pane (SHOWCASE_COLUMNS × SHOWCASE_ROWS, the plain caption of the calm story,
// the demo's canned plain words for its thinking, an orchestrator waiting on the worker), animated
// through one demo loop from HERO_START, as the hero, and
// docs/images/showcase-session.svg: a still of it following this session (one desk, `claude`).
// Run from anywhere: node scripts/render-scenes.ts   (Node 24 runs .ts directly)
// Deterministic: fixed fixtures, fixed clock, fixed frames. Prints one summary line.
//
// Review renders of one palette (stills, large stills and the wall; no animations; --session alone
// reviews in night):
//   node scripts/render-scenes.ts --palette paper --out /tmp/look [--scenes observatory,office] [--width 740] [--session]
// --width rewrites each SVG's width attribute (height in proportion, viewBox kept), for viewers
// that crop wide SVGs; --session draws the stills as the pane following this session draws them
// (docs/DESIGN.md 36: no orchestrator, the worker's desk named `claude`, a Claude model, no server).
import './polyfill.ts' // first: Canvas.encode needs Uint8Array.prototype.toBase64

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Summary } from '../types'
import { activity, isSession } from '../hooks/activity.ts'
import type { Activity } from '../hooks/activity.ts'
import { DEMO_LOOP_SECS, demoPlain, demoSummary } from '../hooks/demo.ts'
import { drawGrid, packModules } from '../hooks/grid.ts'
import { HiCanvas, glyphToMask } from '../hooks/hicanvas.ts'
import { factsOf } from '../hooks/facts.ts'
import type { Fact } from '../hooks/facts.ts'
import { memoryOf } from '../hooks/memory.ts'
import { DEFAULT_ORDER, MODULES } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import { storyOf } from '../hooks/narrate.ts'
import { newestAt } from '../hooks/scenes/screens.ts'
import { parseExplained } from '../hooks/thought.ts'
import { PALETTES, isPaletteId } from '../hooks/palette.ts'
import type { Palette, PaletteId } from '../hooks/palette.ts'
import { SCENES } from '../hooks/scenes/index.ts'
import type { Scene } from '../hooks/scenes/index.ts'
import type { You } from '../hooks/you.ts'
import { FAILED, FINISHED, RUNNING, T, THINKING, YOU_THINKING } from '../tests/fixtures.ts'

// The command line: --palette, --out, --scenes, --width (see the header).
const argv = process.argv.slice(2)
function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const PICK = arg('palette')
if (PICK != null && !isPaletteId(PICK)) throw new Error(`--palette: night, paper or phosphor, not ${PICK}`)
const SESSION = argv.includes('--session')
const REVIEW = PICK != null || SESSION
const ONLY = arg('scenes')?.split(',').map(x => x.trim()).filter(Boolean)
const FIT_WIDTH = arg('width') ? Number(arg('width')) : null

const OUT = arg('out') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images')
const COLUMNS = 80
const LARGE_COLUMNS = 100
// The hero: wide enough for all six stations, the window and the clock, at the office's large size.
const HERO_COLUMNS = 100
const HERO_START = 72 + 12
// The showcase: a second monitor's pane, as the ambient layout fills it.
const SHOWCASE_COLUMNS = 100
const SHOWCASE_ROWS = 48
const CW = 8 // px per cell, wide
const CH = 16 // px per cell, tall (two pixel rows of 8)
const SW = CW / 2 // a HiCanvas sub-pixel: half a cell wide, a quarter tall
const SH = CH / 4
// The terminal's default colour behind the picture: dark, or light for the paper palette.
const PAGES: Record<PaletteId, string> = { night: '#0b0b10', paper: '#f4efe6', phosphor: '#0b0b10' }
let palette: Palette = PALETTES.night
let PAGE = PAGES.night
/** Draw with `p` (and on its page colour) from here on. */
function usePalette(p: Palette): void {
  palette = p
  PAGE = PAGES[p.id]
}
const NONE = 0x01000000
const STILL_FRAME = 12
// The animation: one demo loop sampled twice per script second (144 frames), shown at 0.12 s a
// frame; the frame counter steps 4 per sample so the motion reads at that speed.
const SAMPLES_PER_SEC = 2
const FRAMES = DEMO_LOOP_SECS * SAMPLES_PER_SEC
const FRAME_STEP = 4
const FRAME_SECS = 0.12

// The prefill variant, as tests/scenes.test.ts builds it.
const PREFILL: Summary = {
  ...RUNNING,
  pending: { kind: 'model', since: T - 1 },
  server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } },
}

const STATES: [string, Summary][] = [
  ['running', RUNNING],
  ['thinking', THINKING],
  ['finished', FINISHED],
  ['failed', FAILED],
]
if (activity(PREFILL, T).state === 'prefill') STATES.push(['prefill', PREFILL])

type Cells = Uint32Array // [codePoint, fg, bg] per cell

function decode(cells: string): Cells {
  const buf = Buffer.from(cells, 'base64')
  const out = new Uint32Array(Math.floor(buf.length / 4))
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt32LE(i * 4)
  return out
}

function hex(c: number): string {
  return c === NONE || c > 0xffffff ? PAGE : '#' + c.toString(16).padStart(6, '0')
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
}

/** The colours of a cell's top and bottom halves, and the glyph laid over it (or null). */
function halves(cells: Cells, i: number): [number, number, string | null, number] {
  const cp = cells[i * 3]!
  const fg = cells[i * 3 + 1]!
  const bg = cells[i * 3 + 2]!
  switch (cp) {
    case 0x2580:
      return [fg, bg, null, 0] // ▀
    case 0x2584:
      return [bg, fg, null, 0] // ▄
    case 0x2588:
      return [fg, fg, null, 0] // █
    case 0x20:
      return [bg, bg, null, 0]
    default:
      return [bg, bg, String.fromCodePoint(cp), fg]
  }
}

/**
 * The sub-pixel mask of a cell drawn by its shape rather than as half rows or text: any block or
 * braille glyph other than the half-block canvas's own ▀ ▄ █ and space, else null.
 */
function fineMask(cells: Cells, i: number): number | null {
  const cp = cells[i * 3]!
  if (cp === 0x2580 || cp === 0x2584 || cp === 0x2588 || cp === 0x20) return null
  return glyphToMask(cp)
}

/**
 * SVG for the cells where `mask(i)` holds: half-cell pixel rows merged into horizontal runs of one
 * colour, drawn as one stroked path per colour (a run is `M x y h w` under a stroke as tall as a
 * half cell, which is far smaller than a <rect> per run), then glyphs grouped per row and colour
 * into one <text> with an x per character. `skipPage` leaves out runs in the page colour (the
 * background rect already paints them). Cells with a finer shape (quadrants, braille) are drawn by
 * their 2 × 4 mask instead: the background rect, then one rect per lit sub-pixel (vertical runs
 * merged for blocks; braille dots inset by 1 px so they read as dots).
 */
function paint(cells: Cells, rows: number, columns: number, select: (i: number) => boolean, skipPage: boolean): string {
  const mask = (i: number) => select(i) && fineMask(cells, i) == null
  const parts: string[] = []
  const runs = new Map<string, string>()
  for (let row = 0; row < rows; row++) {
    for (let half = 0; half < 2; half++) {
      let x = 0
      while (x < columns) {
        const i = row * columns + x
        if (!mask(i)) {
          x++
          continue
        }
        const col = hex(halves(cells, i)[half]!)
        let end = x + 1
        while (end < columns && mask(row * columns + end) && hex(halves(cells, row * columns + end)[half]!) === col) end++
        if (!(skipPage && col === PAGE)) {
          runs.set(col, `${runs.get(col) ?? ''}M${x * CW} ${row * CH + half * (CH / 2) + CH / 4}h${(end - x) * CW}`)
        }
        x = end
      }
    }
  }
  if (runs.size) {
    parts.push(`<g fill="none" stroke-width="${CH / 2}">`)
    for (const [col, d] of runs) parts.push(`<path stroke="${col}" d="${d}"/>`)
    parts.push('</g>')
  }
  const bgs = new Map<string, string>()
  const fgs = new Map<string, string>()
  const box = (m: Map<string, string>, col: string, x: number, y: number, w: number, h: number) =>
    m.set(col, `${m.get(col) ?? ''}M${x} ${y}h${w}v${h}h${-w}z`)
  for (let i = 0; i < rows * columns; i++) {
    const m = select(i) ? fineMask(cells, i) : null
    if (m == null) continue
    const x = (i % columns) * CW
    const y = Math.floor(i / columns) * CH
    const bg = hex(cells[i * 3 + 2]!)
    const fg = hex(cells[i * 3 + 1]!)
    if (!(skipPage && bg === PAGE)) box(bgs, bg, x, y, CW, CH)
    const dots = cells[i * 3]! >= 0x2800
    for (let sc = 0; sc < 2; sc++) {
      for (let sr = 0; sr < 4; sr++) {
        if (!(m & (1 << (sr * 2 + sc)))) continue
        if (dots) {
          box(fgs, fg, x + sc * SW + 1, y + sr * SH + 1, SW - 2, SH - 2)
          continue
        }
        let end = sr + 1
        while (end < 4 && m & (1 << (end * 2 + sc))) end++
        box(fgs, fg, x + sc * SW, y + sr * SH, SW, (end - sr) * SH)
        sr = end - 1
      }
    }
  }
  for (const m of [bgs, fgs]) for (const [col, d] of m) parts.push(`<path fill="${col}" d="${d}"/>`)
  for (let row = 0; row < rows; row++) {
    const byColour = new Map<string, { xs: number[]; text: string }>()
    for (let x = 0; x < columns; x++) {
      const i = row * columns + x
      if (!mask(i)) continue
      const [, , glyph, fg] = halves(cells, i)
      if (glyph == null) continue
      const col = hex(fg)
      const g = byColour.get(col) ?? { xs: [], text: '' }
      g.xs.push(x * CW + 1)
      g.text += glyph
      byColour.set(col, g)
    }
    for (const [col, g] of byColour) {
      parts.push(`<text x="${g.xs.join(' ')}" y="${row * CH + 12}" fill="${col}">${esc(g.text)}</text>`)
    }
  }
  return parts.join('')
}

function svgOpen(rows: number, columns: number, title: string): string {
  const w = columns * CW
  const h = rows * CH
  const sw = FIT_WIDTH && FIT_WIDTH < w ? FIT_WIDTH : w
  const sh = Math.round((h * sw) / w)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    `<title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${PAGE}"/>` +
    `<g font-family="ui-monospace, Menlo, monospace" font-size="13">`
  )
}

const SVG_CLOSE = '</g></svg>\n'

/** The activity as the ambient layout hands it to its scene: the caption in the calm story's plain words (docs/DESIGN.md 38.1, 39). */
function ambientActivity(s: Summary, t: number): Activity {
  const a = activity(s, t)
  return { ...a, text: storyOf(s, a, memoryOf(s, t), t, isSession(s) ? 'Claude' : 'The worker').caption }
}

/** The thinking in plain words as the pane hands them over for the demo: its canned ones (docs/DESIGN.md 40.2); none for a fixture. */
function plainOf(s: Summary): { runs: ReturnType<typeof parseExplained>; t: number; stale: boolean } | undefined {
  const canned = demoPlain((s.thinking ?? '').trim())
  return canned ? { runs: parseExplained(canned), t: newestAt(s, 'think') ?? 0, stale: false } : undefined
}

function draw(sc: Scene, s: Summary, frame: number, t: number, rows = sc.rows.standard, columns = COLUMNS, you?: You, shown?: ReadonlySet<Fact>, worker?: string, ambient = false): Cells {
  const a = ambient ? ambientActivity(s, t) : activity(s, t)
  const cells = decode(sc.draw({ s, a, frame, t, columns, rows, you, palette, shown, worker, plain: ambient ? plainOf(s) : undefined }))
  if (cells.length !== columns * rows * 3) throw new Error(`${sc.id}: ${cells.length / 3} cells, want ${columns * rows}`)
  return cells
}

/** The orchestrator's activity for a still: the offices draw your desk while the worker is live. */
function youFor(sc: Scene, state: string): You | undefined {
  return (sc.id === 'office' || sc.id === 'office-hd') && (state === 'running' || state === 'thinking' || state === 'large') ? YOU_THINKING : undefined
}

/**
 * A demo summary as the pane would have it following this session (docs/DESIGN.md 36): a
 * transcript under its own source (so no demo tag), the session's own Claude model, no model
 * server probed (so no server stats or memory), no hand-off.
 */
function asSession(s: Summary): Summary {
  return { ...s, source: { name: 'this session', path: s.path }, transcript: true, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
}

function still(sc: Scene, state: string, s: Summary, rows = sc.rows.standard, columns = COLUMNS): string {
  const cells = SESSION ? draw(sc, asSession(s), STILL_FRAME, T, rows, columns, undefined, undefined, 'claude') : draw(sc, s, STILL_FRAME, T, rows, columns, youFor(sc, state))
  return svgOpen(rows, columns, `lookout ${sc.id} scene, ${state}${palette.id === 'night' ? '' : `, ${palette.id} palette`}`) + paint(cells, rows, columns, () => true, true) + SVG_CLOSE
}

/**
 * The animation: frame 0 complete, then each later frame as a group of only the cells that changed
 * since the frame before. Group k is hidden for the first k/FRAMES of the cycle and visible after,
 * so at any moment the groups up to the current frame are stacked in order; the cycle repeats.
 */
function animated(sc: Scene, opts: { session?: boolean; title?: string; columns?: number; rows?: number; start?: number; you?: (t0: number) => You; ambient?: boolean } = {}): string {
  const cycle = (FRAMES * FRAME_SECS).toFixed(2)
  const rows = opts.rows ?? sc.rows.standard
  const columns = opts.columns ?? COLUMNS
  let out = svgOpen(rows, columns, opts.title ?? `lookout ${sc.id} scene, animated demo loop`)
  let prev: Cells | null = null
  for (let f = 0; f < FRAMES; f++) {
    const elapsed = (opts.start ?? 0) + f / SAMPLES_PER_SEC
    const t = T + elapsed
    const s = demoSummary(elapsed, t)
    const you = opts.you?.(T + (opts.start ?? 0))
    const cells = opts.session ? draw(sc, asSession(s), f * FRAME_STEP, t, rows, columns, undefined, undefined, 'claude', opts.ambient) : draw(sc, s, f * FRAME_STEP, t, rows, columns, you, undefined, undefined, opts.ambient)
    if (!prev) {
      out += `<g>${paint(cells, rows, columns, () => true, true)}</g>`
    } else {
      const p = prev
      const changed = (i: number) => p[i * 3] !== cells[i * 3] || p[i * 3 + 1] !== cells[i * 3 + 1] || p[i * 3 + 2] !== cells[i * 3 + 2]
      // A text glyph overhangs its cell's right edge by a sliver, so the cell after a changed one
      // that held text is painted again too: else the old glyph's edge stays behind as a stray dot.
      const wasText = (i: number) => halves(p, i)[2] != null && fineMask(p, i) == null
      const body = paint(cells, rows, columns, i => changed(i) || (i % columns > 0 && changed(i - 1) && wasText(i - 1)), false)
      const at = (f / FRAMES).toFixed(6)
      out +=
        `<g visibility="hidden"><animate attributeName="visibility" calcMode="discrete" values="hidden;visible" ` +
        `keyTimes="0;${at}" dur="${cycle}s" repeatCount="indefinite"/>${body}</g>`
    }
    prev = cells
  }
  return out + SVG_CLOSE
}

/** The detailed layout's picture on a wide pane (the wall, docs/DESIGN.md 43.2): the visible default modules, half above the large scene, half below. */
function wall(): string {
  const columns = LARGE_COLUMNS
  const sc = SCENES.find(x => x.id === 'office-hd') ?? SCENES[0]!
  const base: ModuleCtx = { s: RUNNING, a: activity(RUNNING, T), you: YOU_THINKING, frame: STILL_FRAME, t: T, ui: { view: 'fold', scene: sc.id, size: 'large', source: 'worker' }, palette }
  const visible = DEFAULT_ORDER.filter(id => MODULES[id]!.hasData(base))
  // What the pane claims in detailed: the visible modules' facts and the Timeline block below.
  const shown = new Set<Fact>([...factsOf(visible), 'timeline'])
  const ctx: ModuleCtx = { ...base, shown }
  const half = Math.ceil(visible.length / 2)
  const grid = (ids: string[]): { cells: Cells; rows: number } => {
    const packed = packModules(ids, columns, ctx)
    const c = new HiCanvas(columns, packed.rows)
    drawGrid(c, packed, ctx)
    return { cells: decode(c.encode()), rows: packed.rows }
  }
  const top = grid(visible.slice(0, half))
  const mid = { cells: draw(sc, RUNNING, STILL_FRAME, T, sc.rows.large, columns, YOU_THINKING, shown), rows: sc.rows.large }
  const bottom = grid(visible.slice(half))
  const rows = top.rows + mid.rows + bottom.rows
  const cells = new Uint32Array(columns * rows * 3)
  cells.set(top.cells, 0)
  cells.set(mid.cells, top.cells.length)
  cells.set(bottom.cells, top.cells.length + mid.cells.length)
  return svgOpen(rows, columns, 'lookout detailed layout on a wide pane: modules around the large scene') + paint(cells, rows, columns, () => true, true) + SVG_CLOSE
}

/** The showcase's still following this session: the one desk named `claude`, the plain caption (docs/DESIGN.md 36, 39). */
function showcaseSession(): string {
  const sc = SCENES.find(x => x.id === 'office-hd') ?? SCENES[0]!
  const cells = draw(sc, asSession(RUNNING), STILL_FRAME, T, SHOWCASE_ROWS, SHOWCASE_COLUMNS, undefined, undefined, 'claude', true)
  return svgOpen(SHOWCASE_ROWS, SHOWCASE_COLUMNS, 'lookout showcase: office-hd on a tall pane, following this session') + paint(cells, SHOWCASE_ROWS, SHOWCASE_COLUMNS, () => true, true) + SVG_CLOSE
}

/** The showcase's still of the running fixture with you at your desk, for review renders. */
function showcaseStill(): string {
  const sc = SCENES.find(x => x.id === 'office-hd') ?? SCENES[0]!
  const cells = draw(sc, RUNNING, STILL_FRAME, T, SHOWCASE_ROWS, SHOWCASE_COLUMNS, YOU_THINKING, undefined, undefined, true)
  return svgOpen(SHOWCASE_ROWS, SHOWCASE_COLUMNS, 'lookout showcase: office-hd on a tall pane') + paint(cells, SHOWCASE_ROWS, SHOWCASE_COLUMNS, () => true, true) + SVG_CLOSE
}

/** The orchestrator in the showcase's loop: its turn handed the task over and waits on the worker. */
const WAITING_YOU = (t0: number): You => ({ state: 'waiting', since: t0, turns: 3, model: 'claude-opus-5-5' })

mkdirSync(OUT, { recursive: true })
const written: [string, number][] = []
function write(name: string, text: string): void {
  writeFileSync(join(OUT, name), text)
  written.push([name, Buffer.byteLength(text)])
}

const scenes = SCENES.filter(sc => !ONLY || ONLY.includes(sc.id))
if (REVIEW) {
  // Review renders: the stills, the large stills and the wall in one palette.
  usePalette(PALETTES[(PICK ?? 'night') as PaletteId])
  for (const sc of scenes) {
    for (const [state, s] of STATES) write(`${sc.id}-${state}.svg`, still(sc, state, s))
    write(`${sc.id}-large.svg`, still(sc, 'large', RUNNING, sc.rows.large, LARGE_COLUMNS))
  }
  if (!ONLY || ONLY.includes('wall')) write('wall.svg', wall())
  if (!ONLY || ONLY.includes('showcase')) {
    write('showcase-still.svg', showcaseStill())
    write('showcase-session.svg', showcaseSession())
  }
} else {
  for (const sc of scenes) {
    for (const [state, s] of STATES) write(`${sc.id}-${state}.svg`, still(sc, state, s))
    write(`${sc.id}-large.svg`, still(sc, 'large', RUNNING, sc.rows.large, LARGE_COLUMNS))
    write(`${sc.id}.svg`, animated(sc))
  }
  // The README's hero: the office as most people meet it, following the session it sits in.
  const hero = SCENES.find(sc => sc.id === 'office')
  if (hero && (!ONLY || ONLY.includes('office'))) {
    write('hero.svg', animated(hero, { session: true, columns: HERO_COLUMNS, rows: hero.rows.large, start: HERO_START, title: 'lookout: the office scene following this session, animated demo loop' }))
  }
  write('wall.svg', wall())
  // The showcase (docs/DESIGN.md 39): office-hd as the ambient layout draws it on a tall pane.
  const hd = SCENES.find(sc => sc.id === 'office-hd')
  if (hd && (!ONLY || ONLY.includes('office-hd') || ONLY.includes('showcase'))) {
    write('showcase.svg', animated(hd, { columns: SHOWCASE_COLUMNS, rows: SHOWCASE_ROWS, start: HERO_START, you: WAITING_YOU, ambient: true, title: 'lookout showcase: office-hd on a tall pane, animated demo loop' }))
    write('showcase-session.svg', showcaseSession())
  }
  // The office in the other two palettes, for the README (docs/DESIGN.md 27).
  const office = SCENES.find(sc => sc.id === 'office')
  if (office && (!ONLY || ONLY.includes('office'))) {
    for (const id of ['paper', 'phosphor'] as const) {
      usePalette(PALETTES[id])
      write(`office-${id}.svg`, still(office, 'running', RUNNING))
    }
    usePalette(PALETTES.night)
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const total = written.reduce((sum, [, n]) => sum + n, 0)
console.log(
  `render-scenes: wrote ${written.length} files to ${OUT} (${kb(total)}): ` +
    written.map(([name, n]) => `${name} ${kb(n)}`).join(', '),
)
