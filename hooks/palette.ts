// Palettes (docs/DESIGN.md 27): every colour a scene or module paints is a ROLE looked up in the
// active palette, never a literal. `night` is the look lookout was drawn with (dark terminals);
// `paper` is for light terminals (light walls, dark ink; screens and monitors stay dark, as real
// ones do in daylight); `phosphor` is a one-colour green CRT. Scenes derive any extra tone they
// need from a role with `mix` / `scale` (hooks/canvas.ts) rather than adding keys here; a new
// key is added to all three palettes at once.
import type { ToolClass } from '../types'
import { luminance, mix, scale } from './canvas.ts'
import type { RGB } from './canvas.ts'

export type PaletteId = 'night' | 'paper' | 'phosphor'
export const PALETTE_IDS: readonly PaletteId[] = ['night', 'paper', 'phosphor']

export function isPaletteId(v: unknown): v is PaletteId {
  return v === 'night' || v === 'paper' || v === 'phosphor'
}

export type Palette = {
  id: PaletteId
  /** True when the terminal behind the pane is assumed light (labels drawn by the pane's Text rows follow the theme anyway). */
  light: boolean
  // ── Text
  ink: RGB
  inkDim: RGB
  dim: RGB
  // ── Rooms
  wall: RGB
  floor: RGB
  ground: RGB
  frame: RGB
  sky: RGB
  star: RGB
  desk: RGB
  deskTop: RGB
  cable: RGB
  tray: RGB
  rack: RGB
  rackFace: RGB
  // ── Screens and instruments (dark in every palette)
  mon: RGB
  bevel: RGB
  screen: RGB
  screenOff: RGB
  grid: RGB
  phosphor: RGB
  phosphorDim: RGB
  phosphorGlow: RGB
  lampOff: RGB
  // ── Meaning
  good: RGB
  bad: RGB
  warn: RGB
  think: RGB
  tools: RGB
  model: RGB
  classes: Record<ToolClass, RGB>
  // ── Colour ramps for the scenes
  lagoon: RGB[]
  dusk: RGB[]
  heat: RGB[]
}

const NIGHT: Palette = {
  id: 'night',
  light: false,
  ink: 0xf4efe6,
  inkDim: 0x8a8399,
  dim: 0x6b6577,
  wall: 0x1a1728,
  floor: 0x1a1720,
  ground: 0x4a4060,
  frame: 0x4a4060,
  sky: 0x0d1030,
  star: 0xfff3c4,
  desk: 0x6b4a32,
  deskTop: 0x8a6a4a,
  cable: 0x3d3650,
  tray: 0x463f58,
  rack: 0x4a4458,
  rackFace: 0x2e2b3a,
  mon: 0x55506a,
  bevel: 0x8f89a6,
  screen: 0x0a0e0a,
  screenOff: 0x060806,
  grid: 0x16261a,
  phosphor: 0x62e07e,
  phosphorDim: 0x2c6b3b,
  phosphorGlow: 0x9ff2b0,
  lampOff: 0x2a2a30,
  good: 0x7ed492,
  bad: 0xf0605d,
  warn: 0xf2c25b,
  think: 0xb48ef0,
  tools: 0x5cc8c0,
  model: 0xf08a5d,
  classes: { shell: 0x5cc8c0, read: 0x9fb4ff, edit: 0xf2a65a, search: 0xc9a0ff, web: 0x6fd3ff, agent: 0xf08a5d, other: 0x6b6577 },
  lagoon: [0x0b2a33, 0x0f5a62, 0x1f9a8a, 0x6fd3a8, 0xd8f5c8],
  dusk: [0x1a1b3a, 0x2f3d7a, 0x5a5fc4, 0x9b7be0, 0xe0a6f0],
  heat: [0x2a9d8f, 0x8ab17d, 0xe9c46a, 0xf4a261, 0xe76f51, 0xc1121f],
}

const PAPER: Palette = {
  id: 'paper',
  light: true,
  ink: 0x1c1a24,
  inkDim: 0x5e586e,
  dim: 0x8a8399,
  wall: 0xe9e3d8,
  floor: 0xd6cfc2,
  ground: 0xb4ad9f,
  frame: 0x8a8399,
  sky: 0xa9cbe8,
  star: 0xffffff,
  desk: 0x8a6a4a,
  deskTop: 0xa8866a,
  cable: 0x9a94a8,
  tray: 0xb0aac2,
  rack: 0x6c667e,
  rackFace: 0x3a3646,
  mon: 0x4a4560,
  bevel: 0x8f89a6,
  screen: 0x0a0e0a,
  screenOff: 0x121412,
  grid: 0x16261a,
  phosphor: 0x4fd070,
  phosphorDim: 0x2c6b3b,
  phosphorGlow: 0x9ff2b0,
  lampOff: 0xc4beb4,
  good: 0x2f8f4e,
  bad: 0xc9403a,
  warn: 0xb8860b,
  think: 0x6f4fc0,
  tools: 0x1f8a84,
  model: 0xc85a2a,
  classes: { shell: 0x1f8a84, read: 0x3f5fc8, edit: 0xc07a1a, search: 0x8a4fd0, web: 0x2a8fc0, agent: 0xc85a2a, other: 0x8a8399 },
  lagoon: [0xd8f0ec, 0x9fd8d0, 0x4fb4a4, 0x2a8a7a, 0x1a5a52],
  dusk: [0xe8e4f4, 0xc4c0ee, 0x8f8ad8, 0x6a5fb8, 0x4a3f98],
  heat: [0x2a9d8f, 0x8ab17d, 0xd4a81a, 0xe08a3a, 0xd05a3a, 0xa81a1a],
}

const G = (f: number): RGB => scale(0x62e07e, f)
const PHOSPHOR: Palette = {
  id: 'phosphor',
  light: false,
  ink: 0xb8f0c4,
  inkDim: 0x4f9a60,
  dim: 0x2f6a3c,
  wall: 0x071009,
  floor: 0x0a160c,
  ground: 0x1c3a22,
  frame: 0x1c3a22,
  sky: 0x040c06,
  star: 0xd8ffe0,
  desk: 0x1e4426,
  deskTop: 0x2c5c36,
  cable: 0x163020,
  tray: 0x1c3a26,
  rack: 0x1e4426,
  rackFace: 0x0e2412,
  mon: 0x24482c,
  bevel: 0x3f7a4a,
  screen: 0x030603,
  screenOff: 0x020402,
  grid: 0x0e2412,
  phosphor: 0x62e07e,
  phosphorDim: 0x2c6b3b,
  phosphorGlow: 0xb8ffc8,
  lampOff: 0x0e2412,
  good: 0x8df0a4,
  bad: 0xf0605d,
  warn: 0xc8ffa0,
  think: 0xa4ffb8,
  tools: 0x48c060,
  model: 0x2f9a48,
  // Neighbours in the stacked class bar (shell, read, edit, search, web, agent) alternate bright
  // and dim, so its segments part on one hue.
  classes: { shell: G(1), read: G(0.62), edit: G(1.25), search: G(0.8), web: G(1.1), agent: G(0.5), other: 0x2f6a3c },
  lagoon: [0x031006, 0x0c3416, 0x1a6a2a, 0x38b050, 0xb8ffc8],
  dusk: [0x0a2410, 0x16461e, 0x2a7a3a, 0x48b060, 0x9ff2b0],
  heat: [0x12461c, 0x1f7a30, 0x38b050, 0x62e07e, 0x8df0a4, 0xd8ffe0],
}

export const PALETTES: Record<PaletteId, Palette> = { night: NIGHT, paper: PAPER, phosphor: PHOSPHOR }

/** The palette from a context's optional `palette` field, `night` when absent (older callers, tests). */
export function paletteOf(ctx: { palette?: Palette } | null | undefined): Palette {
  return ctx?.palette ?? NIGHT
}

/** A tone between two roles, for scenes that derive their own shades. */
export { mix, scale }

/** The palette keys that hold one colour (every role but `classes` and the ramps). */
export type Role = { [K in keyof Palette]: Palette[K] extends number ? K : never }[keyof Palette]

const PHOSPHOR_HUE = 0x62e07e
const PHOSPHOR_HUE_L = luminance(PHOSPHOR_HUE)

/** A colour put on the phosphor's green at its own luminance (the `phosphor` palette's one hue). */
export function onGreen(c: RGB): RGB {
  const l = luminance(c)
  return l <= PHOSPHOR_HUE_L ? scale(PHOSPHOR_HUE, l / PHOSPHOR_HUE_L) : mix(PHOSPHOR_HUE, 0xb8ffc8, (l - PHOSPHOR_HUE_L) / (1 - PHOSPHOR_HUE_L))
}

/**
 * The tone that stands to `p[role]` as `night` (a colour a scene drew beside that role in the
 * `night` look) stands to the night palette's `role`: the role plus the same offset per channel.
 * In `night` it is `night` exactly, so converting a scene to roles leaves its night look
 * untouched; in `paper` a shadow of the wall stays a shadow of the (light) wall; in `phosphor`
 * the result is put on the green at its luminance, so nothing but `bad` leaves the one hue.
 */
export function shade(p: Palette, role: Role, night: RGB): RGB {
  return shadeBy(p, p[role], NIGHT[role], night)
}

/**
 * `shade` for a colour that is not a plain role (a class colour, a ramp stop): the tone that
 * stands to `to` (the colour in `p`) as `night` stands to `from` (the same colour in `night`).
 */
export function shadeBy(p: Palette, to: RGB, from: RGB, night: RGB): RGB {
  if (p.id === 'night') return night
  const ch = (sh: number) => Math.max(0, Math.min(255, ((to >> sh) & 255) + ((night >> sh) & 255) - ((from >> sh) & 255)))
  const out = (ch(16) << 16) | (ch(8) << 8) | ch(0)
  return p.id === 'phosphor' ? onGreen(out) : out
}

/**
 * A colour dimmed to `f` (0..1) of its strength: darker in the dark palettes (`scale`, as the
 * scenes always dimmed), toward the wall in a light one, where dark would read as louder.
 */
export function fade(p: Palette, c: RGB, f: number): RGB {
  return p.light ? mix(p.wall, c, Math.max(0, Math.min(1, f))) : scale(c, f)
}

/**
 * A scene's derived tones, worked out once per palette: `const tones = perPalette(p => ({ … }))`
 * at module level, then `const T = tones(paletteOf(ctx))` at the top of `draw`.
 */
export function perPalette<T>(make: (p: Palette) => T): (p: Palette) => T {
  const cache = new Map<PaletteId, T>()
  return (p: Palette): T => {
    let t = cache.get(p.id)
    if (t === undefined) {
      t = make(p)
      cache.set(p.id, t)
    }
    return t
  }
}

/** Anything `label` can be laid on: a Canvas or a HiCanvas. */
type Labelled = { label(col: number, row: number, s: string, light?: RGB, dark?: RGB, noneIsLight?: boolean): void }

/**
 * The light counterpart of a dark ink, for a label that lands on a dark object (a screen) in a
 * light palette: the ink three quarters of the way to the wall.
 */
export function inkOnDark(p: Palette, ink: RGB): RGB {
  return luminance(ink) >= 0.55 ? ink : mix(ink, p.wall, 0.75)
}

/**
 * `c.label` for the palette. In the dark palettes it is `c.label(col, row, s, ink, dark)` as the
 * scenes always called it. In a light one the terminal behind the pane is light: `ink` (a dark
 * ink there) is laid on the terminal and on light pixels, and its light counterpart on dark ones.
 */
export function labelIn(p: Palette, c: Labelled, col: number, row: number, s: string, ink: RGB, dark?: RGB): void {
  if (!p.light) {
    c.label(col, row, s, ink, dark)
    return
  }
  c.label(col, row, s, inkOnDark(p, ink), ink, true)
}
