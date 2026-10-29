// Ambience in office-hd (docs/DESIGN.md 42): the rules of 42.1 checked on the showcase scene, the
// one a tall pane fills with screens (39). Ambience only touches art cells (never text, never the
// labels or the caption), never in a meaning colour, keeps a finished room moving; each piece shows
// where the room has room for it; and off draws exactly what office-hd drew before ambience (hashes
// captured from office-hd before the change).
import { expect, test } from 'claude-code/testing'

import { activity } from '../hooks/activity.ts'
import { TICK_SECS, rainDrops, rainRuns } from '../hooks/ambience.ts'
import { glyphToMask } from '../hooks/hicanvas.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { Palette } from '../hooks/palette.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import { geometry, officeHd } from '../hooks/scenes/office-hd.ts'
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

/** A HiCanvas art cell (a block, braille or space); anything else is text. */
const isArt = (cp: number) => glyphToMask(cp) != null
const meaning = (p: Palette) => new Set([p.bad, p.good, p.warn, p.think])

const STALLED: Summary = { ...THINKING, mtime: T - 600, stalled: true }
/** RUNNING as the pane following this session has it (as tests/golden.test.ts draws it). */
const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime() / 1000

// ── The shared rain at office-hd's scale

test('rainRuns: rainDrops at one second a unit; faster on a fine glass, a run inside a minute', () => {
  for (const [w, h] of [[12, 3], [25, 16], [29, 64]] as [number, number][]) {
    for (let f = 0; f < 400; f += 13) expect(rainRuns(w, h, f, 1)).toEqual(rainDrops(w, h, f))
  }
  // office-hd's tall window, 64 sub-pixels at a quarter second each: one lane (a glass under ten
  // sub-pixels wide has one drop), each run from the top to the foot in 12 to 23 seconds.
  const [w, h] = [6, 64]
  let run = 0
  const runs: number[] = []
  for (let f = 0; f < 3000; f++) {
    const drops = rainRuns(w, h, f, 0.25)
    for (const g of drops) expect(g.x >= 0 && g.x < w && g.y >= 0 && g.y < h).toBe(true)
    if (drops.length) run++
    else if (run) {
      runs.push(run * TICK_SECS)
      run = 0
    }
  }
  expect(runs.length >= 3).toBe(true)
  for (const secs of runs.slice(1)) expect(secs > 12 && secs < 23).toBe(true)
})

// ── The rules of 42.1 (docs/DESIGN.md 42.1, rules 1 and 2)

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
const STATES: [string, Summary][] = [['tool', RUNNING], ['thinking', THINKING], ['done', FINISHED], ['stalled', STALLED]]
/** Heights: compact, standard, large and the showcase's (docs/DESIGN.md 39). */
const HEIGHTS = [officeHd.rows.compact, officeHd.rows.standard, officeHd.rows.large, 40, 52, 60]

function draws(pal: 'night' | 'paper' | 'phosphor'): { name: string; ctx: SceneCtx }[] {
  const out: { name: string; ctx: SceneCtx }[] = []
  let n = 0
  for (const rows of HEIGHTS) {
    for (const columns of rows > officeHd.rows.large ? [100, 144] : [60, 80, 100, 144]) {
      for (const [season, look, t] of LOOKS) {
        const [state, s0] = STATES[n % STATES.length]!
        const frame = [12, 333, 4321, 77777][n % 4]!
        const mode = (['you', 'solo', 'session'] as const)[n % 3]!
        const s = mode === 'session' ? SESSION : s0
        n++
        out.push({
          name: `${pal} ${columns}x${rows} ${look} ${mode === 'session' ? 'session' : state} f${frame} ${mode}`,
          ctx: { s, a: activity(s, T), frame, t, columns, rows, you: mode === 'you' ? YOU_THINKING : undefined, worker: mode === 'session' ? 'claude' : undefined, transparent: n % 2 === 0, palette: PALETTES[pal], season },
        })
      }
    }
  }
  return out
}

/** Ambience on against off for each draw: the cells it changed (and checks rules 1 and 2 on them). */
function rulesHold(pal: 'night' | 'paper' | 'phosphor'): number {
  let touched = 0
  for (const { name, ctx } of draws(pal)) {
    const off = decode(officeHd.draw({ ...ctx, ambience: false }))
    const on = decode(officeHd.draw({ ...ctx, ambience: true }))
    expect(officeHd.draw(ctx)).toBe(officeHd.draw({ ...ctx, ambience: true })) // undefined is on
    const bad = meaning(ctx.palette!)
    const g = geometry(ctx.columns, ctx.rows!, ctx.you != null)
    for (let i = 0; i < off.length; i += 3) {
      if (off[i] === on[i] && off[i + 1] === on[i + 1] && off[i + 2] === on[i + 2]) continue
      const col = (i / 3) % ctx.columns
      const row = Math.floor(i / 3 / ctx.columns)
      const cell = `${name}: cell (${col}, ${row})`
      if (row >= g.labelRow) throw new Error(`${cell}: ambience changed the labels or the caption`)
      if (!isArt(off[i]!)) throw new Error(`${cell} is text (0x${off[i]!.toString(16)}) and ambience changed it`)
      if (!isArt(on[i]!)) throw new Error(`${cell}: ambience laid text (0x${on[i]!.toString(16)}) on it`)
      for (const c of [on[i + 1]!, on[i + 2]!]) {
        if (bad.has(c) && c !== off[i + 1] && c !== off[i + 2]) throw new Error(`${cell}: ambience drew a meaning colour 0x${c.toString(16)}`)
      }
      touched++
    }
  }
  return touched
}

test('office-hd ambience, night: only art cells change, never into a meaning colour (docs/DESIGN.md 42.1)', () => {
  expect(rulesHold('night') > 2000).toBe(true)
})

test('office-hd ambience, paper: only art cells change, never into a meaning colour (docs/DESIGN.md 42.1)', () => {
  expect(rulesHold('paper') > 2000).toBe(true)
})

test('office-hd ambience, phosphor: only art cells change, never into a meaning colour (docs/DESIGN.md 42.1)', () => {
  expect(rulesHold('phosphor') > 2000).toBe(true)
})

function keepsMoving(pal: 'night' | 'paper' | 'phosphor'): void {
  const a = activity(FINISHED, T)
  expect(a.state).toBe('done')
  let n = 0
  for (const rows of HEIGHTS) {
    for (const columns of rows > officeHd.rows.large ? [100, 144] : [60, 80, 100, 144]) {
      for (const [season, look, t] of LOOKS) {
        for (const frame of [12, 4321]) {
          const you = n++ % 2 ? YOU_THINKING : undefined
          const ctx: SceneCtx = { s: FINISHED, a, frame, t, columns, rows, you, palette: PALETTES[pal], season }
          if (officeHd.draw(ctx) === officeHd.draw({ ...ctx, frame: frame + 1 })) throw new Error(`${pal} ${columns}x${rows} ${look}${you ? ' you' : ''} f${frame}: frames f and f+1 are the same`)
        }
      }
    }
  }
}

test('office-hd ambience: a finished room keeps moving frame to frame, night (docs/DESIGN.md 42.1)', () => keepsMoving('night'))
test('office-hd ambience: a finished room keeps moving frame to frame, paper (docs/DESIGN.md 42.1)', () => keepsMoving('paper'))
test('office-hd ambience: a finished room keeps moving frame to frame, phosphor (docs/DESIGN.md 42.1)', () => keepsMoving('phosphor'))

// ── Each piece where the room has room for it (docs/DESIGN.md 42.2)

/** The cells (col, row) where ambience on and off differ for `ctx`. */
function changed(ctx: SceneCtx): Set<string> {
  const off = decode(officeHd.draw({ ...ctx, ambience: false }))
  const on = decode(officeHd.draw({ ...ctx, ambience: true }))
  const out = new Set<string>()
  for (let i = 0; i < off.length; i += 3) {
    if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) out.add(`${(i / 3) % ctx.columns},${Math.floor(i / 3 / ctx.columns)}`)
  }
  return out
}

test('office-hd ambience: string lights under the tray in the large room and the showcase, none in the lights holiday or a smaller room', () => {
  const night = at(2026, 10, 20, 22)
  for (const [columns, rows, you] of [[100, 24, true], [144, 24, false], [100, 52, true], [144, 60, false], [80, 15, true], [80, 10, false]] as [number, number, boolean][]) {
    const g = geometry(columns, rows, you)
    const under = (cells: Set<string>) => [...cells].filter(k => Number(k.split(',')[1]) === g.top + 1).length
    const base: SceneCtx = { s: RUNNING, a: activity(RUNNING, T), frame: 40, t: night, columns, rows, you: you ? YOU_THINKING : undefined, season: 'autumn' }
    if (rows >= officeHd.rows.large) expect(under(changed(base)) >= 6).toBe(true)
    else expect(under(changed(base))).toBe(0)
    expect(under(changed({ ...base, t: at(2026, 12, 24, 21), season: 'winter' }))).toBe(0)
  }
})

test('office-hd ambience: the skyline across the glass, the lamplit desks, and the solo plant swaying over its loop', () => {
  const night = at(2026, 10, 20, 22)
  for (const you of [true, false]) {
    const g = geometry(100, 24, you)
    const w = g.window!
    const cells = changed({ s: RUNNING, a: activity(RUNNING, T), frame: 40, t: night, columns: 100, rows: 24, you: you ? YOU_THINKING : undefined, season: 'autumn' })
    const at2 = (col: number, row: number) => cells.has(`${col},${row}`)
    // The skyline: the glass's last row, across both panes.
    let sky = 0
    for (let col = w.c0 + 1; col < w.c1; col++) if (at2(col, w.top + w.sky)) sky++
    expect(sky >= (w.c1 - w.c0) / 2).toBe(true)
    // The lamplight: the plank under each monitor.
    for (const d of you ? [g.orch, g.worker] : [g.worker]) {
      const mid = d.screen.col + (d.screen.w >> 1)
      expect(at2(mid, g.D)).toBe(true)
    }
  }
  // Solo, the plant's leaves lean a sub-pixel and back over seven seconds.
  const g = geometry(100, 24, false)
  const leaves = new Set<string>()
  for (let f = 0; f < 7 / TICK_SECS; f += 3) {
    for (const k of changed({ s: SESSION, a: activity(SESSION, T), frame: f, t: T, columns: 100, rows: 24, worker: 'claude', season: 'none' })) {
      const [col, row] = k.split(',').map(Number)
      if (row! >= g.D && row! < g.F && Math.abs(col! * 2 - (g.plant!.pot.x + 2)) <= 6) leaves.add(k)
    }
  }
  expect(leaves.size > 0).toBe(true)
})

// ── Off draws office-hd as it was (docs/DESIGN.md 42.1, rule 6). The hashes below were captured
// from office-hd before ambience was added, for a spread of palettes, sizes, widths and showcase
// heights, seasons, states, times of day (the fixtures' morning, that night, a morning in the
// `lights` holiday), frames, with your desk, solo and following this session, transparent and
// painted. The golden frames (tests/golden.test.ts) draw with ambience off too.

const OFF_STATES = [['tool', RUNNING], ['thinking', THINKING], ['done', FINISHED], ['stalled', STALLED]] as const
const OFF_HOURS = [0, 13, 94 * 24]

function offCases(): { name: string; ctx: SceneCtx }[] {
  const out: { name: string; ctx: SceneCtx }[] = []
  let n = 0
  const add = (pal: 'night' | 'paper' | 'phosphor', rows: number, columns: number, season: string, mode: 'you' | 'solo' | 'session') => {
    const [state, s0] = OFF_STATES[n % OFF_STATES.length]!
    const hours = OFF_HOURS[n % OFF_HOURS.length]!
    const frame = 12 + (n % 5) * 7
    const transparent = n % 3 !== 0
    n++
    const session = mode === 'session'
    const s = session ? SESSION : s0
    out.push({
      name: `${pal} ${columns}x${rows} ${season} ${session ? 'session' : state} +${hours}h f${frame} ${mode}${transparent ? '' : ' painted'}`,
      ctx: { s, a: activity(s, T), frame, t: T + hours * 3600, columns, rows, you: mode === 'you' ? YOU_THINKING : undefined, worker: session ? 'claude' : undefined, transparent, palette: PALETTES[pal], season },
    })
  }
  for (const pal of ['night', 'paper', 'phosphor'] as const) {
    for (const rows of [officeHd.rows.compact, officeHd.rows.standard, officeHd.rows.large]) {
      for (const columns of [60, 80, 100, 144]) {
        for (const season of ['winter', 'spring', 'summer', 'autumn', 'none']) add(pal, rows, columns, season, n % 2 ? 'you' : 'solo')
      }
      for (const columns of [80, 144]) add(pal, rows, columns, 'autumn', 'session')
    }
    // The showcase (docs/DESIGN.md 39): taller than the large size.
    for (const [columns, rows] of [[100, 40], [100, 52], [144, 60]] as const) {
      for (const season of ['autumn', 'summer']) for (const mode of ['you', 'solo', 'session'] as const) add(pal, rows, columns, season, mode)
    }
  }
  return out
}

const BEFORE: Record<string, string> = {
  'night 60x10 winter tool +0h f12 solo painted': '9143e307',
  'night 60x10 spring thinking +13h f19 you': 'a68ed2c4',
  'night 60x10 summer done +2256h f26 solo': '58370841',
  'night 60x10 autumn stalled +0h f33 you painted': '1385ba07',
  'night 60x10 none tool +13h f40 solo': 'b2686977',
  'night 80x10 winter thinking +2256h f12 you': 'caa65da8',
  'night 80x10 spring done +0h f19 solo painted': '0ab2db54',
  'night 80x10 summer stalled +13h f26 you': 'b2312fdf',
  'night 80x10 autumn tool +2256h f33 solo': '7c922770',
  'night 80x10 none thinking +0h f40 you painted': '8a9a6ac8',
  'night 100x10 winter done +13h f12 solo': 'ce3e131f',
  'night 100x10 spring stalled +2256h f19 you': '7dda3764',
  'night 100x10 summer tool +0h f26 solo painted': 'bb275719',
  'night 100x10 autumn thinking +13h f33 you': '9a8ca80b',
  'night 100x10 none done +2256h f40 solo': '467f2a6b',
  'night 144x10 winter stalled +0h f12 you painted': '47601d2a',
  'night 144x10 spring tool +13h f19 solo': '7f886abc',
  'night 144x10 summer thinking +2256h f26 you': '6786abcf',
  'night 144x10 autumn done +0h f33 solo painted': '938bfca8',
  'night 144x10 none stalled +13h f40 you': '8d8be49d',
  'night 80x10 autumn session +2256h f12 session': 'f3714095',
  'night 144x10 autumn session +0h f19 session painted': '4a30e7ba',
  'night 60x15 winter done +13h f26 solo': '3a469e9c',
  'night 60x15 spring stalled +2256h f33 you': '7636c84d',
  'night 60x15 summer tool +0h f40 solo painted': '678f8819',
  'night 60x15 autumn thinking +13h f12 you': '8ac18d91',
  'night 60x15 none done +2256h f19 solo': '279d4663',
  'night 80x15 winter stalled +0h f26 you painted': 'ca7ec2b9',
  'night 80x15 spring tool +13h f33 solo': 'c01bc498',
  'night 80x15 summer thinking +2256h f40 you': 'f49c27c1',
  'night 80x15 autumn done +0h f12 solo painted': '218d1979',
  'night 80x15 none stalled +13h f19 you': 'fdd7dac2',
  'night 100x15 winter tool +2256h f26 solo': '53e79c01',
  'night 100x15 spring thinking +0h f33 you painted': 'ea5027cd',
  'night 100x15 summer done +13h f40 solo': '073b1633',
  'night 100x15 autumn stalled +2256h f12 you': 'cea0b657',
  'night 100x15 none tool +0h f19 solo painted': 'f93d246d',
  'night 144x15 winter thinking +13h f26 you': '76a9a6c3',
  'night 144x15 spring done +2256h f33 solo': 'f56a5100',
  'night 144x15 summer stalled +0h f40 you painted': '55d63a63',
  'night 144x15 autumn tool +13h f12 solo': '442df662',
  'night 144x15 none thinking +2256h f19 you': 'c425f91e',
  'night 80x15 autumn session +0h f26 session painted': '3cda7499',
  'night 144x15 autumn session +13h f33 session': '41d0119a',
  'night 60x24 winter tool +2256h f40 solo': 'e42e7bfa',
  'night 60x24 spring thinking +0h f12 you painted': '56414ade',
  'night 60x24 summer done +13h f19 solo': 'fa23776a',
  'night 60x24 autumn stalled +2256h f26 you': '734893e7',
  'night 60x24 none tool +0h f33 solo painted': '6fd467eb',
  'night 80x24 winter thinking +13h f40 you': 'd45f3abd',
  'night 80x24 spring done +2256h f12 solo': 'c84445cf',
  'night 80x24 summer stalled +0h f19 you painted': '0429c65d',
  'night 80x24 autumn tool +13h f26 solo': 'fe739b98',
  'night 80x24 none thinking +2256h f33 you': '38802f01',
  'night 100x24 winter done +0h f40 solo painted': '0a234912',
  'night 100x24 spring stalled +13h f12 you': '2be01dd4',
  'night 100x24 summer tool +2256h f19 solo': '76935977',
  'night 100x24 autumn thinking +0h f26 you painted': '5457f6c0',
  'night 100x24 none done +13h f33 solo': '5a4ed541',
  'night 144x24 winter stalled +2256h f40 you': '90f43bde',
  'night 144x24 spring tool +0h f12 solo painted': '8f78908b',
  'night 144x24 summer thinking +13h f19 you': 'cc02a272',
  'night 144x24 autumn done +2256h f26 solo': '9fa9ad19',
  'night 144x24 none stalled +0h f33 you painted': 'f287ff86',
  'night 80x24 autumn session +13h f40 session': 'c4828f6d',
  'night 144x24 autumn session +2256h f12 session': 'de460dd0',
  'night 100x40 autumn done +0h f19 you painted': '500ebd7e',
  'night 100x40 autumn stalled +13h f26 solo': 'a2c3d005',
  'night 100x40 autumn session +2256h f33 session': '8b66fd60',
  'night 100x40 summer thinking +0h f40 you painted': '3ea35b10',
  'night 100x40 summer done +13h f12 solo': 'd8cf3de2',
  'night 100x40 summer session +2256h f19 session': 'c25fc382',
  'night 100x52 autumn tool +0h f26 you painted': '6fc6ce67',
  'night 100x52 autumn thinking +13h f33 solo': '7b732e82',
  'night 100x52 autumn session +2256h f40 session': '520854fd',
  'night 100x52 summer stalled +0h f12 you painted': 'd2807cd2',
  'night 100x52 summer tool +13h f19 solo': 'df184dad',
  'night 100x52 summer session +2256h f26 session': '5b937f5c',
  'night 144x60 autumn done +0h f33 you painted': 'cccca775',
  'night 144x60 autumn stalled +13h f40 solo': 'a36b0041',
  'night 144x60 autumn session +2256h f12 session': '48cc5124',
  'night 144x60 summer thinking +0h f19 you painted': '29e0c0d6',
  'night 144x60 summer done +13h f26 solo': '6acca638',
  'night 144x60 summer session +2256h f33 session': 'b9131f9b',
  'paper 60x10 winter tool +0h f40 solo painted': 'c9b06ef2',
  'paper 60x10 spring thinking +13h f12 you': '17cc4dca',
  'paper 60x10 summer done +2256h f19 solo': '87bca0c1',
  'paper 60x10 autumn stalled +0h f26 you painted': '66abbe12',
  'paper 60x10 none tool +13h f33 solo': '8b8d6e17',
  'paper 80x10 winter thinking +2256h f40 you': 'ebe6f325',
  'paper 80x10 spring done +0h f12 solo painted': 'f551126a',
  'paper 80x10 summer stalled +13h f19 you': '8b51f70e',
  'paper 80x10 autumn tool +2256h f26 solo': 'f0f3b1fb',
  'paper 80x10 none thinking +0h f33 you painted': '4820fb3b',
  'paper 100x10 winter done +13h f40 solo': '3b57f58e',
  'paper 100x10 spring stalled +2256h f12 you': 'd0cb2faa',
  'paper 100x10 summer tool +0h f19 solo painted': '18c80e06',
  'paper 100x10 autumn thinking +13h f26 you': 'f7b9c5f4',
  'paper 100x10 none done +2256h f33 solo': '74dd33d0',
  'paper 144x10 winter stalled +0h f40 you painted': '8da9c39e',
  'paper 144x10 spring tool +13h f12 solo': '6a25e1bc',
  'paper 144x10 summer thinking +2256h f19 you': '64d302fb',
  'paper 144x10 autumn done +0h f26 solo painted': '21202f90',
  'paper 144x10 none stalled +13h f33 you': '9c547d57',
  'paper 80x10 autumn session +2256h f40 session': 'dd0f46aa',
  'paper 144x10 autumn session +0h f12 session painted': '0b6babd1',
  'paper 60x15 winter done +13h f19 solo': '5d65b322',
  'paper 60x15 spring stalled +2256h f26 you': 'bac5a246',
  'paper 60x15 summer tool +0h f33 solo painted': 'fc8296a9',
  'paper 60x15 autumn thinking +13h f40 you': '813b5149',
  'paper 60x15 none done +2256h f12 solo': 'dd2415cb',
  'paper 80x15 winter stalled +0h f19 you painted': '251c7dbc',
  'paper 80x15 spring tool +13h f26 solo': 'd5e3ccfc',
  'paper 80x15 summer thinking +2256h f33 you': '66bc0c97',
  'paper 80x15 autumn done +0h f40 solo painted': '704639c1',
  'paper 80x15 none stalled +13h f12 you': '522fb07a',
  'paper 100x15 winter tool +2256h f19 solo': 'bb7d4cff',
  'paper 100x15 spring thinking +0h f26 you painted': 'd7c01409',
  'paper 100x15 summer done +13h f33 solo': '06ae94bb',
  'paper 100x15 autumn stalled +2256h f40 you': '063e5c28',
  'paper 100x15 none tool +0h f12 solo painted': 'fccf594f',
  'paper 144x15 winter thinking +13h f19 you': '7dc3bc22',
  'paper 144x15 spring done +2256h f26 solo': '07d45189',
  'paper 144x15 summer stalled +0h f33 you painted': 'b9846503',
  'paper 144x15 autumn tool +13h f40 solo': 'f88dad27',
  'paper 144x15 none thinking +2256h f12 you': '63a5b573',
  'paper 80x15 autumn session +0h f19 session painted': '5dcf0ac0',
  'paper 144x15 autumn session +13h f26 session': '0c20fbd2',
  'paper 60x24 winter tool +2256h f33 solo': '26d32131',
  'paper 60x24 spring thinking +0h f40 you painted': 'd4e5afdf',
  'paper 60x24 summer done +13h f12 solo': 'a89b89e0',
  'paper 60x24 autumn stalled +2256h f19 you': '6892d591',
  'paper 60x24 none tool +0h f26 solo painted': 'a60c9cfd',
  'paper 80x24 winter thinking +13h f33 you': 'dc1e3ebc',
  'paper 80x24 spring done +2256h f40 solo': '2aa21613',
  'paper 80x24 summer stalled +0h f12 you painted': '07f5e0e2',
  'paper 80x24 autumn tool +13h f19 solo': '730d3ea6',
  'paper 80x24 none thinking +2256h f26 you': 'a92fe3e4',
  'paper 100x24 winter done +0h f33 solo painted': 'eb68ddcc',
  'paper 100x24 spring stalled +13h f40 you': 'b318fea8',
  'paper 100x24 summer tool +2256h f12 solo': '3abb9f52',
  'paper 100x24 autumn thinking +0h f19 you painted': '27b7574e',
  'paper 100x24 none done +13h f26 solo': '428c90e4',
  'paper 144x24 winter stalled +2256h f33 you': 'fe951cdd',
  'paper 144x24 spring tool +0h f40 solo painted': '8d321b67',
  'paper 144x24 summer thinking +13h f12 you': '29413d63',
  'paper 144x24 autumn done +2256h f19 solo': 'afc70aab',
  'paper 144x24 none stalled +0h f26 you painted': '20a96811',
  'paper 80x24 autumn session +13h f33 session': '642ed607',
  'paper 144x24 autumn session +2256h f40 session': 'ed911999',
  'paper 100x40 autumn done +0h f12 you painted': 'fc6f1729',
  'paper 100x40 autumn stalled +13h f19 solo': '35020626',
  'paper 100x40 autumn session +2256h f26 session': '0412dec2',
  'paper 100x40 summer thinking +0h f33 you painted': 'b725f5e5',
  'paper 100x40 summer done +13h f40 solo': '5c46bc24',
  'paper 100x40 summer session +2256h f12 session': 'f7daf292',
  'paper 100x52 autumn tool +0h f19 you painted': 'afdf7d5e',
  'paper 100x52 autumn thinking +13h f26 solo': '2127724d',
  'paper 100x52 autumn session +2256h f33 session': 'aa367c9c',
  'paper 100x52 summer stalled +0h f40 you painted': '6b41e155',
  'paper 100x52 summer tool +13h f12 solo': 'ea9e8c40',
  'paper 100x52 summer session +2256h f19 session': '73c42874',
  'paper 144x60 autumn done +0h f26 you painted': '764d0dfb',
  'paper 144x60 autumn stalled +13h f33 solo': 'f3ed8e9b',
  'paper 144x60 autumn session +2256h f40 session': 'e2bc3841',
  'paper 144x60 summer thinking +0h f12 you painted': 'f2aedb32',
  'paper 144x60 summer done +13h f19 solo': '64f86ff2',
  'paper 144x60 summer session +2256h f26 session': '672b8303',
  'phosphor 60x10 winter tool +0h f33 solo painted': 'db364544',
  'phosphor 60x10 spring thinking +13h f40 you': 'cf4062dc',
  'phosphor 60x10 summer done +2256h f12 solo': 'e44518eb',
  'phosphor 60x10 autumn stalled +0h f19 you painted': '856e281c',
  'phosphor 60x10 none tool +13h f26 solo': 'f4509eed',
  'phosphor 80x10 winter thinking +2256h f33 you': '403225d6',
  'phosphor 80x10 spring done +0h f40 solo painted': 'b21c0967',
  'phosphor 80x10 summer stalled +13h f12 you': 'f156cefa',
  'phosphor 80x10 autumn tool +2256h f19 solo': 'b5ef14a9',
  'phosphor 80x10 none thinking +0h f26 you painted': 'fb16d624',
  'phosphor 100x10 winter done +13h f33 solo': 'da5ba16f',
  'phosphor 100x10 spring stalled +2256h f40 you': 'cf2d2315',
  'phosphor 100x10 summer tool +0h f12 solo painted': 'ffab48ff',
  'phosphor 100x10 autumn thinking +13h f19 you': '5556375b',
  'phosphor 100x10 none done +2256h f26 solo': '393cd84c',
  'phosphor 144x10 winter stalled +0h f33 you painted': '72a827f9',
  'phosphor 144x10 spring tool +13h f40 solo': '09a3bd0d',
  'phosphor 144x10 summer thinking +2256h f12 you': '7ddfb28f',
  'phosphor 144x10 autumn done +0h f19 solo painted': '790a9ee7',
  'phosphor 144x10 none stalled +13h f26 you': 'b29be253',
  'phosphor 80x10 autumn session +2256h f33 session': '361763db',
  'phosphor 144x10 autumn session +0h f40 session painted': '0e8b8fb0',
  'phosphor 60x15 winter done +13h f12 solo': '2b6171b1',
  'phosphor 60x15 spring stalled +2256h f19 you': '75687b7b',
  'phosphor 60x15 summer tool +0h f26 solo painted': '5f771058',
  'phosphor 60x15 autumn thinking +13h f33 you': 'ae28c3ed',
  'phosphor 60x15 none done +2256h f40 solo': '7b484cbb',
  'phosphor 80x15 winter stalled +0h f12 you painted': '557ea7ba',
  'phosphor 80x15 spring tool +13h f19 solo': '5edc5a79',
  'phosphor 80x15 summer thinking +2256h f26 you': 'cce310d8',
  'phosphor 80x15 autumn done +0h f33 solo painted': '673a9a6c',
  'phosphor 80x15 none stalled +13h f40 you': 'df5ff096',
  'phosphor 100x15 winter tool +2256h f12 solo': '8fcfe60e',
  'phosphor 100x15 spring thinking +0h f19 you painted': '099d705c',
  'phosphor 100x15 summer done +13h f26 solo': '058191a9',
  'phosphor 100x15 autumn stalled +2256h f33 you': '9035e542',
  'phosphor 100x15 none tool +0h f40 solo painted': 'b459961a',
  'phosphor 144x15 winter thinking +13h f12 you': '9d98b573',
  'phosphor 144x15 spring done +2256h f19 solo': '1a2fbdf9',
  'phosphor 144x15 summer stalled +0h f26 you painted': '1eae70c0',
  'phosphor 144x15 autumn tool +13h f33 solo': '11959a2e',
  'phosphor 144x15 none thinking +2256h f40 you': '51c1a4e6',
  'phosphor 80x15 autumn session +0h f12 session painted': '8c8dd7fa',
  'phosphor 144x15 autumn session +13h f19 session': '2ee6b3f6',
  'phosphor 60x24 winter tool +2256h f26 solo': '0761f118',
  'phosphor 60x24 spring thinking +0h f33 you painted': 'a36a277b',
  'phosphor 60x24 summer done +13h f40 solo': '3deefa0b',
  'phosphor 60x24 autumn stalled +2256h f12 you': '9dd2e527',
  'phosphor 60x24 none tool +0h f19 solo painted': '6f51fd06',
  'phosphor 80x24 winter thinking +13h f26 you': 'f83009f7',
  'phosphor 80x24 spring done +2256h f33 solo': '6aae45e9',
  'phosphor 80x24 summer stalled +0h f40 you painted': '5c3a926e',
  'phosphor 80x24 autumn tool +13h f12 solo': 'c7391714',
  'phosphor 80x24 none thinking +2256h f19 you': '5d9654c5',
  'phosphor 100x24 winter done +0h f26 solo painted': '072a6a3e',
  'phosphor 100x24 spring stalled +13h f33 you': '84bbe3d7',
  'phosphor 100x24 summer tool +2256h f40 solo': '5d55c55c',
  'phosphor 100x24 autumn thinking +0h f12 you painted': '697fbcaf',
  'phosphor 100x24 none done +13h f19 solo': '298d02eb',
  'phosphor 144x24 winter stalled +2256h f26 you': 'e202c692',
  'phosphor 144x24 spring tool +0h f33 solo painted': 'afcb211a',
  'phosphor 144x24 summer thinking +13h f40 you': '8f7695df',
  'phosphor 144x24 autumn done +2256h f12 solo': 'c8fa076c',
  'phosphor 144x24 none stalled +0h f19 you painted': '9404dc52',
  'phosphor 80x24 autumn session +13h f26 session': '1e9eefa7',
  'phosphor 144x24 autumn session +2256h f33 session': '39aa8ff5',
  'phosphor 100x40 autumn done +0h f40 you painted': 'ce96b959',
  'phosphor 100x40 autumn stalled +13h f12 solo': 'f819d115',
  'phosphor 100x40 autumn session +2256h f19 session': 'f0ee62e3',
  'phosphor 100x40 summer thinking +0h f26 you painted': '47917dde',
  'phosphor 100x40 summer done +13h f33 solo': 'b275397f',
  'phosphor 100x40 summer session +2256h f40 session': '8387188d',
  'phosphor 100x52 autumn tool +0h f12 you painted': 'ff95fc07',
  'phosphor 100x52 autumn thinking +13h f19 solo': '92bd0cea',
  'phosphor 100x52 autumn session +2256h f26 session': '42755432',
  'phosphor 100x52 summer stalled +0h f33 you painted': '4ad8f01c',
  'phosphor 100x52 summer tool +13h f40 solo': 'f8a181da',
  'phosphor 100x52 summer session +2256h f12 session': 'cfe4ab5b',
  'phosphor 144x60 autumn done +0h f19 you painted': '7d75db82',
  'phosphor 144x60 autumn stalled +13h f26 solo': '914fa3ba',
  'phosphor 144x60 autumn session +2256h f33 session': 'ddbd0b6c',
  'phosphor 144x60 summer thinking +0h f40 you painted': 'db55af7b',
  'phosphor 144x60 summer done +13h f12 solo': 'c0b6c719',
  'phosphor 144x60 summer session +2256h f19 session': 'b97aca87',
}

test('office-hd ambience off: exactly office-hd drawn before ambience (docs/DESIGN.md 42.1, rule 6)', () => {
  const cases = offCases()
  expect(cases.length).toBe(Object.keys(BEFORE).length)
  for (const { name, ctx } of cases) expect(`${name} ${fnv(officeHd.draw({ ...ctx, ambience: false }))}`).toBe(`${name} ${BEFORE[name]}`)
  // And on is a different picture.
  const [first] = cases
  expect(fnv(officeHd.draw(first!.ctx))).not.toBe(BEFORE[first!.name])
})
