// Seasons and holidays for the two offices' window (docs/DESIGN.md 28). Pure functions of `t`
// (epoch seconds) read in the local time zone: `seasonOf` picks what the window shows, `holidayOf`
// the small extra on the day; `weather` lists the moving specks for a window of a given size, so
// both offices draw the same weather at their own pixel scale; `seasonTones` gives the colours,
// derived from the palette's roles (docs/DESIGN.md 27), memoised per palette.
import { hash, mix, scale } from './canvas.ts'
import type { RGB } from './canvas.ts'
import type { Palette, PaletteId } from './palette.ts'

export type Season = 'winter' | 'spring' | 'summer' | 'autumn' | 'none'
export type Holiday = 'halloween' | 'lights' | 'newyear' | null

const FIXED = new Set<string>(['winter', 'spring', 'summer', 'autumn', 'none'])

/** The `season` setting's values (and `/lookout season <…>`'s): `auto` follows the date. */
export type SeasonSetting = 'auto' | Season
export const SEASON_SETTINGS: readonly SeasonSetting[] = ['auto', 'winter', 'spring', 'summer', 'autumn', 'none']

export function isSeasonSetting(v: unknown): v is SeasonSetting {
  return v === 'auto' || (typeof v === 'string' && FIXED.has(v))
}

/** The season the window shows: a fixed one or `none` from the setting, else (`auto`, absent) from the local month. */
export function seasonOf(t: number, setting?: string): Season {
  if (setting && FIXED.has(setting)) return setting as Season
  const m = new Date(t * 1000).getMonth() // 0 = January
  return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn'
}

/** The firework lasts this long after midnight on 1 January (seconds of `t`). */
export const FIREWORK_SECS = 10

/** 31 October: a pumpkin; 20 December to 1 January: a string of lights; the first seconds of 1 January: a firework. */
export function holidayOf(t: number): Holiday {
  const d = new Date(t * 1000)
  const m = d.getMonth()
  const day = d.getDate()
  if (m === 0 && day === 1 && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() < FIREWORK_SECS) return 'newyear'
  if (m === 9 && day === 31) return 'halloween'
  if ((m === 11 && day >= 20) || (m === 0 && day === 1)) return 'lights'
  return null
}

/** By day (7:00 to 19:00 local) the summer window shows the sun. */
export function isDay(t: number): boolean {
  const h = new Date(t * 1000).getHours()
  return h >= 7 && h < 19
}

/** One speck in the window, in the window's own units (0..w-1, 0..h-1); `tone` indexes the season's colours. */
export type Speck = { x: number; y: number; tone: number }

/**
 * The moving specks of a season (and of the new-year firework) for a window `w` × `h` units, at
 * `frame`; deterministic per frame (positions from `hash`). Winter: falling snow; spring: two
 * drifting clouds, two units wide; autumn: two leaves falling and swaying; the firework: a ring of
 * sparks that grows over the first seconds of the year. Summer and `none` have none.
 */
export function weather(season: Season, holiday: Holiday, t: number, frame: number, w: number, h: number): Speck[] {
  const out: Speck[] = []
  if (w < 3 || h < 1) return out
  if (holiday === 'newyear') {
    // One burst: a ring of eight sparks around a point in the upper middle, its radius growing.
    const secs = new Date(t * 1000).getSeconds()
    const most = Math.max(1, Math.min(Math.floor((h - 1) / 2), Math.floor(w / 4)))
    const r = 1 + Math.min(most - 1, Math.floor(((secs + (frame % 8) / 8) / FIREWORK_SECS) * most))
    const cx = Math.floor(w / 2)
    const cy = Math.floor(h / 2)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      out.push({ x: Math.round(cx + Math.cos(a) * r * 1.2), y: Math.round(cy + Math.sin(a) * r), tone: i % 4 })
    }
    out.push({ x: cx, y: cy, tone: (frame >> 1) % 4 })
    return out.filter(s => s.x >= 0 && s.x < w && s.y >= 0 && s.y < h)
  }
  if (season === 'winter') {
    const n = Math.max(3, Math.round((w * h) / 10))
    for (let i = 0; i < n; i++) {
      const y = Math.floor(hash(i + 70) * h + frame * (0.25 + hash(i + 90) * 0.2)) % h
      out.push({ x: Math.floor(hash(i + 80) * w + Math.sin(frame * 0.2 + i) * 0.6 + w) % w, y, tone: 0 })
    }
  } else if (season === 'spring') {
    for (let i = 0; i < 2; i++) {
      const x = Math.floor(hash(i + 30) * w + frame * (0.06 + 0.03 * i)) % w
      const y = Math.floor(hash(i + 40) * Math.max(1, h - 1))
      out.push({ x, y, tone: 1 }, { x: (x + 1) % w, y, tone: 1 })
    }
  } else if (season === 'autumn') {
    for (let i = 0; i < 2; i++) {
      const y = Math.floor(hash(i + 60) * h + frame * 0.2) % h
      const x = Math.floor(hash(i + 50) * w + Math.sin(frame * 0.3 + i * 2) * 1.2 + w) % w
      out.push({ x, y, tone: 2 + i })
    }
  }
  return out
}

/** The window's colours in one palette. */
export type SeasonTones = {
  /** The glass by season, and the summer glass by day. */
  sky: Record<Season, RGB>
  daySky: RGB
  /** Snow, a cloud, two leaves (by `Speck.tone`); the sparks of the firework. */
  speck: RGB[]
  sparks: RGB[]
  sun: RGB
  sill: RGB
  /** The three lights, and the wire between them. */
  lights: RGB[]
  wire: RGB
  /** The pumpkin: body, the darker rib, the stem. */
  pumpkin: [RGB, RGB, RGB]
}

const TONES = new Map<PaletteId, SeasonTones>()

export function seasonTones(p: Palette): SeasonTones {
  let s = TONES.get(p.id)
  if (s) return s
  const snow = p.star
  s = {
    sky: { none: p.sky, winter: p.sky, autumn: p.sky, spring: mix(p.sky, p.dusk[3]!, 0.3), summer: mix(p.sky, p.think, 0.12) },
    daySky: mix(p.sky, mix(p.warn, p.dusk[4]!, 0.5), 0.7),
    speck: [snow, mix(p.star, p.sky, 0.3), mix(p.warn, p.model, 0.35), mix(p.warn, p.model, 0.75)],
    sparks: [p.warn, p.bad, p.good, p.think],
    sun: mix(p.warn, p.star, 0.3),
    sill: mix(snow, p.frame, 0.15),
    lights: [p.bad, p.good, p.warn],
    wire: scale(p.frame, 0.8),
    pumpkin: [mix(p.model, p.warn, 0.2), scale(mix(p.model, p.warn, 0.2), 0.72), scale(p.good, 0.7)],
  }
  TONES.set(p.id, s)
  return s
}

/** The light of the string that is lit at `frame` (they take turns, one every 4 frames). */
export function litLight(frame: number): number {
  return Math.floor(frame / 4) % 3
}
