// Palettes (docs/DESIGN.md 27): the three role maps agree on their keys, every scene and module
// draws in each of them, `paper` keeps ink darker than the wall and screens darker than the
// phosphor, and `night` is the look lookout was drawn with to the cell (the golden frames).
import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { luminance } from '../hooks/canvas.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { MODULES } from '../hooks/modules/index.ts'
import { PALETTES, PALETTE_IDS, isPaletteId, paletteOf, shade } from '../hooks/palette.ts'
import type { Palette } from '../hooks/palette.ts'
import { PANEL, panelOf } from '../hooks/panel.ts'
import { SCENES } from '../hooks/scenes/index.ts'
import { CASE_SUMMARIES, OWN_SCENES, nightGroups } from './night-cases.ts'
import { ALL, RUNNING, T, YOU_THINKING, YOU_TOOL } from './fixtures.ts'

/**
 * The night frames before the scenes and modules moved to palette roles: per scene (and the
 * module grid) and fixture, one hash of the encoded frame 12 at every size, at 40, 80 and 144
 * columns, transparent and opaque (tests/night-cases.ts). A change to the night look updates this
 * on purpose, never by accident.
 */
const GOLDEN: Record<string, string> = {
    "grid/commit": "bf68afc969a66",
    "grid/error": "17c9d1d2790d74",
    "grid/failed": "fc248e81de3a2",
    "grid/finished": "1493f6f50e7958",
    "grid/nolog": "1fcdfa77b3776e",
    "grid/prefill": "1466fcf7a88672",
    "grid/running": "fb14ff3d1fb02",
    "grid/stalled": "36d2f555dcb8b",
    "grid/tests-fail": "97dca669819e7",
    "grid/tests-pass": "159b87e888ba1e",
    "grid/thinking": "7f5a79f61631d",
    "grid/web": "1f613974c98b4b",
    "observatory/commit": "1887980543fdb2",
    "observatory/error": "274bbd230d287",
    "observatory/failed": "15704fec1fc7c7",
    "observatory/finished": "11cee71af18b53",
    "observatory/nolog": "54351e5f8aaa5",
    "observatory/prefill": "72d446a53a6bd",
    "observatory/running": "191193dbb94e37",
    "observatory/stalled": "1736196d3aa442",
    "observatory/tests-fail": "a8045258c51d7",
    "observatory/tests-pass": "3bfa418798e1e",
    "observatory/thinking": "da024464581c3",
    "observatory/web": "df184301486be",
  }

const ALL_PALETTES: Palette[] = PALETTE_IDS.map(id => PALETTES[id])

function keysOf(p: Palette): string[] {
  return Object.keys(p).sort()
}

test('palettes: the three maps have the same keys, the same classes and ramps of the same lengths', () => {
  const night = PALETTES.night
  for (const p of ALL_PALETTES) {
    expect(keysOf(p)).toEqual(keysOf(night))
    expect(Object.keys(p.classes).sort()).toEqual(Object.keys(night.classes).sort())
    for (const ramp of ['lagoon', 'dusk', 'heat'] as const) expect(p[ramp].length).toBe(night[ramp].length)
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') expect(v >= 0 && v <= 0xffffff).toBe(true)
      else if (k !== 'id' && k !== 'light' && typeof v !== 'object') throw new Error(`${p.id}.${k} is not a colour`)
    }
    expect(isPaletteId(p.id)).toBe(true)
    expect(PALETTES[p.id]).toBe(p)
  }
  expect(paletteOf(undefined).id).toBe('night')
  expect(paletteOf({}).id).toBe('night')
})

test('palettes: paper keeps ink darker than the wall and floor, and its screens darker than the phosphor', () => {
  const p = PALETTES.paper
  expect(p.light).toBe(true)
  expect(luminance(p.wall) > luminance(p.ink) + 0.5).toBe(true)
  expect(luminance(p.floor) > luminance(p.ink) + 0.4).toBe(true)
  expect(luminance(p.wall) > luminance(p.inkDim)).toBe(true)
  expect(luminance(p.screen) < luminance(p.phosphor)).toBe(true)
  expect(luminance(p.screen) < luminance(p.phosphorDim)).toBe(true)
  expect(luminance(p.mon) < luminance(p.wall)).toBe(true)
  // The dark palettes: the other way round.
  for (const d of [PALETTES.night, PALETTES.phosphor]) {
    expect(d.light).toBe(false)
    expect(luminance(d.ink) > luminance(d.wall) + 0.5).toBe(true)
    expect(luminance(d.screen) < luminance(d.phosphor)).toBe(true)
  }
})

test('palettes: phosphor is one green hue, except bad', () => {
  const p = PALETTES.phosphor
  const green = (c: number) => ((c >> 8) & 255) >= ((c >> 16) & 255) && ((c >> 8) & 255) >= (c & 255)
  for (const [k, v] of Object.entries(p)) {
    if (k === 'bad' || typeof v !== 'number') continue
    if (!green(v)) throw new Error(`phosphor.${k} 0x${v.toString(16)} is not green`)
  }
  for (const v of [...Object.values(p.classes), ...p.lagoon, ...p.dusk, ...p.heat]) expect(green(v)).toBe(true)
  expect((p.bad >> 16) & 255).toBeGreaterThan((p.bad >> 8) & 255)
  // Neighbours in the stacked class bar part by brightness.
  const order = ['shell', 'read', 'edit', 'search', 'web', 'agent'] as const
  for (let i = 1; i < order.length; i++) {
    const d = Math.abs(luminance(p.classes[order[i]!]) - luminance(p.classes[order[i - 1]!]))
    if (d < 0.08) throw new Error(`phosphor classes ${order[i - 1]} and ${order[i]} are too close (${d.toFixed(3)})`)
  }
})

test('palettes: shade is the identity in night and follows the role elsewhere', () => {
  expect(shade(PALETTES.night, 'wall', 0x123456)).toBe(0x123456)
  expect(shade(PALETTES.paper, 'wall', PALETTES.night.wall)).toBe(PALETTES.paper.wall)
  // A shadow of the wall stays darker than the wall in paper.
  expect(luminance(shade(PALETTES.paper, 'wall', 0x0d0c12)) < luminance(PALETTES.paper.wall)).toBe(true)
  // panelOf(night) is PANEL.
  const P = panelOf(PALETTES.night)
  for (const [k, v] of Object.entries(PANEL)) expect([k, P[k as keyof typeof PANEL]]).toEqual([k, v])
})

test('palettes: night draws every converted scene and the module grid exactly as before (golden frames)', () => {
  const now = nightGroups()
  expect(Object.keys(now).sort()).toEqual(Object.keys(GOLDEN).sort())
  const differ = Object.keys(GOLDEN).filter(k => now[k] !== GOLDEN[k])
  expect(differ).toEqual([])
  // The same with the night palette passed explicitly.
  const passed = nightGroups(PALETTES.night)
  expect(Object.keys(GOLDEN).filter(k => passed[k] !== GOLDEN[k])).toEqual([])
})

test('palettes: every scene draws in every palette at every size, without throwing', () => {
  for (const p of ALL_PALETTES) {
    for (const sc of SCENES) {
      for (const rows of [sc.rows.compact, sc.rows.standard, sc.rows.large]) {
        for (const [name, s] of CASE_SUMMARIES) {
          for (const columns of [40, 80, 144]) {
            for (const transparent of [true, false]) {
              let cells: string
              try {
                cells = sc.draw({ s, a: activity(s, T), frame: 7, t: T, columns, rows, transparent, you: YOU_THINKING, orchestrator: 'claude-opus-5-5', palette: p })
              } catch (err) {
                throw new Error(`${sc.id} in ${p.id}, ${name} at ${columns}×${rows}: ${String(err)}`)
              }
              expect(atob(cells).length).toBe(columns * rows * 12)
            }
          }
        }
      }
    }
  }
})

test('palettes: the converted scenes paint differently in each palette', () => {
  for (const sc of OWN_SCENES) {
    const frames = ALL_PALETTES.map(p => sc.draw({ s: RUNNING, a: activity(RUNNING, T), frame: 12, t: T, columns: 80, rows: sc.rows.standard, palette: p }))
    expect(new Set(frames).size).toBe(3)
  }
})

test('palettes: every module draws in every palette for every fixture, without throwing', () => {
  for (const p of ALL_PALETTES) {
    for (const [id, m] of Object.entries(MODULES)) {
      for (const [name, s] of Object.entries(ALL) as [string, Summary][]) {
        for (const [w, h] of [[m.minW, m.minH], [m.minW * 2, m.minH + 2]] as const) {
          const c = new HiCanvas(w + 2, h + 2)
          try {
            m.draw(c, { col: 1, row: 1, w, h }, { s, a: activity(s, T), you: YOU_TOOL, frame: 3, t: T, ui: { view: 'fold', scene: 'observatory' }, palette: p })
          } catch (err) {
            throw new Error(`${id} in ${p.id}, ${name} at ${w}×${h}: ${String(err)}`)
          }
          expect(atob(c.encode()).length).toBe((w + 2) * (h + 2) * 12)
        }
      }
    }
  }
})

test('palettes: modules frame their screens in the palette slate and keep the screen dark', () => {
  for (const p of ALL_PALETTES) {
    const c = new HiCanvas(24, 6)
    MODULES['counter:turns']!.draw(c, { col: 0, row: 0, w: 24, h: 6 }, { s: RUNNING, a: activity(RUNNING, T), frame: 3, t: T, palette: p })
    const bin = atob(c.encode())
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const words = new Uint32Array(bytes.buffer)
    const colours = new Set<number>()
    for (let i = 0; i < words.length; i += 3) colours.add(words[i + 1]!).add(words[i + 2]!)
    expect(colours.has(p.mon)).toBe(true)
    expect(colours.has(p.bevel)).toBe(true)
    expect(colours.has(p.screen)).toBe(true)
  }
})
