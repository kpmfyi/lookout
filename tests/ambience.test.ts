// Ambience, the lofi layer (docs/DESIGN.md 42): the shared pieces in hooks/ambience.ts, the cat's
// breath and blink, and the rules of 42.1 checked on the office, the default scene: ambience only
// touches art cells, never in a meaning colour, keeps a finished office moving, and off draws
// exactly what the office drew before ambience (hashes captured from the office before the change).
import { expect, test } from 'claude-code/testing'

import { activity } from '../hooks/activity.ts'
import {
  CITY_SLOT_SECS, PLANE_SECS, TICK_SECS, ambient, ambientTones, breathe, bulbLevel, cityLights, dustMotes, dusty, fireflies, lampLevel,
  planeLight, rainDrops, skyline, skylineTone, steamPuffs, strand, windowFar, windowLook, windowNear,
} from '../hooks/ambience.ts'
import { NONE, luminance } from '../hooks/canvas.ts'
import { BLINK_EVERY, BREATH_STEPS, catAmbient, catFrames, catSprite } from '../hooks/cat.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { Palette } from '../hooks/palette.ts'
import { office } from '../hooks/scenes/office.ts'
import type { SceneCtx, SceneSize } from '../hooks/scenes/index.ts'
import type { Sprite } from '../hooks/sprite.ts'
import type { Summary } from '../types'
import { FINISHED, RUNNING, T, THINKING, YOU_THINKING } from './fixtures.ts'

/** 32-bit FNV-1a over the UTF-16 code units of `s`, as 8 hex digits (as tests/golden.test.ts). */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

/** The half-block canvas's own art characters: anything else in a cell is text (a letter, a digit, a glyph). */
const ART = new Set([0x20, 0x2580, 0x2584, 0x2588])

/** A cell's top and bottom pixel colours, read back from its character, fg and bg (art cells only). */
function halves(cp: number, fg: number, bg: number): [number, number] {
  return cp === 0x2580 ? [fg, bg] : cp === 0x2584 ? [bg, fg] : cp === 0x2588 ? [fg, fg] : [bg, bg]
}

const meaning = (p: Palette) => new Set([p.bad, p.good, p.warn, p.think])

// ── The shared pieces

test('ambience: on unless the setting turned it off', () => {
  expect(ambient({})).toBe(true)
  expect(ambient({ ambience: true })).toBe(true)
  expect(ambient({ ambience: false })).toBe(false)
  expect(ambient(undefined)).toBe(true)
})

test('breathe: a smooth 0..1 loop of its period at the 120 ms tick, out of step by its phase', () => {
  const per = 8 / TICK_SECS
  expect(Math.abs(breathe(0, 8) - 0) < 1e-6).toBe(true)
  expect(Math.abs(breathe(per / 2, 8) - 1) < 1e-6).toBe(true)
  expect(Math.abs(breathe(per, 8) - 0) < 1e-6).toBe(true)
  expect(Math.abs(breathe(per / 4, 8, 0.25) - 1) < 1e-6).toBe(true)
  for (let f = 0; f < 200; f++) {
    const b = breathe(f, 4, 0.3)
    expect(b >= 0 && b <= 1).toBe(true)
    expect(Math.abs(breathe(f + 1, 4, 0.3) - b) < 0.1).toBe(true) // smooth: no jump between frames
  }
  for (let f = 0; f < 400; f++) {
    for (const v of [bulbLevel(f, f % 7), lampLevel(f)]) expect(v >= 0.85 && v <= 1).toBe(true) // a 15 % breath at most
  }
})

test('ambientTones: once per palette, never a meaning colour; dim greens in phosphor', () => {
  for (const p of Object.values(PALETTES)) {
    const A = ambientTones(p)
    expect(ambientTones(p)).toBe(A)
    const all = [A.lamp, ...A.bulbs, A.wire, A.drop, A.city, A.plane, A.firefly, A.dust, A.steam, A.steam2, A.catBack]
    for (const c of all) if (meaning(p).has(c)) throw new Error(`${p.id}: ambient tone ${c.toString(16)} is a meaning colour`)
    if (p.id === 'phosphor') {
      for (const c of all.filter(c => c !== A.catBack)) {
        const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
        expect(g >= r && g >= b).toBe(true)
        expect(luminance(c) < luminance(p.good)).toBe(true)
      }
    }
  }
})

test('skyline: low buildings across the glass, windows inside them, memoised per size', () => {
  for (const [w, h] of [[12, 3], [22, 8], [40, 16], [60, 24]] as [number, number][]) {
    const s = skyline(w, h)
    expect(skyline(w, h)).toBe(s)
    expect(s.heights.length).toBe(w)
    for (const v of s.heights) expect(v >= 1 && v <= Math.max(1, Math.round(h * 0.45))).toBe(true)
    for (const win of s.windows) expect(win.y >= h - s.heights[win.x]! && win.y < h).toBe(true)
  }
  expect(Math.max(...skyline(12, 3).heights)).toBe(1) // a small glass keeps a one-row skyline
})

test('cityLights: one window at a time switches, 20 to 40 seconds apart', () => {
  const [w, h] = [40, 16]
  expect(skyline(w, h).windows.length > 3).toBe(true)
  const key = (f: number) => cityLights(w, h, f).map(g => `${g.x},${g.y}`).sort().join(' ')
  const changes: number[] = []
  let prev = key(0)
  const span = Math.round((CITY_SLOT_SECS * 6) / TICK_SECS)
  for (let f = 1; f < span; f++) {
    const now = key(f)
    if (now === prev) continue
    const a = new Set(prev.split(' '))
    const b = new Set(now.split(' '))
    const diff = [...a].filter(x => !b.has(x)).length + [...b].filter(x => !a.has(x)).length
    expect(diff).toBe(1)
    changes.push(f)
    prev = now
  }
  expect(changes.length >= 10).toBe(true)
  for (let i = 1; i < changes.length; i++) {
    const secs = (changes[i]! - changes[i - 1]!) * TICK_SECS
    if (secs < 19.9 || secs > 40.1) throw new Error(`a change ${secs.toFixed(1)} s after the last`)
  }
})

test('planeLight: crosses the top of the sky once in every 90 seconds, a unit at a time, blinking every two seconds', () => {
  const [w, h] = [24, 8]
  const cycle = PLANE_SECS / TICK_SECS
  for (let k = 0; k < 4; k++) {
    let seen = 0
    let bright = 0
    let last: { x: number } | null = null
    for (let f = k * cycle; f < (k + 1) * cycle; f++) {
      const pl = planeLight(w, h, f)
      if (!pl) {
        last = null
        continue
      }
      seen++
      if (pl.a === 1) bright++
      expect(pl.x >= 0 && pl.x < w && pl.y >= 0 && pl.y < Math.max(1, Math.floor(h * 0.3))).toBe(true)
      if (last) expect(Math.abs(pl.x - last.x) <= 1).toBe(true)
      last = pl
    }
    expect(seen * TICK_SECS >= 6 && seen * TICK_SECS <= 18.2).toBe(true)
    expect(bright > 0 && bright <= Math.ceil(seen / 8) + 2).toBe(true) // two frames in sixteen: never faster than twice a second
  }
})

test('rainDrops, fireflies and dust: in their region, slow, and moving', () => {
  for (const [w, h] of [[12, 3], [22, 8], [40, 16]] as [number, number][]) {
    let moved = 0
    for (let f = 0; f < 300; f++) {
      const sets = [rainDrops(w, h, f), fireflies(w, h, f), dustMotes(w, h, f)]
      for (const g of sets.flat()) if (!(g.x >= 0 && g.x < w && g.y >= 0 && g.y < h && g.a > 0 && g.a <= 1)) throw new Error(`${w}×${h} f${f}: ${JSON.stringify(g)}`)
      for (const g of fireflies(w, h, f)) expect(g.y >= h - Math.ceil(h * 0.4) && g.a <= 0.7).toBe(true) // low and dim
      if (JSON.stringify(sets) !== JSON.stringify([rainDrops(w, h, f + 1), fireflies(w, h, f + 1), dustMotes(w, h, f + 1)])) moved++
    }
    expect(moved > 100).toBe(true)
    expect(rainDrops(w, h, 7)).toEqual(rainDrops(w, h, 7))
  }
})

test('steamPuffs: three puffs at most curling up over the mug, fading as they rise', () => {
  for (const h of [3, 4, 8]) {
    for (let f = 0; f < 200; f++) {
      const puffs = steamPuffs(f, h, 1)
      expect(puffs.length <= 3).toBe(true)
      for (const q of puffs) expect(q.y <= 0 && q.y > -h && q.x >= -1 && q.x <= 2 && q.a > 0 && q.a <= 1).toBe(true)
    }
  }
})

test('strand: the wire dips between its hooks, bulbs hang a unit under it, none on a hook', () => {
  for (const [w, sag] of [[20, 0], [40, 1], [70, 2]] as [number, number][]) {
    const s = strand(w, sag, 12, 4)
    expect(strand(w, sag, 12, 4)).toBe(s)
    for (let x = 0; x < w; x++) expect(s.wire[x]! >= 0 && s.wire[x]! <= sag).toBe(true)
    for (const b of s.bulbs) {
      expect(b.y).toBe(s.wire[b.x]! + 1)
      expect(b.x % 12 === 0).toBe(false)
      expect(b.tone >= 0 && b.tone < 3).toBe(true)
    }
  }
})

test('the window: the city lit only at night, the plane and rain into its own glass', () => {
  const p = PALETTES.night
  const day = new Date(2026, 6, 15, 12).getTime() / 1000
  const night = new Date(2026, 6, 15, 23).getTime() / 1000
  expect(windowLook(p, 'summer', null, day).night).toBe(false)
  expect(windowLook(p, 'summer', null, night).night).toBe(true)
  expect(windowLook(p, 'winter', null, day).night).toBe(true) // the winter glass is a night sky all day
  expect(windowLook(PALETTES.paper, 'winter', null, night).night).toBe(false)
  expect(dusty(day) && !dusty(night)).toBe(true)
  expect(skylineTone(p, p.sky, true) !== p.sky).toBe(true)
  const [w, h] = [22, 8]
  for (const look of [windowLook(p, 'autumn', null, night), windowLook(p, 'summer', null, night), windowLook(p, 'summer', null, day)]) {
    for (let f = 0; f < 120; f += 7) {
      const tones = new Set<number>()
      const put = (x: number, y: number, tone: number, a: number) => {
        if (!(x >= 0 && x < w && y >= 0 && y < h && a > 0 && a <= 1)) throw new Error(`outside the glass: ${x},${y}`)
        tones.add(tone)
      }
      windowFar(p, look, p.sky, f, w, h, put)
      windowNear(p, look, f, w, h, put)
      expect(tones.has(ambientTones(p).city)).toBe(look.night && cityLights(w, h, f).length > 0)
      for (const c of tones) expect(meaning(p).has(c)).toBe(false)
    }
  }
})

// ── The cat

test('cat: asleep it breathes (its back alone changes tone) and now and then twitches an ear; sitting it blinks slowly', () => {
  const cells = (sp: Sprite) => Array.from({ length: sp.h * sp.w }, (_, i) => sp.at(i % sp.w, Math.floor(i / sp.w)))
  for (const p of Object.values(PALETTES)) {
    const f = catFrames(p)
    expect(f.breath.length).toBe(BREATH_STEPS)
    expect(cells(f.breath[0]!)).toEqual(cells(f.asleep)) // at rest: the plain loaf
    const top = cells(f.breath[BREATH_STEPS - 1]!)
    const base = cells(f.asleep)
    const changed = top.filter((c, i) => c !== base[i])
    expect(changed.length >= 2 && changed.length <= 4).toBe(true)
    for (const c of changed) expect(c).toBe(ambientTones(p).catBack)
    expect(cells(f.blink).includes(p.ink)).toBe(false) // eyes shut
    expect(cells(f.twitch).filter(c => c != null).length).toBe(cells(f.asleep).filter(c => c != null).length - 1)
    // Every picture stays in the cat's box and its own tones.
    for (let fr = 0; fr < 400; fr++) {
      const sp = catAmbient(p, 'asleep', false, fr)
      for (const c of cells(sp)) if (c != null && c !== p.inkDim && c !== p.ink && !f.breath.some(b => cells(b).includes(c))) throw new Error(`${p.id}: ${c.toString(16)}`)
    }
  }
  const p = PALETTES.night
  const f = catFrames(p)
  const asleep = Array.from({ length: 1200 }, (_, fr) => catAmbient(p, 'asleep', false, fr))
  expect(new Set(asleep).size >= BREATH_STEPS).toBe(true)
  expect(asleep.filter(sp => sp === f.twitch).length > 0).toBe(true)
  expect(asleep.filter(sp => sp === f.twitch).length < 40).toBe(true) // now and then
  const sitting = Array.from({ length: BLINK_EVERY * 4 }, (_, fr) => catAmbient(p, 'sitting', false, fr))
  expect(sitting.filter(sp => sp === f.blink).length).toBe(12) // three frames in every BLINK_EVERY
  expect(catAmbient(p, 'sitting', true, 0)).toBe(f.flick) // the flick (meaningful) wins over a blink
  expect(catSprite(p, 'asleep', false)).toBe(f.asleep) // the old pictures are unchanged
})

// ── The office: the rules of 42.1

const STALLED: Summary = { ...THINKING, mtime: T - 600, stalled: true }
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime() / 1000
/** The window's looks: each season by night, summer and autumn by day, and the `lights` holiday. */
const LOOKS: [string, string, number][] = [
  ['winter', 'winter night', at(2026, 1, 20, 22)],
  ['spring', 'spring night', at(2026, 4, 20, 22)],
  ['summer', 'summer day', at(2026, 7, 20, 12)],
  ['summer', 'summer night', at(2026, 7, 20, 23)],
  ['autumn', 'autumn day', at(2026, 10, 20, 12)],
  ['none', 'none night', at(2026, 9, 20, 22)],
  ['winter', 'the lights holiday', at(2026, 12, 24, 21)],
]
const STATES_ON: [string, Summary][] = [['tool', RUNNING], ['thinking', THINKING], ['done', FINISHED], ['stalled', STALLED]]

function draws(): { name: string; ctx: SceneCtx }[] {
  const out: { name: string; ctx: SceneCtx }[] = []
  let n = 0
  for (const p of Object.values(PALETTES)) {
    for (const size of ['compact', 'standard', 'large'] as SceneSize[]) {
      for (const columns of [60, 80, 100, 144]) {
        for (const [season, look, t] of LOOKS) {
          const [state, s] = STATES_ON[n % STATES_ON.length]!
          const frame = [12, 333, 4321, 77777][n % 4]!
          const you = n % 3 === 0 ? YOU_THINKING : undefined
          n++
          out.push({ name: `${p.id} ${size} ${columns} ${look} ${state} f${frame}`, ctx: { s, a: activity(s, T), frame, t, columns, rows: office.rows[size], you, transparent: n % 2 === 0, palette: p, season } })
        }
      }
    }
  }
  return out
}

test('office ambience: only art cells change, and never into a meaning colour (docs/DESIGN.md 42.1, rules 1 and 2)', () => {
  let touched = 0
  for (const { name, ctx } of draws()) {
    const off = decode(office.draw({ ...ctx, ambience: false }))
    const on = decode(office.draw({ ...ctx, ambience: true }))
    expect(office.draw(ctx)).toBe(office.draw({ ...ctx, ambience: true })) // undefined is on
    const bad = meaning(ctx.palette!)
    for (let i = 0; i < off.length; i += 3) {
      if (off[i] === on[i] && off[i + 1] === on[i + 1] && off[i + 2] === on[i + 2]) continue
      const cell = `${name}: cell (${(i / 3) % ctx.columns}, ${Math.floor(i / 3 / ctx.columns)})`
      if (!ART.has(off[i]!)) throw new Error(`${cell} is text (0x${off[i]!.toString(16)}) and ambience changed it`)
      if (!ART.has(on[i]!)) throw new Error(`${cell}: ambience laid text (0x${on[i]!.toString(16)}) on it`)
      const before = halves(off[i]!, off[i + 1]!, off[i + 2]!)
      const after = halves(on[i]!, on[i + 1]!, on[i + 2]!)
      for (const k of [0, 1]) {
        if (after[k] === before[k]) continue
        touched++
        if (bad.has(after[k]!)) throw new Error(`${cell}: ambience drew a meaning colour 0x${after[k]!.toString(16)}`)
      }
    }
  }
  expect(touched > 1000).toBe(true)
})

test('office ambience: a finished office keeps moving, frame to frame, at every size (docs/DESIGN.md 42.1)', () => {
  const a = activity(FINISHED, T)
  expect(a.state).toBe('done')
  for (const p of Object.values(PALETTES)) {
    for (const size of ['compact', 'standard', 'large'] as SceneSize[]) {
      for (const columns of [60, 80, 100, 144]) {
        for (const [season, look, t] of LOOKS) {
          for (const frame of [12, 333, 4321]) {
            const ctx: SceneCtx = { s: FINISHED, a, frame, t, columns, rows: office.rows[size], palette: p, season }
            if (office.draw(ctx) === office.draw({ ...ctx, frame: frame + 1 })) throw new Error(`${p.id} ${size} ${columns} ${look} f${frame}: frames f and f+1 are the same`)
          }
        }
      }
    }
  }
})

// ── Off draws the office as it was (docs/DESIGN.md 42.1, rule 6). The hashes below were captured
// from the office before ambience was added, for a spread of palettes, sizes, widths, seasons,
// states, times of day (the fixtures' morning, that night, a morning in the `lights` holiday),
// frames, with and without your desk, transparent and painted; and the office's golden frames
// (tests/golden.test.ts) as they were.

const OFF_STATES = [['tool', RUNNING], ['thinking', THINKING], ['done', FINISHED], ['stalled', STALLED]] as const
const OFF_HOURS = [0, 13, 94 * 24]

function offCases(): { name: string; ctx: SceneCtx }[] {
  const out: { name: string; ctx: SceneCtx }[] = []
  let n = 0
  for (const pal of ['night', 'paper', 'phosphor'] as const) {
    for (const size of ['compact', 'standard', 'large'] as const) {
      for (const columns of [60, 80, 100, 144]) {
        for (const season of ['winter', 'spring', 'summer', 'autumn', 'none']) {
          const [state, s] = OFF_STATES[n % OFF_STATES.length]!
          const hours = OFF_HOURS[n % OFF_HOURS.length]!
          const frame = 12 + (n % 5) * 7
          const you = n % 2 ? YOU_THINKING : undefined
          const transparent = n % 3 !== 0
          n++
          out.push({
            name: `${pal} ${size} ${columns} ${season} ${state} +${hours}h f${frame}${you ? ' you' : ''}${transparent ? '' : ' painted'}`,
            ctx: { s, a: activity(s, T), frame, t: T + hours * 3600, columns, rows: office.rows[size], you, transparent, palette: PALETTES[pal], season },
          })
        }
      }
    }
  }
  return out
}

const BEFORE: Record<string, string> = {
  'night compact 60 winter tool +0h f12 painted': '52ad3029',
  'night compact 60 spring thinking +13h f19 you': '1b1ac69b',
  'night compact 60 summer done +2256h f26': 'fb7d91b3',
  'night compact 60 autumn stalled +0h f33 you painted': '4eeaa66a',
  'night compact 60 none tool +13h f40': 'a23d1ffe',
  'night compact 80 winter thinking +2256h f12 you': '33dc1aa0',
  'night compact 80 spring done +0h f19 painted': 'e06d38dd',
  'night compact 80 summer stalled +13h f26 you': '8a853071',
  'night compact 80 autumn tool +2256h f33': '2c31a698',
  'night compact 80 none thinking +0h f40 you painted': '6c344dea',
  'night compact 100 winter done +13h f12': 'e643ed13',
  'night compact 100 spring stalled +2256h f19 you': '425fb418',
  'night compact 100 summer tool +0h f26 painted': 'afb88aba',
  'night compact 100 autumn thinking +13h f33 you': '1cafd94f',
  'night compact 100 none done +2256h f40': 'e643ed13',
  'night compact 144 winter stalled +0h f12 you painted': 'c42796be',
  'night compact 144 spring tool +13h f19': '88d99ff0',
  'night compact 144 summer thinking +2256h f26 you': '18d7e6da',
  'night compact 144 autumn done +0h f33 painted': '10eeef67',
  'night compact 144 none stalled +13h f40 you': '356712d6',
  'night standard 60 winter tool +2256h f12': '735ac986',
  'night standard 60 spring thinking +0h f19 you painted': '44d38822',
  'night standard 60 summer done +13h f26': '3be2acc4',
  'night standard 60 autumn stalled +2256h f33 you': '565c622a',
  'night standard 60 none tool +0h f40 painted': '29a23ce8',
  'night standard 80 winter thinking +13h f12 you': 'cc92f464',
  'night standard 80 spring done +2256h f19': '13e0a0f2',
  'night standard 80 summer stalled +0h f26 you painted': '59412da8',
  'night standard 80 autumn tool +13h f33': '0e077506',
  'night standard 80 none thinking +2256h f40 you': '1cb59851',
  'night standard 100 winter done +0h f12 painted': '581b85ac',
  'night standard 100 spring stalled +13h f19 you': 'b1319342',
  'night standard 100 summer tool +2256h f26': 'acc4ce41',
  'night standard 100 autumn thinking +0h f33 you painted': '8bc045c2',
  'night standard 100 none done +13h f40': 'b70630f7',
  'night standard 144 winter stalled +2256h f12 you': 'eb6cc3c7',
  'night standard 144 spring tool +0h f19 painted': '50a1f7d3',
  'night standard 144 summer thinking +13h f26 you': 'fa041304',
  'night standard 144 autumn done +2256h f33': '44083109',
  'night standard 144 none stalled +0h f40 you painted': '836677c2',
  'night large 60 winter tool +13h f12': '9051d922',
  'night large 60 spring thinking +2256h f19 you': '7ffeca61',
  'night large 60 summer done +0h f26 painted': '11044561',
  'night large 60 autumn stalled +13h f33 you': '660970e1',
  'night large 60 none tool +2256h f40': 'b8c8624a',
  'night large 80 winter thinking +0h f12 you painted': 'a832553e',
  'night large 80 spring done +13h f19': '6fb9de7d',
  'night large 80 summer stalled +2256h f26 you': 'f4deafa9',
  'night large 80 autumn tool +0h f33 painted': 'c8f9f721',
  'night large 80 none thinking +13h f40 you': '65ab90d9',
  'night large 100 winter done +2256h f12': 'a04db98f',
  'night large 100 spring stalled +0h f19 you painted': 'e637189f',
  'night large 100 summer tool +13h f26': '831fdc3d',
  'night large 100 autumn thinking +2256h f33 you': '8623da6b',
  'night large 100 none done +0h f40 painted': '12a273b3',
  'night large 144 winter stalled +13h f12 you': '47e136a4',
  'night large 144 spring tool +2256h f19': 'e7516596',
  'night large 144 summer thinking +0h f26 you painted': '96210b5a',
  'night large 144 autumn done +13h f33': '1becc8db',
  'night large 144 none stalled +2256h f40 you': 'efe9713b',
  'paper compact 60 winter tool +0h f12 painted': '5a60d53c',
  'paper compact 60 spring thinking +13h f19 you': 'ed7ed463',
  'paper compact 60 summer done +2256h f26': 'e883a136',
  'paper compact 60 autumn stalled +0h f33 you painted': '4c720039',
  'paper compact 60 none tool +13h f40': '5833d6b9',
  'paper compact 80 winter thinking +2256h f12 you': 'e1c53507',
  'paper compact 80 spring done +0h f19 painted': '31ed896c',
  'paper compact 80 summer stalled +13h f26 you': '454e9432',
  'paper compact 80 autumn tool +2256h f33': '4e460851',
  'paper compact 80 none thinking +0h f40 you painted': '2661458f',
  'paper compact 100 winter done +13h f12': '53751523',
  'paper compact 100 spring stalled +2256h f19 you': '93e34527',
  'paper compact 100 summer tool +0h f26 painted': '315fafe2',
  'paper compact 100 autumn thinking +13h f33 you': 'f2ac3d41',
  'paper compact 100 none done +2256h f40': '53751523',
  'paper compact 144 winter stalled +0h f12 you painted': 'ca6e1e90',
  'paper compact 144 spring tool +13h f19': '849f1423',
  'paper compact 144 summer thinking +2256h f26 you': 'ce4be51b',
  'paper compact 144 autumn done +0h f33 painted': 'b074aa0b',
  'paper compact 144 none stalled +13h f40 you': 'fe671442',
  'paper standard 60 winter tool +2256h f12': '36048f11',
  'paper standard 60 spring thinking +0h f19 you painted': '0cd77019',
  'paper standard 60 summer done +13h f26': 'a9ba2790',
  'paper standard 60 autumn stalled +2256h f33 you': '1835586b',
  'paper standard 60 none tool +0h f40 painted': '9e58e95e',
  'paper standard 80 winter thinking +13h f12 you': '3125cba4',
  'paper standard 80 spring done +2256h f19': '21a81a15',
  'paper standard 80 summer stalled +0h f26 you painted': 'e39066e6',
  'paper standard 80 autumn tool +13h f33': 'bafb2430',
  'paper standard 80 none thinking +2256h f40 you': '08ca1afe',
  'paper standard 100 winter done +0h f12 painted': 'c0cc1239',
  'paper standard 100 spring stalled +13h f19 you': '3383be2c',
  'paper standard 100 summer tool +2256h f26': '28f6b776',
  'paper standard 100 autumn thinking +0h f33 you painted': '00831c15',
  'paper standard 100 none done +13h f40': 'fe7059c4',
  'paper standard 144 winter stalled +2256h f12 you': 'b7183d1e',
  'paper standard 144 spring tool +0h f19 painted': '6856ce96',
  'paper standard 144 summer thinking +13h f26 you': 'c5513a64',
  'paper standard 144 autumn done +2256h f33': '4ad668aa',
  'paper standard 144 none stalled +0h f40 you painted': 'e5063474',
  'paper large 60 winter tool +13h f12': '5a9f433d',
  'paper large 60 spring thinking +2256h f19 you': 'f681b439',
  'paper large 60 summer done +0h f26 painted': 'ee609471',
  'paper large 60 autumn stalled +13h f33 you': '80494044',
  'paper large 60 none tool +2256h f40': '0fb7b57b',
  'paper large 80 winter thinking +0h f12 you painted': 'bbf4a348',
  'paper large 80 spring done +13h f19': '6ceb2066',
  'paper large 80 summer stalled +2256h f26 you': '28fd90d6',
  'paper large 80 autumn tool +0h f33 painted': '58d1d626',
  'paper large 80 none thinking +13h f40 you': 'a4c0de53',
  'paper large 100 winter done +2256h f12': '53559a23',
  'paper large 100 spring stalled +0h f19 you painted': '0f4d1f7a',
  'paper large 100 summer tool +13h f26': '467deef9',
  'paper large 100 autumn thinking +2256h f33 you': 'c7d37ffb',
  'paper large 100 none done +0h f40 painted': '49ce3f98',
  'paper large 144 winter stalled +13h f12 you': '9eb4c8f1',
  'paper large 144 spring tool +2256h f19': 'c2f0277f',
  'paper large 144 summer thinking +0h f26 you painted': '812dbbd8',
  'paper large 144 autumn done +13h f33': '88664c03',
  'paper large 144 none stalled +2256h f40 you': 'cddef8dc',
  'phosphor compact 60 winter tool +0h f12 painted': 'd281b166',
  'phosphor compact 60 spring thinking +13h f19 you': '12feecef',
  'phosphor compact 60 summer done +2256h f26': '0b1ca05e',
  'phosphor compact 60 autumn stalled +0h f33 you painted': '2073d3bc',
  'phosphor compact 60 none tool +13h f40': 'c7f8c07b',
  'phosphor compact 80 winter thinking +2256h f12 you': '08740742',
  'phosphor compact 80 spring done +0h f19 painted': '5a134986',
  'phosphor compact 80 summer stalled +13h f26 you': 'bb2d1b57',
  'phosphor compact 80 autumn tool +2256h f33': '50c5b239',
  'phosphor compact 80 none thinking +0h f40 you painted': 'bb02bf52',
  'phosphor compact 100 winter done +13h f12': 'd0a25765',
  'phosphor compact 100 spring stalled +2256h f19 you': '009df4e8',
  'phosphor compact 100 summer tool +0h f26 painted': '185d8737',
  'phosphor compact 100 autumn thinking +13h f33 you': 'c834a153',
  'phosphor compact 100 none done +2256h f40': 'd0a25765',
  'phosphor compact 144 winter stalled +0h f12 you painted': 'dfec7d59',
  'phosphor compact 144 spring tool +13h f19': '0214618a',
  'phosphor compact 144 summer thinking +2256h f26 you': '52812e7b',
  'phosphor compact 144 autumn done +0h f33 painted': '07d4e827',
  'phosphor compact 144 none stalled +13h f40 you': 'b1cacbf8',
  'phosphor standard 60 winter tool +2256h f12': '2d067505',
  'phosphor standard 60 spring thinking +0h f19 you painted': '22c1d1ee',
  'phosphor standard 60 summer done +13h f26': 'b312762d',
  'phosphor standard 60 autumn stalled +2256h f33 you': '0718836d',
  'phosphor standard 60 none tool +0h f40 painted': 'f9f1d7cf',
  'phosphor standard 80 winter thinking +13h f12 you': 'f6d00d81',
  'phosphor standard 80 spring done +2256h f19': 'd3f05a94',
  'phosphor standard 80 summer stalled +0h f26 you painted': '815061ea',
  'phosphor standard 80 autumn tool +13h f33': 'cca314e6',
  'phosphor standard 80 none thinking +2256h f40 you': '20f2e258',
  'phosphor standard 100 winter done +0h f12 painted': '360d1228',
  'phosphor standard 100 spring stalled +13h f19 you': 'c9190db5',
  'phosphor standard 100 summer tool +2256h f26': 'cf2a582a',
  'phosphor standard 100 autumn thinking +0h f33 you painted': '77bf90c1',
  'phosphor standard 100 none done +13h f40': 'cafd5eff',
  'phosphor standard 144 winter stalled +2256h f12 you': '8c0dd57d',
  'phosphor standard 144 spring tool +0h f19 painted': '298f5e14',
  'phosphor standard 144 summer thinking +13h f26 you': '26e875ee',
  'phosphor standard 144 autumn done +2256h f33': 'fd9690e7',
  'phosphor standard 144 none stalled +0h f40 you painted': '7b674b2e',
  'phosphor large 60 winter tool +13h f12': '40ad87e2',
  'phosphor large 60 spring thinking +2256h f19 you': '692da89a',
  'phosphor large 60 summer done +0h f26 painted': '6330df79',
  'phosphor large 60 autumn stalled +13h f33 you': 'f9726bdd',
  'phosphor large 60 none tool +2256h f40': '26d50f4e',
  'phosphor large 80 winter thinking +0h f12 you painted': '100dff25',
  'phosphor large 80 spring done +13h f19': '74b817ca',
  'phosphor large 80 summer stalled +2256h f26 you': '934c79b8',
  'phosphor large 80 autumn tool +0h f33 painted': '92bafa03',
  'phosphor large 80 none thinking +13h f40 you': 'b8973d16',
  'phosphor large 100 winter done +2256h f12': '56014509',
  'phosphor large 100 spring stalled +0h f19 you painted': '35f832a1',
  'phosphor large 100 summer tool +13h f26': '2d1c395c',
  'phosphor large 100 autumn thinking +2256h f33 you': 'dfaf8b12',
  'phosphor large 100 none done +0h f40 painted': 'a2e9d524',
  'phosphor large 144 winter stalled +13h f12 you': 'ad154ab0',
  'phosphor large 144 spring tool +2256h f19': '1caed901',
  'phosphor large 144 summer thinking +0h f26 you painted': '7a04ce2f',
  'phosphor large 144 autumn done +13h f33': '3e1b8425',
  'phosphor large 144 none stalled +2256h f40 you': '3fb4b3ff',
}

/** RUNNING as the pane following this session has it (as tests/golden.test.ts draws it). */
const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }

/** The office's golden frames (tests/golden.test.ts) before ambience, but for the wall cases (their claims are the golden file's to build). */
const GOLDEN_BEFORE: [string, SceneCtx, string][] = [
  ['80 standard f12', 80, 'standard', 12, false, '3379171f'],
  ['80 standard f12 you', 80, 'standard', 12, true, 'd35cd08e'],
  ['80 large f12', 80, 'large', 12, false, '269ecf50'],
  ['80 large f12 you', 80, 'large', 12, true, 'd3bc4071'],
  ['144 standard f12', 144, 'standard', 12, false, '14a4e64e'],
  ['144 standard f12 you', 144, 'standard', 12, true, 'e666b257'],
  ['144 large f12', 144, 'large', 12, false, '14dabfbd'],
  ['144 large f12 you', 144, 'large', 12, true, '28251972'],
  ['144 standard f13 you', 144, 'standard', 13, true, 'e756540a'],
].map(([name, columns, size, frame, you, hash]) => [
  name as string,
  { s: RUNNING, a: activity(RUNNING, T), frame: frame as number, t: T, columns: columns as number, rows: office.rows[size as SceneSize], orchestrator: 'claude-opus-5-5', you: you ? YOU_THINKING : undefined, transparent: true, palette: PALETTES.night },
  hash as string,
] as [string, SceneCtx, string])
const SESSION_BEFORE: [string, SceneCtx, string][] = [
  ['80 compact f12 session', 80, 'compact', '1e326bf9'],
  ['80 standard f12 session', 80, 'standard', 'f26ee2ed'],
  ['80 large f12 session', 80, 'large', '319e9de6'],
  ['144 compact f12 session', 144, 'compact', 'bc4b3083'],
  ['144 standard f12 session', 144, 'standard', '74cb7778'],
  ['144 large f12 session', 144, 'large', 'fcd1ecb7'],
].map(([name, columns, size, hash]) => [
  name as string,
  { s: SESSION, a: activity(SESSION, T), frame: 12, t: T, columns: columns as number, rows: office.rows[size as SceneSize], worker: 'claude', transparent: true, palette: PALETTES.night },
  hash as string,
] as [string, SceneCtx, string])

test('office ambience off: exactly the office drawn before ambience (docs/DESIGN.md 42.1, rule 6)', () => {
  const cases = offCases()
  expect(cases.length).toBe(Object.keys(BEFORE).length)
  for (const { name, ctx } of cases) expect(`${name} ${fnv(office.draw({ ...ctx, ambience: false }))}`).toBe(`${name} ${BEFORE[name]}`)
  for (const [name, ctx, hash] of [...GOLDEN_BEFORE, ...SESSION_BEFORE]) expect(`${name} ${fnv(office.draw({ ...ctx, ambience: false }))}`).toBe(`${name} ${hash}`)
  // And on is a different picture.
  expect(fnv(office.draw(GOLDEN_BEFORE[0]![1]))).not.toBe(GOLDEN_BEFORE[0]![2])
})
