// Scene "observatory" (HiCanvas; compact 7, standard 12, large 20 rows, any height from 7): a domed
// observatory on a hill under a night sky (docs/DESIGN.md 6.4, 6.4b). The slit in the dome sweeps
// while the model thinks (faster while it reads its prompt) and stops for a tool call, when the lamp
// by the door takes the tool's colour; each turn adds a star to a constellation; the moon fills with
// the context window; tool calls fall as shooting stars; pulses bring an aurora, a cloud bank, a red
// lamp or a satellite. The caption is the last row.
// One home per fact (docs/DESIGN.md 31): the turn count is said once, under the dome (the
// constellation keeps its stars and no label), and the dome's `turn N` and the moon's `ctx` go when
// `ctx.shown` claims `turns` or `ctx`; the pictures stay.
// Transparency: the sky IS the scene here, so the picture is painted whatever
// SceneCtx.transparent says; only the caption row is left NONE when transparent.
// Ambience (docs/DESIGN.md 42): thin clouds drift across the low sky, a minute to cross; grass at
// the horizon sways; the dome's slit (or its closed seam) breathes a faint warm light. All of it is
// art only (never a label's cell or a meaning colour), the same in every state, and gone with
// `ambience: false`, which draws the picture as it was before.
import { ctxLimitOf, fmtDur } from '../activity.ts'
import { TICK_SECS, ambient, breathe } from '../ambience.ts'
import { claimed } from '../facts.ts'
import { HiCanvas, cut, hash, hiLayout, mix, NONE } from '../hicanvas.ts'
import type { Layout, RGB } from '../hicanvas.ts'
import { PALETTES, labelIn, paletteOf, perPalette, shade } from '../palette.ts'
import type { Palette } from '../palette.ts'
import type { Scene, SceneCtx } from './index.ts'

const ROWS = { compact: 7, standard: 12, large: 20 }
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// The night look's colours: the anchors the tones below derive from (docs/DESIGN.md 27).
const SKY_TOP = 0x0a0b1a
const SKY_LOW = 0x14152e
const DAWN = [0x0a0b1a, 0x1c1a3a, 0x5a3a5a, 0xd08a5a]
const MILKY = 0x9a98d0
const HILL = 0x1b1c3a
const RIDGE = 0x2c2d55
const TREE = RIDGE
const WALL = 0x8d8d86
const WALL_LIGHT = 0xc9c9c0
const WALL_DARK = 0x5c5c62
const DOME = 0xa8a8a0
const DOME_BAND = 0x7c7c76
const DOME_LIGHT = 0xbdbdb4
const DOME_SEAM = 0x8a8a84
const DOOR = 0x1a1a24
const SLIT = 0x17171f
const LAMP_OFF = 0x4a4038
const MOON_LIT = 0xe9e9e1
const MOON_DARK = 0x2a2b4a
const CRATER = 0xc4c4ba
const LINE = 0x3a3b6a
const CLOUD = 0x3a3a44
const OVERCAST = 0x2e2e3a
const CLOUD_GRAIN = 0x2f2f39
const GOLD = 0xffd27a
const AURORA_BAND = [0x2fbf71, 0x3ec9c0, 0x8f6fe8]
const STAR_DIM = 0x34376a
const LABEL_DARK = 0x14121c
const CAPTION_BG = 0x0c0d1c
const MILKY_GRAIN = 0xc8c8ee
const STAR_WARM = 0xffe2b0
const STAR_COOL = 0xe8ecff
const POINT = 0xdfe4ff
const POINT_OLD = 0x9aa0d0
const WHITE = 0xffffff
const LAMP_ERR = 0x401418
const PER_CONSTELLATION = 40
// Ambience's own muted tones (docs/DESIGN.md 42.1): a pale night haze, the warm light inside the dome.
const HAZE = 0x6c6e9c
const DOME_WARM = 0xe0b07a

/**
 * The picture's palette. In `paper` the sky stays a night sky, a dark picture on the light page as
 * a screen stays dark in daylight: the stars, the constellation, the moon and the shooting stars
 * are light on dark and would not read on a daylight sky. Only the caption row, on the terminal's
 * own colour, follows the light palette.
 */
function pictureOf(p: Palette): Palette {
  return p.light ? PALETTES.night : p
}

/** Every colour the scene paints, from the palette's roles (night: exactly the anchors above). */
const tones = perPalette((p: Palette) => {
  const q = pictureOf(p)
  const sky = (c: RGB) => shade(q, 'sky', c)
  const stone = (c: RGB) => shade(q, 'bevel', c)
  const star = (c: RGB) => shade(q, 'star', c)
  return {
    skyTop: sky(SKY_TOP),
    skyLow: sky(SKY_LOW),
    dawn: [sky(DAWN[0]!), sky(DAWN[1]!), sky(DAWN[2]!), shade(q, 'model', DAWN[3]!)],
    milky: star(MILKY),
    milkyGrain: star(MILKY_GRAIN),
    hill: sky(HILL),
    ridge: sky(RIDGE),
    tree: sky(TREE),
    wall: stone(WALL),
    wallLight: stone(WALL_LIGHT),
    wallDark: stone(WALL_DARK),
    dome: stone(DOME),
    domeBand: stone(DOME_BAND),
    domeLight: stone(DOME_LIGHT),
    domeSeam: stone(DOME_SEAM),
    door: shade(q, 'wall', DOOR),
    slit: shade(q, 'wall', SLIT),
    amber: q.warn,
    lampOff: shade(q, 'lampOff', LAMP_OFF),
    lampErr: shade(q, 'bad', LAMP_ERR),
    moonLit: star(MOON_LIT),
    moonDark: sky(MOON_DARK),
    crater: star(CRATER),
    line: sky(LINE),
    cloud: shade(q, 'wall', CLOUD),
    overcast: shade(q, 'wall', OVERCAST),
    cloudGrain: shade(q, 'wall', CLOUD_GRAIN),
    gold: shade(q, 'warn', GOLD),
    auroraBand: [shade(q, 'good', AURORA_BAND[0]!), shade(q, 'tools', AURORA_BAND[1]!), shade(q, 'think', AURORA_BAND[2]!)],
    starDim: sky(STAR_DIM),
    starWarm: star(STAR_WARM),
    starCool: star(STAR_COOL),
    point: star(POINT),
    pointOld: star(POINT_OLD),
    white: star(WHITE),
    think: q.think,
    bad: q.bad,
    classes: q.classes,
    label: mix(q.ink, q.dim, 0.4),
    labelDark: shade(q, 'wall', LABEL_DARK),
    // The caption row, on the terminal's own colour (or its own strip): the palette's own inks.
    captionBg: p.light ? p.wall : shade(q, 'sky', CAPTION_BG),
    capGood: p.good,
    capBad: p.bad,
    capWarn: p.warn,
    capInk: p.ink,
    // Ambience (docs/DESIGN.md 42): its own tones, never a meaning colour.
    haze: sky(HAZE),
    domeWarm: star(DOME_WARM),
  }
})

/** Squared distance between two colours, for "is this pixel still the sky". */
function dist2(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255)
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255)
  const db = (a & 255) - (b & 255)
  return dr * dr + dg * dg + db * db
}

/** Allocation-free colour mix for the per-pixel passes. */
function mx(a: number, b: number, t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * u
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * u
  const bl = (a & 255) + ((b & 255) - (a & 255)) * u
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

function rampOf(stops: number[], t: number): number {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mx(stops[i]!, stops[i + 1]!, x - i)
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Thousands as the moon's label wants them: 54k, 131k, 1.0M. */
function kilo(n: number): string {
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
}

export type ObsGeom = {
  W: number
  H: number
  /** Picture height in sub-pixels (every row but the caption). */
  P: number
  lay: Layout
  groundY: number
  /** The hill's top under the building: a multiple of 4, one below the base. */
  peakY: number
  /** The base: x, width, top row (it ends at peakY − 1). */
  bx: number
  bw: number
  baseTop: number
  baseH: number
  /** The dome: radius and centre x (a sub-pixel boundary). */
  r: number
  cx: number
  door: { x: number; y: number; w: number }
  /** The door lamp's sub-pixel. */
  lamp: [number, number]
  moon: { x: number; y: number; r: number }
  /** The constellation region, or null (narrow). */
  cons: { x: number; y: number; w: number; h: number } | null
  /** The hill's top sub-pixel row per sub-pixel column. */
  hill: Int16Array
}

/** Where everything stands for a canvas of `columns × rows` cells (exported for the tests). */
export function obsLayout(columns: number, rows: number): ObsGeom {
  const W = columns * 2
  const H = rows * 4
  const P = Math.max(8, (rows - 1) * 4)
  const lay = hiLayout(columns)
  const groundY = P - 1
  const hPk = clamp(Math.round(P * 0.2), 8, 24)
  const peakY = Math.max(4, 4 * Math.floor((P - hPk) / 4))
  const r = Math.max(3, Math.min(clamp(Math.round(P * 0.23), 5, 16), Math.floor(W * 0.1)))
  const baseH = r >= 12 ? 12 : 8
  const baseTop = peakY - baseH
  const bw = 2 * r + 2
  const mr = rows < 10 ? 3 : rows < 16 ? 4 : 5
  const moonX = W - Math.max(7, Math.round(W * 0.05)) - mr
  const moonY = mr + 2
  let bx = 2 * Math.round((W * 0.72 - bw / 2) / 2)
  if (moonY + mr + 2 >= baseTop - r && bx + bw + 3 >= moonX - mr) bx = 2 * Math.floor((moonX - mr - 4 - bw) / 2)
  bx = Math.max(2, bx)
  const cx = bx + bw / 2
  const doorW = r >= 8 ? 4 : 2
  const doorX = 2 * Math.round((cx - doorW / 2) / 2)
  const doorY = baseTop + (baseH >= 12 ? 4 : 2)
  const lamp: [number, number] = [doorX + doorW + 1, baseTop + 4]

  // The hill: flat under the building, easing down both ways to a low ridge, with a gentle swell.
  const hill = new Int16Array(W)
  const half = bw / 2 + 3
  const sig = Math.max(16, W * 0.2)
  const top = groundY - peakY
  const low = Math.max(3, Math.round(top * 0.3))
  // One height per cell (both sub-columns alike), so the ridge cells are whole ▂ ▄ ▆ ▀ glyphs.
  for (let x = 0; x < W; x += 2) {
    const d = Math.max(0, Math.abs(x + 1 - cx) - half)
    const swell = 1.4 * Math.sin(x * 0.045 + 0.7) * Math.min(1, d / 12)
    const h = low + (top - low) * Math.exp(-((d / sig) ** 2)) + swell
    // Never in the ground line's cell row, where the ridge, the fill and the line would make three.
    hill[x] = clamp(Math.round(groundY - h), peakY, groundY - 4)
    if (x + 1 < W) hill[x + 1] = hill[x]!
  }

  // The constellation region: top left, clear of the dome; a label row under it on wide.
  let cons: ObsGeom['cons'] = null
  if (lay !== 'narrow') {
    const x0 = 6
    const right = Math.min(bx - 12, Math.round(W * (lay === 'wide' ? 0.52 : 0.45)))
    const y0 = 3
    let yb = H
    for (let x = x0; x < right; x++) yb = Math.min(yb, hill[x]!)
    yb -= lay === 'wide' ? 10 : 6
    const h = Math.min(48, yb - y0)
    if (right - x0 >= 24 && h >= 8) cons = { x: x0, y: y0, w: right - x0, h }
  }
  return { W, H, P, lay, groundY, peakY, bx, bw, baseTop, baseH, r, cx, door: { x: doorX, y: doorY, w: doorW }, lamp, moon: { x: moonX, y: moonY, r: mr }, cons, hill }
}

type Label = { col: number; row: number; text: string }

/**
 * A puffy cloud: ellipses filled in 1 × 2 quadrant steps, so the rim is whole block glyphs; inside,
 * hash dots of `grain` (changing with `tick`) give it a noisy, moving texture.
 */
function puff(c: HiCanvas, lumps: number[], bottom: number, tick: number, col: RGB, grain: RGB): void {
  for (let i = 0; i + 3 < lumps.length; i += 4) {
    const lx = lumps[i]!
    const ly = lumps[i + 1]!
    const rx = lumps[i + 2]!
    const ry = lumps[i + 3]!
    for (let y0 = Math.floor((ly - ry) / 2) * 2; y0 <= ly + ry && y0 + 1 < bottom; y0 += 2) {
      for (let x = Math.floor(lx - rx); x <= lx + rx; x++) {
        const dx = (x + 0.5 - lx) / rx
        const dy = (y0 + 1 - ly) / ry
        const d = dx * dx + dy * dy
        if (d > 1) continue
        c.set(x, y0, col)
        c.set(x, y0 + 1, col)
        if (grain !== col && d < 0.8) {
          if (hash(x * 31.7 + y0 * 17.3 + tick * 7.1) < 0.3) c.set(x, y0, grain)
          if (hash(x * 13.3 + y0 * 29.9 + tick * 3.7) < 0.3) c.set(x, y0 + 1, grain)
        }
      }
    }
  }
}

/** A line with every other sub-pixel lit (ends excluded): light braille, like a star chart. */
function dotted(c: HiCanvas, x0: number, y0: number, x1: number, y1: number, col: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 2; i < n - 1; i += 2) c.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), col)
}

function draw(ctx: SceneCtx): string {
  const { s, a, frame, t, columns, rows: rowsIn, transparent = true } = ctx
  const pal = paletteOf(ctx)
  const T = tones(pal)
  const rows = Number.isFinite(rowsIn) ? Math.max(1, Math.floor(rowsIn)) : ROWS.standard
  const c = new HiCanvas(columns, rows)
  const g = obsLayout(columns, rows)
  const { W, P, hill } = g
  const st = a.state
  const done = st === 'done'
  const dawn = done && a.ok === true
  const pulse = a.pulse
  const ink = transparent ? NONE : T.captionBg
  const pictureRows = Math.min(P, c.h - 4)
  // Ambience (docs/DESIGN.md 42): the compact banner keeps the slit's light alone.
  const amb = ambient(ctx)
  const roomy = amb && P >= 40

  // ── Labels first, so the stars keep out of their cells.
  const labels: Label[] = []
  const turns = s.turns ?? 0
  const domeCells = { c0: Math.floor(g.bx / 2) - 1, c1: Math.ceil((g.bx + g.bw) / 2) + 1, r0: Math.floor((g.baseTop - g.r) / 4) }
  if (s.exists && !claimed(ctx.shown, 'turns')) {
    const text = `turn ${turns}`
    labels.push({ col: clamp(Math.round(g.cx / 2 - text.length / 2), 0, Math.max(0, columns - text.length)), row: g.peakY / 4, text })
  }
  const limit = ctxLimitOf(s)
  const frac = limit ? clamp((s.ctx ?? 0) / limit, 0, 1) : 0.5
  if (limit && s.exists && !claimed(ctx.shown, 'ctx')) {
    const row = Math.ceil((g.moon.y + g.moon.r + 1) / 4)
    for (const text of [`ctx ${kilo(s.ctx ?? 0)}/${kilo(limit)}`, `${kilo(s.ctx ?? 0)}/${kilo(limit)}`]) {
      const col = clamp(Math.round(g.moon.x / 2 - text.length / 2), 0, Math.max(0, columns - text.length - 1))
      const hitsDome = row >= domeCells.r0 && col < domeCells.c1 && col + text.length > domeCells.c0
      if (row < rows - 1 && row * 4 + 3 < hill[Math.min(W - 1, col * 2)]! && !hitsDome) {
        labels.push({ col, row, text })
        break
      }
    }
  }
  const inLabel = (x: number, y: number): boolean => {
    const col = x >> 1
    const row = y >> 2
    for (const l of labels) if (row === l.row && col >= l.col && col < l.col + l.text.length) return true
    return false
  }

  // ── The sky: a vertical ramp (warming at dawn) with the Milky Way as a faint diagonal haze.
  const skyRow = new Uint32Array(pictureRows)
  for (let y = 0; y < pictureRows; y++) {
    const v = y / Math.max(1, P - 1)
    skyRow[y] = dawn ? rampOf(T.dawn, v * v * 1.05) : mx(T.skyTop, T.skyLow, v)
  }
  const mwFade = dawn ? 0.3 : 1
  const mwA = P * 0.85
  const mwB = -P * 0.15
  const mwHalf = Math.max(4, P * 0.16)
  for (let y = 0; y < pictureRows; y++) {
    const base = skyRow[y]!
    for (let x = 0; x < W; x++) {
      const u = (y - (mwA + ((mwB - mwA) * x) / W)) / mwHalf
      let col = base
      if (u > -2.5 && u < 2.5) {
        const band = Math.exp(-u * u) * (0.75 + 0.25 * Math.sin(x * 0.05 + y * 0.09)) * mwFade
        col = mx(base, T.milky, 0.08 * band)
        if (hash(x * 3.71 + y * 91.3) > 1 - 0.03 * band) col = mx(base, T.milkyGrain, 0.28 * mwFade)
      }
      c.px[y * W + x] = col
    }
  }
  const sky = (x: number, y: number): number => (y >= 0 && y < pictureRows ? skyRow[y]! : T.skyLow)

  // ── Pulse: tests passed, an aurora band across the sky for 8 s.
  if (pulse?.kind === 'tests-pass') {
    const env = Math.min(1, pulse.age / 0.8) * Math.min(1, (8 - pulse.age) / 2)
    const skyH = g.peakY
    for (let x = 0; x < W; x++) {
      const yc = skyH * 0.42 + skyH * 0.1 * Math.sin(x * 0.03 + frame * 0.04)
      const th = Math.max(3, skyH * 0.26 * (0.75 + 0.25 * Math.sin(x * 0.11 - frame * 0.07)))
      const curtain = 0.55 + 0.45 * Math.sin(x * 0.45 + frame * 0.09) * Math.sin(x * 0.13 - frame * 0.05)
      const y0 = Math.floor(yc - th)
      const y1 = Math.ceil(yc + th * 0.25)
      for (let y = Math.max(0, y0); y <= y1 && y < hill[x]!; y++) {
        const v = clamp((y1 - y) / (y1 - y0), 0, 1)
        const edge = Math.min(1, (y1 - y) / 2) * (1 - v * v)
        c.px[y * W + x] = mx(c.px[y * W + x]!, rampOf(T.auroraBand, v), 0.25 * env * curtain * edge * 1.6)
      }
    }
  }

  // ── Stars: 1 per 6 columns (more on a tall sky), single sub-pixels twinkling on a 40-frame period.
  const skyH = Math.max(4, g.peakY)
  const nStars = Math.round((columns / 6) * Math.max(1, skyH / 32))
  const starFade = dawn ? 0.55 : 1
  for (let i = 0; i < nStars; i++) {
    const x = Math.floor(hash(i * 3 + 1) * W)
    const y = Math.floor(hash(i * 3 + 2) ** 1.25 * skyH * 0.75)
    if (y >= hill[x]! - 2 || inLabel(x, y)) continue
    const tw = 0.5 + 0.5 * Math.sin((frame * Math.PI * 2) / 40 + hash(i * 3 + 3) * 6.283)
    const warm = hash(i * 5 + 7) > 0.7 ? T.starWarm : T.starCool
    let col = mx(T.starDim, warm, 0.25 + 0.75 * tw)
    if (dawn) col = mx(sky(x, y), col, starFade * (1 - (y / skyH) * 0.8))
    c.set(x, y, col)
  }

  // ── The constellation: one point per turn, joined in order; 40 to a figure, the next to the right.
  if (g.cons && turns > 0) {
    const R = g.cons
    const K = Math.ceil(turns / PER_CONSTELLATION)
    const slots = clamp(Math.floor(R.w / 48), 1, 4)
    const slotW = Math.floor(R.w / slots)
    const first = Math.max(0, K - slots)
    for (let j = first; j < K; j++) {
      const sx = R.x + (j - first) * slotW
      const n = Math.min(PER_CONSTELLATION, turns - j * PER_CONSTELLATION)
      const current = j === K - 1
      const seed = j * 977
      let px = sx + slotW * (0.1 + 0.15 * hash(seed + 1))
      let py = R.y + R.h * (0.25 + 0.5 * hash(seed + 2))
      let ang = (hash(seed + 3) - 0.5) * 1.2
      let lx = -1
      let ly = -1
      const pts: number[] = []
      for (let m = 0; m < n; m++) {
        if (m > 0) {
          ang += (hash(seed + m * 7 + 11) - 0.5) * 2.2
          const step = Math.max(3, Math.min(slotW, R.h * 1.6) * (0.1 + 0.12 * hash(seed + m * 7 + 12)))
          let nx = px + Math.cos(ang) * step * 1.3
          let ny = py + Math.sin(ang) * step
          if (nx < sx + 1 || nx > sx + slotW - 3) {
            ang = Math.PI - ang
            nx = clamp(nx, sx + 1, sx + slotW - 3)
          }
          if (ny < R.y || ny > R.y + R.h - 1) {
            ang = -ang
            ny = clamp(ny, R.y, R.y + R.h - 1)
          }
          px = nx
          py = ny
        }
        const x = Math.round(px)
        const y = Math.round(py)
        if (lx >= 0) dotted(c, lx, ly, x, y, current ? T.line : mx(T.line, T.skyTop, 0.35))
        pts.push(x, y)
        lx = x
        ly = y
      }
      for (let m = 0; m < pts.length; m += 2) {
        const newest = current && m === pts.length - 2
        let col = current ? T.point : T.pointOld
        if (newest && !done) col = mx(T.think, T.white, 0.5 + 0.5 * Math.sin(frame * 0.35))
        c.set(pts[m]!, pts[m + 1]!, col)
      }
    }
  }

  // ── The moon: lit fraction = ctx / limit (a steady half with no limit), with a faint halo.
  {
    // Quadrant steps (1 × 2 sub-pixels) keep the rim solid; the centre sits on a pair boundary.
    const { x: mcx, y: mcy, r: mr } = g.moon
    const R2 = (mr + 0.4) ** 2
    const hr = mr + 1
    for (let y0 = mcy - hr - 1; y0 <= mcy + hr; y0 += 2) {
      const dy = y0 + 1 - mcy
      for (let x = mcx - hr; x < mcx + hr; x++) {
        const dx = x + 0.5 - mcx
        const d2 = dx * dx + dy * dy
        for (const y of [y0, y0 + 1]) {
          if (x < 0 || y < 0 || x >= W || y >= pictureRows) continue
          if (d2 <= R2) {
            const hw = Math.sqrt(Math.max(0, R2 - dy * dy))
            const lit = frac > 0.005 && dx > Math.min(hw * (1 - 2 * frac), hw - 1)
            let col = lit ? T.moonLit : T.moonDark
            if (lit && mr >= 4 && hash(Math.floor(dx + 9) * 13 + dy * 7) > 0.8) col = T.crater
            c.set(x, y, col)
          }
        }
      }
    }
  }

  // ── Shooting stars: one per tool call in the last 8 s, down-right in the class colour.
  for (const ev of s.events ?? []) {
    if (ev.kind !== 'tool' || !ev.cls || ev.t == null) continue
    const age = t - ev.t
    if (age < 0 || age >= 8) continue
    const seed = Math.floor(ev.t * 13) % 100_000
    const phase = (frame + Math.floor(hash(seed) * 40)) % 40
    if (phase >= 10) continue
    const p = phase / 10
    const len = clamp(W * 0.22, 20, 64)
    const x0 = W * (0.08 + 0.45 * hash(seed + 1))
    const y0 = 1 + hash(seed + 2) * skyH * 0.2
    const hx = x0 + p * len
    const hy = y0 + p * len * 0.4
    const col = T.classes[ev.cls]
    const tail = 12
    for (let i = tail; i >= 0; i--) {
      const x = Math.round(hx - i * 0.93)
      const y = Math.round(hy - i * 0.37)
      if (x < 0 || y < 0 || x >= W || y >= hill[Math.min(W - 1, Math.max(0, x))]!) continue
      if (i > 0 && i % 2 === 0 && i > tail / 2) continue // the far tail breaks into dots
      c.set(x, y, mx(col, c.get(x, y), i / (tail + 1)))
    }
    c.set(Math.round(hx), Math.round(hy), mx(col, T.white, 0.4))
  }

  // ── Pulse: a commit, a gold satellite crossing high up.
  if (pulse?.kind === 'commit') {
    const x = Math.floor((pulse.age / 8) * W)
    const y = 2
    c.set(x, y, frame % 6 < 4 ? T.gold : mx(T.gold, T.skyTop, 0.5))
    c.set(x - 2, y, mx(T.gold, T.skyTop, 0.75))
  }

  // ── Stalled: a cloud deck over the top half of the sky that stays.
  if (st === 'stalled') {
    // Two rows of big lumps from the top down to about half the sky; behind the dome.
    const lumps: number[] = []
    const ry = Math.max(3, skyH * 0.2)
    for (let row = 0; row < 2; row++) {
      for (let lx = -6 + row * ry * 1.5, j = 0; lx < W + 8; j++) {
        const rx = ry * (1.4 + 1.0 * hash(j * 5 + row * 101 + 3))
        const ly = row === 0 ? ry * 0.4 : skyH * 0.5 - ry * (0.3 + 1.0 * hash(j * 5 + 4))
        lumps.push(lx + rx * 0.5, ly, rx, ry * (row === 0 ? 1.4 : 1))
        lx += rx * (row === 0 ? 1.2 : 1.9)
      }
    }
    puff(c, lumps, pictureRows, 0, T.overcast, T.overcast)
  }

  // ── The hill: a dark bump with a lighter ridge, and the ground line along the bottom.
  for (let x = 0; x < W; x++) {
    const top = hill[x]!
    for (let y = top; y < pictureRows; y++) c.px[y * W + x] = T.hill
    // The ridge runs from the top to the end of its cell row (two rows when it starts a cell), so
    // each ridge cell is a solid ▂ ▄ ▆ or ▀ over the sky.
    // At dawn the sky is lighter than the ridge, which flips the glyph's mask (▂ becomes rows 0–2,
    // braille): then the ridge starts on an even row so its cells are ▀ or ▄ either way round.
    const t0 = dawn ? top & ~1 : top
    const end = t0 % 4 === 0 ? t0 + 1 : t0 | 3
    for (let y = end; y >= t0; y--) if (y >= 0 && y < pictureRows) c.px[y * W + x] = T.ridge
  }
  if (g.groundY < pictureRows) c.hline(0, W - 1, g.groundY, T.ridge)

  // ── Ambience (docs/DESIGN.md 42): grass along the horizon. Tufts of blades in the ridge's colour
  // where the ridge starts on an even row, built of 1 × 2 quadrants (so each cell stays a quadrant
  // shape in two colours, sky and ridge), clear of the building's flat; a tall blade's tip leans a
  // sub-pixel and back on a loop of its own, 5 to 9 s.
  if (roomy) {
    const n = Math.round(W / 12)
    for (let i = 0; i < n; i++) {
      const x = 2 * Math.floor((hash(i * 7 + 301) * W) / 2)
      if (x + 1 >= W || (x >= g.bx - 6 && x <= g.bx + g.bw + 5)) continue
      const top = dawn ? hill[x]! & ~1 : hill[x]!
      if (top % 2 !== 0 || top < 4) continue
      const blade = (bx: number, y: number) => {
        if (y >= 0 && y + 1 < pictureRows && !inLabel(bx, y)) {
          c.set(bx, y, T.ridge)
          c.set(bx, y + 1, T.ridge)
        }
      }
      const side = hash(i * 7 + 302) > 0.5 ? 1 : 0
      blade(x + side, top - 2)
      if (hash(i * 7 + 303) > 0.4) blade(x + 1 - side, top - 2)
      if (hash(i * 7 + 304) > 0.3) {
        const lean = breathe(frame, 5 + 4 * hash(i * 7 + 305), hash(i * 7 + 306)) > 0.5 ? 1 - side : side
        blade(x + lean, top - 4)
      }
    }
  }

  const pineBoxes: number[] = [] // x0, y0, x1, y1 per pine, for the clouds to pass behind
  {
    const x0 = Math.round(W * 0.3)
    const x1 = g.bx - 8
    const n = g.lay === 'narrow' ? 1 : g.lay === 'mid' ? 2 : 3
    const span = x1 - x0
    for (let i = 0; i < n && span >= 12; i++) {
      let tx = Math.round(x0 + ((i + 0.3 + 0.4 * hash(i * 11 + 5)) * span) / n)
      const ok = (x: number) => x >= 0 && x < W && hill[x]! % 2 === 0
      let shift = 0
      while (shift < 8 && !ok(tx + shift) && !ok(tx - shift)) shift++
      if (shift >= 8) continue
      tx = ok(tx + shift) ? tx + shift : tx - shift
      const foot = dawn ? hill[tx]! & ~1 : hill[tx]!
      const pairs = Math.round(clamp(P * (0.09 + 0.04 * hash(i * 11 + 6)), 3, 8))
      const yTop = foot - 2 - pairs * 2
      pineBoxes.push(tx - (pairs >> 1) - 1, yTop, tx + (pairs >> 1) + 1, foot)
      for (let k = 0; k < pairs; k++) {
        const y0 = yTop + k * 2
        const half = Math.floor((k + 1) / 2)
        for (let x = tx - half; x <= tx + half; x++) {
          if (x < 0 || x >= W) continue
          // Only where the pair ends above this column's ridge cell (or the ridge fills the cell's lower half).
          const top = hill[x]!
          if (!((y0 >> 2) < (top >> 2) || (top % 4 === 2 && y0 + 1 < top))) continue
          c.set(x, y0, T.tree)
          c.set(x, y0 + 1, T.tree)
        }
      }
      c.set(tx, foot - 2, T.tree)
      c.set(tx, foot - 1, T.tree)
    }
  }

  // ── The observatory: a bezelled base with a door and a lamp, and the dome with its slit.
  const { bx, bw, baseTop, peakY, r, cx } = g
  for (let y = baseTop; y < peakY; y++) {
    for (let x = bx; x < bx + bw; x++) {
      let col = T.wall
      if (y < baseTop + 2 || x === bx) col = T.wallLight
      if (y >= peakY - 2 || x === bx + bw - 1) col = T.wallDark
      c.set(x, y, col)
    }
  }
  c.rect(g.door.x, g.door.y, g.door.w, peakY - g.door.y, T.door)
  let theta: number | null = null
  if (st === 'thinking') theta = 1.1 * Math.sin(frame * 0.02)
  else if (st === 'prefill') theta = 1.1 * Math.sin(frame * 0.06)
  else if (st === 'tool') theta = 0.35
  // The dome in quadrant steps (1 × 2 sub-pixels): every edge cell is then a solid block glyph.
  const domeHw = (y0: number): number => {
    const dy = baseTop - y0 - 1
    return dy > r + 0.4 ? -1 : Math.sqrt(Math.max(0, (r + 0.4) ** 2 - dy * dy))
  }
  for (let y0 = baseTop - 2; y0 >= baseTop - r - 2; y0 -= 2) {
    const hw = domeHw(y0)
    if (hw < 0) continue
    for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw); x++) {
      if (Math.abs(x + 0.5 - cx) > hw) continue
      const col = y0 >= baseTop - 2 ? T.domeBand : x + 0.5 < cx - hw * 0.55 && y0 < baseTop - r * 0.4 ? T.domeLight : T.dome
      c.set(x, y0, col)
      c.set(x, y0 + 1, col)
    }
  }
  const slitW = r >= 8 ? 2.2 : 1.4
  if (theta != null) {
    const glow = st === 'thinking' ? 0.5 + 0.2 * Math.sin(frame * 0.3) : st === 'prefill' ? 0.3 + 0.15 * Math.sin(frame * 0.6) : 0
    let slit = glow > 0 ? mx(T.slit, T.think, glow) : T.slit
    // Ambience: the warm light inside the dome breathes faintly through the slit, over 8 s.
    if (amb) slit = mx(slit, T.domeWarm, 0.12 + 0.06 * breathe(frame, 8))
    const sinT = Math.sin(theta)
    const hwS = Math.max(0.5, (slitW * Math.cos(theta)) / 2)
    for (let y0 = baseTop - 2; y0 >= baseTop - r - 2; y0 -= 2) {
      const hwRow = domeHw(y0)
      if (hwRow < 2) continue // the cap stays whole, or the dome reads as two horns
      const sinP = clamp((baseTop - y0 - 1) / r, 0, 1)
      const xc = cx + r * sinT * Math.sqrt(1 - sinP * sinP)
      for (let x = Math.floor(xc - hwS - 1); x <= Math.ceil(xc + hwS); x++) {
        if (Math.abs(x + 0.5 - cx) > hwRow - 0.5 || Math.abs(x + 0.5 - xc) > hwS) continue
        c.set(x, y0, slit)
        c.set(x, y0 + 1, slit)
      }
    }
  } else {
    // Closed: the two shutters meet in a seam down the middle.
    // Ambience: the light inside shows faintly along it, breathing over 8 s.
    const seam = amb ? mx(T.domeSeam, T.domeWarm, 0.1 + 0.06 * breathe(frame, 8)) : T.domeSeam
    for (let y = baseTop - r; y < baseTop - 2; y++) if (c.get(Math.floor(cx), y) !== NONE) c.set(Math.floor(cx), y, seam)
  }

  // The door lamp: amber at work, the tool's colour during a call, red on an error or a failed end.
  let lamp: RGB = T.amber
  if (st === 'tool') lamp = T.classes[a.cls ?? 'other']
  if (st === 'nolog') lamp = T.lampOff
  if (st === 'waiting') lamp = Math.floor(frame / 6) % 2 === 0 ? T.amber : T.lampOff
  if ((pulse?.kind === 'error' || pulse?.kind === 'denied') && !done) lamp = frame % 4 < 2 ? T.bad : T.lampErr
  if (done) lamp = a.ok ? T.amber : T.bad
  c.set(g.lamp[0], g.lamp[1], lamp)
  c.set(g.lamp[0], g.lamp[1] + 1, lamp)
  // Its light falls on the step below the door.
  for (let x = g.door.x - 1; x <= g.door.x + g.door.w; x++) {
    if (peakY < pictureRows && st !== 'nolog') c.set(x, peakY, mx(T.hill, lamp, 0.18))
  }

  // ── Ambience (docs/DESIGN.md 42): thin clouds drifting across the low sky, 50 to 60 s to cross,
  // each a long strand with a shorter one above and a wisp below. They pass behind the hill, the
  // pines and the observatory (only whole cells of sky take them) and keep off the labels; a star,
  // a constellation point or the Milky Way's grain shows through, since only sky pixels are veiled.
  if (roomy) {
    const nC = g.lay === 'narrow' ? 1 : g.lay === 'mid' ? 2 : 3
    const dc0 = (g.bx >> 1) - 1
    const dc1 = ((g.bx + g.bw) >> 1) + 1
    const dr0 = Math.floor((baseTop - r - 2) / 4)
    const clear = (x: number, y: number): boolean => {
      if (x < 0 || x >= W || y < 0 || y >= pictureRows || (y | 3) >= hill[x]! || inLabel(x, y)) return false
      const col = x >> 1
      const row = y >> 2
      if (col >= dc0 && col <= dc1 && row >= dr0) return false
      for (let i = 0; i < pineBoxes.length; i += 4) {
        if (col >= pineBoxes[i]! >> 1 && col <= pineBoxes[i + 2]! >> 1 && row >= pineBoxes[i + 1]! >> 2 && row <= pineBoxes[i + 3]! >> 2) return false
      }
      return dist2(c.px[y * W + x]!, skyRow[y]!) < 1600
    }
    const STRANDS = [0, 0, 1, -2, 0.2, 0.7, 2, 0.45, 0.85] // dy, from, to (of the cloud's length)
    for (let j = 0; j < nC; j++) {
      const L = Math.max(18, Math.round(W * (0.12 + 0.08 * hash(j * 13 + 401))))
      const period = (50 + 10 * hash(j * 13 + 402)) / TICK_SECS
      const x0 = (((frame / period + hash(j * 13 + 403)) % 1) * (W + L)) - L
      const yc = 2 * Math.round((skyH * (0.48 + 0.3 * ((j + hash(j * 13 + 404)) / nC))) / 2)
      for (let k = 0; k < STRANDS.length; k += 3) {
        const xs = x0 + STRANDS[k + 1]! * L
        const xe = x0 + STRANDS[k + 2]! * L
        const y = yc + STRANDS[k]!
        for (let x = Math.max(0, Math.ceil(xs)); x <= Math.min(W - 1, Math.floor(xe)); x++) {
          const a = 0.2 * Math.min(1, (x - xs) / 5, (xe - x) / 5) * (k === 0 ? 1 : 0.8)
          if (a <= 0.02) continue
          for (const yy of [y, y + 1]) if (clear(x, yy)) c.px[yy * W + x] = mx(c.px[yy * W + x]!, T.haze, a)
        }
      }
    }
  }

  // ── Pulse: tests failed, a noisy cloud bank drifting over the dome.
  if (pulse?.kind === 'tests-fail') {
    // From the left of the dome to over it across the 8 s, drifting a little every frame.
    const ccx = cx - r * 2.2 + (pulse.age / 8) * r * 2.2 + frame * 0.08
    const ccy = baseTop - r * 0.9
    const lumps: number[] = []
    for (let j = 0; j < 5; j++) {
      const rr = r * (0.35 + 0.3 * hash(j * 3 + 2)) * (j === 1 || j === 3 ? 1.25 : 1)
      lumps.push(ccx + (j - 2) * r * 0.7, ccy - (j === 1 || j === 3 ? rr * 0.4 : 0) + (hash(j * 3 + 1) - 0.5) * r * 0.25, rr * 1.25, rr)
    }
    puff(c, lumps, pictureRows, Math.floor(frame / 3), T.cloud, T.cloudGrain)
  }

  // ── The caption row: the terminal's own colour when transparent.
  for (let y = pictureRows; y < c.h; y++) for (let x = 0; x < W; x++) c.px[y * W + x] = ink

  // ── Labels under things, and the caption.
  // In the picture: the picture's inks (a light palette's sky is the night one).
  const q = pictureOf(pal)
  for (const l of labels) if (l.row < rows - 1) labelIn(q, c, l.col, l.row, cut(l.text, columns - l.col), T.label, T.labelDark)
  const mark = done ? (a.ok ? '✓' : '✖') : SPIN[frame % SPIN.length]!
  // The stalled text already says for how long (docs/DESIGN.md 31: one home per fact).
  const caption = done || st === 'nolog' || st === 'stalled' ? `${mark} ${a.text}` : `${mark} ${a.text} · ${fmtDur(a.secs)}`
  const capInk = done ? (a.ok ? T.capGood : T.capBad) : st === 'stalled' ? T.capWarn : T.capInk
  labelIn(pal, c, 1, rows - 1, cut(caption, columns - 2), capInk, capInk)
  return c.encode()
}

export const observatory: Scene = { id: 'observatory', title: 'observatory', rows: ROWS, minColumns: 40, draw }
