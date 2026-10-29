// Ambience, the lofi layer (docs/DESIGN.md 42): slow decorative loops that keep a calm scene from
// looking frozen and mean nothing. Held apart from the motion that reports the run by the rules of
// 42.1: never over a text cell, never in a meaning colour (`bad`, `good`, `warn`, `think`), loops 2
// to 60 seconds long with nothing blinking faster than twice a second, a breathing light within
// 15 %, a moving speck one unit at a time, the same in every state, and a pure function of `frame`
// (and `t`, through the window's look) so the goldens stay reproducible. Off (`ambience: off`)
// draws exactly what each scene drew before.
//
// This module holds the shared parts: the switch, a breathing curve, the tones (memoised per
// palette), and the pieces of the window both offices draw (a skyline with lit windows, a plane
// light, rain on the glass, fireflies) plus the steam, the string lights and the dust motes. Each
// piece works in its caller's own units, like `weather()` in hooks/seasons.ts: one Canvas pixel in
// office, one HiCanvas sub-pixel in office-hd, so both offices draw the same window at their scale.
import { hash, mix, scale } from './canvas.ts'
import type { RGB } from './canvas.ts'
import { onGreen, perPalette } from './palette.ts'
import type { Palette } from './palette.ts'
import { isDay } from './seasons.ts'
import type { Holiday, Season } from './seasons.ts'

/** The pane's tick (register.tsx FRAME_MS): one `frame` is this many seconds while the worker is live. */
export const TICK_SECS = 0.12

/** Whether a scene draws its ambience: `ctx.ambience` (the `ambience` setting), on when absent. */
export function ambient(ctx: { ambience?: boolean } | null | undefined): boolean {
  return ctx?.ambience !== false
}

/**
 * A slow breath, 0 at rest to 1 at the top and back, over `periodSecs` at the 120 ms tick: a smooth
 * sine of `frame`. `phase` (0..1, a fraction of the period) puts lights of one strand out of step.
 */
export function breathe(frame: number, periodSecs: number, phase = 0): number {
  const per = Math.max(1, periodSecs / TICK_SECS)
  return 0.5 - 0.5 * Math.cos((frame / per + phase) * 2 * Math.PI)
}

/** One ambient speck in its caller's units, with its strength `a` (0..1): how far to mix its tone over what lies beneath. */
export type Glow = { x: number; y: number; a: number }

/** Where an ambient tone lands: the caller mixes `tone` over what it already drew there by `a`. */
export type Put = (x: number, y: number, tone: RGB, a: number) => void

// ── Tones (docs/DESIGN.md 42.1, rule 2): warm lamplight, glass, steam, the night city, each mixed
// from the palette's roles. In `phosphor` they are put on its green and kept dim; in `paper`
// (a light room) the glass and the air get soft shadows rather than glows.

export type AmbientTones = {
  /** The lamplight's warm pool on a desk, mixed into the wood. */
  lamp: RGB
  /** The string lights' bulbs (warm white, peach, soft gold, by `tone`), and their wire. */
  bulbs: RGB[]
  wire: RGB
  /** A raindrop on the glass at full strength, mixed over the glass by its `a`. */
  drop: RGB
  /** A lit window across the street. */
  city: RGB
  /** The plane light at its blink. */
  plane: RGB
  /** A firefly at its brightest. */
  firefly: RGB
  /** A mote of dust in the window's light (a soft shadow in a light palette). */
  dust: RGB
  /** Steam off a mug, its near puff and its thinner far one. */
  steam: RGB
  steam2: RGB
  /** The cat's back at the top of a breath, mixed into its body. */
  catBack: RGB
}

function makeTones(p: Palette): AmbientTones {
  const warm = (f: number) => mix(p.star, p.model, f)
  // Phosphor: one hue, and dim (never as bright as its `good`, `warn` or `think`).
  const g = (c: RGB): RGB => (p.id === 'phosphor' ? scale(onGreen(c), 0.62) : c)
  return {
    lamp: g(p.light ? warm(0.3) : warm(0.35)),
    bulbs: (p.light ? [mix(p.model, p.star, 0.45), mix(p.model, p.star, 0.65), mix(p.deskTop, p.star, 0.35)] : [warm(0.15), warm(0.5), mix(warm(0.3), p.deskTop, 0.25)]).map(c => g(scale(c, p.light ? 1 : 0.92))),
    wire: g(p.light ? mix(p.frame, p.wall, 0.6) : scale(p.frame, 0.45)),
    drop: g(p.light ? mix(p.sky, p.frame, 0.55) : mix(p.star, p.sky, 0.35)),
    city: g(scale(warm(0.18), 0.6)),
    plane: g(p.star),
    firefly: g(mix(warm(0.12), p.deskTop, 0.15)),
    dust: g(p.light ? mix(p.wall, p.dim, 0.28) : mix(p.wall, p.star, 0.3)),
    steam: g(p.light ? mix(p.wall, p.dim, 0.55) : mix(p.inkDim, p.star, 0.2)),
    steam2: g(p.light ? mix(p.wall, p.dim, 0.35) : p.inkDim),
    catBack: mix(p.inkDim, p.light ? p.wall : p.ink, 0.22), // the cat's own roles: green already in phosphor
  }
}

/** The ambient tones of a palette, worked out once per palette. */
export const ambientTones: (p: Palette) => AmbientTones = perPalette(makeTones)

// ── The window (docs/DESIGN.md 42.2). Everything in glass units: (0, 0) is the glass's top left.

/** What the window looks like at `t`: a night sky (the city lit, a plane), daylight, and the season. */
export type WindowLook = { season: Season; holiday: Holiday; night: boolean }

/**
 * The window's look as the offices paint the glass: night unless it shows the summer sun, and never
 * night in a light palette (its glass is pale; the skyline is a silhouette with no lights).
 */
export function windowLook(p: Palette, season: Season, holiday: Holiday, t: number): WindowLook {
  return { season, holiday, night: !p.light && !(season === 'summer' && isDay(t)) }
}

/**
 * By day (7:00 to 19:00 local, whatever the glass shows) the room has dust in the window's light;
 * the same in every season, so a season changes nothing outside the window (docs/DESIGN.md 28).
 */
export function dusty(t: number): boolean {
  return isDay(t)
}

/** The skyline across a glass of `glass` colour: a shade darker at night, a pale silhouette by day or in a light palette. */
export function skylineTone(p: Palette, glass: RGB, night: boolean): RGB {
  const c = night ? scale(glass, 0.6) : mix(glass, p.light ? p.wall : p.star, p.light ? 0.4 : 0.22)
  return p.id === 'phosphor' ? scale(c, 0.9) : c
}

const SKYLINES = new Map<string, { heights: Uint8Array; windows: { x: number; y: number; on: boolean }[] }>()

/**
 * The skyline of a glass `w` × `h` units: a height per column (buildings two to five units wide,
 * mostly low, the odd tower up to about 45 % of the glass) and the windows that can light, each
 * with its usual state. Memoised per size.
 */
export function skyline(w: number, h: number): { heights: Uint8Array; windows: { x: number; y: number; on: boolean }[] } {
  const key = `${w}x${h}`
  let s = SKYLINES.get(key)
  if (s) return s
  const heights = new Uint8Array(Math.max(0, w))
  const hi = h <= 4 ? 1 : Math.max(1, Math.round(h * 0.4)) // a small glass keeps a one-unit skyline
  const unit = Math.max(1, Math.floor(h / 8)) // wider blocks on a finer grid
  let x = 0
  for (let b = 0; x < w; b++) {
    const bw = (2 + Math.floor(hash(b * 7 + 401) * 4)) * unit
    const r = hash(b * 11 + 409)
    const bh = Math.min(hi, 1 + Math.floor(r * r * hi))
    for (let i = 0; i < bw && x < w; i++, x++) heights[x] = bh
  }
  const windows: { x: number; y: number; on: boolean }[] = []
  for (let cx = 0; cx < w; cx++) {
    for (let k = 0; k < heights[cx]!; k++) {
      const y = h - 1 - k
      if (hash(cx * 13 + k * 71 + 419) < 0.2) windows.push({ x: cx, y, on: hash(cx * 5 + k * 29 + 431) < 0.55 })
    }
  }
  s = { heights, windows }
  SKYLINES.set(key, s)
  return s
}

/** Lit windows switch one at a time: two changes in every CITY_SLOT_SECS, 20 to 40 seconds apart. */
export const CITY_SLOT_SECS = 60

/**
 * The windows lit across the street at `frame`: the usual ones, with one at a time switched off or
 * on. In each CITY_SLOT_SECS slot one window (picked by `hash`) flips in the first half (its moment
 * jittered by up to ten seconds) and back in the second, so a change comes every 20 to 40 seconds.
 */
export function cityLights(w: number, h: number, frame: number): Glow[] {
  const { windows } = skyline(w, h)
  const out: Glow[] = []
  if (!windows.length) return out
  const slot = CITY_SLOT_SECS / TICK_SECS
  const k = Math.floor(frame / slot)
  const at = frame - k * slot
  const from = hash(k * 3 + 443) * (10 / TICK_SECS)
  const to = slot / 2 + hash(k * 3 + 449) * (10 / TICK_SECS)
  const flipped = at >= from && at < to ? Math.floor(hash(k * 3 + 457) * windows.length) : -1
  windows.forEach((win, i) => {
    if (win.on !== (i === flipped)) out.push({ x: win.x, y: win.y, a: 1 })
  })
  return out
}

/** A plane crosses the top of the sky once in every PLANE_SECS. */
export const PLANE_SECS = 90

/**
 * The plane light at `frame`, or null between crossings: once every PLANE_SECS it crosses the top of
 * the glass one unit at a time (about 7 to 18 seconds a crossing, either way), a dim steady light
 * (`a` 0.4) that blinks bright for a quarter second every two seconds.
 */
export function planeLight(w: number, h: number, frame: number): Glow | null {
  if (w < 4 || h < 2) return null
  const cycle = PLANE_SECS / TICK_SECS
  const k = Math.floor(frame / cycle)
  const crossing = Math.max(6, Math.min(18, w * 0.6)) / TICK_SECS
  const start = hash(k * 5 + 461) * (cycle - crossing - 1)
  const at = frame - k * cycle - start
  if (at < 0 || at >= crossing) return null
  const steps = Math.floor((at / crossing) * w)
  const x = hash(k * 5 + 463) < 0.5 ? steps : w - 1 - steps
  const y = Math.floor(hash(k * 5 + 467) * Math.max(1, Math.floor(h * 0.3)))
  return { x, y, a: Math.floor(at) % 16 < 2 ? 1 : 0.4 }
}

/**
 * Rain running down the glass at `frame` (spring and autumn): one drop per seven units of width,
 * each sliding down a unit at a time (about a second a unit) with a short fading trail, pausing a
 * second or more at the top before the next run, in a new lane each run. The head is `a` 0.75.
 */
export function rainDrops(w: number, h: number, frame: number): Glow[] {
  return rainRuns(w, h, frame, 1)
}

/**
 * `rainDrops` on a finer glass: about `secsPerUnit` seconds a unit instead of one. office-hd's
 * glass is in sub-pixels, a quarter of a cell tall, so its drops take a quarter to a whole second
 * a sub-pixel and a run across its tall window stays well inside a minute (docs/DESIGN.md 42.1).
 */
export function rainRuns(w: number, h: number, frame: number, secsPerUnit: number): Glow[] {
  const out: Glow[] = []
  if (w < 2 || h < 2) return out
  const n = Math.max(1, Math.round(w / 7))
  const trail = h >= 5 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const run = (h * secsPerUnit * (0.8 + 0.6 * hash(i * 7 + 503))) / TICK_SECS
    const rest = (1 + 3 * hash(i * 7 + 509)) / TICK_SECS
    const cycle = run + rest
    const f = frame + hash(i * 7 + 521) * cycle
    const c = Math.floor(f / cycle)
    const at = f - c * cycle
    if (at >= run) continue
    const y = Math.floor((at / run) * h)
    const x = Math.floor(hash(i * 31 + c * 17 + 523) * w)
    out.push({ x, y, a: 0.75 })
    for (let k = 1; k <= trail && y - k >= 0; k++) out.push({ x, y: y - k, a: 0.4 / k })
  }
  return out
}

/**
 * Two or three fireflies low in the glass on a summer night at `frame`: each drifts on its own slow
 * loop through the lower third and glows up and fades over three to five seconds; dark ones are left
 * out. `a` is the glow (at most 0.7: they stay dim).
 */
export function fireflies(w: number, h: number, frame: number): Glow[] {
  const out: Glow[] = []
  if (w < 4 || h < 2) return out
  const n = w >= 10 ? 3 : 2
  const band = Math.max(1, Math.ceil(h * 0.4))
  const secs = frame * TICK_SECS
  for (let i = 0; i < n; i++) {
    const glow = breathe(frame, 3 + 0.9 * i, hash(i + 601))
    if (glow < 0.2) continue
    const x = Math.floor(((hash(i + 607) * w + Math.sin(secs / (9 + 2 * i) + i) * w * 0.25) % w + w) % w)
    const y = h - 1 - Math.floor((0.5 + 0.5 * Math.sin(secs / (6 + i) + i * 2)) * band * 0.999)
    out.push({ x, y, a: 0.7 * glow })
  }
  return out
}

/**
 * Motes of dust drifting in the window's light at `frame`, in a region `w` × `h` (its caller picks
 * where the light falls): about one per 40 units, sinking a unit every four seconds and swaying,
 * each brightening and fading on its own breath. `a` 0.35 to 1 (the tone itself is low contrast).
 */
export function dustMotes(w: number, h: number, frame: number): Glow[] {
  const out: Glow[] = []
  if (w < 2 || h < 2) return out
  const n = Math.max(2, Math.round((w * h) / 40))
  const secs = frame * TICK_SECS
  for (let i = 0; i < n; i++) {
    const y = Math.floor(hash(i + 701) * h + secs * 0.25) % h
    const x = Math.floor(((hash(i + 709) * w + Math.sin(secs * 0.3 + i * 1.7) * 1.5) % w + w) % w)
    out.push({ x, y, a: 0.35 + 0.65 * breathe(frame, 5 + i, hash(i + 719)) })
  }
  return out
}

/**
 * The far layer of the window, back to front, into `put` (glass units): the skyline across the
 * bottom of the glass, its lit windows and the plane light at night. Called after the sky and its
 * stars, before the season's weather (which falls in front).
 */
export function windowFar(p: Palette, look: WindowLook, glass: RGB, frame: number, w: number, h: number, put: Put): void {
  if (h < 3 || w < 4) return
  const T = ambientTones(p)
  const { heights } = skyline(w, h)
  const tone = skylineTone(p, glass, look.night)
  for (let x = 0; x < w; x++) for (let k = 0; k < heights[x]!; k++) put(x, h - 1 - k, tone, 1)
  if (!look.night) return
  for (const g of cityLights(w, h, frame)) put(g.x, g.y, T.city, g.a)
  if (look.holiday === 'newyear') return // the firework has the sky
  const plane = planeLight(w, h, frame)
  if (plane) put(plane.x, plane.y, T.plane, plane.a)
}

/**
 * The near layer of the window, into `put` (glass units): rain on the glass in spring and autumn,
 * fireflies on a summer night. Called after the season's weather, before the window's frame. The
 * rain runs at `secsPerUnit` seconds a unit (`rainRuns`; one, `rainDrops`, unless a finer glass asks).
 */
export function windowNear(p: Palette, look: WindowLook, frame: number, w: number, h: number, put: Put, secsPerUnit = 1): void {
  const T = ambientTones(p)
  if (look.season === 'spring' || look.season === 'autumn') for (const g of rainRuns(w, h, frame, secsPerUnit)) put(g.x, g.y, T.drop, g.a)
  else if (look.season === 'summer' && look.night) for (const g of fireflies(w, h, frame)) put(g.x, g.y, T.firefly, g.a)
}

// ── On the desk and the wall.

/** Steam off the newest mug: puffs rise and curl over STEAM_SECS each, the whole plume swelling and thinning over a longer loop. */
export const STEAM_SECS = 4

/**
 * The steam's puffs at `frame` for a plume `h` units tall above a mug (y 0 the unit just above it,
 * counting up as negative y; x 0 the mug's left edge): three puffs, each rising a unit at a time
 * over STEAM_SECS while it bends with a sine (the curl) and fades; the plume as a whole thins and
 * swells over seven seconds. `seed` keeps two mugs out of step.
 */
export function steamPuffs(frame: number, h: number, seed = 0): Glow[] {
  const out: Glow[] = []
  if (h < 1) return out
  const swell = 0.45 + 0.55 * breathe(frame, 7, hash(seed + 801))
  const life = STEAM_SECS / TICK_SECS
  for (let i = 0; i < 3; i++) {
    const prog = ((frame / life + i / 3 + hash(seed + 811)) % 1 + 1) % 1
    const y = -Math.floor(prog * h)
    const x = Math.round(0.5 + Math.sin(prog * Math.PI * 1.6 + seed) * 0.9)
    const a = (1 - prog) * swell
    if (a >= 0.15) out.push({ x, y, a })
  }
  return out
}

const STRANDS = new Map<string, { wire: Int8Array; bulbs: { x: number; y: number; tone: number }[] }>()

/**
 * A strand of string lights `w` units long with `sag` units to dip: the wire's y per x (hooked at 0
 * every `span` units, dipping between) and the bulbs hanging a unit under it, one every `every`
 * units, their tones in turn. Memoised per shape.
 */
export function strand(w: number, sag: number, span = 10, every = 5): { wire: Int8Array; bulbs: { x: number; y: number; tone: number }[] } {
  const key = `${w}:${sag}:${span}:${every}`
  let s = STRANDS.get(key)
  if (s) return s
  const wire = new Int8Array(Math.max(0, w))
  for (let x = 0; x < w; x++) {
    const u = (x % span) / span
    wire[x] = Math.round(Math.sin(u * Math.PI) * sag)
  }
  const bulbs: { x: number; y: number; tone: number }[] = []
  for (let x = Math.floor(every / 2) + 1, i = 0; x < w - 1; x += every, i++) {
    if (x % span === 0) continue // never on a hook
    bulbs.push({ x, y: wire[x]! + 1, tone: i % 3 })
  }
  s = { wire, bulbs }
  STRANDS.set(key, s)
  return s
}

/** A bulb's brightness at `frame`: 0.85 to 1 (a 15 % breath) over five to seven seconds, out of step with its neighbours. */
export function bulbLevel(frame: number, i: number): number {
  return 0.85 + 0.15 * breathe(frame, 5 + 2 * hash(i + 901), hash(i + 907))
}

/** The lamplight's strength over its eight-second breath at `frame`: 0.85 to 1 of its full pool. */
export function lampLevel(frame: number): number {
  return 0.85 + 0.15 * breathe(frame, 8)
}
