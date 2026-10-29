import { expect, test } from 'claude-code/testing'

import { activity } from '../hooks/activity.ts'
import { Canvas, NONE, PAPER, luminance, scale as scaleRGB } from '../hooks/canvas.ts'
import type { Rect } from '../hooks/canvas.ts'
import type { Fact } from '../hooks/facts.ts'
import { FLIP_SECS } from '../hooks/memory.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { Palette } from '../hooks/palette.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import { CAT_COLUMNS, OFFICE_ROWS, SLIP_SECS, clockHands, clockPixels, handPixels, office, officePlan, officeSize } from '../hooks/scenes/office.ts'
import type { OfficePlan } from '../hooks/scenes/office.ts'
import { seasonTones } from '../hooks/seasons.ts'
import type { You } from '../hooks/you.ts'
import type { Summary } from '../types'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING, YOU_TOOL, YOU_WAITING } from './fixtures.ts'

const NIGHT = PALETTES.night
const CLASS_COLOR = NIGHT.classes
const ROWS = OFFICE_ROWS.standard
const YOU_SHIRT = 0x9a5a9a
const WORKER_SHIRT = 0x3d7ea6
const SIZES = Object.values(OFFICE_ROWS)
const WIDTHS = [48, 80, 144, 200]

/** The pixels (columns × 2·rows) behind encoded half-block cells; a text cell gives its background. */
function pixels(cells: string, columns: number): Uint32Array {
  const w = words(cells)
  const rows = w.length / 3 / columns
  const px = new Uint32Array(columns * rows * 2)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < columns; x++) {
      const i = (r * columns + x) * 3
      const [cp, fg, bg] = [w[i]!, w[i + 1]!, w[i + 2]!]
      const [top, bot] = cp === 0x2580 ? [fg, bg] : cp === 0x2584 ? [bg, fg] : cp === 0x2588 ? [fg, fg] : [bg, bg]
      px[2 * r * columns + x] = top
      px[(2 * r + 1) * columns + x] = bot
    }
  }
  return px
}

function words(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

/** The colours inside `b` (the inner area, without its frame when `inner`). */
function region(px: Uint32Array, columns: number, b: Rect, inner = false): number[] {
  const d = inner ? 1 : 0
  const out: number[] = []
  for (let y = b.y + d; y < b.y + b.h - d; y++) for (let x = b.x + d; x < b.x + b.w - d; x++) out.push(px[y * columns + x]!)
  return out
}

/** The cells (column, row) where two encoded frames differ. */
function changed(a: string, b: string, columns: number): [number, number][] {
  const A = words(a)
  const B = words(b)
  expect(A.length).toBe(B.length)
  const out: [number, number][] = []
  for (let i = 0; i < A.length / 3; i++) {
    if (A[i * 3] !== B[i * 3] || A[i * 3 + 1] !== B[i * 3 + 1] || A[i * 3 + 2] !== B[i * 3 + 2]) out.push([i % columns, Math.floor(i / columns)])
  }
  return out
}

/** The glyphs of one encoded row. */
function rowText(cells: string, columns: number, row: number): string {
  const w = words(cells)
  let out = ''
  for (let x = 0; x < columns; x++) out += String.fromCodePoint(w[(row * columns + x) * 3]!)
  return out
}

/** Every row's text, joined by newlines. */
function allText(cells: string, columns: number): string {
  const rows = words(cells).length / 3 / columns
  return Array.from({ length: rows }, (_, r) => rowText(cells, columns, r)).join('\n')
}

/** Whether cell (col, row) lies on any pixel of the pixel rectangles `rs` (a cell is 1 × 2 pixels). */
const inside = (rs: (Rect | null)[], col: number, row: number) => rs.some(r => r != null && col >= r.x && col < r.x + r.w && row * 2 + 1 >= r.y && row * 2 < r.y + r.h)

/** The window with the row of lights above it. */
const windowArea = (P: OfficePlan): Rect | null => (P.win ? { ...P.win, y: P.win.y - 1, h: P.win.h + 1 } : null)

type DrawOpts = { columns?: number; rows?: number; frame?: number; you?: You; s?: Summary; t?: number; season?: string; palette?: Palette; transparent?: boolean; shown?: Set<Fact> }

function drawAt(o: DrawOpts = {}): string {
  const s = o.s ?? RUNNING
  const t = o.t ?? T
  return office.draw({ s, a: activity(s, t), frame: o.frame ?? 12, t, columns: o.columns ?? 80, rows: o.rows ?? ROWS, you: o.you, palette: o.palette, transparent: o.transparent, season: o.season ?? 'none', shown: o.shown } as SceneCtx)
}

const pxAt = (o: DrawOpts = {}) => pixels(drawAt(o), o.columns ?? 80)

/** The mean column of the pixels of colour `c` (NaN when there are none). */
function meanX(px: Uint32Array, columns: number, c: number): number {
  let n = 0
  let sum = 0
  for (let i = 0; i < px.length; i++) {
    if (px[i] === c) {
      n++
      sum += i % columns
    }
  }
  return sum / n
}

/** A summary at clock `t`: RUNNING moved there (its last row two seconds before). */
const runningAt = (t: number): Summary => ({ ...RUNNING, mtime: t - 2, last_ts: t - 2, pending: { ...RUNNING.pending!, since: t - 4 } as Summary['pending'] })

// ── Sides, desks and labels (docs/DESIGN.md 33.1)

test('office: you sit on the left and the worker on the right, next to the rack and its stations', () => {
  for (const columns of [80, 100, 144, 200]) {
    const P = officePlan(columns, ROWS, true)
    const px = pxAt({ columns, you: YOU_THINKING })
    expect(meanX(px, columns, YOU_SHIRT) < meanX(px, columns, WORKER_SHIRT)).toBe(true)
    // Your desk, then the stations, the rack, the worker's desk; the worker's monitor faces the rack.
    expect(P.you!.desk.x + P.you!.desk.w < P.stations[0]!.x).toBe(true)
    for (const b of P.stations) expect(b.x + b.w < P.rack.x).toBe(true)
    expect(P.rack.x + P.rack.w < P.worker.desk.x).toBe(true)
    expect(P.worker.mon.x + P.worker.mon.w < P.worker.ax).toBe(true)
  }
  // With no `you` the worker still sits on the right, the stations at the left edge.
  const P = officePlan(80, ROWS, false)
  expect(P.you).toBe(null)
  expect(P.stations[0]!.x).toBe(1)
  expect(meanX(pxAt(), 80, WORKER_SHIRT) > 40).toBe(true)
})

test('office: the labels: you on the left, the rack centred under it, the worker and its ctx right-aligned', () => {
  for (const columns of [80, 100, 144]) {
    const P = officePlan(columns, ROWS, true)
    const cells = drawAt({ columns, you: YOU_THINKING })
    const label = rowText(cells, columns, ROWS - 3)
    const ctx = rowText(cells, columns, ROWS - 2)
    expect(label.startsWith(' you · opus 5')).toBe(true)
    expect(label.trimEnd().endsWith('worker · qwen coder')).toBe(true)
    expect(label.trimEnd().length).toBe(columns - 1)
    expect(ctx.trimEnd().endsWith('ctx 54.2k/131.1k 41%')).toBe(true)
    expect(ctx.trimEnd().length).toBe(columns - 1)
    // The ctx reading sits under the worker's label, nowhere near yours.
    expect(ctx.indexOf('ctx') > label.indexOf('worker') - 2).toBe(true)
    const at = label.indexOf('30 tok/s')
    expect(Math.abs(at + 4 - (P.rack.x + P.rack.w / 2)) <= 1).toBe(true)
  }
})

test('office: following this session the one desk is the worker’s, named by `worker`, the rack names the model, and nobody says you', () => {
  // docs/DESIGN.md 36: `worker: 'claude'`, no `you`, no `orchestrator`; a Claude model, no server.
  const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
  for (const rows of SIZES) {
    for (const columns of WIDTHS) {
      for (const shown of [undefined, new Set<Fact>(['handoff'])]) {
        const cells = office.draw({ s: SESSION, a: activity(SESSION, T), frame: 12, t: T, columns, rows, worker: 'claude', season: 'none', shown } as SceneCtx)
        const P = officePlan(columns, rows, false)
        const label = rowText(cells, columns, P.rows - 3)
        const all = allText(cells, columns)
        // The desk is just `claude`; the rack, standing for the model, names it (one home each),
        // unless the hand-off, the models' home, is claimed.
        expect(label.trimEnd().endsWith(' claude')).toBe(true)
        const models = all.match(/opus 5/g)?.length ?? 0
        if (shown) expect(models).toBe(0)
        else expect(columns >= 80 ? models === 1 : models <= 1).toBe(true)
        if (!shown && columns >= 80) {
          const at = label.indexOf('opus 5')
          expect(Math.abs(at + 3 - (P.rack.x + P.rack.w / 2)) <= 2).toBe(true)
        }
        expect(all.includes('no server')).toBe(false)
        expect(/\byou\b/.test(all)).toBe(false)
        expect(all.includes('worker')).toBe(false)
        expect(new Set(pixels(cells, columns)).has(YOU_SHIRT)).toBe(false)
      }
    }
  }
  // A worker with no server (no name): the rack stays dark over `no server`, the desk names the model.
  const bare = drawAt({ s: { ...RUNNING, server: null } })
  expect(rowText(bare, 80, ROWS - 3).includes('no server')).toBe(true)
  expect(rowText(bare, 80, ROWS - 3).trimEnd().endsWith('qwen coder')).toBe(true)
  // Unnamed and alone, the model says it; beside you, the desk's name leads.
  expect(rowText(drawAt(), 80, ROWS - 3).trimEnd().endsWith(' qwen coder')).toBe(true)
  expect(rowText(drawAt(), 80, ROWS - 3).includes('worker')).toBe(false)
  expect(rowText(drawAt({ you: YOU_THINKING }), 80, ROWS - 3).trimEnd().endsWith('worker · qwen coder')).toBe(true)
})

test('office: following this session the rack’s lights follow the model: busy thinking, calmer on a tool, idle waiting', () => {
  const session = (s: Summary): Summary => ({ ...s, model: 'claude-opus-5-5', server: null, memory: null, handoff: null })
  // Between turns a session waits on its person (docs/DESIGN.md 36).
  const WAITING: Summary = { ...THINKING, pending: { kind: 'user', since: T - 5 } }
  const P = officePlan(80, ROWS, false)
  const lit = (s: Summary, worker?: string) => {
    let n = 0
    for (let frame = 0; frame < 24; frame++) {
      const px = pixels(office.draw({ s, a: activity(s, T), frame, t: T, columns: 80, rows: ROWS, worker, season: 'none' } as SceneCtx), 80)
      for (const v of region(px, 80, P.rack, true)) if (v === NIGHT.good) n++
    }
    return n
  }
  expect(activity(session(THINKING), T).state).toBe('thinking')
  expect(activity(session(WAITING), T).state).toBe('waiting')
  const thinking = lit(session(THINKING), 'claude')
  const tool = lit(session(RUNNING), 'claude')
  expect(thinking > tool && tool > 0).toBe(true)
  expect(lit(session(WAITING), 'claude')).toBe(0)
  // A worker with no server and no name: the rack stays dark.
  expect(lit(session(THINKING))).toBe(0)
})

test('office: nothing reaches the last column, at every size, with or without you', () => {
  const PREFILL: Summary = { ...RUNNING, pending: { kind: 'model', since: T - 1 }, server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } } }
  for (const columns of [48, 60, 80, 100, 144]) {
    for (const rows of SIZES) {
      for (const [name, s] of [['running', RUNNING], ['thinking', THINKING], ['prefill', PREFILL], ['finished', FINISHED], ['failed', FAILED], ['nolog', NOLOG]] as const) {
        for (const you of [undefined, YOU_THINKING, YOU_WAITING]) {
          const cells = office.draw({ s, a: activity(s, T), frame: 12, t: T, columns, rows, you })
          for (let row = 0; row < rows; row++) {
            const last = rowText(cells, columns, row).at(-1)!
            if (/[\p{L}\p{N}…]/u.test(last)) throw new Error(`${name} at ${columns}×${rows}: row ${row} ends in ${last}`)
          }
          const label = rowText(cells, columns, rows - 3)
          if (!officePlan(columns, rows, you != null).you && label.includes('you')) throw new Error(`${name} at ${columns}: a you label without its desk`)
        }
      }
    }
  }
})

test('office: claimed facts drop the station counts, the tok/s and the ctx reading, and keep the pictures', () => {
  const plain = drawAt({ you: YOU_THINKING })
  const text = allText(plain, 80)
  for (const s of ['read 14', 'edit 7', '30 tok/s', 'ctx 54.2k']) expect(text).toContain(s)
  const shown = new Set<Fact>(['tools', 'decode', 'ctx'])
  const claimedCells = drawAt({ you: YOU_THINKING, shown })
  const claimed = allText(claimedCells, 80)
  for (const s of ['read 14', 'edit 7', '$ 9', 'tok/s', 'ctx']) expect(claimed.includes(s)).toBe(false)
  expect(claimed).toContain('files')
  expect(claimed).toContain('edit')
  expect(claimed).toContain('mlx-serve') // the adapter in the rack's place
  // Only the text changed: every pixel is the same.
  expect(Array.from(pixels(claimedCells, 80))).toEqual(Array.from(pixels(plain, 80)))
  // The hand-off claims the models: the desks keep only who sits there.
  const handoff = drawAt({ you: YOU_THINKING, shown: new Set<Fact>(['handoff']) })
  const label = rowText(handoff, 80, ROWS - 3)
  expect(label.startsWith(' you ')).toBe(true)
  expect(label.trimEnd().endsWith(' worker')).toBe(true)
  for (const s of ['opus', 'qwen']) expect(label.includes(s)).toBe(false)
  expect(label).toContain('30 tok/s')
  expect(rowText(handoff, 80, ROWS - 2).trimEnd().endsWith('ctx 54.2k/131.1k 41%')).toBe(true)
  expect(rowText(drawAt({ shown: new Set<Fact>(['handoff']) }), 80, ROWS - 3).trimEnd().endsWith(' worker')).toBe(true)
  // One at a time.
  expect(allText(drawAt({ shown: new Set<Fact>(['tools']) }), 80)).toContain('30 tok/s')
  expect(allText(drawAt({ shown: new Set<Fact>(['decode']) }), 80)).toContain('read 14')
})

// ── The wall clock

test('office: the wall clock shows the local hour and minute with two hands', () => {
  const at = (h: number, m: number) => new Date(2026, 8, 21, h, m).getTime() / 1000
  const q = clockHands(at(3, 0))
  expect(Math.abs(q.minute)).toBe(0)
  expect(Math.abs(q.hour - Math.PI / 2) < 1e-9).toBe(true)
  const h = clockHands(at(6, 30))
  expect(Math.abs(h.minute - Math.PI) < 1e-9).toBe(true)
  expect(Math.abs(h.hour - (6.5 / 12) * 2 * Math.PI) < 1e-9).toBe(true)
  // A hand is an unbroken line from the centre.
  for (let a = 0; a < 2 * Math.PI; a += 0.1) {
    let [px, py] = [10, 10]
    for (const [x, y] of handPixels(10, 10, a, 3.4)) {
      expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1)
      ;[px, py] = [x, y]
    }
  }
  for (const rows of [ROWS, OFFICE_ROWS.large]) {
    const P = officePlan(80, rows, true)
    const c = P.clock!
    const r = (c.w - 1) / 2
    for (const [hh, mm] of [[3, 0], [9, 15], [9, 45], [12, 0], [12, 30], [6, 30]] as const) {
      const t = at(hh, mm)
      const px = pxAt({ rows, t, s: runningAt(t), you: YOU_THINKING })
      const hands = clockPixels(c.x + r, c.y + r, r, t)
      const minute = new Set(hands.minute.map(([x, y]) => px[y * 80 + x]))
      const hour = new Set(hands.hour.filter(([x, y]) => !hands.minute.some(([a, b]) => a === x && b === y)).map(([x, y]) => px[y * 80 + x]))
      // Two hands in two tones, the hour hand shorter, a red pip between them.
      expect([...minute]).toEqual([0x14121c])
      expect(hour.size).toBe(1)
      expect(hour.has(0x14121c)).toBe(false)
      expect(hands.hour.length < hands.minute.length).toBe(true)
      expect(px[(c.y + r) * 80 + c.x + r]).toBe(NIGHT.bad)
      // Never one straight bar: the hour hand's pixels never all lie on the minute hand's line.
      const [mx, my] = hands.minute.at(-1)!
      const onLine = hands.hour.every(([x, y]) => (x - c.x - r) * (my - c.y - r) === (y - c.y - r) * (mx - c.x - r))
      expect(onLine).toBe(false)
    }
    // Another time, another face.
    const a = region(pxAt({ rows, t: at(3, 0), s: runningAt(at(3, 0)) }), 80, c)
    const b = region(pxAt({ rows, t: at(9, 45), s: runningAt(at(9, 45)) }), 80, c)
    expect(a).not.toEqual(b)
  }
})

test('office: the clock reads in every palette: dark hands on a light face', () => {
  const t = new Date(2026, 8, 21, 4, 40).getTime() / 1000
  for (const p of Object.values(PALETTES)) {
    const P = officePlan(80, ROWS, true)
    const c = P.clock!
    const r = (c.w - 1) / 2
    const px = pxAt({ palette: p, t, s: runningAt(t), you: YOU_THINKING })
    const face = px[(c.y + 1) * 80 + c.x + r - 1]!
    const [hx, hy] = clockPixels(c.x + r, c.y + r, r, t).minute.at(-1)!
    const hand = px[hy * 80 + hx]!
    expect(luminance(face) - luminance(hand) > 0.4).toBe(true)
  }
})

// ── Run memory (docs/DESIGN.md 32): each object appears with its memory and only then

const MUG = (p: Palette) => {
  // The mug's body: a light shade of the worker's shirt (hooks/scenes/office.ts).
  const px = pxAt({ palette: p, s: { ...RUNNING, turns: 50 }, columns: 144 })
  const g = officePlan(144, ROWS, false).mugs[0]!
  return px[(g.y) * 144 + g.x]!
}

test('office: mugs on the worker desk, one per ten turns, as many as the desk holds', () => {
  const columns = 144
  const P = officePlan(columns, ROWS, false)
  expect(P.mugs.length).toBe(5)
  const mug = MUG(NIGHT)
  const count = (turns: number) => {
    const px = pxAt({ columns, s: { ...RUNNING, turns } })
    return P.mugs.filter(g => px[g.y * columns + g.x] === mug).length
  }
  expect(count(0)).toBe(0)
  expect(count(9)).toBe(0)
  expect(count(10)).toBe(1)
  expect(count(35)).toBe(3)
  expect(count(400)).toBe(5)
  // Mugs sit on the desk, left of the paper stack and the monitor.
  for (const g of P.mugs) {
    expect(g.y + g.h).toBe(P.worker.desk.y)
    expect(g.x >= P.worker.desk.x && g.x + g.w <= P.pages!.x).toBe(true)
  }
})

test('office: the paper stack grows with the edits, beside the worker monitor', () => {
  const columns = 100
  const P = officePlan(columns, ROWS, true)
  const g = P.pages!
  expect(g.x + g.w < P.worker.mon.x).toBe(true)
  const sheets = (tool_counts: [string, number][]) => {
    const px = pxAt({ columns, you: YOU_THINKING, s: { ...RUNNING, tool_counts } })
    return region(px, columns, g).filter(c => c !== NONE).length / g.w
  }
  expect(sheets([['Read', 3]])).toBe(0)
  expect(sheets([['Edit', 1]])).toBe(1)
  expect(sheets([['Edit', 6], ['Write', 1]])).toBe(3) // 7 edits: 1 + floor(log2 7)
  expect(sheets([['Edit', 500]])).toBe(6)
})

test('office: the bin by the chair fills with crumpled paper, overflowing at nine', () => {
  const columns = 100
  const P = officePlan(columns, ROWS, true)
  const b = P.bin!
  expect(b.x > P.worker.ax + 3).toBe(true) // right of the chair back
  expect(b.x + b.w <= columns - 1).toBe(true)
  const at = (errors: number, denials = 0) => region(pxAt({ columns, you: YOU_THINKING, s: { ...RUNNING, errors, denials } }), columns, b)
  expect(at(0).every(c => c === NONE)).toBe(true) // no empty bin
  const one = at(1)
  expect(one.includes(NIGHT.rack)).toBe(true)
  const lit = (cs: number[]) => cs.filter(c => c !== NONE).length
  expect(lit(at(4)) > lit(one)).toBe(true)
  expect(lit(at(3, 1))).toBe(lit(at(4))) // denials count too
  expect(lit(at(9)) > lit(at(8))).toBe(true) // the overflow ball
  expect(lit(at(50))).toBe(lit(at(9)))
})

test('office: red sticky notes on the worker monitor, one per failing test, at most four', () => {
  const P = officePlan(80, ROWS, true)
  expect(P.notes.length).toBe(4)
  const notes = (failed: number) => {
    const px = pxAt({ you: YOU_THINKING, s: { ...RUNNING, tests: [{ t: T - 100, failed, passed: 3, total: 3 + failed }] } })
    return P.notes.filter(g => px[g.y * 80 + g.x] === NIGHT.bad).length
  }
  expect(notes(0)).toBe(0)
  expect(notes(1)).toBe(1)
  expect(notes(3)).toBe(3)
  expect(notes(9)).toBe(4)
  // On the bezel: each spot touches the monitor's frame.
  const m = P.worker.mon
  for (const g of P.notes) expect(g.x === m.x || g.y === m.y || g.x + g.w === m.x + m.w).toBe(true)
})

test('office: commit parcels on the rack top, one per commit', () => {
  const columns = 200
  const P = officePlan(columns, ROWS, true)
  expect(P.parcels.length).toBe(6)
  for (const g of P.parcels) {
    expect(g.y + g.h).toBe(P.rack.y)
    expect(g.x > P.rack.x && g.x + g.w < P.rack.x + P.rack.w).toBe(true)
  }
  const parcels = (n: number) => {
    const commits = Array.from({ length: n }, (_, i) => ({ hash: `c${i}`, t: T - 2000 + i, subject: 'x', stat: '' }))
    const px = pxAt({ columns, you: YOU_THINKING, s: { ...RUNNING, git: { ...RUNNING.git!, commits } } })
    return P.parcels.filter(g => px[(g.y + 1) * columns + g.x] === NIGHT.deskTop).length
  }
  expect(parcels(0)).toBe(0)
  expect(parcels(2)).toBe(2)
  expect(parcels(20)).toBe(6)
})

/** Test runs: `marks` as pass (true) or fail, a minute apart, the newest `ago` seconds before T. */
const runs = (marks: boolean[], ago = 100) => marks.map((ok, i) => ({ t: T - ago - (marks.length - 1 - i) * 60, failed: ok ? 0 : 2, passed: 8, total: ok ? 8 : 10 }))

test('office: the tally board: large, and standard from 100 columns; one mark per run, oldest left, a star after a flip', () => {
  expect(officePlan(80, ROWS, true).board).toBe(null)
  expect(officePlan(80, OFFICE_ROWS.compact, true).board).toBe(null)
  expect(officePlan(100, ROWS, true).board).not.toBe(null)
  for (const [columns, rows] of [[80, OFFICE_ROWS.large], [144, OFFICE_ROWS.large], [144, ROWS]] as const) {
    const P = officePlan(columns, rows, true)
    const b = P.board!
    const draw = (tests: Summary['tests']) => pxAt({ columns, rows, you: YOU_THINKING, s: { ...RUNNING, tests } })
    // No blank board.
    expect(region(draw([]), columns, b).every(c => c === NONE)).toBe(true)
    const marks = [false, true, false, false]
    const px = draw(runs(marks))
    const y = b.y + 2
    marks.forEach((ok, i) => expect(px[y * columns + b.x + 2 + i * 2]).toBe(ok ? NIGHT.good : NIGHT.bad))
    // A red → green flip puts the gold star on the corner; never red → never a star.
    const star = (p: Uint32Array) => p[b.y * columns + b.x + b.w - 1] === NIGHT.warn
    expect(star(px)).toBe(true)
    expect(star(draw(runs([false, false])))).toBe(false)
    expect(star(draw(runs([true, true])))).toBe(false)
    // More runs than marks: the newest are kept.
    const many = Array.from({ length: P.boardMarks + 3 }, (_, i) => i % 2 === 0)
    const pm = draw(runs(many))
    expect(pm[y * columns + b.x + 2 + (P.boardMarks - 1) * 2]).toBe(many.at(-1) ? NIGHT.good : NIGHT.bad)
  }
})

test('office: the celebration: arms up on alternating frames, the notes fall away after the flip', () => {
  const P = officePlan(80, ROWS, true)
  const flipT = T - 1
  const tests = [{ t: T - 600, failed: 3, passed: 8, total: 11 }, { t: flipT, failed: 0, passed: 11, total: 11 }]
  const s: Summary = { ...RUNNING, pending: { kind: 'model', since: T - 3 }, tests }
  const { ax } = P.worker
  const ay = P.worker.desk.y - 1
  const skin = 0xe0b48a
  const hand = (age: number, frame: number) => pxAt({ s, t: flipT + age, frame, you: YOU_THINKING })[(ay - 6) * 80 + ax - 2]
  expect(hand(2, 0)).toBe(skin) // both arms up
  expect(hand(2, 3)).not.toBe(skin) // out in a V
  expect(pxAt({ s, t: flipT + 2, frame: 0, you: YOU_THINKING })[(ay - 6) * 80 + ax + 3]).toBe(skin)
  // Not celebrating once FLIP_SECS have passed: no arms.
  expect(hand(FLIP_SECS + 1, 0)).not.toBe(skin)
  // The three notes of the failing run sit on the bezel at the flip, fall, and are gone.
  const red = (age: number) => {
    const px = pxAt({ s, t: flipT + age, frame: 0, you: YOU_THINKING })
    return region(px, 80, { x: P.worker.mon.x, y: P.worker.mon.y, w: P.worker.mon.w, h: P.worker.desk.y - P.worker.mon.y }).filter(c => c === NIGHT.bad).length
  }
  expect(red(0)).toBe(3 * 3) // three notes of three red pixels (a curled corner each)
  const notesAt = (age: number) => P.notes.slice(0, 3).filter(g => pxAt({ s, t: flipT + age, frame: 0, you: YOU_THINKING })[g.y * 80 + g.x] === NIGHT.bad).length
  expect(notesAt(0)).toBe(3)
  expect(notesAt(0.8) < 3).toBe(true)
  expect(red(5)).toBe(0)
})

test('office: at done a printed slip travels back to your desk and rests there, stamped', () => {
  const P = officePlan(80, ROWS, true)
  const floorY = P.floorY
  const slipOnFloor = (px: Uint32Array) => {
    for (let x = 0; x < 80; x++) if (px[(floorY - 1) * 80 + x] === PAPER && px[floorY * 80 + x] === PAPER) return x
    return -1
  }
  const m = FINISHED.mtime!
  const early = slipOnFloor(pxAt({ s: FINISHED, t: m + SLIP_SECS * 0.2, you: YOU_WAITING }))
  const later = slipOnFloor(pxAt({ s: FINISHED, t: m + SLIP_SECS * 0.7, you: YOU_WAITING }))
  expect(early > later && later >= 0).toBe(true) // right to left
  const rest = pxAt({ s: FINISHED, t: m + 30, you: YOU_WAITING })
  expect(slipOnFloor(rest)).toBe(-1)
  const g = P.slip
  expect(g.x >= P.you!.desk.x && g.x + g.w <= P.you!.desk.x + P.you!.desk.w).toBe(true)
  expect(region(rest, 80, g).filter(c => c === PAPER).length).toBe(5)
  expect(rest[g.y * 80 + g.x + 2]).toBe(NIGHT.good)
  expect(pxAt({ s: FAILED, you: YOU_WAITING })[g.y * 80 + g.x + 2]).toBe(NIGHT.bad)
  // Pure: the same clock gives the same picture, whatever was drawn before.
  expect(drawAt({ s: FINISHED, t: m + 0.5, you: YOU_WAITING })).toBe(drawAt({ s: FINISHED, t: m + 0.5, you: YOU_WAITING }))
  // Not before the end.
  expect(region(pxAt({ you: YOU_WAITING }), 80, g).filter(c => c === PAPER).length).toBe(0)
  // Without your desk the slip lies on the worker's.
  const noYou = officePlan(80, ROWS, false)
  expect(pxAt({ s: FINISHED })[noYou.slip.y * 80 + noYou.slip.x + 2]).toBe(NIGHT.good)
})

// ── Sizes (docs/DESIGN.md 33.1)

test('office: three real sizes, and any height in between padded above the nearest one below', () => {
  expect(office.rows).toEqual({ compact: 10, standard: 15, large: 22 })
  expect([10, 12, 14, 15, 18, 21, 22, 40].map(officeSize)).toEqual(['compact', 'compact', 'compact', 'standard', 'standard', 'standard', 'large', 'large'])
  for (const rows of SIZES) expect(words(drawAt({ rows })).length).toBe(80 * rows * 3)
  // Compact: the desks and the rack, nothing on the wall.
  const C = officePlan(80, OFFICE_ROWS.compact, true)
  expect([C.win, C.clock, C.board, C.strip, C.trayY]).toEqual([null, null, null, null, null])
  expect(C.you).not.toBe(null)
  // Large: the window, the clock and the board side by side on a taller wall, above the tray.
  const L = officePlan(80, OFFICE_ROWS.large, true)
  const [b, c, w] = [L.board!, L.clock!, L.win!]
  expect(b.x + b.w < c.x && c.x + c.w < w.x).toBe(true)
  for (const r of [b, c, w]) expect(r.y + r.h < L.trayY!).toBe(true)
  // In between: the native picture at the bottom, wall above it.
  for (const [rows, native] of [[12, 10], [17, 15], [30, 22]] as const) {
    const tall = drawAt({ rows, you: YOU_THINKING })
    const base = drawAt({ rows: native, you: YOU_THINKING })
    expect(tall.endsWith(base.slice(-200))).toBe(true)
    expect(Array.from(words(tall).slice((rows - native) * 80 * 3))).toEqual(Array.from(words(base)))
  }
})

test('office: nothing is drawn past the canvas, at every size, width and palette', () => {
  const proto = Canvas.prototype as unknown as { set(x: number, y: number, c: number): void; text(col: number, row: number, s: string, fg: number): void }
  const set = proto.set
  const text = proto.text
  const past: string[] = []
  proto.set = function (this: Canvas, x: number, y: number, c: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) past.push(`pixel ${x},${y}`)
    set.call(this, x, y, c)
  }
  proto.text = function (this: Canvas, col: number, row: number, s: string, fg: number) {
    if (col < 0 || row < 0 || row >= this.rows || col + [...s].length > this.columns) past.push(`text ${JSON.stringify(s)} at ${col},${row}`)
    text.call(this, col, row, s, fg)
  }
  try {
    const flipT = T - 2
    const CELEB: Summary = { ...RUNNING, tests: [{ t: T - 600, failed: 9, passed: 2, total: 11 }, { t: flipT, failed: 0, passed: 11, total: 11 }] }
    const FULL: Summary = { ...RUNNING, turns: 99, errors: 20, tool_counts: [['Edit', 300]], tests: runs(Array.from({ length: 14 }, (_, i) => i % 3 === 0)), git: { ...RUNNING.git!, commits: Array.from({ length: 9 }, (_, i) => ({ hash: `c${i}`, t: T - 900 + i, subject: 'x', stat: '' })) } }
    for (const p of Object.values(PALETTES)) {
      for (const rows of SIZES) {
        for (const columns of WIDTHS) {
          for (const [name, s, t] of [['running', RUNNING, T], ['thinking', THINKING, T], ['full', FULL, T], ['celebrating', CELEB, flipT + 0.5], ['finished', FINISHED, FINISHED.mtime! + 0.5], ['failed', FAILED, T], ['nolog', NOLOG, T]] as const) {
            for (const you of [undefined, YOU_THINKING, YOU_TOOL, { ...YOU_WAITING, lastHandoff: T }]) {
              for (const frame of [0, 3, 12]) {
                past.length = 0
                office.draw({ s, a: activity(s, t), frame, t, columns, rows, you, palette: p, season: 'winter' } as SceneCtx)
                if (past.length) throw new Error(`${p.id} ${name} at ${columns}×${rows}, frame ${frame}: ${past.slice(0, 3).join('; ')}`)
              }
            }
          }
        }
      }
    }
  } finally {
    proto.set = set
    proto.text = text
  }
})

/** The objects of a plan as rectangles that may not overlap (labels and figures included where they reach). */
function objects(P: OfficePlan, columns: number, done: boolean): [string, Rect][] {
  const out: [string, Rect][] = []
  const add = (name: string, r: Rect | null | undefined) => {
    if (r) out.push([name, r])
  }
  const { desk, mon, ax } = P.worker
  if (P.you) {
    // Your desk with its figure, monitor, headset and the bubble above.
    const d = P.you.desk
    const top = P.size === 'compact' ? 9 : 11 // the headset, or the bubble above it
    add('you', { x: d.x, y: d.y - top, w: d.w, h: top + 4 })
  }
  P.stations.forEach((b, i) => add(`station ${i}`, { x: b.x, y: b.y, w: b.w + GAP - 1, h: b.h + 2 }))
  add('rack', { x: P.rack.x, y: P.rack.y - 2, w: P.rack.w, h: P.rack.h + 2 })
  add('desk', { x: desk.x, y: desk.y, w: desk.w, h: 4 })
  add('monitor', { x: mon.x - 1, y: mon.y, w: mon.w + 1, h: mon.h + 1 })
  const top = P.size === 'compact' ? 8 : 10 // the hair, or the thought above it
  add('worker', { x: ax - 5, y: desk.y - top, w: 9, h: top })
  P.mugs.forEach((g, i) => add(`mug ${i}`, g))
  add('pages', P.pages)
  add('bin', P.bin)
  add('window', windowArea(P))
  add('clock', P.clock)
  add('board', P.board ? { x: P.board.x, y: P.board.y - 1, w: P.board.w + 1, h: P.board.h + 1 } : null)
  add('cat', done ? P.catDone?.box : P.cat?.box)
  if (P.strip) for (const x of P.strip.xs) add(`strip ${x}`, { x, y: P.strip.y, w: 1, h: 1 })
  for (const [name, r] of out) if (r.x < 0 || r.y < 0 || r.x + r.w > columns - 1 || r.y + r.h > P.rows * 2) throw new Error(`${name} past the canvas at ${columns}: ${JSON.stringify(r)}`)
  return out
}
const GAP = 2

test('office: no two objects overlap at any width from 48 to 200, at every size', () => {
  const meet = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (const rows of SIZES) {
    for (let columns = 48; columns <= 200; columns++) {
      for (const withYou of [false, true]) {
        const P = officePlan(columns, rows, withYou)
        for (const done of [false, true]) {
          const objs = objects(P, columns, done)
          for (let i = 0; i < objs.length; i++) {
            for (let j = i + 1; j < objs.length; j++) {
              const [an, a] = objs[i]!
              const [bn, b] = objs[j]!
              // Stations' own label rows are allowed to reach under the next box's label; never into another object.
              if (an.startsWith('station') && bn.startsWith('station')) continue
              if (meet(a, b)) throw new Error(`${an} and ${bn} overlap at ${columns}×${rows}${withYou ? ' with you' : ''}${done ? ', done' : ''}: ${JSON.stringify(a)} ${JSON.stringify(b)}`)
            }
          }
        }
        // Narrow still draws the essentials.
        expect(P.stations.length >= 2 && P.rack.w >= 6 && P.worker.mon.w >= 8).toBe(true)
      }
    }
  }
})

// ── The cat, the seasons, the palettes (docs/DESIGN.md 27, 28)

test('office: the cat sleeps by the worker desk while thinking, sits up facing the rack during a tool call, and takes the shelf once done', () => {
  const p = NIGHT
  for (const columns of [76, 80, 100, 144, 200]) {
    const P = officePlan(columns, ROWS, false)
    const spot = P.cat!
    // In the gap between the rack and the desk, a pixel clear of the rack, standing on the floor.
    expect(spot.box.x > P.rack.x + P.rack.w).toBe(true)
    expect(spot.box.x + spot.box.w <= P.worker.desk.x).toBe(true)
    expect(spot.box.y + spot.box.h).toBe(P.floorY)
    const sit = region(pxAt({ columns }), columns, spot.box)
    const nap = region(pxAt({ columns, s: THINKING }), columns, spot.box)
    expect(sit.includes(p.ink)).toBe(true) // eyes open
    expect(nap.includes(p.inkDim)).toBe(true)
    expect(nap.includes(p.ink)).toBe(false) // asleep
    // Done: on a shelf continuing the desk toward the rack.
    const shelf = P.catDone!.shelf!
    expect(shelf.x + shelf.w).toBe(P.worker.desk.x)
    const done = pxAt({ columns, s: FINISHED })
    expect(region(done, columns, shelf).every(c => c === scaleRGB(p.desk, 0.5))).toBe(true)
    expect(region(done, columns, P.catDone!.box).includes(scaleRGB(p.inkDim, 0.5))).toBe(true)
  }
  for (let columns = 48; columns < CAT_COLUMNS; columns++) expect(officePlan(columns, ROWS, true).cat).toBe(null)
  for (let columns = CAT_COLUMNS; columns <= 200; columns++) expect(officePlan(columns, ROWS, true).cat).not.toBe(null)
})

test('office: seasons and holidays change only the window, the lights row and the pumpkin spot', () => {
  const at = (m: number, d: number, h = 12, s = 0) => new Date(2026, m - 1, d, h, 0, s).getTime() / 1000
  const times = [T, at(7, 15), at(7, 15, 2), at(10, 31), at(12, 24), new Date(2027, 0, 1, 0, 0, 4).getTime() / 1000]
  for (const columns of [60, 80, 100]) {
    const P = officePlan(columns, ROWS, true)
    for (const t of times) {
      const s = runningAt(t)
      const none = drawAt({ columns, t, s, season: 'none', you: YOU_WAITING })
      for (const season of ['auto', 'winter', 'spring', 'summer', 'autumn']) {
        const cells = changed(none, drawAt({ columns, t, s, season, you: YOU_WAITING }), columns)
        for (const [x, y] of cells) if (!inside([windowArea(P), P.pumpkin], x, y)) throw new Error(`${season} at ${columns}, ${new Date(t * 1000)}: cell ${x},${y}`)
      }
    }
  }
})

test('office: the holidays draw a pumpkin in the first mug place, three lights and a firework', () => {
  const S = seasonTones(NIGHT)
  const P = officePlan(80, ROWS, true)
  const draw1 = (t: number, frame = 0) => pxAt({ t, frame, s: runningAt(t), season: 'auto', you: YOU_WAITING })
  const halloween = region(draw1(new Date(2026, 9, 31, 12).getTime() / 1000), 80, P.pumpkin!)
  expect(halloween.includes(S.pumpkin[0])).toBe(true)
  expect(halloween.includes(S.pumpkin[2])).toBe(true)
  const w = P.win!
  const lights = draw1(new Date(2026, 11, 24, 21).getTime() / 1000)
  const above = region(lights, 80, { x: w.x, y: w.y - 1, w: w.w, h: 1 })
  expect(above.includes(S.lights[0]!)).toBe(true) // the first is lit at frame 0
  expect(above.filter(c => c === S.wire).length >= 3).toBe(true)
  const fw = region(draw1(new Date(2027, 0, 1, 0, 0, 3).getTime() / 1000), 80, w, true)
  expect(S.sparks.filter(c => fw.includes(c)).length >= 2).toBe(true)
  const winter = region(pxAt({ season: 'winter', you: YOU_WAITING }), 80, { x: w.x, y: w.y + w.h - 1, w: w.w, h: 1 })
  expect(winter.every(c => c === S.sill)).toBe(true) // a snowy sill
})

test('office: paper and phosphor draw the room, the cat and the memory from their roles', () => {
  const FULL: Summary = { ...RUNNING, turns: 40, errors: 4 }
  for (const id of ['paper', 'phosphor'] as const) {
    const p = PALETTES[id]
    const P = officePlan(100, ROWS, true)
    const px = pxAt({ columns: 100, palette: p, transparent: false, s: FULL, you: YOU_THINKING })
    const box = region(px, 100, P.cat!.box)
    expect(box.includes(p.inkDim)).toBe(true)
    expect(box.includes(p.ink)).toBe(true)
    expect(px.includes(p.desk)).toBe(true)
    expect(px.includes(p.mon)).toBe(true)
    expect(region(px, 100, P.bin!).includes(p.rack)).toBe(true)
    // Nothing of the night look is left: no night-only role colour appears.
    for (const c of [NIGHT.desk, NIGHT.mon, NIGHT.sky, NIGHT.rack]) expect(px.includes(c)).toBe(false)
  }
  // The paper stack reads on a light wall: its sheets alternate with a clearly darker tone.
  const P = officePlan(100, ROWS, true)
  const stack = region(pxAt({ columns: 100, palette: PALETTES.paper, s: { ...RUNNING, tool_counts: [['Edit', 40]] }, you: YOU_THINKING }), 100, P.pages!).filter(c => c !== NONE)
  const lum = stack.map(luminance)
  expect(Math.max(...lum) - Math.min(...lum) > 0.2).toBe(true)
})

// ── You (docs/DESIGN.md 17)

test('office: a thinking orchestrator lights its own monitor and shows the … bubble', () => {
  const g = officePlan(80, ROWS, true).you!
  const think = pxAt({ you: YOU_THINKING })
  const idle = pxAt({ you: { ...YOU_THINKING, state: 'idle' } })
  const lit = (px: Uint32Array) => region(px, 80, g.mon, true).filter(c => c !== 0x0a0f14 && c !== NONE).length
  expect(lit(idle)).toBe(0)
  expect(lit(think) > 0).toBe(true)
  // Three PAPER pixels, one apart, above the head.
  const y = g.desk.y - 11
  for (const dx of [1, 3, 5]) expect(think[y * 80 + g.ax + dx]).toBe(PAPER)
  expect(idle[y * 80 + g.ax + 1]).not.toBe(PAPER)
})

test('office: a tool call tints the orchestrator monitor with the class colour', () => {
  const g = officePlan(80, ROWS, true).you!
  expect(YOU_TOOL.cls).toBe('shell')
  expect(region(pxAt({ you: YOU_TOOL }), 80, g.mon, true).includes(CLASS_COLOR.shell)).toBe(true)
})

test('office: a waiting orchestrator blinks one cursor pixel on a 12-frame period', () => {
  const g = officePlan(80, ROWS, true).you!
  const on = region(pxAt({ frame: 0, you: YOU_WAITING }), 80, g.mon, true)
  const off = region(pxAt({ frame: 6, you: YOU_WAITING }), 80, g.mon, true)
  expect(on.filter((c, i) => c !== off[i]).length).toBe(1)
  expect(region(pxAt({ frame: 12, you: YOU_WAITING }), 80, g.mon, true)).toEqual(on)
})

test('office: too narrow for your desk, a silhouette sits at the far left', () => {
  for (const columns of [48, 56, 60, 64]) {
    const P = officePlan(columns, ROWS, true)
    expect(P.you).toBe(null)
    expect(P.silhouette).toBe(true)
    const px = pxAt({ columns, you: YOU_THINKING })
    let shirt = 0
    for (let y = 0; y < px.length / columns; y++) for (let x = 0; x < 3; x++) if (px[y * columns + x] === YOU_SHIRT) shirt++
    expect(shirt >= 10).toBe(true)
    expect(rowText(drawAt({ columns, you: YOU_THINKING }), columns, ROWS - 3).includes('opus')).toBe(false)
  }
  for (let columns = 65; columns <= 200; columns++) expect(officePlan(columns, ROWS, true).you).not.toBe(null)
})

test('office: a new hand-off slides a sheet left to right along the floor, then rests it on the worker desk', () => {
  const P = officePlan(80, ROWS, true)
  const floorY = P.floorY
  const you = { ...YOU_WAITING, lastHandoff: T + 12_345 }
  const sheetX = (px: Uint32Array) => {
    for (let x = 0; x < 80; x++) if (px[floorY * 80 + x] === PAPER && px[(floorY - 1) * 80 + x] === PAPER) return x
    return -1
  }
  const one = sheetX(pxAt({ frame: 1, you }))
  const five = sheetX(pxAt({ frame: 5, you }))
  expect(one >= 0 && five >= 0).toBe(true)
  expect(five > one).toBe(true)
  // Arrived: off the floor and on the worker's desk, and it stays there.
  const rest = pxAt({ frame: 9, you })
  expect(sheetX(rest)).toBe(-1)
  expect(region(rest, 80, P.sheet).every(c => c === PAPER)).toBe(true)
  expect(pxAt({ frame: 40, you }).filter(c => c === PAPER).length).toBe(rest.filter(c => c === PAPER).length)
})

test('office: a station whose class has not run is off: a dark face, no icon', () => {
  // RUNNING at 144 columns shows six stations; web and agent have 0 calls.
  const columns = 144
  const P = officePlan(columns, ROWS, false)
  const px = pxAt({ columns })
  const box = (cls: string): Rect => P.stations[P.classes.indexOf(cls as never)]!
  for (const cls of ['web', 'agent']) {
    const b = box(cls)
    const face = region(px, columns, { x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2 })
    expect(face.every(c => c === 0x08090c)).toBe(true)
  }
  const lit = box('edit')
  expect(new Set(region(px, columns, { x: lit.x + 1, y: lit.y + 1, w: lit.w - 2, h: lit.h - 2 })).size > 1).toBe(true)
})
