// Scene "office" (compact 10, standard 15, large 22 rows; any height from 10): you at your desk on
// the left, the tool stations and the model server's rack in the middle, the worker at its desk on
// the right facing them, a ceiling cable tray between, and packets travelling the cables for
// whatever is happening now (docs/DESIGN.md 6.2, 17, 33.1). The window follows the season and the
// holidays, a wall clock tells the local time, a cat keeps the worker company (28), and the room
// keeps what the run has been through: mugs, a paper stack, a bin, sticky notes, a test tally,
// commit parcels and the printed slip at the end (32). Every colour is a palette role or a shade of
// one (27). A fact something else in the pane spells out loses its text here, never its picture (31).
// With ambience on (42) the room keeps a few slow loops that mean nothing: a skyline with its lit
// windows, a plane light, rain or fireflies in the window, string lights along the top of the wall,
// a lamplight pool breathing on the worker's desk, steam curling off the newest mug, the cat's
// breath, and dust in the daylight; off, the office draws exactly as before.
//
// Layout is planned per width and size in `officePlan`, left to right: a one-column margin, your
// desk (a silhouette on narrow), the stations, the rack, the cat's gap, the worker's desk (its free
// end with the mugs and the paper stack, the monitor, the worker, the chair), the bin, a one-column
// margin. Width goes first to what every office needs; your desk, the paper stack, a mug and the
// bin come next, then more mugs, then wider stations, so a narrow pane drops objects instead of
// overlapping them.
import type { ToolClass } from '../../types'
import { classCounts, ctxLimitOf, decodeTps, fmtDur, isDemo, k } from '../activity.ts'
import { ambient, ambientTones, bulbLevel, dustMotes, dusty, lampLevel, steamPuffs, strand, windowFar, windowLook, windowNear } from '../ambience.ts'
import type { Put } from '../ambience.ts'
import { Canvas, NONE, cable, cut, frameRect, hash, layout, mix, ramp, rect, scale } from '../canvas.ts'
import type { RGB, Rect } from '../canvas.ts'
import { CAT_H, CAT_W, catAmbient, catPose, catSprite } from '../cat.ts'
import { claimed } from '../facts.ts'
import { MAX_MUGS, MAX_PAGES, MAX_RUNS, memoryOf } from '../memory.ts'
import type { RunMemory } from '../memory.ts'
import { fade, labelIn, paletteOf, perPalette, shade } from '../palette.ts'
import type { Palette, Role } from '../palette.ts'
import { holidayOf, isDay, litLight, seasonOf, seasonTones, weather } from '../seasons.ts'
import { blit } from '../sprite.ts'
import { youActivity } from '../you.ts'
import { fitRows } from './fit.ts'
import { modelLoad } from './model.ts'
import type { Scene, SceneCtx } from './index.ts'

/** The three heights (docs/DESIGN.md 33.1); any other height draws the largest that fits, padded. */
export const OFFICE_ROWS = { compact: 10, standard: 15, large: 22 } as const
export type OfficeSize = keyof typeof OFFICE_ROWS
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const STATIONS: Record<'narrow' | 'mid' | 'wide', ToolClass[]> = {
  narrow: ['shell', 'edit', 'read'],
  mid: ['shell', 'read', 'edit', 'search'],
  wide: ['shell', 'read', 'edit', 'search', 'web', 'agent'],
}
const STATION_NAME: Record<ToolClass, string> = {
  shell: '$',
  read: 'files',
  edit: 'edit',
  search: 'search',
  web: 'web',
  agent: 'agent',
  other: 'other',
}
/** Shorter names for a box too narrow for the full label, so labels never run into the next box's. */
const STATION_SHORT: Partial<Record<ToolClass, string>> = { read: 'read', search: 'grep' }
const SHEET_FRAMES = 8
/** The printed slip's trip back to your desk once the run is done, in seconds (from the result). */
export const SLIP_SECS = 1.2
/** How long the sticky notes take to fall after the red → green flip, in seconds. */
const NOTE_FALL_SECS = 3
const MAX_NOTES = 4
const MAX_PARCELS = 6
const DEMO_TAG = ' demo'
/** The narrowest office with a cat (docs/DESIGN.md 28). */
export const CAT_COLUMNS = 76
/** The narrowest station box (its label may run one cell past it, into the gap). */
const MIN_STATION = 7
/** Station boxes stop growing here; the width left over goes to the worker's desk. */
const MAX_STATION = 13
const GAP = 2
/** Your desk and figure (docs/DESIGN.md 17): the narrowest desk that holds chair, figure and a 7-wide monitor. */
const YOU_DESK = 15

// ── Colours (docs/DESIGN.md 27): every tone is a palette role, or a shade derived from one with
// `shade` (hooks/palette.ts: exactly the old value in `night`), worked out once per palette.
type Tones = ReturnType<typeof makeTones>

function makeTones(p: Palette) {
  const sh = (role: Role, night: RGB) => shade(p, role, night)
  const sheet = sh('star', 0xf4efe6) // the hand-off sheet, white paper in every palette
  return {
    cable: sh('cable', 0x3a3346),
    tray: sh('tray', 0x2e2a38),
    wall: [sh('wall', 0x14121f), sh('wall', 0x1d1a2e), sh('wall', 0x262238)],
    floorTop: sh('floor', 0x2a2433),
    starDim: sh('sky', 0x2a2f6a),
    leg: sh('desk', 0x4a3222),
    screen: sh('screen', 0x0a0f14),
    screenOff: sh('screenOff', 0x08090c), // a station whose class has not run: off
    face: sh('screen', 0x1c1a24), // a station's face, tinted by its class
    faceDone: sh('screen', 0x16141c),
    rackFill: sh('rackFace', 0x1c1a24),
    ledOff: sh('phosphorDim', 0x234030),
    ledIdle: sh('phosphorDim', 0x2f5a40),
    lampOff: sh('bad', 0x401418),
    lampOff2: sh('bad', 0x2a1014),
    prompt: sh('tools', 0x5c8a86),
    cursor: sh('phosphorGlow', 0xd8d2c4),
    eye: sh('screen', 0x14121c), // also the dark ink of labels laid on something light
    skin: sh('deskTop', 0xe0b48a),
    hair: sh('desk', 0x2a1f1a),
    youHair: sh('desk', 0x7a4e2e),
    shirt: sh('tools', 0x3d7ea6),
    youShirt: sh('think', 0x9a5a9a),
    keys: sh('bevel', 0x8a8399),
    mug: mix(sh('tools', 0x3d7ea6), p.ink, 0.25), // the worker's mugs, in a lighter shade of its shirt
    mugShade: sh('tools', 0x2d5e7e),
    tick: mix(p.frame, sh('star', 0xe6e0d2), 0.35),
    steam: sh('inkDim', 0x9a94a8),
    steam2: sh('inkDim', 0x7a7488),
    clockFace: sh('star', 0xe6e0d2),
    // The hands: the minute hand in the dark ink, the hour hand a mid tone between it and the face.
    hourHand: mix(sh('screen', 0x14121c), sh('star', 0xe6e0d2), 0.45),
    sheet,
    // Every other sheet of the stack, so its levels read; darker on a light wall, where white paper
    // would vanish.
    sheet2: mix(sheet, p.dim, p.light ? 0.6 : 0.3),
    crumple: mix(sheet, p.dim, p.light ? 0.45 : 0.15),
    bin: p.rack,
    binRim: p.bevel,
    parcel: p.deskTop,
    parcelTape: p.warn,
    note: p.bad,
    board: p.screen,
    bubble: mix(p.think, p.ink, 0.3),
    label: mix(p.ink, p.dim, 0.3),
    stationInk: mix(p.ink, p.dim, 0.4),
    offInk: mix(p.ink, p.dim, 0.8),
    noServer: mix(p.ink, p.dim, 0.6),
    demo: mix(p.ink, p.dim, 0.5),
  }
}

/** Derived tones, memoised per palette so a frame costs no more than with literals. */
const tones: (p: Palette) => Tones = perPalette(makeTones)

/** The size drawn for a height: the largest whose rows fit (compact below 10). */
export function officeSize(rows: number): OfficeSize {
  return rows >= OFFICE_ROWS.large ? 'large' : rows >= OFFICE_ROWS.standard ? 'standard' : 'compact'
}

/** A desk with its monitor and figure: `ax` is the figure's column (the head's middle). */
export type Desk = { desk: Rect; mon: Rect; ax: number }

/** Where everything in the office goes, in pixels (1 × 2 per cell), at one width and size. */
export type OfficePlan = {
  size: OfficeSize
  /** The native height in cells (the size's), and the floor line's pixel row. */
  rows: number
  floorY: number
  /** The worker's desk on the right; the figure faces left, toward the rack. */
  worker: Desk
  /** Your desk on the left (figure facing right); null with no `you` or where it does not fit. */
  you: Desk | null
  /** A seated silhouette at the far left instead of your desk (narrow, or too tight for the desk). */
  silhouette: boolean
  rack: Rect
  classes: ToolClass[]
  ncols: number
  stations: Rect[]
  /** The ceiling tray's row; null in compact (no tray, no drops). */
  trayY: number | null
  /** The column where the worker's cables rise from its monitor to the tray. */
  ux: number
  /** Your cable's column, between your desk and the stations (null without your desk or tray). */
  youCableX: number | null
  win: Rect | null
  clock: Rect | null
  /** The test tally board (its frame; the star sits on its top right corner, one pixel outside). */
  board: Rect | null
  /** How many marks the board holds (newest kept). */
  boardMarks: number
  /** Test runs as a row of lights above the stations where there is no board: its columns, clear of the drops. */
  strip: { y: number; xs: number[] } | null
  /** One 3 × 2 slot per mug (2 × 2 and a handle). */
  mugs: Rect[]
  /** The paper stack beside the worker's monitor (3 wide, MAX_PAGES tall at most). */
  pages: Rect | null
  /** The bin by the worker's chair, with room above for its heap and beside it for the overflow. */
  bin: Rect | null
  /** One 2 × 2 slot per commit parcel on the rack's top. */
  parcels: Rect[]
  /** The sticky-note spots (2 × 2) on the worker monitor's bezel, in the order they fill. */
  notes: Rect[]
  /** Where the hand-off sheet rests on the worker's desk. */
  sheet: Rect
  /** Where the printed slip rests at the end: on your desk, or the worker's without yours. */
  slip: Rect
  /** The pumpkin (31 October) takes the first mug's place; null with no mug slot. */
  pumpkin: Rect | null
  /** The cat's box on the floor in the gap by the worker's desk, and on the shelf once done. */
  cat: { box: Rect; shelf: Rect | null } | null
  catDone: { box: Rect; shelf: Rect | null } | null
}

/** Your desk's figure and monitor, from the desk's rectangle. */
function youAt(desk: Rect): Desk {
  const ax = desk.x + 3 + Math.floor((desk.w - YOU_DESK) / 2)
  return { desk, mon: { x: ax + 4, y: desk.y - 7, w: 7, h: 6 }, ax }
}

const plans = new Map<string, OfficePlan>()

/**
 * The office at `columns` and `rows` (any height: the size drawn is `officeSize(rows)`), with or
 * without your desk. Memoised: the tick calls it every frame with the same few arguments.
 */
export function officePlan(columns: number, rows: number, withYou: boolean): OfficePlan {
  const key = `${columns}:${officeSize(rows)}:${withYou ? 1 : 0}`
  let p = plans.get(key)
  if (!p) {
    p = makePlan(columns, officeSize(rows), withYou)
    plans.set(key, p)
  }
  return p
}

function makePlan(W: number, size: OfficeSize, withYou: boolean): OfficePlan {
  const R = OFFICE_ROWS[size]
  const F = R * 2 - 7
  const lay = layout(W)
  const narrow = lay === 'narrow'
  const wide = lay === 'wide'
  const compact = size === 'compact'
  const large = size === 'large'
  const rackW = narrow ? 6 : Math.max(8, Math.round(W * 0.1))
  const mw = narrow ? 8 : wide ? Math.max(10, Math.round(W * 0.07)) : 9
  const catGap = W >= CAT_COLUMNS ? CAT_W + 1 : 2
  // The worker's block: monitor, a gap, keys, the hand, the body, the chair back.
  const block = mw + 9
  const all = STATIONS[lay]
  const ncols0 = wide ? 3 : 2
  const minSt = ncols0 * MIN_STATION + (ncols0 - 1) * GAP
  // Width left after what every office needs: both margins, the stations at their narrowest, the
  // gap to the rack, the rack, the cat's gap and the worker.
  let spare = W - (1 + minSt + 2 + rackW + catGap + block + 1)
  let yw = 0
  let silhouette = false
  if (withYou) {
    const want = wide ? Math.max(YOU_DESK, Math.round(W * 0.13)) : YOU_DESK
    if (!narrow && spare >= want + 2) {
      yw = want
      spare -= want + 2
    } else {
      silhouette = true
      spare -= 3
    }
  }
  const take = (n: number): boolean => (spare >= n ? ((spare -= n), true) : false)
  const paper = take(4)
  // The first mug sits at the desk's end; each one after it keeps a pixel's gap.
  let mugN = paper && take(3) ? 1 : 0
  const bin = take(4)
  while (bin && mugN < MAX_MUGS && take(4)) mugN++
  const stExtra = Math.max(Math.min(spare, ncols0 * (MAX_STATION - MIN_STATION)), Math.min(0, spare))
  const deskExtra = Math.max(0, spare - stExtra)

  const sx = yw ? 1 + yw + 2 : silhouette ? 4 : 1
  const span = Math.max(3, minSt + stExtra)
  const deskY = F - 4
  const you = yw ? youAt({ x: 1, y: deskY, w: yw, h: 2 }) : null

  // The stations: two rows (one in compact, as many as fit), boxes on even pixel rows so each
  // label gets a clean text row just below its box.
  let classes = all
  let ncols = ncols0
  if (compact) {
    const n = Math.max(1, Math.min(all.length, Math.floor((span + GAP) / (MIN_STATION + GAP))))
    classes = all.slice(0, n)
    ncols = n
  }
  const sw = Math.max(3, Math.floor((span - GAP * (ncols - 1)) / ncols))
  const top = compact ? F - 11 : F - 17
  const stations = classes.map((_, i): Rect => ({ x: sx + (i % ncols) * (sw + GAP), y: top + Math.floor(i / ncols) * 8, w: sw, h: 6 }))

  const rackX = sx + span + 2
  const rack: Rect = compact ? { x: rackX, y: F - 11, w: rackW, h: 11 } : { x: rackX, y: F - 18, w: rackW, h: 18 }
  const rackEnd = rack.x + rack.w
  const deskX = rackEnd + catGap
  const monX = deskX + (mugN ? 4 * mugN - 1 : 0) + deskExtra + (paper ? 4 : 0)
  const ax = monX + mw + 5
  const chair = ax + 3
  const desk: Rect = { x: deskX, y: deskY, w: chair - deskX + 1, h: 2 }
  const mon: Rect = compact ? { x: monX, y: deskY - 7, w: mw, h: 6 } : { x: monX, y: deskY - 9, w: mw, h: 8 }
  const worker: Desk = { desk, mon, ax }
  const trayY = compact ? null : rack.y - 5
  const ux = mon.x + mon.w - 2

  // Run memory on the worker's desk: mugs at its free end, the paper stack beside the monitor,
  // the notes on the monitor's bezel (along the top, then down each side), the bin by the chair.
  const mugs: Rect[] = Array.from({ length: mugN }, (_, i) => ({ x: deskX + 4 * i, y: deskY - 2, w: 3, h: 2 }))
  const pages: Rect | null = paper ? { x: mon.x - 4, y: deskY - MAX_PAGES, w: 3, h: MAX_PAGES } : null
  const notes: Rect[] = []
  for (let x = mon.x + 1; x + 1 < ux && notes.length < MAX_NOTES; x += 3) notes.push({ x, y: mon.y, w: 2, h: 2 })
  for (const [x, dy] of [[mon.x, 3], [mon.x + mon.w - 2, 3], [mon.x, 5]] as const) {
    if (notes.length < MAX_NOTES && mon.y + dy + 1 < mon.y + mon.h) notes.push({ x, y: mon.y + dy, w: 2, h: 2 })
  }
  // The bin: 3 × 3 on the floor right of the chair, its heap up to three rows above it and an
  // overflow ball beside it, by the chair.
  const binRect: Rect | null = bin ? { x: chair + 1, y: F - 6, w: 4, h: 6 } : null
  const parcels: Rect[] = []
  for (let x = rack.x + 1; x + 2 <= rack.x + rack.w - 1 && parcels.length < MAX_PARCELS; x += 3) parcels.push({ x, y: rack.y - 2, w: 2, h: 2 })
  const sheet: Rect = { x: mon.x + mon.w - 4, y: deskY - 1, w: 3, h: 2 }
  const slip: Rect = you ? { x: you.mon.x + 1, y: deskY - 1, w: 3, h: 2 } : sheet

  // The cat (docs/DESIGN.md 28): in the gap between the rack and the desk, a pixel clear of the
  // rack, or on a shelf continuing the desk into that gap once done.
  const room = deskX - 1 - rackEnd
  const catOK = W >= CAT_COLUMNS && room >= CAT_W
  const cat = catOK ? { box: { x: rackEnd + 1 + Math.floor((room - CAT_W) / 2), y: F - CAT_H, w: CAT_W, h: CAT_H }, shelf: null } : null
  const catDone = catOK ? { box: { x: deskX - CAT_W, y: deskY - CAT_H, w: CAT_W, h: CAT_H }, shelf: { x: deskX - CAT_W, y: deskY, w: CAT_W, h: 2 } } : null

  // ── The wall (none in compact). Standard: the clock left of the worker's monitor, the window
  // right of its riser, the tally board over your desk at 100 columns and more. Large: a band
  // above the tray with the board, the clock and the window side by side.
  let win: Rect | null = null
  let clock: Rect | null = null
  let board: Rect | null = null
  let boardMarks = 0
  if (!compact) {
    const winH = large ? 10 : 5
    const winY = large ? 2 : 4
    const ww = Math.min(Math.max(8, Math.round(W * 0.18)), W - 3 - (ux + 2) + 1)
    if (ww >= 6) win = { x: W - 2 - ww, y: winY, w: ww, h: winH }
    if (large) {
      const cs = 11
      const cx = (win ? win.x : W - 2) - 3 - cs
      if (cx >= 2) clock = { x: cx, y: 1, w: cs, h: cs }
      const right = (clock ? clock.x : win ? win.x : W - 2) - 4
      const marks = Math.min(MAX_RUNS, Math.floor((right - 2 - 4 + 2) / 2))
      if (marks >= 3) {
        const bw = 2 * marks - 1 + 4
        board = { x: right - bw + 1, y: 5, w: bw, h: 6 }
        boardMarks = marks
      }
    } else {
      // Left of the monitor, clear of the rack (9 across, or 7 where that is tight); else on the
      // wall over your desk's monitor (below 100 columns, where the board is not); else (narrow)
      // right of the riser, with the window after it where there is still room.
      const cs = [9, 7].find(n => mon.x - 1 - n > rackEnd)
      if (cs) clock = { x: mon.x - 1 - cs, y: 9 - cs + 2, w: cs, h: cs }
      else if (you && W < 100) clock = { x: you.desk.x + you.desk.w - 8, y: 1, w: 7, h: 7 }
      else if (W - 3 - (ux + 2) + 1 >= 7) {
        clock = { x: ux + 2, y: 2, w: 7, h: 7 }
        const rest = W - 3 - (clock.x + 7 + 2) + 1
        win = rest >= 6 ? { x: clock.x + 7 + 2, y: winY, w: rest, h: winH } : null
      }
      if (you && W >= 100) {
        const marks = Math.min(MAX_RUNS, Math.floor((you.desk.w - 2 - 4 + 2) / 2))
        if (marks >= 3) {
          board = { x: you.desk.x + 1, y: 1, w: 2 * marks - 1 + 4, h: 5 }
          boardMarks = marks
        }
      }
    }
  }
  // The strip's lights keep a pixel clear of every cable dropping past their row.
  let strip: OfficePlan['strip'] = null
  if (!compact && !board) {
    const drops = stations.map((b, i) => (i < ncols ? b.x + Math.floor(b.w / 2) : i % ncols === ncols - 1 ? b.x + b.w : b.x + b.w + GAP - 1))
    const xs: number[] = []
    for (let x = sx; x <= rack.x - 3; x++) if (drops.every(d => Math.abs(x - d) > 1)) xs.push(x)
    strip = { y: F - 19, xs }
  }
  const pumpkin = mugs[0] ? { x: mugs[0].x, y: deskY - 3, w: 3, h: 3 } : null
  return {
    size,
    rows: R,
    floorY: F,
    worker,
    you,
    silhouette,
    rack,
    classes,
    ncols,
    stations,
    trayY,
    ux,
    youCableX: you && trayY != null ? sx - 2 : null,
    win,
    clock,
    board,
    boardMarks,
    strip,
    mugs,
    pages,
    bin: binRect,
    parcels,
    notes,
    sheet,
    slip,
    pumpkin,
    cat,
    catDone,
  }
}

/** A model id for a desk label: the last path segment, no `claude-`, its first two words ("opus 5"). */
function shortModel(id: string | null | undefined): string {
  if (!id) return ''
  return (id.split('/').at(-1) ?? '').replace(/^claude-/, '').split('-').slice(0, 2).join(' ')
}

/**
 * The clock's hands at `t`, local time: the minute hand's angle and the hour hand's, in radians
 * clockwise from twelve.
 */
export function clockHands(t: number): { minute: number; hour: number } {
  const d = new Date(t * 1000)
  const m = d.getMinutes() + d.getSeconds() / 60
  const h = (d.getHours() % 12) + m / 60
  return { minute: (m / 60) * 2 * Math.PI, hour: (h / 12) * 2 * Math.PI }
}

/** The pixels of a hand `len` long from the centre at `angle` (clockwise from twelve). */
export function handPixels(cx: number, cy: number, angle: number, len: number): [number, number][] {
  // A line from the centre to the tip, one pixel per step along its longer axis, so it never breaks.
  const dx = Math.round(len * Math.sin(angle))
  const dy = -Math.round(len * Math.cos(angle))
  const n = Math.max(Math.abs(dx), Math.abs(dy))
  const out: [number, number][] = []
  for (let i = 1; i <= n; i++) out.push([cx + Math.round((dx * i) / n), cy + Math.round((dy * i) / n)])
  return out
}

/**
 * The clock's hands on a face of radius `r` centred at (cx, cy), at `t`: the minute hand reaching
 * the ticks, the hour hand about half as long. When the two lie within 30° of one line (together,
 * or opposite, where they would read as one bar), the hour hand steps one pixel aside so the face
 * still shows two hands.
 */
export function clockPixels(cx: number, cy: number, r: number, t: number): { minute: [number, number][]; hour: [number, number][] } {
  const { minute, hour } = clockHands(t)
  const apart = Math.abs(((minute - hour) % Math.PI + Math.PI) % Math.PI) // 0..π, 0 when on one line
  const near = Math.min(apart, Math.PI - apart) < Math.PI / 6
  const ox = near ? Math.round(Math.cos(hour)) : 0
  const oy = near ? Math.round(Math.sin(hour)) : 0
  return {
    minute: handPixels(cx, cy, minute, r - 0.6),
    hour: handPixels(cx, cy, hour, Math.max(1, r * 0.45)).map(([x, y]) => [x + ox, y + oy] as [number, number]),
  }
}

/** The sticky notes on the worker's monitor: one per failing test, or those falling after the flip. */
function noteCount(m: RunMemory): number {
  if (m.celebrating && m.flip) {
    // The failing count of the run before the flip (the flip is the last pass after a fail).
    for (let i = m.runs.length - 1; i > 0; i--) if (m.runs[i]!.ok && !m.runs[i - 1]!.ok) return Math.min(MAX_NOTES, Math.max(1, m.runs[i - 1]!.failed))
    return Math.min(MAX_NOTES, Math.max(1, m.peakFailing))
  }
  return Math.min(MAX_NOTES, m.failing)
}

/**
 * The one piece of animation state this otherwise pure scene keeps: the hand-off last drawn
 * (`you.lastHandoff`) and the frame its sheet began to slide. A newer hand-off starts a new slide;
 * the sheet then rests on the worker's desk. A reload starts empty, so nothing rests at first.
 * (The printed slip at the end needs none: it travels on the clock, from the result's arrival.)
 */
let lastSheetAt: { at: number; frame: number } | null = null

function drawNative(ctx: SceneCtx, P: OfficePlan): string {
  const { s, a, frame, t, columns, transparent = true, you } = ctx
  const p = paletteOf(ctx)
  const T = tones(p)
  const CLASS_COLOR = p.classes
  const c = new Canvas(columns, P.rows)
  const W = c.w
  const H = c.h
  const st = a.state
  const done = st === 'done'
  const live = !done && st !== 'nolog'
  const stalled = st === 'stalled'
  const pulse = a.pulse
  const floorY = P.floorY
  const compact = P.size === 'compact'
  const lights = done ? 0.5 : 1
  const m = memoryOf(s, t)
  // The orchestrator (docs/DESIGN.md 17): its own desk where it fits, a silhouette otherwise.
  const ya = you ? youActivity(you, t) : null
  const yd = P.you
  // Ambience (docs/DESIGN.md 42): `glow` mixes an ambient tone over what is drawn at a pixel (over
  // the terminal's own colour, the tone faded instead).
  const amb = ambient(ctx)
  const AT = ambientTones(p)
  const glow = (x: number, y: number, tone: RGB, a: number) => {
    const under = c.get(x, y)
    c.set(x, y, a >= 1 ? tone : under === NONE ? fade(p, tone, a) : mix(under, tone, a))
  }

  // ── Back wall at dusk and a floor; the lights go low once finished. Transparent: no wall or
  // floor, only the floor line, so the furniture still stands on something.
  if (!transparent) {
    for (let y = 0; y < H; y++) {
      const col = y < floorY ? ramp(T.wall, y / floorY) : ramp([T.floorTop, p.floor], (y - floorY) / (H - floorY))
      for (let x = 0; x < W; x++) c.set(x, y, scale(col, lights))
    }
  }
  for (let x = 0; x < W; x++) c.set(x, floorY, scale(T.cable, lights))

  // ── The window with its stars (they stay lit) and the season (docs/DESIGN.md 28).
  const season = seasonOf(t, ctx.season)
  const holiday = season === 'none' ? null : holidayOf(t)
  const S = seasonTones(p)
  const win = P.win
  // String lights along the top of the wall (docs/DESIGN.md 42), over the worker's side of the
  // room: from the middle to a column before the edge in large, in swags over the wall band; from
  // the cable riser in standard (the tray runs along the top left of it); in compact, which has no
  // wall, a short straight run between the rack (its parcels stand up there) and the worker's
  // monitor. Drawn first, so the clock and the window hang in front; not during the `lights`
  // holiday (by the date, whatever the window shows), which hangs its own over the window.
  if (amb && holidayOf(t) !== 'lights') {
    const large = P.size === 'large'
    const x0 = large ? Math.floor(W / 2) : compact ? P.rack.x + P.rack.w + 1 : P.ux + 2
    const x1 = compact ? P.worker.mon.x - 1 : W - 1
    const sd = large ? strand(x1 - x0, 2, 12, 4) : strand(x1 - x0, compact ? 0 : 1, 10, compact ? 5 : 4)
    for (let x = 0; x < sd.wire.length; x++) c.set(x0 + x, sd.wire[x]!, AT.wire)
    sd.bulbs.forEach((b, i) => c.set(x0 + b.x, b.y, scale(AT.bulbs[b.tone]!, bulbLevel(frame, i))))
  }
  if (win) {
    const day = season === 'summer' && isDay(t)
    const sky = day ? S.daySky : S.sky[season]
    rect(c, win, sky)
    if (!day && season !== 'spring' && !p.light) {
      for (let i = 0; i < 9; i++) {
        const sx = win.x + 1 + Math.floor(hash(i) * (win.w - 2))
        const sy = win.y + 1 + Math.floor(hash(i + 50) * (win.h - 2))
        const tw = Math.sin(frame * (done ? 0.25 : 0.15) + i * 2.1) * 0.5 + 0.5
        c.set(sx, sy, mix(T.starDim, p.star, tw))
      }
    }
    const glass: Rect = { x: win.x + 1, y: win.y + 1, w: win.w - 2, h: win.h - 2 }
    // Ambience: the skyline, its lit windows and the plane behind the weather, rain or fireflies in
    // front of it, all in glass pixels (docs/DESIGN.md 42.2).
    const look = windowLook(p, season, holiday, t)
    const onGlass: Put = (x, y, tone, a) => glow(glass.x + x, glass.y + y, tone, a)
    if (amb) windowFar(p, look, sky, frame, glass.w, glass.h, onGlass)
    if (day) {
      // The sun: a 3 × 3 disc (no corners) in the glass's top right.
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] as const) c.set(glass.x + glass.w - 4 + dx, glass.y + dy, S.sun)
    }
    for (const sp of weather(season, holiday, t, frame, glass.w, glass.h)) {
      c.set(glass.x + sp.x, glass.y + sp.y, holiday === 'newyear' ? S.sparks[sp.tone]! : S.speck[sp.tone]!)
    }
    if (amb) windowNear(p, look, frame, glass.w, glass.h, onGlass)
    frameRect(c, win, scale(p.frame, lights))
    if (season === 'winter') for (let x = win.x; x < win.x + win.w; x++) c.set(x, win.y + win.h - 1, S.sill) // a snowy sill
    if (holiday === 'lights') {
      // Three lights on a wire along the window's top, lit in turn.
      for (let x = win.x + 1; x < win.x + win.w - 1; x++) c.set(x, win.y - 1, S.wire)
      for (let i = 0; i < 3; i++) c.set(win.x + Math.round((win.w * (i + 1)) / 4), win.y - 1, i === litLight(frame) ? S.lights[i]! : scale(S.lights[i]!, 0.45))
    }
    if (amb && dusty(t)) {
      // Dust in the daylight from the window: a few faint motes in the air under it, down to the
      // desk, behind whatever stands there.
      const top = win.y + win.h
      const h = Math.min(P.size === 'large' ? 10 : 6, P.worker.desk.y - 1 - top)
      for (const d of dustMotes(win.w - 2, h, frame)) glow(win.x + 1 + d.x, top + d.y, AT.dust, d.a)
    }
  }

  // ── The wall clock (docs/DESIGN.md 33.1): a round face in the frame's colour with two hands at
  // the local time. Indoors, so it dims with the room.
  if (P.clock) {
    const { x, y, w } = P.clock
    const r = (w - 1) / 2
    const cx = x + r
    const cy = y + r
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const d = Math.hypot(dx - r, dy - r)
        if (d > r + 0.5) continue
        c.set(x + dx, y + dy, scale(d > r - 0.5 ? p.frame : T.clockFace, lights))
      }
    }
    // Ticks at twelve, three, six and nine, just inside the rim, so the face reads as a dial (not
    // on the smallest face, where they would crowd the hands).
    if (r >= 4) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) c.set(cx + dx * (r - 1), cy + dy * (r - 1), scale(T.tick, lights))
    const hands = clockPixels(cx, cy, r, t)
    for (const [hx, hy] of hands.hour) c.set(hx, hy, scale(T.hourHand, lights))
    for (const [hx, hy] of hands.minute) c.set(hx, hy, scale(T.eye, lights))
    c.set(cx, cy, scale(p.bad, lights)) // the centre pip
  }

  // ── The test tally board (docs/DESIGN.md 32): one mark per remembered run, oldest left, green
  // pass and red fail, and a gold star on its corner once the tests have gone red → green.
  if (P.board && m.runs.length) {
    const b = P.board
    rect(c, b, T.board)
    frameRect(c, b, scale(p.frame, lights))
    const marks = m.runs.slice(-P.boardMarks)
    marks.forEach((r, i) => {
      let col: RGB = r.ok ? p.good : p.bad
      if (i === marks.length - 1 && pulse?.kind === 'tests-fail' && !done) col = frame % 2 === 0 ? p.bad : T.lampOff
      for (let y = b.y + 1; y < b.y + b.h - 1; y++) c.set(b.x + 2 + i * 2, y, scale(col, lights))
    })
    if (m.flip) {
      const [sx, sy] = [b.x + b.w - 1, b.y]
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) c.set(sx + dx, sy + dy, p.warn)
    }
  }

  // ── The worker's desk, monitor and figure (facing left, toward the rack).
  const { desk, mon, ax } = P.worker
  const drawDesk = (d: Rect) => {
    rect(c, d, scale(p.desk, lights))
    for (let x = d.x + 1; x < d.x + d.w - 1; x++) c.set(x, d.y + d.h, scale(T.leg, lights))
    for (const lx of [d.x + 1, d.x + d.w - 2]) {
      c.set(lx, d.y + 2, scale(T.leg, lights))
      c.set(lx, d.y + 3, scale(T.leg, lights))
    }
  }
  drawDesk(desk)
  if (amb && !compact) {
    // Lamplight (docs/DESIGN.md 42): a warm pool on the desk under the monitor, brightest under its
    // middle and on the top row, nearest the screen, breathing over eight seconds.
    const mid = mon.x + (mon.w - 1) / 2
    const reach = mon.w / 2 + 3
    const level = 0.24 * lampLevel(frame)
    for (let x = Math.ceil(mid - reach); x <= mid + reach; x++) {
      const d = 1 - Math.abs(x - mid) / reach
      const fall = d * d * (3 - 2 * d) // smooth at the pool's edges
      if (d <= 0 || x < desk.x || x >= desk.x + desk.w) continue
      glow(x, desk.y, AT.lamp, level * fall)
      glow(x, desk.y + 1, AT.lamp, level * fall * 0.5)
    }
  }
  rect(c, mon, T.screen)
  frameRect(c, mon, scale(p.mon, lights))
  c.set(mon.x + Math.floor(mon.w / 2), mon.y + mon.h, scale(p.mon, lights))
  if (!done) {
    // Code scrolling while the model writes; slow otherwise; dim when stalled.
    const speed = st === 'thinking' ? 0.5 : st === 'prefill' ? 0.25 : 0.08
    const glow = stalled ? 0.3 : live ? 0.85 : 0.45
    for (let y = 1; y < mon.h - 1; y++) {
      const line = Math.floor(frame * speed) + y
      const len = 2 + Math.floor(hash(line) * (mon.w - 5))
      const indent = Math.floor(hash(line + 7) * 3)
      const hue = [p.good, p.think, p.tools, p.warn][line % 4]!
      for (let x = 0; x < len; x++) c.set(mon.x + 1 + indent + x, mon.y + y, scale(hue, glow))
    }
    if (pulse?.kind === 'tests-fail') {
      for (const y of [mon.y + 2, mon.y + 4]) for (let x = mon.x + 1; x < mon.x + mon.w - 2; x++) c.set(x, y, p.bad)
    }
  }
  const ay = desk.y - 1
  const skin = scale(T.skin, lights)
  const shirt = scale(T.shirt, lights)
  const bob = (st === 'thinking' && Math.floor(frame / 6) % 2 === 0 ? 1 : 0) - (stalled ? 1 : 0)
  rect(c, { x: ax - 1, y: ay - 6 + bob, w: 3, h: 3 }, skin) // head
  for (let dx = -1; dx <= 1; dx++) c.set(ax + dx, ay - 7 + bob, scale(T.hair, lights))
  c.set(ax - 1, ay - 5 + bob, T.eye) // eye, on the screen
  rect(c, { x: ax - 1, y: ay - 3, w: 4, h: 4 }, shirt) // body
  if (m.celebrating && !stalled && !(done && !a.ok)) {
    // Both arms up, then out in a V, a few frames each (docs/DESIGN.md 32); not over a failed end.
    const up = Math.floor(frame / 3) % 2 === 0
    for (const [arm, out] of [[ax - 2, -1], [ax + 3, 1]] as const) {
      c.set(arm, ay - 4, shirt)
      if (up) {
        c.set(arm, ay - 5, shirt)
        c.set(arm, ay - 6, skin)
      } else {
        c.set(arm + out, ay - 5, skin)
      }
    }
  } else if (stalled) {
    c.set(ax + 2, ay, skin) // hand off the keyboard, resting
  } else {
    const typing = (st === 'thinking' || st === 'tool') && frame % 4 < 2
    c.set(ax - 2, ay - 2 + (typing ? 1 : 0), skin)
  }
  c.set(ax - 3, ay - 1, scale(T.keys, lights))
  c.set(ax - 4, ay - 1, scale(T.keys, lights))
  rect(c, { x: ax + 3, y: ay - 2, w: 1, h: 6 }, scale(T.cable, lights)) // chair back
  if (st === 'thinking' && !compact) {
    // A thought: three dots appearing in turn over the head, toward the screen.
    const n = Math.floor(frame / 5) % 4
    for (let i = 0; i < n; i++) c.set(ax - 1 - i * 2, ay - 9, T.bubble)
  }

  // ── Run memory on the worker's desk (docs/DESIGN.md 32). Mugs, one per TURNS_PER_MUG turns; the
  // newest steams while the worker is stalled (with no mug yet, one appears for the wait).
  const pumpkin = holiday === 'halloween' ? P.pumpkin : null
  const mugsShown = Math.min(P.mugs.length, stalled ? Math.max(1, m.mugs) : m.mugs)
  for (let i = 0; i < mugsShown; i++) {
    if (pumpkin && i === 0) continue
    const g = P.mugs[i]!
    rect(c, { x: g.x, y: g.y, w: 2, h: 2 }, scale(T.mug, lights))
    c.set(g.x + 1, g.y + 1, scale(T.mugShade, lights))
    c.set(g.x + 2, g.y, scale(T.mugShade, lights)) // the handle
    if (!amb && stalled && i === mugsShown - 1) {
      const ph = frame % 2
      c.set(g.x, g.y - 1 - ph, T.steam)
      c.set(g.x + 1, g.y - 2 - ph, T.steam2)
    }
  }
  if (amb && mugsShown > 0) {
    // Ambience (docs/DESIGN.md 42): steam curls slowly up off the newest mug in every state (it
    // replaces the old quick wisp of a stall). On 31 October a lone mug's place is the pumpkin's,
    // and the curl rises from its stem: the candle inside.
    const g = P.mugs[mugsShown - 1]!
    for (const q of steamPuffs(frame, compact ? 3 : 4, mugsShown)) glow(g.x + q.x, g.y - 1 + q.y, q.a > 0.5 ? T.steam : T.steam2, Math.min(1, q.a + 0.3))
  }
  if (pumpkin) {
    // A pumpkin in the first mug's place (two or three pixels wide, a darker rib, a stem).
    const [body, rib, stem] = S.pumpkin
    for (let i = 0; i < pumpkin.w; i++) rect(c, { x: pumpkin.x + i, y: pumpkin.y + 1, w: 1, h: 2 }, scale(i === 1 ? rib : body, lights))
    c.set(pumpkin.x + (pumpkin.w >> 1), pumpkin.y, scale(stem, lights))
  }
  if (P.pages && m.pages) {
    // The paper stack: one sheet per level, alternating tones so the levels read.
    const g = P.pages
    for (let i = 0; i < Math.min(MAX_PAGES, m.pages); i++) {
      for (let x = g.x; x < g.x + g.w; x++) c.set(x, desk.y - 1 - i, scale(i % 2 ? T.sheet2 : T.sheet, lights))
    }
  }
  // Sticky notes on the monitor's bezel, one per failing test; after the flip they fall to the
  // desk in turn over the first NOTE_FALL_SECS seconds, and are gone.
  {
    const n = Math.min(P.notes.length, noteCount(m))
    const age = m.celebrating && m.flip ? m.flip.age : null
    for (let i = 0; i < n; i++) {
      const g = P.notes[i]!
      let y = g.y
      if (age != null) {
        const tt = age - i * 0.35
        if (tt > 0) y += Math.floor(16 * tt * tt)
        if (age >= NOTE_FALL_SECS || y + 1 >= desk.y) continue
      }
      rect(c, { x: g.x, y, w: 2, h: 2 }, scale(T.note, lights))
      c.set(g.x + 1, y + 1, scale(mix(T.note, T.eye, 0.35), lights)) // a curled corner
    }
  }
  if (P.bin && m.crumples) {
    // The bin: three wide, its rim lighter; the balls heap up above the rim, a ninth beside it.
    const b = P.bin
    const bx = b.x + 1
    const by = floorY - 3
    rect(c, { x: bx, y: by, w: 3, h: 3 }, scale(T.bin, lights))
    for (let x = bx; x < bx + 3; x++) c.set(x, by, scale(T.binRim, lights))
    const heap: [number, number][] = [[1, -1], [0, -1], [2, -1], [1, -2], [0, -2], [2, -2], [1, -3], [0, -3]]
    for (let i = 0; i < Math.min(m.crumples, heap.length); i++) c.set(bx + heap[i]![0], by + heap[i]![1], scale(i % 2 ? T.crumple : T.sheet, lights))
    if (m.crumples > heap.length) c.set(b.x, floorY - 1, scale(T.crumple, lights))
  }

  // ── The model server's rack: LEDs blink at the decode rate; dim and steady with no server.
  // Following this session there is no server to read (docs/DESIGN.md 36, a named worker): the
  // rack stands for the model itself, its LEDs busy while it thinks, calmer during a tool call,
  // idle while it waits on you, and the model's name goes under it instead of the desk's.
  const rack = P.rack
  const hasServer = s.server != null
  const load = modelLoad(ctx, st)
  const modelRack = load !== undefined
  rect(c, rack, T.rackFill)
  frameRect(c, rack, scale(p.rack, hasServer || modelRack ? lights : 0.6))
  const blinkRate = 0.05 + (load ?? a.intensity) * 0.4
  const units = Math.floor((rack.h - 4) / 2)
  for (let u = 0; u < units; u++) {
    const uy = rack.y + 2 + u * 2
    for (let x = rack.x + 2; x < rack.x + rack.w - 2; x++) c.set(x, uy, p.rackFace)
    let led: RGB = T.ledOff
    let led2: RGB = p.rackFace
    if (modelRack) {
      if (load != null && live) {
        const on = hash(u * 13 + Math.floor(frame * blinkRate * 3)) > 1 - load * 0.65
        led = on ? (st === 'prefill' ? p.warn : p.good) : T.ledOff
        led2 = load > 0.5 && hash(u + Math.floor(frame * 0.07)) > 0.6 ? p.think : p.rackFace
      } else if (!done) {
        led = T.ledIdle
      }
    } else if (hasServer && live && !stalled) {
      const on = hash(u * 13 + Math.floor(frame * blinkRate * 3)) > 0.45
      led = on ? (st === 'prefill' ? p.warn : p.good) : T.ledOff
      led2 = hash(u + Math.floor(frame * 0.07)) > 0.6 ? p.think : p.rackFace
    } else if (hasServer && !done) {
      led = T.ledIdle
    }
    c.set(rack.x + rack.w - 3, uy, led)
    c.set(rack.x + rack.w - 4, uy, led2)
  }
  const mem = s.memory
  if (mem?.total_gb) {
    const used = 1 - (mem.free_gb ?? 0) / mem.total_gb
    const hpx = Math.round(used * (rack.h - 2))
    for (let i = 0; i < hpx; i++) c.set(rack.x + 1, rack.y + rack.h - 2 - i, scale(ramp(p.heat, i / (rack.h - 2)), lights))
  }
  if ((pulse?.kind === 'error' || pulse?.kind === 'denied') && !done) {
    // A warning lamp on the rack's top unit.
    const lx = rack.x + Math.floor(rack.w / 2)
    const lit = frame % 3 === 0
    c.set(lx, rack.y + 1, lit ? p.bad : T.lampOff)
    c.set(lx - 1, rack.y + 1, lit ? scale(p.bad, 0.6) : T.lampOff2)
  }
  // Commit parcels on the rack's top, one per commit: cardboard with a gold tape.
  for (let i = 0; i < Math.min(P.parcels.length, m.commits); i++) {
    const g = P.parcels[i]!
    rect(c, g, scale(T.parcel, lights))
    c.set(g.x + 1, g.y, scale(T.parcelTape, lights))
  }

  // ── Tool stations, lit by the active tool's class.
  const classes = P.classes
  const ncols = P.ncols
  const active = st === 'tool' && a.cls && classes.includes(a.cls) ? a.cls : null
  const counts = classCounts(s)
  // Each box has a half-cell slate frame: its top and bottom rows are half cells already (the boxes
  // start on an even pixel row); its sides are ▐ / ▌ glyphs on the wall, drawn with the labels. A
  // box whose class has not run yet is off: a dark face, a dim frame and label, no icon.
  const onStation = (cls: ToolClass) => counts[cls] > 0 || active === cls
  const frameOf = (cls: ToolClass): RGB => (active === cls ? CLASS_COLOR[cls] : scale(p.mon, (onStation(cls) ? 1 : 0.6) * lights))
  classes.forEach((cls, i) => {
    const b = P.stations[i]!
    const col = CLASS_COLOR[cls]
    const lit = active === cls
    const glow = lit ? 0.6 + 0.4 * Math.sin(frame * 0.6) : 0
    const inner: Rect = { x: b.x + 1, y: b.y, w: b.w - 2, h: b.h }
    if (!onStation(cls)) {
      rect(c, inner, T.screenOff)
      for (let x = inner.x; x < inner.x + inner.w; x++) {
        c.set(x, b.y, frameOf(cls))
        c.set(x, b.y + b.h - 1, frameOf(cls))
      }
      return
    }
    rect(c, inner, done ? T.faceDone : mix(T.face, col, 0.15 + glow * 0.5))
    for (let x = inner.x; x < inner.x + inner.w; x++) {
      c.set(x, b.y, frameOf(cls))
      c.set(x, b.y + b.h - 1, frameOf(cls))
    }
    if (cls === 'shell') {
      // A prompt and its cursor: blinking while live, a slow blink once finished.
      c.set(b.x + 1, b.y + 3, T.prompt)
      const on = done ? Math.floor(frame / 8) % 2 === 0 : Math.floor(frame / 4) % 2 === 0 || lit
      if (on) c.set(b.x + 2, b.y + 3, p.tools)
    } else {
      const n = counts[cls]
      const h = Math.min(b.h - 2, Math.ceil(Math.log2(1 + n)))
      for (let j = 0; j < h; j++) {
        for (let x = b.x + 2; x < b.x + b.w - 2; x++) c.set(x, b.y + b.h - 2 - j, scale(col, (0.6 + (j % 2) * 0.25) * lights))
      }
    }
  })

  // ── Test runs as a strip of lights above the stations, where the board is not on the wall.
  if (P.strip) {
    const { xs, y } = P.strip
    const runs = (s.tests ?? []).slice(-xs.length)
    runs.forEach((r, i) => {
      const last = i === runs.length - 1
      let col: RGB = r.failed > 0 ? p.bad : p.good
      if (last && pulse?.kind === 'tests-fail') col = frame % 2 === 0 ? p.bad : T.lampOff
      c.set(xs[i]!, y, scale(col, lights))
    })
  }

  // ── You: your desk, monitor and figure (a headset, your own shirt), or a silhouette.
  if (you && ya) {
    const shirt2 = scale(T.youShirt, lights)
    if (yd) {
      const { desk: od, mon: om, ax: ox } = yd
      const oy = od.y - 1
      drawDesk(od)
      rect(c, om, T.screen)
      frameRect(c, om, scale(p.mon, lights))
      c.set(om.x + 3, om.y + om.h, scale(p.mon, lights))
      const ix = om.x + 1
      const iy = om.y + 1
      if (ya.state === 'thinking') {
        for (let y = 0; y < om.h - 2; y++) {
          const line = Math.floor(frame * 0.5) + y
          const indent = Math.floor(hash(line + 31) * 2)
          const len = 1 + Math.floor(hash(line + 17) * (om.w - 3 - indent))
          const hue = [p.think, p.good, p.warn, p.tools][line % 4]!
          for (let x = 0; x < len; x++) c.set(ix + indent + x, iy + y, scale(hue, 0.85))
        }
      } else if (ya.state === 'tool') {
        const col = CLASS_COLOR[ya.cls ?? 'other']
        rect(c, { x: ix, y: iy, w: om.w - 2, h: om.h - 2 }, mix(T.screen, col, 0.3))
        const row = Math.floor(frame / 2) % (om.h - 2)
        for (let x = ix; x < om.x + om.w - 1; x++) c.set(x, iy + row, col)
      } else if (ya.state === 'waiting') {
        // A slow cursor: one pixel, on for 6 frames and off for 6.
        c.set(ix, om.y + om.h - 2, T.prompt)
        if (Math.floor(frame / 6) % 2 === 0) c.set(ix + 1, om.y + om.h - 2, T.cursor)
      }
      const bob = ya.state === 'thinking' && Math.floor((frame + 3) / 6) % 2 === 0 ? 1 : 0
      rect(c, { x: ox - 1, y: oy - 6 + bob, w: 3, h: 3 }, skin) // head
      for (let dx = -1; dx <= 1; dx++) c.set(ox + dx, oy - 7 + bob, scale(T.youHair, lights))
      c.set(ox + 1, oy - 5 + bob, T.eye) // eye, on the screen
      // The headset: a 1-pixel band over the hair down to an ear cup, and the mic by the mouth.
      const band = scale(T.hair, lights)
      for (let dx = -1; dx <= 1; dx++) c.set(ox + dx, oy - 8 + bob, band)
      c.set(ox - 2, oy - 7 + bob, band)
      c.set(ox - 2, oy - 6 + bob, band)
      c.set(ox - 2, oy - 5 + bob, band)
      c.set(ox + 2, oy - 4 + bob, scale(T.keys, lights))
      rect(c, { x: ox - 2, y: oy - 3, w: 4, h: 4 }, shirt2) // body
      if (ya.state === 'tool' || ya.state === 'thinking') {
        const typing = ya.state === 'tool' && frame % 4 < 2
        c.set(ox + 2, oy - 2 + (typing ? 1 : 0), skin)
      } else {
        c.set(ox - 2, oy, skin) // hand resting while it waits
      }
      c.set(ox + 3, oy - 1, scale(T.keys, lights))
      rect(c, { x: ox - 3, y: oy - 2, w: 1, h: 6 }, scale(T.cable, lights)) // chair back
      if (ya.state === 'thinking' && !compact) {
        // A speech bubble: "…" above the head.
        for (let i = 0; i < 3; i++) c.set(ox + 1 + i * 2, oy - 10, p.ink)
      }
    } else {
      // Too narrow for your desk: a seated silhouette at the far left edge, in your shirt colour.
      const oy = desk.y - 1
      rect(c, { x: 1, y: oy - 6, w: 2, h: 2 }, shirt2) // head
      c.set(1, oy - 4, shirt2) // neck
      rect(c, { x: 0, y: oy - 3, w: 3, h: 4 }, shirt2) // body
      rect(c, { x: 1, y: oy + 1, w: 2, h: 1 }, shirt2) // lap
      for (let y = oy + 2; y < floorY; y++) c.set(2, y, shirt2) // shin
    }
  }

  // ── Cables: the worker's monitor to the rack (straight across at the monitor's second row), and
  // the ceiling tray from the monitor's riser to each station.
  const portY = compact ? mon.y + 1 : mon.y + 2
  const deskPort: [number, number] = [mon.x - 1, portY]
  const rackPort: [number, number] = [rack.x + rack.w - 1, Math.min(rack.y + rack.h - 2, Math.max(rack.y + 1, portY))]
  const toRack = cable(deskPort, rackPort)
  const trayY = P.trayY
  const stationPath = (i: number): [number, number][] => {
    if (trayY == null) return []
    const b = P.stations[i]!
    const pts: [number, number][] = []
    for (let y = mon.y - 1; y >= trayY; y--) pts.push([P.ux, y])
    if (i < ncols) {
      // Upper row: along the tray, then straight down into the box top.
      const tx = b.x + Math.floor(b.w / 2)
      for (let x = P.ux - 1; x >= tx; x--) pts.push([x, trayY])
      for (let y = trayY + 1; y < b.y; y++) pts.push([tx, y])
      return pts
    }
    // Lower row: down the gap right of the box's column (before the rack for the last column),
    // clear of the upper boxes, then an L into the box's right side at its vertical middle.
    const last = i % ncols === ncols - 1
    const gx = last ? b.x + b.w : b.x + b.w + GAP - 1
    const my = b.y + Math.floor(b.h / 2)
    for (let x = P.ux - 1; x >= gx; x--) pts.push([x, trayY])
    for (let y = trayY + 1; y <= my; y++) pts.push([gx, y])
    for (let x = gx - 1; x >= b.x + b.w; x--) pts.push([x, my])
    return pts
  }
  const cableC = scale(T.cable, lights)
  const trayC = scale(T.tray, lights)
  for (const [x, y] of toRack) c.set(x, y, cableC)
  classes.forEach((_, i) => {
    for (const [x, y] of stationPath(i)) if (c.get(x, y) !== cableC) c.set(x, y, trayC)
  })
  // Your own cable: out of your monitor's side, up the gap before the stations into the tray, and
  // along it to the first station's drop.
  const toYou: [number, number][] = []
  if (yd && P.youCableX != null && trayY != null) {
    const gx = P.youCableX
    const py = yd.mon.y + 2
    for (let x = yd.mon.x + yd.mon.w; x < gx; x++) toYou.push([x, py])
    for (let y = py; y >= trayY; y--) toYou.push([gx, y])
    const first = P.stations[0]
    const end = first ? first.x + Math.floor(first.w / 2) : gx
    for (let x = gx + 1; x <= end; x++) toYou.push([x, trayY])
    for (const [x, y] of toYou) if (c.get(x, y) !== cableC) c.set(x, y, trayC)
  }
  const run = (path: [number, number][], color: RGB, speed: number, every: number, reverse = false) => {
    const L = path.length
    if (!L) return
    for (let p = 0; p < L; p += every) {
      const i = Math.floor((p + frame * speed) % L)
      const [x, y] = path[reverse ? L - 1 - i : i]!
      c.set(x, y, color)
      const [tx, ty] = path[reverse ? Math.min(L - 1, L - i) : Math.max(0, i - 1)]!
      c.set(tx, ty, scale(color, 0.45))
    }
  }
  if (st === 'prefill') run(toRack, p.warn, 1.5, 4)
  if (st === 'thinking') run(toRack, p.good, 0.4 + a.intensity * 0.6, 6, true)
  if (active) run(stationPath(classes.indexOf(active)), CLASS_COLOR[active], 1.2, 5)
  if (yd && ya?.state === 'tool') run(toYou, CLASS_COLOR[ya.cls ?? 'other'], 1.2, 6)

  // ── The cat (docs/DESIGN.md 28): beside the desk facing the rack, or on its far end once done.
  {
    const { pose, flick } = catPose(a, frame)
    const spot = done ? P.catDone : P.cat
    if (spot) {
      if (spot.shelf) {
        rect(c, spot.shelf, scale(p.desk, lights))
        c.set(spot.shelf.x + 1, desk.y + 2, scale(T.leg, lights))
        c.set(spot.shelf.x + 1, desk.y + 3, scale(T.leg, lights))
      }
      const sp = amb ? catAmbient(p, pose, flick, frame) : catSprite(p, pose, flick)
      blit(c, sp, spot.box.x, spot.box.y + CAT_H - sp.h, { scale: lights, flipX: true })
    }
  }

  // ── The hand-off: a sheet slides along the floor from your desk to the worker's over
  // SHEET_FRAMES frames, then rests on the worker's desk.
  const fromX = yd ? yd.desk.x + yd.desk.w : 0
  const toX = desk.x - 3
  if (you?.lastHandoff != null) {
    if (!lastSheetAt || you.lastHandoff > lastSheetAt.at) lastSheetAt = { at: you.lastHandoff, frame }
    const prog = frame < lastSheetAt.frame ? 1 : (frame - lastSheetAt.frame) / SHEET_FRAMES
    if (prog < 1) rect(c, { x: Math.round(fromX + (toX - fromX) * prog), y: floorY - 1, w: 3, h: 2 }, T.sheet)
    else if (!(done && !yd)) rect(c, P.sheet, T.sheet)
  }
  // ── The printed slip (docs/DESIGN.md 32): once done it travels back along the same floor from the
  // worker's desk to yours over SLIP_SECS, then rests there, stamped green for success, red otherwise.
  if (done) {
    const prog = s.mtime == null ? 1 : a.secs / SLIP_SECS
    const stamp = a.ok ? p.good : p.bad
    if (prog < 1 && yd) {
      const x = Math.round(toX + (fromX - toX) * prog)
      rect(c, { x, y: floorY - 1, w: 3, h: 2 }, T.sheet)
      c.set(x + 2, floorY - 1, stamp)
    } else {
      rect(c, P.slip, T.sheet)
      c.set(P.slip.x + 2, P.slip.y, stamp)
    }
  }

  // ── Confetti from the ceiling when the tests pass.
  if (pulse?.kind === 'tests-pass') {
    const confetti = [p.good, p.warn, T.sheet]
    const fall = (pulse.age / 8) * (floorY + 8)
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(hash(i * 7 + 1) * (W - 2)) + ((frame + i) % 2)
      const y = Math.floor(fall - hash(i * 3 + 2) * 8)
      if (y >= 0 && y < floorY) c.set(x, y, confetti[i % 3]!)
    }
  }

  // ── Labels: you on the left, the rack's centred under it, the worker's right-aligned to one
  // column before the edge with the worker's context under it; the caption on the last row.
  const lr = P.rows - 1
  const labelRow = lr - 2
  if (done) {
    const mark = a.ok ? '✓' : '✖'
    c.text(mon.x + Math.floor(mon.w / 2), Math.floor((mon.y + mon.h / 2) / 2), mark, a.ok ? p.good : p.bad)
  }
  const mark = done ? (a.ok ? '✓' : '✖') : SPIN[frame % SPIN.length]!
  // The stalled text already says for how long (docs/DESIGN.md 31: one home per fact).
  const caption = done || st === 'nolog' || st === 'stalled' ? `${mark} ${a.text}` : `${mark} ${a.text} · ${fmtDur(a.secs)}`
  const capInk = done ? (a.ok ? p.good : p.bad) : stalled ? p.warn : p.ink
  c.label(1, lr, cut(caption, columns - 2), capInk, capInk)
  // The models belong to the hand-off (docs/DESIGN.md 31): where the strip spells it out
  // (`you · opus 5 → qwen coder`), the desks are just `you` and `worker`. The worker's desk takes
  // its name from `ctx.worker` (`claude` when the pane follows this session, docs/DESIGN.md 36).
  const models = !claimed(ctx.shown, 'handoff')
  let leftEnd = 1
  if (yd) {
    const name = cut(you?.model && models ? `you · ${shortModel(you.model)}` : 'you', yd.desk.w)
    labelIn(p, c, 1, labelRow, name, T.label, T.eye)
    leftEnd = 1 + name.length + 1
  }
  let workerAt = columns - 1
  {
    // The worker's model under its desk, and ` demo` (dim) after it in demo mode when it fits.
    // Beside your desk, or with a name of its own, the desk's name leads (`worker · qwen coder`,
    // `claude · opus 5`); alone and unnamed the model says it, and where the pair does not fit the
    // model stands alone.
    const name = ctx.worker || 'worker'
    const modelName = s.model ? shortModel(s.model) || name : name
    const room = Math.max(1, columns - 1 - (desk.x - 2))
    const tag = isDemo(s) && room >= DEMO_TAG.length + 4 ? DEMO_TAG : ''
    const pair = `${name} · ${modelName}`
    // With the rack standing for the model, the model's name is the rack's: the desk is just its name.
    const deskName = !models || !s.model || modelRack ? name : yd ? pair : ctx.worker && pair.length <= room - tag.length ? pair : modelName
    const shown = cut(deskName, room - tag.length)
    workerAt = columns - 1 - shown.length - tag.length
    labelIn(p, c, workerAt, labelRow, shown, T.label, T.eye)
    if (tag) labelIn(p, c, workerAt + shown.length, labelRow, tag, T.demo, T.eye)
  }
  {
    // The rack's label, centred under it and kept between your label and the worker's.
    const tps = decodeTps(s)
    // A rack standing for the model names it, unless the hand-off (the models' home) is claimed.
    const text = modelRack ? (models ? shortModel(s.model) : '') : !hasServer ? 'no server' : tps && !claimed(ctx.shown, 'decode') ? `${tps.toFixed(0)} tok/s` : s.server!.adapter
    const room = Math.max(0, workerAt - 1 - leftEnd)
    const shown = cut(text, room)
    if (shown) {
      const at = Math.max(leftEnd, Math.min(workerAt - 1 - shown.length, rack.x + Math.floor((rack.w - shown.length) / 2)))
      labelIn(p, c, at, labelRow, shown, hasServer || modelRack ? T.label : T.noServer, T.eye)
    }
  }
  const showCounts = !claimed(ctx.shown, 'tools')
  classes.forEach((cls, i) => {
    const b = P.stations[i]!
    for (let row = b.y >> 1; row <= (b.y + b.h - 1) >> 1; row++) {
      c.text(b.x, row, '▐', frameOf(cls))
      c.text(b.x + b.w - 1, row, '▌', frameOf(cls))
    }
    const ink = active === cls ? p.ink : onStation(cls) ? T.stationInk : T.offInk
    const n = showCounts ? ` ${counts[cls]}` : ''
    const full = `${STATION_NAME[cls]}${n}`
    const name = full.length <= b.w ? full : `${STATION_SHORT[cls] ?? STATION_NAME[cls]}${n}`
    c.label(b.x, Math.floor((b.y + b.h) / 2), cut(name, b.w + GAP - 1), ink, ink)
  })
  if (s.exists && !claimed(ctx.shown, 'ctx')) {
    // The worker's context, right-aligned under its label; the short form where the long one won't fit.
    const limit = ctxLimitOf(s)
    const long = limit ? `ctx ${k(s.ctx)}/${k(limit)} ${Math.round(((s.ctx ?? 0) / limit) * 100)}%` : `ctx ${k(s.ctx)}`
    const short = limit ? `ctx ${Math.round(((s.ctx ?? 0) / limit) * 100)}%` : long
    const text = long.length <= columns - 3 ? long : short
    labelIn(p, c, Math.max(1, columns - 1 - text.length), lr - 1, cut(text, columns - 2), T.stationInk, T.eye)
  }
  return c.encode()
}

/**
 * Draw at the size that fits `ctx.rows` (docs/DESIGN.md 33.1), padded at the top with more wall
 * (none when transparent) for any height between the sizes.
 */
function draw(ctx: SceneCtx): string {
  const P = officePlan(ctx.columns, ctx.rows, ctx.you != null)
  const cells = drawNative(ctx, P)
  if (ctx.rows === P.rows) return cells
  const wall = ctx.transparent === false ? scale(tones(paletteOf(ctx)).wall[0]!, ctx.a.state === 'done' ? 0.5 : 1) : null
  return fitRows(P.rows, ctx, cells, wall == null ? undefined : () => wall)
}

export const office: Scene = { id: 'office', title: 'office', rows: { ...OFFICE_ROWS }, minColumns: 48, draw }
