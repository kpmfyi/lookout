// Scene "office-hd" (HiCanvas; compact 10, standard 15, large 24 rows, any height from 10;
// minColumns 60): the office at 2 × 4 sub-pixels a cell, with the orchestrator and the worker at
// desks facing each other across the room and screens that show the work (docs/DESIGN.md 19, 33.2).
// Left → right: the orchestrator's desk (figure facing right, headset), the tool-station panels in
// two columns of three flanking the model server's rack, the worker's desk (figure facing left).
// A cable tray runs along the ceiling, the worker → rack cable along the floor's back edge. The window
// follows the season and the holidays, a cat sits on the floor by the rack (docs/DESIGN.md 28), and
// every colour is a palette role or a shade of one (27).
//
// The room remembers the run (docs/DESIGN.md 32, `memoryOf`): the board in the top right carries the
// test tally, the star after a red → green flip and the commit parcels on a shelf under it; mugs and
// the hand-off sheet sit on the worker's desk, a paper stack and the bin of crumples under it, red
// sticky notes on the worker monitor's side, one per failing test; the worker cheers after the flip,
// and at the end a printed slip slides back to your desk with a green or red stamp. Each object
// appears once it has something to show.
//
// With no orchestrator known (`ctx.you` absent, docs/DESIGN.md 36: the pane following this session)
// the worker is alone: your desk gives way to a tall window with a plant under it, the tray starts
// at the first drop, and the slip rests on the worker's desk. The worker's desk is named
// `ctx.worker` (`worker`, or `claude`).
//
// One home per fact (docs/DESIGN.md 31): the caption is the only place the current activity is
// spelled out; the worker's monitor shows the work (the last diff, the last command's output) and
// the scene drops its counts, `tok/s`, `GB`, ctx and checks text for a fact `ctx.shown` claims,
// keeping the pictures.
//
// Layout is planned in cells first: every solid shape sits on whole or half cells (even x, rows
// on 0/2 of a cell) so the encoder emits blocks (▀ ▄ ▌ ▐ ▙ ▟ …), and every cell holds at most two
// colours; braille only appears where it is meant as texture (stars, steam, confetti).
// Screens are dark rectangles with text laid in phosphor ink on whole cells; bars are solid
// sub-pixel fills (▆ cells) inside a text row.
//
// Taller than the large size (the showcase, docs/DESIGN.md 39: the ambient layout on a tall pane)
// the room keeps its large layout at the bottom, its tray and cables with it, and the wall above it
// holds screens (`showcaseOf`, hooks/scenes/screens.ts): an instrument row of modules between your
// window and the board, the thinking screen under them, and in the pockets of wall over the desks
// the departures board, the details and the files edited.
//
// Below 60 columns the 60-column layout is drawn and cropped at the right (the worker's desk is
// cut); `geometry` lays out at max(columns, 60) and the canvas clips the rest.
//
// Ambience (docs/DESIGN.md 42), in sub-pixels and only into art: the window's skyline with its lit
// windows and the plane light, rain on the glass or summer fireflies, dust in the daylight under the
// window; string lights under the ceiling tray, a lamplit pool on each desk, steam off the mug by
// the keyboard, the cat breathing and blinking, the solo plant swaying, and a faint scan band down
// the screen rows that carry nothing. A speck that would share a cell with something drawn there
// is left out, so every cell still holds two colours and no text cell changes. `ambience: false`
// draws the room exactly as before.
import type { Summary, ToolClass } from '../../types'
import { classCounts, ctxLimitOf, decodeTps, elapsedOf, fmtDur, isDemo, k, toolClass } from '../activity.ts'
import { TICK_SECS, ambient, ambientTones, breathe, bulbLevel, dustMotes, dusty, lampLevel, skylineTone, steamPuffs, strand, windowFar, windowLook, windowNear } from '../ambience.ts'
import type { Put } from '../ambience.ts'
import { CAT_H, CAT_W, catAmbient, catPose, catSprite } from '../cat.ts'
import { CLASS_GLYPH, G } from '../glyphs.ts'
import { MODULE_FACTS, claimed, factsOf } from '../facts.ts'
import type { Fact } from '../facts.ts'
import { HiCanvas, NONE, cut, hash, mix, scale } from '../hicanvas.ts'
import type { RGB } from '../hicanvas.ts'
import { MAX_RUNS, memoryOf } from '../memory.ts'
import type { RunMemory } from '../memory.ts'
import type { ModuleCtx } from '../modules/index.ts'
import { innerOf, panelOf } from '../panel.ts'
import { fade, paletteOf, perPalette, shade } from '../palette.ts'
import type { Palette, Role } from '../palette.ts'
import { holidayOf, isDay, litLight, seasonOf, seasonTones, weather } from '../seasons.ts'
import { youActivity } from '../you.ts'
import type { Scene, SceneCtx } from './index.ts'
import { modelLoad } from './model.ts'
import { BOARD_MIN_H, DETAILS_MIN_H, MOD_H, THINK_MIN_H, drawDepartures, drawDetails, drawFiles, drawInstruments, drawThinking, instrumentRow } from './screens.ts'

const ROWS = { compact: 10, standard: 15, large: 24 }
const MIN_COLUMNS = 60
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SHEET_FRAMES = 8
/** The widest a monitor grows into the gap by the stations. */
const MONITOR_MAX = 34
/** Seconds the printed slip takes to slide back along the floor once the run is done. */
export const SLIP_SECS = 2
/** Seconds the sticky notes take to fall away after the red → green flip (each a little after the last). */
export const FALL_SECS = 3
export const MAX_NOTES = 4
export const MAX_PARCELS = 6

// ── Colours (docs/DESIGN.md 27): a few per object, each a palette role or a shade derived from one
// (`shade`, hooks/palette.ts: exactly the old value in `night`), worked out once per palette.
function makeTones(p: Palette) {
  const sh = (role: Role, night: RGB) => shade(p, role, night)
  return {
    WALL: p.wall, // one colour: a ramp would band at cell rows and clash with objects
    FLOOR: p.floor,
    GROUND: p.ground,
    DESK: p.desk,
    DESK_TOP: p.deskTop,
    LEG: sh('desk', 0x4a3222),
    SKIN: sh('deskTop', 0xe0b48a),
    HAIR: sh('desk', 0x2a1f1a),
    YOU_HAIR: sh('desk', 0x7a4e2e),
    SHIRT: sh('tools', 0x3d7ea6),
    YOU_SHIRT: sh('think', 0x9a5a9a),
    TROUSERS: sh('rack', 0x34405a),
    SHOE: sh('desk', 0x5a4a3a),
    CHAIR: p.rack,
    HEADSET: sh('bevel', 0x8a8399),
    KEYS: sh('bevel', 0x8a8399),
    EYE: sh('screen', 0x14121c),
    MON: p.mon,
    BEVEL: p.bevel,
    SCREEN: p.screen,
    SCREEN_OFF: p.screenOff,
    PHOS: p.phosphor,
    PHOS_DIM: p.phosphorDim,
    CODE: sh('grid', 0x1f3a2a),
    RACK_FACE: p.rackFace,
    RACK_GAP: sh('rackFace', 0x1c1a24),
    TRACK: sh('mon', 0x34314a), // the memory gauge's slate track
    TRAY: p.tray,
    CABLE: p.cable,
    LAMP_OFF: p.lampOff,
    SKY: p.sky,
    STAR_DIM: sh('sky', 0x2a2f6a),
    FRAME: p.frame,
    MUG: sh('model', 0xc2603a),
    STEAM: sh('inkDim', 0x9a94a8),
    SHEET: sh('star', 0xf4efe6), // the hand-off sheet, white paper in every palette
    PAPER_SHADE: sh('star', 0xc9c1b2), // the shadowed side of a crumpled ball
    PARCEL: sh('deskTop', 0xc49a66), // a commit's parcel: cardboard
    POT: sh('model', 0x9a4a2e), // the solo window's plant: a terracotta pot with a lighter rim
    POT_RIM: sh('model', 0xb85a38),
    LEAF: sh('good', 0x2f6a3e),
    LEAF_HI: sh('good', 0x4a8a56),
    TIE: sh('desk', 0x9a7046), // the taped lid of a parcel
    BIN: sh('mon', 0x4a4560),
    BIN_RIM: sh('bevel', 0x7a7490),
    SCREEN_INK: sh('phosphorGlow', 0xf4efe6), // light text on a screen (screens stay dark in every palette)
    LAMP_RED: sh('bad', 0x401418),
    LAMP_ERR: sh('bad', 0x5a2024),
    LED_OFF: sh('phosphorDim', 0x234030),
    LED_IDLE: sh('phosphorDim', 0x2f5a40),
    POWER: sh('phosphorDim', 0x3f8a52),
    POWER_IDLE: sh('phosphorDim', 0x24402c),
    LABEL: mix(p.ink, p.dim, 0.3),
    DIM_TEXT: mix(p.ink, p.dim, 0.45),
    NO_SERVER: mix(p.ink, p.dim, 0.6),
    BUBBLE: mix(p.think, p.ink, 0.3),
    OFF_INK: sh('screenOff', 0x3a3d44), // a label on a screen that is off: legible, clearly not lit
    OFF_DIM: sh('screenOff', 0x2a2d33), // an idle screen's cursor: there, and quiet
  }
}
const tones = perPalette(makeTones)

type Size = 'compact' | 'standard' | 'large'
/** A cell (column, row). */
export type Cell = [number, number]
/** A rectangle of cells. */
export type Box = { col: number; row: number; w: number; h: number }
/** A rectangle of sub-pixels. */
export type Px = { x: number; y: number; w: number; h: number }

/** One desk: the figure, its monitor and the riser from the monitor's top into the ceiling tray. */
export type DeskGeom = {
  /** +1 the figure faces right (the orchestrator), -1 it faces left (the worker). */
  dir: 1 | -1
  /** The screen cell of the desk's local cell 0 (the chair, at the outer wall). */
  rel0: number
  /** The monitor's text cells. */
  screen: Box
  /** The monitor's top bezel row (the bezel fills its lower half). */
  top: number
  /** The cell column of the riser cable, at the monitor's inner edge. */
  riser: number
  /** First and last cell of the desk's zone, left → right. */
  zone: [number, number]
  /** The 4 × 8 head: left and top sub-pixel, and its centre x. */
  head: { x: number; y: number; cx: number }
  /** The eye: a 1 × 2 sub-pixel mark on the head's inner side. */
  eye: { x: number; y: number }
}

export type Geometry = {
  size: Size
  /** Layout columns (at least 60) and rows. */
  C: number
  R: number
  /**
   * The room's ceiling row, where the cable tray runs: 0, or on a canvas taller than the large size
   * (the showcase, docs/DESIGN.md 39) the rows above the room, which keeps its large layout at the
   * bottom and leaves the wall over it to the wall screens (`showcaseOf`).
   */
  top: number
  /** Cell rows: the floor line (top half of F), the desk plank, labels, caption. */
  F: number
  D: number
  labelRow: number
  capRow: number
  /**
   * No orchestrator in the room (docs/DESIGN.md 36: `ctx.you` absent, as when the pane follows this
   * session): the worker works alone, and `orch` only reserves the left zone, which holds a tall
   * window and a plant under it instead of your desk.
   */
  solo: boolean
  orch: DeskGeom
  worker: DeskGeom
  /** Panel width and height (cells), the row pitch from one panel to the next (PH plus a gap on
   * tall walls); the panels' top row; the two panel columns' first cell. */
  P: number
  PH: number
  PS: number
  pt: number
  panelL: number
  panelR: number
  /** The drop cables' cells: right of the left column, left of the right column. */
  dropL: number
  dropR: number
  /**
   * A showcase's cable lanes: the free column left of the stations and the one right of them, down
   * which the tray's ends run to the row over each monitor (docs/DESIGN.md 39); null otherwise.
   */
  lanes: { left: number; right: number } | null
  /** The first cell the board's widest face may take (two right of the worker's riser as the desks first stand). */
  boardMin: number
  rack: { col: number; w: number; lines: number }
  /**
   * The window's first and last sky cell, the row of its top frame (the sky starts on the row under
   * it) and the sky's height in rows (the sill under it). Your window stays in the top left corner of
   * a showcase; the solo window, standing over the plant, moves with the room.
   */
  window: { c0: number; c1: number; top: number; sky: number } | null
  /** The plant under the solo window (sub-pixels: the pot's box, the leaves above it), or null. */
  plant: { pot: Px; leaves: Px[] } | null
  /** The elapsed badge, on its own or in the board's corner: its last cell (one column in from the
   * right edge) and its text row. Null where the wall over the worker's monitor is too low. */
  clock: { right: number; row: number } | null
  /** Cable paths, cell by cell, in the direction packets travel. */
  paths: { orch: Cell[]; toRack: Cell[]; station: Record<ToolClass, Cell[]> }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** The left column's classes, then the right column's (top → bottom). */
const LEFT: ToolClass[] = ['shell', 'read', 'edit']
const RIGHT: ToolClass[] = ['search', 'web', 'agent']
const NAMES: Record<ToolClass, [string, string, string]> = {
  shell: ['$', '$', '$'],
  read: ['read', 'rd', 'r'],
  edit: ['edit', 'ed', 'e'],
  search: ['grep', 'gr', 'g'],
  web: ['web', 'web', 'w'],
  agent: ['agent', 'ag', 'a'],
  other: ['other', 'ot', 'o'],
}

function deskGeom(dir: 1 | -1, C: number, D: number, tw: number, th: number): DeskGeom {
  const rel0 = dir > 0 ? 1 : C - 2
  const cell = (r: number) => (dir > 0 ? rel0 + r : rel0 - r)
  const X = (dx: number) => (dir > 0 ? 2 * rel0 + dx : 2 * rel0 + 1 - dx)
  const hy = (D - 4) * 4
  const hx = Math.min(X(4), X(7))
  const end = cell(8 + tw)
  return {
    dir,
    rel0,
    screen: { col: dir > 0 ? cell(8) : cell(7 + tw), row: D - 1 - th, w: tw, h: th },
    top: D - 2 - th,
    riser: cell(8 + tw),
    zone: [Math.min(rel0, end), Math.max(rel0, end)],
    head: { x: hx, y: hy, cx: hx + 1.5 },
    eye: { x: X(7), y: hy + 4 },
  }
}

/** The sub-pixels of a desk's local span `dx .. dx + w - 1` (mirrored for the worker), `y .. y + h - 1`. */
function local(d: DeskGeom, dx: number, w: number, y: number, h: number): Px {
  return { x: d.dir > 0 ? 2 * d.rel0 + dx : 2 * d.rel0 + 2 - dx - w, y, w, h }
}

const vcells = (out: Cell[], col: number, r0: number, r1: number): Cell[] => {
  const d = r1 >= r0 ? 1 : -1
  for (let r = r0; r !== r1 + d; r += d) out.push([col, r])
  return out
}
const hcells = (out: Cell[], row: number, c0: number, c1: number): Cell[] => {
  const d = c1 >= c0 ? 1 : -1
  for (let c = c0; c !== c1 + d; c += d) out.push([c, row])
  return out
}

/**
 * Where everything sits for a canvas of `columns × rows` cells (laid out at max(columns, 60)), with
 * your desk on the left (`withYou`) or, solo, the tall window and the plant in its place.
 */
export function geometry(columns: number, rows: number, withYou = true): Geometry {
  const C = Math.max(MIN_COLUMNS, Math.floor(columns))
  const R = Math.max(ROWS.compact, Math.floor(rows))
  const size: Size = R >= ROWS.large ? 'large' : R >= ROWS.standard ? 'standard' : 'compact'
  // The showcase (docs/DESIGN.md 39): taller than the large size, the room keeps its large layout at
  // the bottom; `top` is its ceiling row, and every row above it is the wall screens'.
  const top = R > ROWS.large ? R - ROWS.large : 0
  const capRow = R - 1
  const labelRow = R - 2
  const F = R - 3
  const D = size === 'compact' ? F - 2 : F - 3
  const oW = clamp(12 + Math.floor((C - 80) / 10), 10, 20)
  const wW = clamp(16 + Math.floor((C - 80) / 8), 14, 26)
  const oH = size === 'compact' ? 1 : size === 'standard' ? 2 : 3
  const wH = size === 'compact' ? 1 : size === 'standard' ? 3 : 4
  let orch = deskGeom(1, C, D, oW, oH)
  let worker = deskGeom(-1, C, D, wW, wH)

  // ── The back wall between the desks: panel column, drop, rack, drop, panel column.
  const m0 = orch.zone[1] + 1
  const m1 = worker.zone[0] - 1
  const M = m1 - m0 + 1
  const RW = M >= 40 ? 12 : M >= 28 ? 10 : M >= 22 ? 8 : 4
  const P = clamp(Math.floor((M - RW - 4) / 2), 2, clamp(Math.floor(C / 8), 9, 22))
  const left = M - RW - 2 - 2 * P
  const g2 = clamp(Math.floor((left - 2) / 4), 0, 3)
  const side = Math.max(0, left - 2 * g2)
  const gL = Math.floor(side / 2)
  const panelL = m0 + gL
  const dropL = panelL + P
  const rackCol = dropL + 1 + g2
  const dropR = rackCol + RW + g2
  const panelR = dropR + 1
  // Large panels carry three text rows (count, last label, the one before). The lowest panel ends
  // three rows over the floor line, or four where the wall has a row to spare above the panels, so
  // the cat sits on the floor under it (docs/DESIGN.md 33.2); the test tally that used to hang over
  // the panels is on the board now. The room under a showcase's ceiling is the large room.
  const PH = size === 'large' ? 5 : 3
  const free = F - top - 3 - 3 * PH - 5
  const gap = size === 'large' ? clamp(Math.floor(free / 2), 0, 2) : 0
  const PS = PH + gap
  const base = F - 2 - 3 * PH - 2 * gap
  const pt = size === 'compact' ? F - 6 : base - top >= 2 ? base - 1 : base
  const lines = RW < 7 ? 0 : size === 'compact' ? 1 : size === 'standard' ? 2 : 3
  // The board's widest face begins two cells right of the worker's riser as the desks first stand.
  const boardMin = worker.riser + 2

  // ── The monitors widen into the gap by the stations, up to the free column each side of them (the
  // figures and chairs stay put; the desk grows with its monitor). In a showcase (docs/DESIGN.md 39)
  // those columns are cable lanes: the tray's ends drop down them and run along the row over each
  // monitor, so the pockets of wall over the desks reach the stations.
  const beside = { left: panelL - 1, right: panelR + P }
  if (withYou) orch = deskGeom(1, C, D, Math.min(MONITOR_MAX, oW + Math.max(0, beside.left - 1 - orch.zone[1])), oH)
  worker = deskGeom(-1, C, D, Math.min(MONITOR_MAX, wW + Math.max(0, worker.zone[0] - beside.right - 1)), wH)
  const lanes = top > 0 && size === 'large' ? beside : null

  // ── Window (top left) and the elapsed badge or board (top right), where the wall above the heads has room.
  // Solo, the window takes your desk's place: as wide as the zone allows (15 cells at most, centred,
  // its frame a cell clear of the zone's ends) and tall, from the top row to a sill a row over the
  // desks' height, with a potted plant on the floor under it.
  const skyRows = Math.min(D - 7, 4)
  let win: Geometry['window'] = skyRows >= 1 ? { c0: 2, c1: Math.min(orch.riser - 2, 14), top: 0, sky: skyRows } : null
  let plant: Geometry['plant'] = null
  if (!withYou) {
    const z0 = orch.zone[0]
    const zw = orch.zone[1] - z0 + 1
    const inner = Math.min(15, zw - 4)
    const c0 = z0 + 1 + ((zw - inner - 2) >> 1)
    win = { c0, c1: c0 + inner - 1, top, sky: Math.max(1, D - 2 - top) }
    // The plant: a pot two cells wide and half a row tall on the floor line, under the window's
    // middle, and leaves in whole half cells above it, up to the row under the sill.
    const mid = (c0 + inner / 2) | 0
    const pot: Px = { x: (mid - 1) * 2, y: F * 4 - 4, w: 4, h: 4 }
    const room = F * 4 - 4 - D * 4 // sub-pixel rows between the sill's row and the pot
    const leaves: Px[] = []
    if (room >= 4) {
      const tall = Math.min(room, size === 'compact' ? 4 : 8)
      leaves.push({ x: pot.x, y: pot.y - tall, w: 4, h: tall }) // the stem's bush over the pot
      leaves.push({ x: pot.x - 2, y: pot.y - tall + 2, w: 2, h: 2 }) // a leaf out to each side
      leaves.push({ x: pot.x + 4, y: pot.y - tall + (tall >= 8 ? 4 : 2), w: 2, h: 2 })
    }
    plant = { pot, leaves }
  }
  const clock = D - 5 >= 3 ? { right: C - 2, row: 1 } : null

  // ── Cables. The tray (the ceiling row) joins the risers; the drops hang from it beside the panels.
  const screenRow = (i: number) => pt + i * PS + 1
  const lastDropRow = size === 'compact' ? pt + 1 : screenRow(2)
  // Up the risers to the tray; in a showcase along the row over each monitor and up its lane first.
  const orchPath = !withYou ? [] : lanes ? hcells(vcells(hcells([], orch.top - 1, orch.riser, lanes.left), lanes.left, orch.top - 2, top + 1), top, lanes.left, lanes.right) : hcells(vcells([], orch.riser, orch.top - 1, top + 1), top, orch.riser, worker.riser)
  const riserW = lanes ? vcells(hcells([], worker.top - 1, worker.riser, lanes.right), lanes.right, worker.top - 2, top + 1) : vcells([], worker.riser, worker.top - 1, top + 1)
  const trayR = lanes ? lanes.right : worker.riser
  const station = {} as Record<ToolClass, Cell[]>
  for (const cls of [...LEFT, ...RIGHT, 'other'] as ToolClass[]) {
    const path = riserW.slice()
    if (cls === 'other') {
      hcells(path, top, trayR, rackCol + (RW >> 1))
    } else if (size === 'compact') {
      hcells(path, top, trayR, dropR)
      vcells(path, dropR, top + 1, lastDropRow)
    } else {
      const li = LEFT.indexOf(cls)
      const drop = li >= 0 ? dropL : dropR
      hcells(path, top, trayR, drop)
      vcells(path, drop, top + 1, screenRow(li >= 0 ? li : RIGHT.indexOf(cls)))
    }
    station[cls] = path
  }
  const floorCol = worker.zone[0] - 1
  const toRack = vcells([], floorCol, D, F - 1)
  hcells(toRack, F - 1, floorCol - 1, rackCol + RW)

  return {
    size, C, R, top, F, D, labelRow, capRow, solo: !withYou, orch, worker, P, PH, PS, pt, panelL, panelR, dropL, dropR, lanes, boardMin,
    rack: { col: rackCol, w: RW, lines },
    window: win,
    plant,
    clock,
    paths: { orch: orchPath, toRack, station },
  }
}

/** The pumpkin's cells (31 October): three cells on the worker's monitor, near its outer end, two rows from the one above the bezel. */
export function pumpkinCells(g: Geometry): Box | null {
  const sc = g.worker.screen
  return sc.w >= 6 ? { col: sc.col + sc.w - 4, row: g.worker.top - 1, w: 3, h: 2 } : null
}

/**
 * The cat's box in sub-pixels (docs/DESIGN.md 28, 33.2): sitting on the floor line just left of the
 * rack, under the left panel column, its last row on the line's top edge and its ears under the
 * lowest panel's bezel; a cell clear of the rack's frame. None in the compact size, where the lamp
 * labels sit there, when it would reach the orchestrator's desk, or past the pane's right edge
 * (below 60 columns the layout is cropped). It fits from 62 columns.
 */
export function catBox(g: Geometry, columns = g.C): Px | null {
  if (g.size === 'compact') return null
  const col = g.rack.col - 1 - CAT_W
  if (col <= g.orch.zone[1] + 1 || col + CAT_W > columns) return null
  return { x: col * 2, y: g.F * 4 - CAT_H * 2, w: CAT_W * 2, h: CAT_H * 2 }
}

/** A model id for a label: the last path segment, no `claude-`, its first two words ("opus 5"). */
function shortModel(id: string | null | undefined): string {
  if (!id) return ''
  return (id.split('/').at(-1) ?? '').replace(/^claude-/, '').split('-').slice(0, 2).join(' ')
}

function base(path: string): string {
  return path.split('/').at(-1) ?? path
}

/**
 * The newest two distinct labels of each tool class in the timeline, newest first (file names as
 * their base name). The call still running is left out: it is the activity, whose one home is the
 * caption (docs/DESIGN.md 31).
 */
function recentLabels(s: Summary): Partial<Record<ToolClass, string[]>> {
  const out: Partial<Record<ToolClass, string[]>> = {}
  const ev = s.events ?? []
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i]!
    if (e.kind !== 'tool' || e.status === 'running') continue
    const cls = e.cls ?? toolClass(e.tool)
    const list = (out[cls] ??= [])
    const label = cls === 'read' || cls === 'edit' ? base(e.label) : e.label
    if (list.length < 2 && !list.includes(label)) list.push(label)
  }
  return out
}

/**
 * Tests and tsc, the longest form that fits `w`. Each reading keeps a space before the next, and
 * the type-check (the lower priority) goes before the tests' reading is shortened (docs/DESIGN.md
 * 33.2: never `✖ 1 failing tsc✓`). Empty with neither.
 */
export function checksLine(s: Summary, w: number, none = 'no tests yet'): string {
  const t = s.tests?.at(-1)
  const tsc = s.tsc?.at(-1)
  // The marks say pass and fail (docs/DESIGN.md 41): `✓ 12/12`, `✖ 2 failing`, `tsc ✓`.
  const long = t ? (t.failed > 0 ? `${G.failed} ${t.failed} failing` : `${G.ok} ${t.passed}/${t.total}`) : tsc ? '' : none
  const mid = long
  const short = t ? (t.failed > 0 ? `${G.failed} ${t.failed}` : `${G.ok} ${t.passed}`) : long
  const tl = tsc ? (tsc.errors > 0 ? `tsc ${G.failed} ${tsc.errors}` : `tsc ${G.ok}`) : ''
  const join = (a: string, b: string, sep: string) => (a && b ? `${a}${sep}${b}` : a || b)
  for (const line of [join(long, tl, ' · '), join(mid, tl, ' · '), long, mid, join(short, tl, ' · '), short]) {
    if (line.length <= w) return line
  }
  return ''
}

/** Which of the worker's last pieces of work is newer: the diff, the command, or neither. */
export function workOf(s: Summary): 'diff' | 'bash' | null {
  const d = s.last_diff
  const b = s.last_bash
  if (d && (!b || (d.t ?? -Infinity) > (b.t ?? -Infinity))) return 'diff'
  return b ? 'bash' : null
}

export type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string }

/**
 * A diff's lines for a screen of `h` rows (no file or hunk headers): from one line of context before
 * the first change (none on a screen of three rows or fewer, which the changes fill), with the
 * indent the changes share removed.
 */
export function diffLines(diff: string, h: number): DiffLine[] {
  const all: DiffLine[] = []
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('@@') || raw.startsWith('\\')) continue
    const kind = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : 'ctx'
    all.push({ kind, text: (kind !== 'ctx' || raw[0] === ' ' ? raw.slice(1) : raw).replace(/\t/g, '  ').trimEnd() })
  }
  const first = all.findIndex(l => l.kind !== 'ctx')
  const from = clamp(first - (h >= 4 ? 1 : 0), 0, Math.max(0, all.length - h))
  const shown = all.slice(from, from + Math.max(0, h))
  // The indent the changed lines share (or all of them, with no change in view); a shallower
  // context line loses only its own.
  const lead = (l: DiffLine) => l.text.length - l.text.trimStart().length
  const by = shown.some(l => l.kind !== 'ctx') ? shown.filter(l => l.kind !== 'ctx') : shown
  let indent = Infinity
  for (const l of by) if (l.text.trim()) indent = Math.min(indent, lead(l))
  const cutBy = Number.isFinite(indent) ? indent : 0
  return shown.map(l => ({ kind: l.kind, text: l.text.slice(Math.min(cutBy, lead(l))) }))
}

/** The last command's output for a screen of `h` rows: its newest non-blank lines, leading spaces trimmed. */
export function outputLines(out: readonly string[], h: number): string[] {
  const lines = out.map(l => l.replace(/\t/g, '  ').trim()).filter(Boolean)
  return h <= 0 ? [] : lines.slice(-h)
}

/** Words of `text` laid into rows of `w` cells, at most `n` rows; the last one cut when more is left. */
export function wrap(text: string, w: number, n: number): string[] {
  const out: string[] = []
  const words = text.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length && out.length < n) {
    if (out.length === n - 1) {
      out.push(cut(words.slice(i).join(' '), w))
      break
    }
    let line = cut(words[i++]!, w)
    while (i < words.length && line.length + 1 + words[i]!.length <= w) line += ' ' + words[i++]!
    out.push(line)
  }
  return out
}

/**
 * Where the run memory's objects sit (docs/DESIGN.md 32), in sub-pixels. On the worker's desk, in
 * front of the monitor on the desk's top: the mugs (the first between the keyboard and the monitor,
 * the rest along the front of the monitor, clear of the stand and the hand-off sheet). Under the desk,
 * on the floor line: the bin by the worker's feet with the crumples piled in and over it (spilling
 * on the floor from the seventh), the paper stack at the desk's inner leg. On the worker monitor's
 * side facing the worker: the sticky notes, one per row from the bottom. Each list is empty, or the
 * box null, when the memory has nothing for it or the room has no space.
 */
export type Props = { mugs: Px[]; pages: Px | null; bin: Px | null; crumples: Px[]; notes: Px[] }

export function props(g: Geometry, m: RunMemory, opts: { stalled?: boolean; light?: boolean; failing?: number } = {}): Props {
  const { worker: d, D, F } = g
  const tw = d.screen.w
  const front = (D - 1) * 4 + 2 // the desk top's half row in front of the monitor
  const sm = 7 + ((tw + 2) >> 1) - 1 // the monitor stand's first local cell
  const mugCells: number[] = []
  const nMugs = Math.max(m.mugs, opts.stalled ? 1 : 0)
  if (nMugs > 0) mugCells.push(6)
  for (let k = 11; mugCells.length < nMugs && k <= 7 + tw; k += 2) {
    if (k === sm || k === sm + 1) continue
    mugCells.push(k)
  }
  const mugs = mugCells.map(k => local(d, k * 2, 2, front, 2))
  const under = (F - D - 1) * 4 // the sub-pixel height under the plank
  // The paper stack: one sheet a sub-pixel (in a light palette two, so it keeps to half cells).
  const ph = Math.min(under, opts.light ? 2 * Math.ceil(m.pages / 2) : m.pages)
  const pages = m.pages > 0 && ph > 0 ? local(d, 2 * (6 + tw), 4, F * 4 - ph, ph) : null
  const bin = m.crumples > 0 && under >= 4 ? local(d, 16, 6, F * 4 - 4, 4) : null
  const crumples: Px[] = []
  if (bin) {
    // In the bin's rim and over it (half cells), then on the floor beside it, toward the room.
    const toward = (cells: number) => (d.dir > 0 ? bin.x + bin.w + (cells - 1) * 2 : bin.x - cells * 2)
    const slots: [number, number][] = [
      [bin.x + 2, bin.y - 2], [bin.x, bin.y - 2], [bin.x + 4, bin.y - 2],
      [bin.x + 2, bin.y - 4], [bin.x, bin.y - 4], [bin.x + 4, bin.y - 4],
      [toward(1), bin.y + 2], [toward(2), bin.y + 2], [toward(1), bin.y],
    ]
    for (const [x, y] of slots) {
      if (crumples.length >= m.crumples) break
      if (y >= (D + 1) * 4) crumples.push({ x, y, w: 2, h: 2 })
    }
  }
  const notes: Px[] = []
  const nNotes = Math.min(MAX_NOTES, opts.failing ?? m.failing)
  for (let i = 0; i < nNotes; i++) {
    const row = D - 2 - i
    if (row < d.top) break
    notes.push(local(d, 12, 3, row * 4 + 2, 2))
  }
  return { mugs, pages, bin, crumples, notes }
}

/**
 * Where the printed slip rests once the run is done: three cells on the desk top in front of your
 * monitor, the stamp on the outer one; solo, on the worker's desk where the hand-off sheet rests.
 */
export function slipBox(g: Geometry): Px {
  return local(g.solo ? g.worker : g.orch, 16, 6, (g.D - 1) * 4 + 2, 2)
}

/**
 * The board in the top right (docs/DESIGN.md 33.2): a slate-framed face with the test tally (one
 * mark per run, oldest left), the star once the tests went red → green, the checks' reading and,
 * in its top right corner, the elapsed time; under it a shelf with a parcel per commit. Readings
 * drop for a claimed fact; the face is not drawn with nothing on it, the shelf not without commits.
 * Laid out from the right edge inward, one column in, clear of the worker's riser and above the
 * worker's monitor with half a row to spare.
 */
export type Board = {
  /** The face's ring of cells (the frame on the ring's inner halves), or null. */
  face: Box | null
  /** The tally marks: a cell each, in the face's first text row. */
  marks: { col: number; row: number; ok: boolean }[]
  star: Cell | null
  /** The tally's name (only with no reading beside it), the elapsed time and the checks' reading, as placed. */
  label: { col: number; row: number; text: string } | null
  elapsed: { col: number; row: number; text: string } | null
  checks: { col: number; row: number; text: string } | null
  /** The shelf's plank and the parcels on it (sub-pixels), or null / empty. */
  shelf: Px | null
  parcels: Px[]
}

export function boardOf(g: Geometry, s: Summary, m: RunMemory, t: number, shown?: ReadonlySet<Fact>, pumpkin?: Box | null): Board {
  const none: Board = { face: null, marks: [], star: null, label: null, elapsed: null, checks: null, shelf: null, parcels: [] }
  if (!g.clock) return none
  const right = g.clock.right // the ring's right cell
  const minCol = g.boardMin
  const maxW = right - minCol - 1 // the widest face, inside its ring
  const top = g.worker.top - g.top // the wall over the worker's monitor (a showcase's board stays at the top, laid out as the large room's)
  const dur = claimed(shown, 'elapsed') ? '' : cut(s.exists ? fmtDur(elapsedOf(s, t)) : '--', 8)
  const showChecks = !claimed(shown, 'checks') && (m.runs.length > 0 || (s.tsc?.length ?? 0) > 0)
  const star = m.flip != null
  const two = top >= 6 && showChecks // a second text row for the reading
  const after = (w: number, add: number) => (add > 0 ? w + (w > 0 ? 1 : 0) + add : w)
  // The tally, the reading and the elapsed time laid along the face for an elapsed text `el`.
  const lay = (el: string) => {
    let runs = m.runs.slice(-MAX_RUNS)
    const tallyW = () => runs.length + (star ? (runs.length ? 2 : 1) : 0)
    let reading = ''
    let rowA = 0
    let rowB = 0
    for (;;) {
      rowA = after(tallyW(), el.length)
      if (showChecks && !two) {
        // One text row: the reading between the tally and the elapsed, the longest form that fits.
        const room = maxW - after(tallyW(), 0) - (tallyW() ? 1 : 0) - (el ? el.length + 1 : 0)
        reading = checksLine(s, room, '')
        rowA = after(after(tallyW(), reading.length), el.length)
      } else if (showChecks) {
        reading = checksLine(s, maxW, '')
        rowB = reading.length
      }
      if (rowA <= maxW || runs.length === 0) break
      runs = runs.slice(1) // too narrow for the whole tally: the newest marks
    }
    return { el, runs, tallyW, reading, rowA, rowB }
  }
  // The elapsed time behind its clock glyph (docs/DESIGN.md 41) where the glyph costs no reading and no mark.
  const bare = lay(dur)
  const glyphed = dur ? lay(`${G.time} ${dur}`) : bare
  const chosen = glyphed.reading === bare.reading && glyphed.runs.length === bare.runs.length ? glyphed : bare
  const { el, runs, tallyW, reading } = chosen
  let { rowA } = chosen
  const { rowB } = chosen
  // With no reading beside it (claimed, or no room) the tally gets its name in front.
  const label = !reading && runs.length > 0 && rowA + 6 <= maxW ? 'tests' : ''
  const lw = label ? label.length + 1 : 0
  if (label) rowA += lw
  const W = Math.max(rowA, rowB)
  const out: Board = { ...none }
  if (W > 0 && W <= maxW) {
    const rows = two && reading && rowA > 0 ? 2 : 1
    // A showcase's board beside the instrument row keeps its widest face, so the row ends at a fixed edge.
    const col0 = right - (g.top >= 6 ? maxW : W) - 1
    out.face = { col: col0, row: 0, w: right - col0 + 1, h: rows + 2 }
    if (label) out.label = { col: col0 + 1, row: 1, text: label }
    out.marks = runs.map((r, i) => ({ col: col0 + 1 + lw + i, row: 1, ok: r.ok }))
    if (star) out.star = [col0 + 1 + lw + runs.length + (runs.length ? 1 : 0), 1]
    if (el) out.elapsed = { col: right - el.length, row: 1, text: el }
    if (reading) out.checks = rows === 2 ? { col: col0 + 1, row: 2, text: reading } : { col: col0 + 1 + after(tallyW(), 0) + (tallyW() ? 1 : 0), row: 1, text: reading }
  }
  // The shelf: tall parcels (a whole row, with a tie) on a plank in the next row's top half when two
  // rows are free above the monitor's top; flat ones (half a row) on a plank in the same row with one.
  const n = Math.min(MAX_PARCELS, m.commits)
  if (n > 0) {
    const sr = out.face ? out.face.row + out.face.h : 0
    const room = top - sr
    const tall = room >= 2
    if (room >= 1) {
      let left = minCol
      // On 31 October the pumpkin sits on the monitor's top: a shelf down to its rows keeps right of it.
      if (pumpkin && (tall ? sr + 1 : sr) >= pumpkin.row) left = Math.max(left, pumpkin.col + pumpkin.w + 1)
      const fit = Math.min(n, Math.floor((right - left) / 3))
      if (fit > 0) {
        const face = out.face
        const plankL = Math.max(left, Math.min(face ? face.col : right, right - 3 * fit))
        const x0 = plankL * 2 + 1
        const x1 = right * 2 // the frame's outer edges: the ring cells' inner halves
        out.shelf = tall ? { x: x0, y: (sr + 1) * 4, w: x1 - x0 + 1, h: 2 } : { x: x0, y: sr * 4 + 2, w: x1 - x0 + 1, h: 2 }
        for (let i = 0; i < fit; i++) {
          const pc = plankL + 1 + i * 3
          out.parcels.push(tall ? { x: pc * 2, y: sr * 4, w: 4, h: 4 } : { x: pc * 2, y: sr * 4, w: 4, h: 2 })
        }
      }
    }
  }
  return out
}

/**
 * The instruments a showcase mounts on its wall (docs/DESIGN.md 39), in the order of what they are
 * worth: the readings the room does not draw itself. The stations claim the tool counts, the rack
 * the decode speed and the memory, the board the checks and the elapsed time, the shelf the commits,
 * so no ledmatrix, vu, lamps or clock (the clock would join only where the board cannot carry the
 * elapsed time, and its fact is claimed then too). With no cost estimate the cost's slot holds the
 * output (or, where the output has its own slot, the errors). A wide row takes the output and the
 * errors too, so it fills its width with whole modules before it stretches them.
 */
export const SHOWCASE_MODULES = ['counter:turns', 'dial:ctx', 'scope:pace', 'river', 'counter:cost', 'counter:out', 'counter:errors'] as const
/** What the room itself spells out, passed to the wall's modules so they leave it to the room. */
const ROOM_FACTS: readonly Fact[] = ['tools', 'decode', 'memory', 'checks', 'elapsed', 'handoff', 'git']

/** The showcase's modules for `shown`: those with a fact nothing else in the pane spells out. */
export function showcaseModules(shown?: ReadonlySet<Fact>): string[] {
  return SHOWCASE_MODULES.filter(id => {
    const facts = MODULE_FACTS[id] ?? []
    return facts.length === 0 || !facts.every(f => claimed(shown, f))
  })
}

/**
 * The wall screens of a showcase (docs/DESIGN.md 39), in cells; empty under the large size. The room
 * keeps its large layout at the bottom; the wall over it holds, by what fits whole:
 * - the instrument row across the top between your window and the board (from the left edge solo),
 *   once the room's ceiling is six rows down; with no band under it the modules take the rows to the
 *   ceiling;
 * - from eleven rows, the band across the width under them: the thinking screen, taking every row
 *   left; on a band of 18 rows the details screen takes its lower third;
 * - the pockets of wall over the desks (left of your riser, right of the worker's, down to a row over
 *   the monitors): over the worker's desk the departures board, or the thinking screen while the band
 *   is too low for it; over your desk the departures board while the thinking screen is in the right
 *   pocket, else the details screen, or the files edited once the details have their place in the
 *   band. Solo there is no left pocket (the tall window stands there).
 * Positions follow the geometry and the modules' ids alone, so nothing moves during a run.
 */
export type Showcase = { instruments: { id: string; box: Box }[]; thinking: Box | null; departures: Box | null; details: Box | null; files: Box | null }

export function showcaseOf(g: Geometry, ids: readonly string[] = SHOWCASE_MODULES): Showcase {
  const out: Showcase = { instruments: [], thinking: null, departures: null, details: null, files: null }
  const off = g.top
  if (off <= 0) return out
  const C = g.C
  const wide = (b: Box | null, h: number): b is Box => b != null && b.h >= h && b.w >= 16
  // The pockets: a row under the window's sill and the board's shelf at the least, from the wall's
  // edge to the cable lane beside the stations.
  const p0 = Math.max(off + 1, 6)
  const lanes = g.lanes ?? { left: g.orch.riser - 1, right: g.worker.riser + 1 }
  const left: Box | null = g.solo ? null : { col: 1, row: p0, w: lanes.left - 1, h: g.orch.top - 1 - p0 }
  const right: Box = { col: lanes.right + 1, row: p0, w: C - 2 - lanes.right, h: g.worker.top - 1 - p0 }
  // The top row: from the window's sill (solo, the left edge) to where the board's face begins.
  const mL = g.solo || !g.window ? 1 : g.window.c1 + 3
  const band = off >= 6 + THINK_MIN_H
  const hm = band ? MOD_H : off - 1
  if (hm >= MOD_H) out.instruments = instrumentRow(ids, { col: mL, row: 0, w: g.boardMin - mL, h: hm })
  if (band) {
    const full: Box = { col: 1, row: 6, w: C - 2, h: off - 6 }
    if (full.h >= 3 * DETAILS_MIN_H) {
      const dh = clamp(Math.floor(full.h / 3), DETAILS_MIN_H, 10)
      out.thinking = { ...full, h: full.h - dh }
      out.details = { ...full, row: full.row + full.h - dh, h: dh }
      if (wide(left, DETAILS_MIN_H)) out.files = left
    } else {
      out.thinking = full
      if (wide(left, DETAILS_MIN_H)) out.details = left
    }
    if (wide(right, BOARD_MIN_H)) out.departures = right
  } else {
    if (wide(right, THINK_MIN_H)) out.thinking = right
    if (wide(left, BOARD_MIN_H)) out.departures = left
  }
  return out
}

/**
 * The one piece of animation state: the hand-off last drawn (`you.lastHandoff`) and the frame its
 * sheet began to slide. A newer hand-off starts a new slide; the sheet then rests by the worker's
 * keyboard. A reload starts empty. (The slip back at the end is a function of the clock instead:
 * the result's time is in the summary.)
 */
let lastSheet: { at: number; frame: number } | null = null

function draw(ctx: SceneCtx): string {
  const { s, a, frame, t, columns, you } = ctx
  const p = paletteOf(ctx)
  const { WALL, FLOOR, GROUND, DESK, DESK_TOP, LEG, SKIN, HAIR, YOU_HAIR, SHIRT, YOU_SHIRT, TROUSERS, SHOE, CHAIR, HEADSET, KEYS, EYE, MON, BEVEL, SCREEN, SCREEN_OFF, PHOS, PHOS_DIM, CODE, RACK_FACE, RACK_GAP, TRACK, TRAY, CABLE, LAMP_OFF, SKY, STAR_DIM, FRAME, MUG, STEAM, SHEET, PAPER_SHADE, PARCEL, POT, POT_RIM, LEAF, LEAF_HI, TIE, BIN, BIN_RIM, SCREEN_INK, LAMP_RED, LAMP_ERR, LED_OFF, LED_IDLE, POWER, POWER_IDLE, LABEL, DIM_TEXT, NO_SERVER, BUBBLE, OFF_INK, OFF_DIM } = tones(p)
  const { good: GOOD, bad: BAD, warn: WARN, think: THINK, classes: CLASS_COLOR } = p
  const transparent = ctx.transparent ?? true
  const rows = Number.isFinite(ctx.rows) ? Math.max(1, Math.floor(ctx.rows)) : ROWS.standard
  const c = new HiCanvas(columns, rows)
  const g = geometry(columns, rows, you != null) // laid out for at least 10 rows; a shorter canvas clips
  const { F, D, size, orch, worker, solo } = g
  const st = a.state
  const done = st === 'done'
  const stalled = st === 'stalled'
  const live = !done && st !== 'nolog'
  const pulse = a.pulse
  const lights = done ? 0.45 : stalled ? 0.6 : 1
  const L = (col: RGB): RGB => (lights === 1 ? col : scale(col, lights))
  const ya = you ? youActivity(you, t) : null
  const counts = classCounts(s)
  const m = memoryOf(s, t)
  const W = c.w
  // The showcase's wall (docs/DESIGN.md 39). Its modules spell their readings out, so the room drops
  // its own text for those (one home per fact, 31): `shown` is the pane's claims and the wall's.
  const show = showcaseOf(g, showcaseModules(ctx.shown))
  const mounted = show.instruments.map(x => x.id)
  const stand = mounted.includes('counter:out') ? (mounted.includes('counter:errors') ? 'counter:cost' : 'counter:errors') : 'counter:out'
  const slots = show.instruments.map(x => (x.id === 'counter:cost' && !s.cost ? { ...x, id: stand } : x))
  const shown: ReadonlySet<Fact> | undefined = slots.length ? new Set<Fact>([...(ctx.shown ?? []), ...factsOf(slots.map(x => x.id))]) : ctx.shown
  const showTools = !claimed(shown, 'tools')

  // The monitor material's half-cell frame on the ring of cells around a box: the frame lies on the
  // ring's inner halves and its outer halves stay wall, so it reads half a cell thick. Top and left
  // in the bevel highlight, bottom and right in the monitor slate; each ring cell holds one of them
  // on the wall (corners ▗ ▖ ▝ ▘). The rack (`rack`) stands on the floor: no bottom, and only its
  // top catches the highlight, so its long left side does not read as a lit pole.
  const slate = (col: number, row: number, w: number, h: number, rack = false) => {
    const bottom = !rack
    const lo = L(MON)
    const hi = L(BEVEL)
    const X0 = col * 2
    const X1 = (col + w) * 2 - 1
    const y0 = row * 4 + 2
    const y1 = bottom ? (row + h - 1) * 4 + 1 : (row + h) * 4 - 1
    c.rect(X0 + 1, y0, X1 - X0 - 1, 2, hi) // top (▄)
    c.rect(X0 + 1, y0, 1, y1 - y0 + 1, rack ? lo : hi) // left (▐)
    c.rect(X1 - 1, y0, 1, y1 - y0 + 1, lo) // right (▌)
    if (bottom) c.rect(X0 + 2, (row + h - 1) * 4, X1 - X0 - 3, 2, lo) // bottom (▀)
  }
  const offScreen = (b: Box) => c.rect(b.col * 2, b.row * 4, b.w * 2, b.h * 4, SCREEN_OFF)
  const px = (b: Px, col: RGB) => c.rect(b.x, b.y, b.w, b.h, col)
  // Ambience (docs/DESIGN.md 42): `glow` mixes an ambient tone over a sub-pixel (over the terminal's
  // own colour, the tone faded instead).
  const amb = ambient(ctx)
  const AT = ambientTones(p)
  const glow = (x: number, y: number, tone: RGB, a: number) => {
    const under = c.get(x, y)
    c.set(x, y, a >= 1 ? tone : under === NONE ? fade(p, tone, a) : mix(under, tone, a))
  }

  // ── Wall and floor (only when the scene paints its background); the floor line always.
  if (!transparent) {
    for (let row = 0; row < c.rows; row++) {
      const col = row < F ? L(WALL) : L(FLOOR)
      c.rect(0, row * 4, W, 4, col)
    }
  }
  c.rect(0, F * 4, W, 2, L(GROUND))

  // ── The window with its stars (they stay lit, done or not).
  // The season (docs/DESIGN.md 28): the `season` setting, or the date's.
  const season = seasonOf(t, ctx.season)
  const holiday = season === 'none' ? null : holidayOf(t)
  const S = seasonTones(p)
  const day = season === 'summer' && isDay(t)
  if (g.window) {
    const { c0, c1, sky } = g.window
    const x0 = c0 * 2
    const x1 = c1 * 2 + 1
    const wy = (g.window.top + 1) * 4 // the sky's first sub-row
    const glass = day ? S.daySky : season === 'none' ? SKY : S.sky[season]
    // The top frame: the last sub-row of the frame's row (▂). On a light wall a ▂ would encode as its
    // inverse, which no block glyph draws (braille instead), so a light palette gives it the half cell (▄).
    const thin = p.light ? 2 : 1
    c.rect(x0, wy - thin, x1 - x0 + 1, thin, L(FRAME))
    c.rect(x0, wy, x1 - x0 + 1, sky * 4, glass)
    c.rect(x0, wy, 1, sky * 4, L(FRAME))
    c.rect(x1, wy, 1, sky * 4, L(FRAME))
    const mid = 2 * ((c0 + c1 + 1) >> 1)
    c.rect(mid, wy, 1, sky * 4, L(FRAME))
    c.rect(x0 - 2, wy + sky * 4, x1 - x0 + 5, 2, season === 'winter' ? S.sill : L(FRAME)) // the sill (▀), snowy in winter
    // Ambience (docs/DESIGN.md 42.2) over the glass inside the frame, in sub-pixels: the skyline
    // across its foot (up to the frame and the mullion, which stay solid), its lit windows and the
    // plane light behind the weather, rain or fireflies in front of the stars. A speck keeps to the
    // cells clear of the frame, as the stars do, so the frame's cells keep their two colours. Rain
    // runs a sub-pixel in a quarter to a whole second, so a drop crosses any glass in 6 to 22 s.
    const look = windowLook(p, season, holiday, t)
    const gw = x1 - x0 - 1
    const gh = sky * 4
    const skyline = skylineTone(p, glass, look.night)
    const onGlass: Put = (x, y, tone, a) => {
      const X = x0 + 1 + x
      const cell = X >> 1
      if (X === mid || (tone !== skyline && (cell === c0 || cell === c1 || cell === mid >> 1))) return
      glow(X, wy + y, tone, a)
    }
    if (amb) windowFar(p, look, glass, frame, gw, gh, onGlass)
    // Stars at night; none by day, in spring's lighter sky, or in a light palette (a daylit window).
    const n = day || season === 'spring' || p.light ? 0 : Math.max(3, Math.round(((c1 - c0) * sky) / 3))
    // Weather and the firework, in half-cell units over the cells clear of the frame. A snowflake is
    // one sub-pixel (texture, like the stars); a cloud, a leaf or a spark fills its half cell (▀ ▄),
    // so it draws the same whether it is lighter or darker than the sky.
    for (const sp of weather(season, holiday, t, frame, c1 - c0 - 1, sky * 2)) {
      const cx = c0 + 1 + sp.x
      if (cx === mid >> 1) continue
      const sy = wy + sp.y * 2
      if (holiday !== 'newyear' && sp.tone === 0) c.set(cx * 2 + (hash(sp.x * 7 + sp.y) > 0.5 ? 1 : 0), sy + (hash(sp.y * 5 + sp.x + 1) > 0.5 ? 1 : 0), S.speck[0]!)
      else c.rect(cx * 2, sy, 2, 2, holiday === 'newyear' ? S.sparks[sp.tone]! : S.speck[sp.tone]!)
    }
    if (day && c1 - c0 >= 5) c.rect((c1 - 2) * 2, wy, 4, 4, S.sun) // the sun: two whole cells in the top right pane
    if (holiday === 'lights') {
      // Three lights strung along the top frame, lit in turn: each a half cell (▄) on the frame's row.
      for (let i = 0; i < 3; i++) {
        const lc = c0 + Math.round(((c1 - c0) * (i + 1)) / 4)
        c.rect(lc * 2, wy - 2, 2, 2, i === litLight(frame) ? S.lights[i]! : scale(S.lights[i]!, 0.45))
      }
    }
    for (let i = 0; i < n; i++) {
      // Stars only in cells clear of the frame and mullion, so those stay solid.
      const cx = c0 + 1 + Math.floor(hash(i * 3 + 1) * Math.max(1, c1 - c0 - 1))
      if (cx * 2 === mid || cx * 2 + 1 === mid) continue
      const sx = cx * 2 + (hash(i + 9) > 0.5 ? 1 : 0)
      const sy = wy + Math.floor(hash(i + 50) * sky * 4)
      if (amb && c.get(sx, sy) !== glass) continue // behind the skyline and the weather
      const tw = Math.sin(frame * (done ? 0.25 : 0.15) + i * 2.1) * 0.5 + 0.5
      c.set(sx, sy, mix(STAR_DIM, p.star, tw))
    }
    if (amb) windowNear(p, look, frame, gw, gh, onGlass, clamp(10 / gh, 0.25, 1))
  }

  // ── Screen text: ✓ in GOOD and ✖ in BAD, the rest in one ink, cut to `w`; returns the cells written.
  const write = (col: number, row: number, w: number, text: string, colr: RGB): number => {
    const sh = cut(text, w)
    let i = 0
    for (const ch of sh) {
      c.text(col + i, row, ch, ch === '✓' ? GOOD : ch === '✖' ? BAD : colr)
      i++
    }
    return i
  }

  // ── The plant under the solo window: the pot on the floor line, the leaves in two greens. With
  // ambience (docs/DESIGN.md 42.2) a slow breeze leans the side leaves a sub-pixel to the left and
  // back over seven seconds, the bush's lit top a moment after them; the bush and the pot stay put.
  if (g.plant) {
    const lean = (lag: number) => (amb && breathe(frame, 7, lag) > 0.62 ? 1 : 0)
    g.plant.leaves.forEach((b, i) => px(i === 0 ? b : { ...b, x: b.x - lean(0) }, L(i === 0 ? LEAF : LEAF_HI)))
    if (g.plant.leaves[0]) c.rect(g.plant.leaves[0].x + 2 - lean(0.06), g.plant.leaves[0].y, 2, 2, L(LEAF_HI)) // light on the bush's top
    px(g.plant.pot, L(POT))
    c.rect(g.plant.pot.x, g.plant.pot.y, g.plant.pot.w, 2, L(POT_RIM)) // the pot's rim (▀)
  }

  // ── The board (docs/DESIGN.md 33.2): the tally, the star, the checks and the elapsed time on a
  // slate-framed face in the top right, the commit parcels on a shelf under it. With only the
  // elapsed time it is the old badge; with nothing to show the wall stays bare.
  const pk = holiday === 'halloween' ? pumpkinCells(g) : null
  const board = boardOf(g, s, m, t, shown, pk)
  if (board.face) {
    const f = board.face
    slate(f.col, f.row, f.w, f.h)
    c.rect((f.col + 1) * 2, (f.row + 1) * 4, (f.w - 2) * 2, (f.h - 2) * 4, SCREEN)
    board.marks.forEach((mk, i) => {
      // A tally stroke (▌): green for a pass, red for a fail; the newest flashes on a failing run.
      let colr: RGB = mk.ok ? GOOD : BAD
      if (i === board.marks.length - 1 && pulse?.kind === 'tests-fail' && !done) colr = frame % 2 === 0 ? BAD : LAMP_RED
      c.rect(mk.col * 2, mk.row * 4, 1, 4, L(colr))
    })
    if (board.star) {
      // The star after the flip: gold, and twinkling while the run celebrates it.
      const tw = m.celebrating && !done && Math.floor(frame / 4) % 2 === 1
      c.text(board.star[0], board.star[1], '★', tw ? SCREEN_INK : L(WARN))
    }
    if (board.label) c.text(board.label.col, board.label.row, board.label.text, L(PHOS_DIM))
    if (board.checks) write(board.checks.col, board.checks.row, board.checks.text.length, board.checks.text, L(PHOS))
    if (board.elapsed) c.text(board.elapsed.col, board.elapsed.row, board.elapsed.text, done ? scale(WARN, 0.6) : WARN)
  }
  if (board.shelf) {
    px(board.shelf, L(DESK_TOP))
    for (const pc of board.parcels) {
      px(pc, L(PARCEL))
      if (pc.h === 4) c.rect(pc.x, pc.y, pc.w, 2, L(TIE)) // a tall parcel's taped lid (▀)
    }
  }

  // ── The showcase's wall screens (docs/DESIGN.md 39), in the panel's frames like the modules: the
  // instrument row, the thinking screen, the departures board, the details screen. The modules are
  // told what the room and the pane spell out, so they leave it out too.
  if (g.top > 0) {
    const P = panelOf(p)
    try {
      if (show.thinking) drawThinking(c, show.thinking, s, a, t, frame, P, ctx.plain)
      // The stations show each class's glyph beside its word: the board's class column can be the glyph.
      if (show.departures) drawDepartures(c, show.departures, s, a, frame, P)
      if (show.details) drawDetails(c, show.details, s, a, frame, P)
      if (show.files) drawFiles(c, show.files, s, a, P)
      if (slots.length) {
        const own = new Set<Fact>([...(shown ?? []), ...ROOM_FACTS, ...(show.departures ? (['recent'] as Fact[]) : [])])
        const mctx: ModuleCtx = { s, a, you, worker: ctx.worker, frame, t, palette: p, shown: own }
        drawInstruments(c, slots, mctx, P)
      }
    } catch {
      // A screen bug must not take the scene down.
    }
  }

  // ── Cables: the tray along the ceiling, the risers, the drops, the floor cable.
  const tray = L(TRAY)
  const cable = L(CABLE)
  // Solo the tray starts over the first drop, with no riser of yours to meet.
  const ceil = g.top // the tray's row; the risers and the drops hang from the row under it
  const lanes = g.lanes
  const trayFrom = !solo ? (lanes ? lanes.left : orch.riser) : size === 'compact' ? g.dropR : g.dropL
  const trayTo = lanes ? lanes.right : worker.riser
  c.rect(trayFrom * 2, ceil * 4 + 2, (trayTo - trayFrom + 1) * 2, 2, tray)
  if (lanes) {
    // A showcase: down each lane beside the stations, then along the row over the monitor to its riser.
    if (!solo) {
      const x = lanes.left * 2 + 1
      const yr = (orch.top - 1) * 4 + 2
      c.rect(x, (ceil + 1) * 4, 1, yr - (ceil + 1) * 4, tray)
      c.rect(orch.riser * 2, yr, x - orch.riser * 2 + 1, 2, tray)
    }
    const x = lanes.right * 2
    const yr = (worker.top - 1) * 4 + 2
    c.rect(x, (ceil + 1) * 4, 1, yr - (ceil + 1) * 4, tray)
    c.rect(x, yr, worker.riser * 2 + 2 - x, 2, tray)
  } else {
    if (!solo) c.rect(orch.riser * 2, (ceil + 1) * 4, 1, (orch.top - 1 - ceil) * 4, tray)
    c.rect(worker.riser * 2 + 1, (ceil + 1) * 4, 1, (worker.top - 1 - ceil) * 4, tray)
  }
  if (!solo) c.rect(orch.riser * 2, orch.top * 4, 1, 2, L(MON))
  c.rect(worker.riser * 2 + 1, worker.top * 4, 1, 2, L(MON))
  const lastDrop = size === 'compact' ? g.pt + 1 : g.pt + 2 * g.PS + 1
  if (size !== 'compact') c.rect(g.dropL * 2, (ceil + 1) * 4, 1, (lastDrop - ceil) * 4, tray)
  c.rect(g.dropR * 2 + 1, (ceil + 1) * 4, 1, (lastDrop - ceil) * 4, tray)
  const m1 = worker.zone[0] - 1
  c.rect(m1 * 2 + 1, D * 4, 1, (F - D) * 4, cable)
  c.rect((g.rack.col + g.rack.w) * 2, (F - 1) * 4 + 2, (m1 - g.rack.col - g.rack.w + 1) * 2, 2, cable)

  // ── Lamps (compact only: the board carries the checks elsewhere): a 2 × 2 sub-pixel lamp in the lower half of a cell.
  const lamp = (col: number, row: number, colr: RGB) => c.rect(col * 2, row * 4 + 2, 2, 2, colr)
  const tests = s.tests ?? []
  const lastTsc = s.tsc?.at(-1)
  const errOn = (pulse?.kind === 'error' || pulse?.kind === 'denied') && !done
  const errLamp = errOn ? (frame % 3 === 0 ? BAD : LAMP_RED) : (s.errors ?? 0) > 0 ? L(LAMP_ERR) : L(LAMP_OFF)
  const tscLamp = lastTsc ? L(lastTsc.errors > 0 ? BAD : GOOD) : L(LAMP_OFF)
  const testLamps = (col: number, row: number, room: number) => {
    const n = Math.max(1, Math.floor((room + 1) / 2))
    const runs = tests.slice(-n)
    if (runs.length === 0) lamp(col, row, L(LAMP_OFF))
    runs.forEach((r, i) => {
      let colr: RGB = r.failed > 0 ? BAD : GOOD
      if (i === runs.length - 1 && pulse?.kind === 'tests-fail' && !done) colr = frame % 2 === 0 ? BAD : LAMP_RED
      lamp(col + i * 2, row, L(colr))
    })
  }
  const dimText = DIM_TEXT
  const lampLabel = (col: number, row: number, text: string) => c.label(col, row, text, L(dimText), L(dimText))

  // ── Panels: slate-framed screens (standard and large), or lamps (compact). A station whose class
  // has not run yet is off: its label dim on a dark face, the box kept so the wall does not jump.
  // With `tools` claimed (docs/DESIGN.md 31) the counts go; the class's last label stays.
  const active: ToolClass | null = st === 'tool' && a.cls ? a.cls : null
  const labels = recentLabels(s)
  const tw = g.P - 2
  // A station's name: with `glyph` (a screen of several rows, where the name has its own row) the
  // class's glyph beside its word, the legend for the departures board (docs/DESIGN.md 41); else the
  // word, shortened as the screen narrows.
  const nameOf = (cls: ToolClass, glyph = false): string => {
    const n = counts[cls]
    const [full, short, tiny] = NAMES[cls]
    const g = glyph && CLASS_GLYPH[cls] !== full ? `${CLASS_GLYPH[cls]} ` : ''
    if (!showTools) return g && (g + full).length <= tw ? g + full : full.length <= tw ? full : short.length <= tw ? short : tiny
    if (g && `${g}${full} ${n}`.length <= tw) return `${g}${full} ${n}`
    const f = `${full} ${n}`
    if (f.length <= tw) return f
    const sh = `${short} ${n}`
    if (sh.length <= tw) return sh
    const t = `${tiny}${n}`
    return t.length <= tw ? t : String(n)
  }
  if (size !== 'compact') {
    for (const [x0, list] of [[g.panelL, LEFT], [g.panelR, RIGHT]] as [number, ToolClass[]][]) {
      list.forEach((cls, i) => {
        const top = g.pt + i * g.PS
        const sr0 = top + 1
        const sr1 = top + g.PH - 2
        const lit = active === cls
        const on = counts[cls] > 0 || lit
        const col = CLASS_COLOR[cls]
        slate(x0, top, g.P, g.PH)
        const box: Box = { col: x0 + 1, row: sr0, w: tw, h: sr1 - sr0 + 1 }
        if (!on) {
          offScreen(box)
          if (tw > 0) c.text(x0 + 1, sr0, cut(nameOf(cls, sr1 > sr0), tw), L(OFF_INK))
          return
        }
        const glow = lit ? 0.14 + 0.1 * Math.sin(frame * 0.7) : 0
        c.rect(box.col * 2, box.row * 4, box.w * 2, box.h * 4, lit ? mix(SCREEN, col, glow) : SCREEN)
        if (tw <= 0) return
        const ink = done ? scale(PHOS_DIM, 0.8) : lit ? col : L(PHOS)
        const dim = done ? scale(PHOS_DIM, 0.8) : lit ? scale(col, 0.75) : L(PHOS_DIM)
        const older = done ? scale(PHOS_DIM, 0.6) : lit ? scale(col, 0.55) : L(scale(PHOS_DIM, 0.75))
        const recent = labels[cls] ?? []
        if (sr1 === sr0) {
          // One-line screens: the count (or the name), then the class's last label, dim, where it
          // fits. With the counts claimed a narrow screen gives its row to the label alone.
          const nm = cut(nameOf(cls), tw)
          if (!showTools && recent[0] && nm.length + 5 > tw) {
            c.text(x0 + 1, sr0, cut(recent[0], tw), lit && !done ? col : ink)
            return
          }
          c.text(x0 + 1, sr0, nm, ink)
          if (recent[0] && tw - nm.length >= (showTools ? 6 : 5)) c.text(x0 + 2 + nm.length, sr0, cut(recent[0], tw - nm.length - 1), dim)
        } else {
          c.text(x0 + 1, sr0, cut(nameOf(cls, true), tw), ink)
          const labs = [...new Set(recent.map(lab => cut(lab, tw)))] // two labels cut alike show once
          labs.slice(0, sr1 - sr0).forEach((lab, j) => c.text(x0 + 1, sr0 + 1 + j, lab, j === 0 ? (lit && !done ? col : dim) : older))
        }
      })
    }
  } else {
    // Compact: the left flank carries the test, tsc and error lamps, the right one a lamp per station.
    const r = g.pt + 1
    lampLabel(g.panelL, r, 'tests')
    testLamps(g.panelL + 6, r, g.P - 6)
    if (r + 2 < F) {
      lampLabel(g.panelL, r + 2, 'tsc')
      lamp(g.panelL + 4, r + 2, tscLamp)
      const er = g.P >= 11 ? r + 2 : r + 4
      const ec = g.P >= 11 ? g.panelL + 6 : g.panelL
      if (er < F) {
        lampLabel(ec, er, 'err')
        lamp(ec + 4, er, errLamp)
      }
    }
    // The stations as lit tokens in their class colours (`$9 r14 e7` / `g4 w0 a0`; `$ r e` with the
    // counts claimed), the active one blinking.
    ;[LEFT, RIGHT].forEach((list, li) => {
      const row = r + li * 2
      if (row >= F) return
      let col = g.panelR
      for (const cls of list) {
        const tok = showTools ? `${NAMES[cls][2]}${counts[cls]}` : NAMES[cls][2]
        if (col + tok.length > g.panelR + g.P) break
        const lit = active === cls
        const n = counts[cls]
        const ink = lit ? (frame % 4 < 2 ? CLASS_COLOR[cls] : p.ink) : scale(CLASS_COLOR[cls], n > 0 ? 0.85 * lights : 0.4 * lights)
        c.text(col, row, tok, ink)
        col += tok.length + 1
      }
    })
  }

  // ── The model server's rack: a readout screen on top, units with LEDs, a memory meter. The screen
  // keeps the rows it has something for: the speed (only while there is one, and not with `decode`
  // claimed; the label under the rack names the server, or says it is off or absent), the decode
  // bar, the memory in use (gone with `memory` claimed, and with neither a server nor a memory
  // reading); the bar and the gauge stay either way.
  // Following this session there is no server to read (docs/DESIGN.md 36): the rack stands for the
  // model, its bar and LEDs following what the model does, the model's name under it.
  const srv = s.server
  const tps = decodeTps(s)
  const showDecode = !claimed(shown, 'decode')
  const load = modelLoad(ctx, st)
  const modelRack = load !== undefined
  {
    const { col: rx, w: RW } = g.rack
    const X0 = rx * 2
    const top = g.pt
    slate(rx, top, RW, F - top, true)
    const ok = srv?.ok === true
    const mem = s.memory
    const usedGb = mem?.total_gb ? mem.total_gb - (mem.free_gb ?? 0) : null
    const rw = RW - 2
    const items: ('speed' | 'bar' | 'mem')[] = []
    if (ok && tps != null && showDecode) items.push('speed')
    items.push('bar')
    if (!claimed(shown, 'memory') && (srv || mem?.total_gb)) items.push('mem')
    const lines = Math.min(g.rack.lines, items.length)
    for (let r = top + 1; r <= top + lines; r++) c.rect(X0 + 2, r * 4, RW * 2 - 4, 4, SCREEN)
    items.slice(0, lines).forEach((item, i) => {
      const row = top + 1 + i
      if (item === 'speed') {
        const txt = `${tps!.toFixed(0)} tok/s`.length <= rw ? `${tps!.toFixed(0)} tok/s` : `${tps!.toFixed(0)} t/s`
        c.text(rx + 1, row, cut(txt, rw), done ? L(PHOS_DIM) : L(PHOS))
      } else if (item === 'bar') {
        // The decode bar: whole ▆ cells, lit by intensity while the model generates.
        const fill = modelRack ? (load != null && live ? Math.round(load * rw) : 0) : ok && live && !stalled ? Math.round(a.intensity * rw) : 0
        for (let j = 0; j < rw; j++) c.rect(X0 + 2 + j * 2, row * 4 + 1, 2, 3, j < fill ? (st === 'prefill' ? WARN : L(PHOS)) : L(CODE))
      } else {
        const mtxt = mem?.total_gb && usedGb != null ? `${Math.round(usedGb)}/${Math.round(mem.total_gb)} GB` : 'mem –'
        c.text(rx + 1, row, cut(mtxt, rw), L(PHOS_DIM))
      }
    })
    // Units below the readout: a face (▀) over the gap per row, LEDs at the right end.
    const u0 = top + 1 + lines
    const leds = RW >= 8 ? 2 : 1
    const face = L(RACK_FACE)
    const gap = L(RACK_GAP)
    const blink = 0.3 + a.intensity * 0.9
    for (let r = u0; r < F; r++) {
      const u = r - u0
      for (let cx = rx + 1; cx < rx + RW - 1; cx++) {
        c.rect(cx * 2, r * 4, 2, 2, face)
        c.rect(cx * 2, r * 4 + 2, 2, 2, gap)
      }
      let led: RGB = L(LAMP_OFF)
      let led2: RGB = L(LAMP_OFF)
      if (modelRack) {
        if (load != null && live) {
          led = hash(u * 13 + Math.floor(frame * (0.3 + load * 0.9))) < 0.25 + 0.6 * load ? (st === 'prefill' ? WARN : GOOD) : LED_OFF
          led2 = load > 0.5 && hash(u + 7 + Math.floor(frame * 0.15)) > 0.6 ? THINK : RACK_FACE
        } else if (!done) {
          led = L(LED_IDLE)
        }
      } else if (ok && live && !stalled) {
        led = hash(u * 13 + Math.floor(frame * blink)) < 0.25 + 0.6 * a.intensity ? (st === 'prefill' ? WARN : GOOD) : LED_OFF
        led2 = hash(u + 7 + Math.floor(frame * 0.15)) > 0.6 ? THINK : RACK_FACE
      } else if (srv && !done) {
        led = L(LED_IDLE)
      }
      c.rect((rx + RW - 2) * 2, r * 4, 2, 2, led)
      if (leds > 1) c.rect((rx + RW - 3) * 2, r * 4, 2, 2, led2)
    }
    // The memory gauge: the first inner column, a slate track filled from the bottom in half cells,
    // phosphor until 80 % of the memory is in use.
    if (RW >= 6 && F > u0) {
      const halves = (F - u0) * 2
      const used = usedGb != null && mem?.total_gb ? usedGb / mem.total_gb : 0
      const fill = Math.round(used * halves)
      const mcol = L(used > 0.95 ? BAD : used > 0.8 ? WARN : PHOS)
      for (let h = 0; h < halves; h++) c.rect((rx + 1) * 2, F * 4 - (h + 1) * 2, 2, 2, h < fill ? mcol : L(TRACK))
    }
  }

  // ── The desks: plank, legs, monitor, figure. Local x (dx) mirrors for the worker.
  type Act = 'type' | 'think' | 'rest' | 'cheer'
  const deskDraw = (d: DeskGeom, tw: number, shirt: RGB, hair: RGB, headset: boolean, act: Act, power: RGB, alert = false) => {
    const X = (dx: number) => (d.dir > 0 ? 2 * d.rel0 + dx : 2 * d.rel0 + 1 - dx)
    const put = (dx: number, y: number, w: number, h: number, col: RGB) => {
      for (let i = 0; i < w; i++) c.rect(X(dx + i), y, 1, h, col)
    }
    const ty = (D - 2) * 4
    const hy = (D - 4) * 4
    const dy = D * 4
    const endRel = 8 + tw
    // Plank, legs (inner end and under the monitor's outer edge).
    put(10, dy, (endRel - 5 + 1) * 2, 2, L(DESK_TOP))
    put(10, dy + 2, (endRel - 5 + 1) * 2, 2, L(DESK))
    put(2 * endRel + 1, dy + 4, 1, (F - D - 1) * 4, L(LEG))
    put(14, dy + 4, 1, (F - D - 1) * 4, L(LEG))
    // Chair: back, seat, post and base.
    const chair = L(CHAIR)
    put(1, ty + 2, 1, dy + 4 - ty - 2, chair)
    put(0, dy + 2, 8, 2, chair)
    if (F - 1 > D + 1) put(4, dy + 4, 1, (F - D - 2) * 4, chair)
    put(4, (F - 1) * 4, 1, 2, chair)
    put(2, (F - 1) * 4 + 2, 6, 2, chair)
    // Legs: thigh on the seat, shin under the plank, a shoe on the floor.
    const tr = L(TROUSERS)
    put(2, dy, 8, 2, tr)
    put(10, dy + 4, 2, (F - D - 1) * 4 - 2, tr)
    put(10, (F - 1) * 4 + 2, 4, 2, L(SHOE))
    // Torso and head (hair at the back, the eye on the inner side).
    const sk = L(SKIN)
    const hr = L(hair)
    put(2, ty, 6, 8, L(shirt))
    put(4, hy, 4, 8, sk)
    put(4, hy, 4, 2, hr)
    put(4, hy + 2, 1, 4, hr)
    put(7, hy + 4, 1, 2, EYE)
    if (headset) {
      const hs = L(HEADSET)
      put(2, hy - (p.light ? 2 : 1), 6, p.light ? 2 : 1, hs) // band (▂; ▄ on a light wall, as the window's top)
      put(2, hy, 2, 6, hs) // ear cup
      put(8, hy + 6, 2, 2, hs) // microphone
    }
    // Arm and keyboard: typing hands bob between the keys and just above them; cheering, both arms
    // go up beside the head, the hands over its top.
    put(10, ty + 6, 2, 2, L(KEYS))
    if (act === 'cheer') {
      put(0, hy, 2, ty + 2 - hy, L(shirt))
      put(8, hy, 2, ty + 6 - hy, L(shirt))
      put(0, hy - 2, 2, 2, sk)
      put(8, hy - 2, 2, 2, sk)
    } else if (act === 'rest') {
      put(8, ty + 4, 2, 4, L(shirt))
      put(8, dy + 2, 2, 2, sk) // hand in the lap
    } else {
      put(8, ty + 4, 2, 2, L(shirt))
      const down = act === 'type' ? frame % 4 < 2 : Math.floor(frame / 3) % 2 === 0
      put(10, down ? ty + 6 : ty + 4, 2, 2, sk)
    }
    // Monitor: a half-cell bezel (its outer side on the inner half of its cell), the screen, the
    // bevel on its inner edge, a stand on the desk.
    // On a failing test run the bezel flashes red: the screen's text keeps its clean cells.
    const mon = alert ? BAD : L(MON)
    const th = d.screen.h
    put(15, d.top * 4 + 2, (tw + 2) * 2 - 1, 2, mon)
    for (let r = d.screen.row; r < d.screen.row + th; r++) {
      put(15, r * 4, 1, 4, mon)
      put(16, r * 4, tw * 2, 4, SCREEN)
      put(16 + tw * 2, r * 4, 1, 4, mon)
      put(17 + tw * 2, r * 4, 1, 4, L(BEVEL))
    }
    put(15, (D - 1) * 4, (tw + 2) * 2 - 1, 2, mon)
    const sm = 7 + ((tw + 2) >> 1) - 1
    put(sm * 2, (D - 1) * 4 + 2, 4, 2, mon)
    put(20, (D - 1) * 4, 2, 2, power) // the power lamp on the bottom bezel (▀)
    return { X, put }
  }

  // The worker cheers for the red → green flip (docs/DESIGN.md 32): arms up and down by turns.
  const cheer = m.celebrating && !done && Math.floor(frame / 3) % 2 === 0
  const wAct: Act = cheer ? 'cheer' : st === 'tool' ? 'type' : st === 'thinking' || st === 'prefill' ? 'think' : 'rest'
  const oAct: Act = ya?.state === 'tool' ? 'type' : ya?.state === 'thinking' ? 'think' : 'rest'
  // Power lamps: steady while the run is live, a slow blink once it is over (the idle motion).
  const blinkOn = Math.floor(frame / 8) % 2 === 0
  const power = done ? (blinkOn ? (a.ok ? GOOD : BAD) : L(LAMP_OFF)) : st === 'nolog' ? L(LAMP_OFF) : L(POWER)
  // The orchestrator's lamp: as the worker's while it works, dim while it is idle (solo, no desk at all).
  const youOn = ya != null && ya.state !== 'idle'
  const failFlash = pulse?.kind === 'tests-fail' && !done && frame % 2 === 0
  if (!solo) deskDraw(orch, orch.screen.w, YOU_SHIRT, YOU_HAIR, true, oAct, youOn ? power : L(POWER_IDLE), failFlash && youOn)
  deskDraw(worker, worker.screen.w, SHIRT, HAIR, false, wAct, power, failFlash)
  if (amb && size !== 'compact') {
    // Lamplight (docs/DESIGN.md 42.2): a warm pool on each desk's plank under its monitor, brightest
    // under the screen's middle and on the plank's top, breathing over eight seconds. A cell at a
    // time, so each plank cell keeps its two tones; dimmed with the room.
    const level = 0.22 * lampLevel(frame)
    const lamp = L(AT.lamp)
    for (const d of solo ? [worker] : [orch, worker]) {
      const plank = local(d, 10, (4 + d.screen.w) * 2, D * 4, 4)
      const mid = d.screen.col + (d.screen.w - 1) / 2
      const reach = d.screen.w / 2 + 3
      for (let col = plank.x >> 1; col < (plank.x + plank.w) >> 1; col++) {
        const u = 1 - Math.abs(col - mid) / reach
        if (u <= 0) continue
        const fall = u * u * (3 - 2 * u) // smooth at the pool's edges
        for (let x = col * 2; x < col * 2 + 2; x++) {
          for (let y = plank.y; y < plank.y + 4; y++) {
            const under = c.get(x, y)
            if (under === L(DESK_TOP) || under === L(DESK)) c.set(x, y, mix(under, lamp, level * fall * (y < plank.y + 2 ? 1 : 0.5)))
          }
        }
      }
    }
  }

  // ── Run memory on and under the worker's desk (docs/DESIGN.md 32).
  const pr = props(g, m, { stalled, light: p.light })
  // The mugs; steam rises from the first when the run is stalled (with ambience, the slow curl of
  // the late pass below in every state instead, as the office's).
  pr.mugs.forEach(b => px(b, L(MUG)))
  if (!amb && stalled && pr.mugs[0]) {
    const cellX = pr.mugs[0].x
    const ph = frame % 2
    c.set(cellX + ph, (D - 1) * 4 - 1, STEAM)
    c.set(cellX + 1 - ph, (D - 1) * 4 - 3, STEAM)
    c.set(cellX + ph, (D - 1) * 4 - 5, scale(STEAM, 0.7))
  }
  if (pr.pages) px(pr.pages, L(SHEET))
  if (pr.bin) {
    px(pr.bin, L(BIN))
    c.rect(pr.bin.x, pr.bin.y, pr.bin.w, 2, L(BIN_RIM)) // the rim (▀)
  }
  pr.crumples.forEach((b, i) => {
    // Paper balls, white and shadowed by turns; the newest flashes on an error or a denial.
    const newest = i === pr.crumples.length - 1
    px(b, newest && errOn ? (frame % 3 === 0 ? BAD : SHEET) : L(i % 2 === 0 ? SHEET : PAPER_SHADE))
  })
  // The sticky notes on the monitor's side, one per failing test. After the flip the notes the last
  // red run left fall away, one after another, and are gone before they reach the desk.
  pr.notes.forEach(b => px(b, L(BAD)))
  let falling = 0
  if (m.flip && m.flip.age < FALL_SECS && m.failing === 0 && !done) {
    const fi = m.runs.findIndex(r => r.t === m.flip!.t && r.ok)
    const before = fi > 0 ? m.runs[fi - 1]!.failed : m.peakFailing
    const gone = props(g, m, { failing: before }).notes
    falling = gone.length
    gone.forEach((b, i) => {
      const age = m.flip!.age - i * 0.4
      if (age < 0) return px(b, L(BAD))
      const y = b.y + 2 * Math.floor(age * age * 4)
      if (y + b.h <= (D - 1) * 4) c.rect(b.x, y, b.w, b.h, scale(BAD, Math.max(0.35, 1 - age / FALL_SECS)))
    })
  }

  // Thought dots over a thinking figure's head (row D-5, lower half), rising one by one; two at
  // most beside a sticky note in that row.
  const dots = (d: DeskGeom, phase: number, most = 3) => {
    const n = Math.min(most, Math.floor((frame + phase) / 5) % 4)
    const X = (dx: number) => (d.dir > 0 ? 2 * d.rel0 + dx : 2 * d.rel0 + 1 - dx)
    // 1 × 2 dots (▖ / ▗) in the cells in front of the head, clear of the monitor and the sill.
    for (let i = 0; i < n; i++) c.rect(X(8 + i * 2), (D - 5) * 4 + 2, 1, 2, BUBBLE)
  }
  const noteHigh = Math.max(pr.notes.length, falling) >= 4
  if (st === 'thinking' && !cheer) dots(worker, 0, noteHigh ? 2 : 3)
  if (ya?.state === 'thinking') dots(orch, 3)

  // On 31 October a pumpkin sits on the worker's monitor, at its outer end: three cells wide, half a
  // row on the bezel and half a row above, the middle cell its darker rib under a stem.
  if (pk) {
    const [body, rib, stem] = S.pumpkin
    for (let i = 0; i < 3; i++) c.rect((pk.col + i) * 2, pk.row * 4 + 2, 2, 4, L(i === 1 ? rib : body))
    c.rect((pk.col + 1) * 2, pk.row * 4, 2, 2, L(stem))
  }

  // ── Screens. The worker's shows the work (docs/DESIGN.md 33.2): the last diff, or the last
  // command's output, whichever is newer; with neither, the context bar and the checks. Never the
  // current activity: that is the caption's. Yours: who, the state, the task; idle, the hand-off.
  const ink = (base: RGB) => (done ? scale(base, 0.6) : L(base))
  const codeLines = (box: Box, row: number, from: number, phase: number) => {
    // Faint code behind the text while the model writes: half-cell dashes in the free cells; a row
    // with no text gets one line of them (its top half), so an empty screen reads as a listing.
    for (let half = 0; half < (from > 0 ? 2 : 1); half++) {
      const line = Math.floor(frame * 0.5) + (row - box.row) * 2 + half + phase
      const indent = Math.floor(hash(line + 7) * 3)
      const len = 1 + Math.floor(hash(line) * Math.max(1, box.w - from - indent - 1))
      for (let x = from + 1 + indent; x < Math.min(box.w, from + 1 + indent + len); x++) c.rect((box.col + x) * 2, row * 4 + half * 2, 2, 2, CODE)
    }
  }
  const cursor = (col: number, row: number, colr: RGB) => c.rect(col * 2, row * 4, 1, 4, colr) // ▌
  {
    const sc = worker.screen
    const last = sc.row + sc.h - 1
    // With a details screen on the wall the command's output is its: the monitor keeps the diff.
    const work = show.details ? (s.last_diff ? 'diff' : null) : workOf(s)
    const used: number[] = [] // cells written per row, for the code behind and the cursor
    if (work === 'diff') {
      // The diff: + in GOOD, - in BAD, context dim; texture cut to the screen, not a reading.
      diffLines(s.last_diff!.diff, sc.h).forEach((l, i) => {
        const mark = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '
        const colr = l.kind === 'add' ? GOOD : l.kind === 'del' ? BAD : PHOS_DIM
        used[i] = write(sc.col, sc.row + i, sc.w, `${mark} ${l.text}`.trimEnd(), ink(colr))
      })
    } else if (work === 'bash') {
      // The command's output tail, the newest line brightest; a cursor while it runs.
      const b = s.last_bash!
      const out = outputLines(b.out, sc.h)
      out.forEach((line, i) => {
        used[i] = write(sc.col, sc.row + i, sc.w, line, ink(i === out.length - 1 ? PHOS : PHOS_DIM))
      })
      if (out.length === 0 && b.status !== 'running') used[0] = write(sc.col, sc.row, sc.w, 'no output', ink(PHOS_DIM))
      if (b.status === 'running' && !done && Math.floor(frame / 4) % 2 === 0) {
        // After the newest line, or at the start of the next row when it fills the screen's width.
        const i = Math.max(0, out.length - 1)
        const at = out.length ? (used[i] ?? 0) + 1 : 0
        if (at < sc.w) cursor(sc.col + at, sc.row + i, ink(PHOS))
        else if (out.length < sc.h) cursor(sc.col, sc.row + out.length, ink(PHOS))
      }
    } else if (s.exists) {
      // Neither yet: the context bar (its reading dropped with `ctx` claimed), then the checks
      // (dropped when claimed, or when the board already reads them out).
      const limit = ctxLimitOf(s)
      const pct = limit && s.ctx != null ? Math.round((s.ctx / limit) * 100) : null
      const showCtx = !claimed(shown, 'ctx')
      const phos = ink(PHOS)
      let row = sc.row
      if (pct != null && limit) {
        const bw = clamp(sc.w - 8, 2, sc.h === 1 ? sc.w - 8 : 6)
        write(sc.col, row, 4, 'ctx ', phos)
        const fill = Math.round((Math.min(100, pct) / 100) * bw)
        const hot = pct >= 80 ? BAD : pct >= 60 ? WARN : PHOS
        for (let i = 0; i < bw; i++) c.rect((sc.col + 4 + i) * 2, row * 4 + 1, 2, 3, i < fill ? ink(hot) : ink(PHOS_DIM))
        let n = 4 + bw
        if (showCtx) {
          n += write(sc.col + n, row, sc.w - n, ` ${pct}%`, phos)
          const more = ` ${k(s.ctx)}/${k(limit)}`
          if (n + more.length <= sc.w) n += write(sc.col + n, row, more.length, more, ink(PHOS_DIM))
        }
        used.push(n)
      } else {
        used.push(write(sc.col, row, sc.w, showCtx ? `ctx ${k(s.ctx)}` : '', phos))
      }
      row++
      if (row <= last && !claimed(shown, 'checks') && !board.checks) {
        used.push(write(sc.col, row, sc.w, checksLine(s, sc.w), phos))
      }
      // The code scrolls only on the rows with no text: a reading sits on clean screen cells.
      if (st === 'thinking') for (let r = 0; r < sc.h; r++) if (!used[r]) codeLines(sc, sc.row + r, 0, r * 2)
    }
    // A slow cursor after the last line once the run is over (the idle motion), on 8 / off 8.
    if (done && Math.floor(frame / 8) % 2 === 0) {
      let i = used.length - 1
      while (i > 0 && !used[i]) i--
      const at = i >= 0 ? (used[i] ?? 0) + 1 : 0
      if (at < sc.w) cursor(sc.col + at, sc.row + Math.max(0, i), ink(PHOS))
      else if (i + 1 < sc.h) cursor(sc.col, sc.row + i + 1, ink(PHOS))
    }
  }
  if (!solo) {
    const sc = orch.screen
    const showHandoff = !claimed(shown, 'handoff')
    const handoff = showHandoff ? (s.handoff?.text.split('\n')[0] ?? '').trim() : ''
    if (!youOn) {
      // An orchestrator that has not started a turn: the screen is off, names its
      // model dim on the first row when that is known, and shows the hand-off's first line, dimmer,
      // on the rows under it; with neither, a dim cursor waits on the first free row.
      const model = showHandoff ? shortModel(you?.model) : '' // the models are the hand-off's (docs/DESIGN.md 31)
      offScreen(sc)
      let row = sc.row
      if (model) write(sc.col, row++, sc.w, `you · ${model}`.length <= sc.w ? `you · ${model}` : `you ${model}`, L(OFF_INK))
      if (handoff && row < sc.row + sc.h) {
        for (const line of wrap(handoff, sc.w, sc.row + sc.h - row)) write(sc.col, row++, sc.w, line, L(OFF_INK))
      } else if (row < sc.row + sc.h) {
        cursor(sc.col, row, L(OFF_DIM))
      }
    } else {
      const phos = L(PHOS)
      const y = you! // youOn implies an orchestrator is known
      const model = shortModel(y.model)
      const who = !model ? 'you' : `you · ${model}`.length <= sc.w ? `you · ${model}` : `you ${model}`
      const ys = ya!.state
      const state =
        ys === 'thinking' ? (`thinking… ${fmtDur(ya!.secs)}`.length <= sc.w ? `thinking… ${fmtDur(ya!.secs)}` : 'thinking…') : ys === 'tool' ? (`tool · ${y.tool ?? ya!.cls ?? '?'}`.length <= sc.w ? `tool · ${y.tool ?? ya!.cls ?? '?'}` : `${y.tool ?? ya!.cls ?? '?'}`) : ys === 'waiting' ? 'waiting for you' : 'idle'
      const stInk = ys === 'tool' ? CLASS_COLOR[ya!.cls ?? 'other'] : ys === 'waiting' ? L(WARN) : phos
      let row = sc.row
      // Who, unless the hand-off (and with it the models) is claimed: then the screen is the one home
      // of your activity and starts with it.
      if (sc.h >= 2 && showHandoff) write(sc.col, row++, sc.w, who, phos)
      let st2 = state
      if (ys === 'waiting' && state.length >= sc.w) st2 = 'waiting'
      const n = write(sc.col, row, sc.w, st2, stInk)
      if (ys === 'waiting' && n < sc.w && Math.floor(frame / 6) % 2 === 0) cursor(sc.col + n, row, phos)
      row++
      if (sc.h >= 3 && (handoff || showHandoff)) write(sc.col, row++, sc.w, handoff || 'no handoff', L(PHOS_DIM))
      // The code scrolls only on the rows with no text (none while every row has a reading).
      if (ys === 'thinking') for (let r = row; r < sc.row + sc.h; r++) codeLines(sc, r, 0, 3)
    }
  }

  // ── Packets along the cables: recolour a cell's cable sub-pixels, a dimmer tail behind.
  const light = (cell: Cell, colr: RGB) => {
    const x0 = cell[0] * 2
    const y0 = cell[1] * 4
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 2; i++) {
        const v = c.get(x0 + i, y0 + j)
        if (v === tray || v === cable) c.set(x0 + i, y0 + j, colr)
      }
    }
  }
  const run = (path: Cell[], colr: RGB, speed: number, every: number, reverse = false) => {
    const n = path.length
    if (n === 0) return
    const tail = scale(colr, 0.45)
    for (let p = 0; p < n; p += every) {
      const i = Math.floor((p + frame * speed) % n)
      const at = reverse ? n - 1 - i : i
      const back = reverse ? Math.min(n - 1, at + 1) : Math.max(0, at - 1)
      if (back !== at) light(path[back]!, tail)
      light(path[at]!, colr)
    }
  }
  if (!done) {
    if (st === 'thinking') run(g.paths.toRack, GOOD, 0.5 + a.intensity * 0.5, Math.max(3, Math.round(8 - a.intensity * 5)))
    if (st === 'prefill') run(g.paths.toRack, WARN, 1, 4, true)
    if (active) run(g.paths.station[active], CLASS_COLOR[active], 1, 5)
  }
  if (ya?.state === 'tool') run(g.paths.orch, CLASS_COLOR[ya.cls ?? 'other'], 1, 6)

  // ── The cat (docs/DESIGN.md 28) on the floor line beside the rack, facing it: a pixel of its
  // picture is half a cell (2 × 2 sub-pixels), so it is drawn in ▀ ▄ █ cells like the office's.
  const cb = catBox(g, columns)
  if (cb) {
    const { pose, flick } = catPose(a, frame)
    const sp = amb ? catAmbient(p, pose, flick, frame) : catSprite(p, pose, flick) // breathing, an ear, a slow blink (docs/DESIGN.md 42.2)
    const y0 = cb.y + (CAT_H - sp.h) * 2
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const colr = sp.at(x, y)
        if (colr != null) c.rect(cb.x + x * 2, y0 + y * 2, 2, 2, L(colr))
      }
    }
  }

  // ── The hand-off sheet: slides along the floor band from the orchestrator's desk to the worker's
  // over SHEET_FRAMES frames, then rests by the worker's keyboard. Once the run is done it comes
  // back as the printed slip: along the same path the other way over SLIP_SECS from the result's
  // time, then on your desk with a stamp, green for a success, red otherwise.
  const handoffAt = you?.lastHandoff ?? null
  let resting = s.handoff != null
  if (handoffAt != null) {
    if (!lastSheet || handoffAt > lastSheet.at) lastSheet = { at: handoffAt, frame }
    const prog = frame < lastSheet.frame ? 1 : (frame - lastSheet.frame) / SHEET_FRAMES
    if (prog < 1 && !done) {
      resting = false
      const x0 = orch.zone[1]
      const x1 = worker.zone[0] - 1
      c.rect(Math.round(x0 + (x1 - x0) * prog) * 2, F * 4 + 2, 4, 2, SHEET)
    } else {
      resting = true
    }
  }
  if (done) {
    const age = t - (s.last_ts ?? s.mtime ?? t)
    if (!solo && age >= 0 && age < SLIP_SECS) {
      const x0 = worker.zone[0] - 1
      const x1 = orch.zone[1]
      c.rect(Math.round(x0 + (x1 - x0) * (age / SLIP_SECS)) * 2, F * 4 + 2, 4, 2, SHEET)
    } else {
      const b = slipBox(g)
      px(b, L(SHEET))
      c.rect(solo ? b.x + b.w - 2 : b.x, b.y, 2, 2, a.ok ? GOOD : BAD) // the stamp, on the cell away from the power lamp
    }
  } else if (resting) {
    const x = Math.min(worker.rel0 * 2 + 1 - 16, worker.rel0 * 2 + 1 - 19)
    c.rect(x, (D - 1) * 4 + 2, 4, 2, L(SHEET))
  }

  // ── Confetti from the ceiling when the tests pass.
  if (pulse?.kind === 'tests-pass' && !done) {
    const confetti = [GOOD, WARN, SHEET]
    // From the room's ceiling: on a showcase the screens above it stay clear.
    const y0 = g.top * 4
    const fall = y0 + (pulse.age / 8) * ((F - g.top) * 4 + 16)
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(hash(i * 7 + 1) * W) + ((frame + i) % 2)
      const y = Math.floor(fall - hash(i * 3 + 2) * 16)
      if (y >= y0 && y < F * 4) c.set(x, y, confetti[i % 3]!)
    }
  }

  // ── Ambience's late pass (docs/DESIGN.md 42.2): what hangs in the room's air goes only into cells
  // that are still bare wall (all eight sub-pixels the wall's, no text), judged before anything of
  // this pass lands in them, so a speck never shares a cell with an object, a reading or a packet.
  if (amb) {
    const cols = c.columns
    const text = new Uint8Array(cols * c.rows)
    for (const gl of c.glyphs()) text[gl.row * cols + gl.col] = 1
    const wall = transparent ? NONE : L(WALL)
    const seen = new Uint8Array(cols * c.rows) // 0 not judged yet, 1 bare, 2 not
    const bare = (col: number, row: number): boolean => {
      if (col < 0 || row < 0 || col >= cols || row >= F) return false
      const i = row * cols + col
      if (seen[i] === 0) {
        let ok = text[i] === 0
        for (let j = 0; ok && j < 8; j++) ok = c.get(col * 2 + (j & 1), row * 4 + (j >> 1)) === wall
        seen[i] = ok ? 1 : 2
      }
      return seen[i] === 1
    }
    const speck = (x: number, y: number, tone: RGB, a: number) => {
      if (bare(x >> 1, y >> 2)) glow(x, y, tone, a)
    }
    // String lights (large and the showcase, where the row under the ceiling tray is free wall):
    // bulbs clipped along the tray's underside in swags between hooks eight cells apart, one every
    // two cells, each a sub-pixel wide and a half cell tall (a quadrant block, so it reads solid: up
    // by the hooks, down mid-swag) and breathing within 15 % on its own slow loop. The swag's wire is left to the eye: a sub-pixel
    // line would draw as braille dots. Not during the `lights` holiday, which strings its own over
    // the window.
    if (size === 'large' && g.pt >= ceil + 2 && holidayOf(t) !== 'lights') {
      const x0 = trayFrom * 2
      const sd = strand((trayTo - trayFrom + 1) * 2, 2, 16, 4)
      const y0 = (ceil + 1) * 4
      sd.bulbs.forEach((b, i) => {
        const y = y0 + (b.y > 1 ? 2 : 0)
        const tone = scale(AT.bulbs[b.tone]!, bulbLevel(frame, i)) // lit through the end of the run, as the office's
        if (!bare((x0 + b.x) >> 1, y >> 2)) return
        c.set(x0 + b.x, y, tone)
        c.set(x0 + b.x, y + 1, tone)
      })
    }
    // Dust in the daylight from the window: a few faint motes drifting down the wall under the sill
    // (to your monitor, or solo to the floor), behind whatever stands there.
    if (g.window && dusty(t)) {
      const { c0, c1 } = g.window
      const r0 = g.window.top + g.window.sky + 2 // the row under the sill's
      const r1 = solo ? F : Math.min(orch.top, r0 + 5)
      if (r1 - r0 >= 1) {
        const motes = dustMotes((c1 - c0 + 1) * 2, (r1 - r0) * 4, frame)
        motes.forEach((d, i) => {
          if (i % 3 === 0) speck(c0 * 2 + d.x, r0 * 4 + d.y, AT.dust, d.a)
        })
      }
    }
    // Steam off the mug by the worker's keyboard, the one with air over it: three puffs curling up
    // the cells over it, from the sub-row a half cell over its rim, as high as those cells are bare
    // (a sticky note or a thought stops it). It replaces the quick wisp of a stall.
    const mug = pr.mugs[0]
    if (mug) {
      const col = mug.x >> 1
      const h = bare(col, D - 2) ? (bare(col, D - 3) ? 7 : 4) : 0
      for (const q of steamPuffs(frame, h, 1)) speck(mug.x + q.x, (D - 1) * 4 - 1 + q.y, q.a > 0.5 ? AT.steam : AT.steam2, Math.min(1, q.a + 0.3))
    }
    // A scan band (docs/DESIGN.md 42.2): a faint half-cell band drifts down each lit screen a half
    // cell every half second, then rests four seconds, drawn only on the rows that carry nothing
    // (no text, no art, the plain screen colour across the width). Every screen keeps its own phase.
    const scan = (b: Box | null) => {
      if (!b || b.w < 4 || b.h < 1) return
      const halves = b.h * 2
      const step = 0.5 / TICK_SECS
      const period = halves * step + 4 / TICK_SECS
      const at = (frame + hash(b.col * 7 + b.row * 13) * period) % period
      const k = Math.floor(at / step)
      if (k >= halves) return
      const row = b.row + (k >> 1)
      for (let col = b.col; col < b.col + b.w; col++) {
        if (text[row * cols + col]) return
        for (let j = 0; j < 8; j++) if (c.get(col * 2 + (j & 1), row * 4 + (j >> 1)) !== SCREEN) return
      }
      c.rect(b.col * 2, row * 4 + (k & 1) * 2, b.w * 2, 2, mix(SCREEN, PHOS_DIM, 0.12))
    }
    scan(worker.screen)
    if (!solo && youOn) scan(orch.screen)
    for (const b of [show.thinking, show.departures, show.details, show.files]) if (b) scan(innerOf(b))
  }

  // ── Labels under the desks and the rack; the caption on the last row.
  const lr = g.labelRow
  const zoneW = (d: DeskGeom) => d.zone[1] - d.zone[0] + 1
  // The desk labels name the models unless the hand-off is claimed (the models are its fact).
  const named = !claimed(shown, 'handoff')
  if (!solo) c.label(orch.zone[0], lr, cut(named && you?.model ? `you · ${shortModel(you.model)}` : 'you', zoneW(orch)), L(LABEL), L(LABEL))
  {
    // The worker's desk name (docs/DESIGN.md 36): `worker`, or `claude` when the pane follows this session.
    const tag = isDemo(s) ? ' · demo' : ''
    const desk = ctx.worker || 'worker'
    // With the rack standing for the model, the model's name is the rack's: the desk is just its name.
    const name = named && s.model && !modelRack ? `${desk} · ${shortModel(s.model)}` : desk
    const room = zoneW(worker)
    const text = tag && room >= tag.length + 8 ? cut(name, room - tag.length) + tag : cut(name, room)
    c.label(worker.zone[0], lr, text, L(LABEL), L(LABEL))
  }
  {
    // A rack standing for the model names it, unless the hand-off (the models' home) is claimed.
    const rk = modelRack ? (named ? shortModel(s.model) : '') : !srv ? 'no server' : g.rack.lines === 0 && tps != null && showDecode ? `${tps.toFixed(0)} tok/s` : srv.ok ? srv.adapter : `${srv.adapter} · off`
    const room = Math.max(1, g.panelR + g.P - g.panelL)
    const text = cut(rk, room)
    const col = Math.max(g.panelL, g.rack.col + (g.rack.w >> 1) - (text.length >> 1))
    const rkInk = srv || modelRack ? L(LABEL) : L(NO_SERVER)
    if (text) c.label(col, lr, text, rkInk, rkInk)
  }
  const mark = done ? (a.ok ? '✓' : '✖') : SPIN[frame % SPIN.length]!
  // The stalled text already says for how long (docs/DESIGN.md 31: one home per fact).
  const caption = done || st === 'nolog' || st === 'stalled' ? `${mark} ${a.text}` : `${mark} ${a.text} · ${fmtDur(a.secs)}`
  const capInk = done ? (a.ok ? GOOD : BAD) : stalled ? WARN : p.ink
  c.label(1, c.rows - 1, cut(caption, columns - 2), capInk, capInk)
  return c.encode()
}

export const officeHd: Scene = { id: 'office-hd', title: 'office hd', rows: { ...ROWS }, minColumns: MIN_COLUMNS, draw }
