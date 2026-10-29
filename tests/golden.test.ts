// Golden frames (docs/DESIGN.md 30): the encoded cells of the heaviest scenes and of the module grid
// for fixed inputs, as FNV-1a hashes captured before the performance pass. A change to any hash
// is a change in what the pane draws: the regression gate for "no behaviour change". When a scene
// is changed on purpose, print the new table (GOLDEN_PRINT below) and paste it.
// The scenes draw with ambience off (docs/DESIGN.md 42): these frames guard what reports the run;
// tests/ambience*.test.ts hold the decoration to its rules.
import { expect, test } from 'claude-code/testing'

import { activity } from '../hooks/activity.ts'
import { drawGrid, packModules } from '../hooks/grid.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { factsOf } from '../hooks/facts.ts'
import type { Fact } from '../hooks/facts.ts'
import { DEFAULT_ORDER } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import { PALETTES } from '../hooks/palette.ts'
import { rowsFor, sceneById } from '../hooks/scenes/index.ts'
import type { SceneSize } from '../hooks/scenes/index.ts'
import type { You } from '../hooks/you.ts'
import type { Summary } from '../types'
import { RUNNING, T, YOU_THINKING } from './fixtures.ts'

/** 32-bit FNV-1a over the UTF-16 code units of `s`, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const A = activity(RUNNING, T)
const UI = { view: 'fold', scene: 'office', size: 'compact', palette: 'night', source: 'worker' }
/** RUNNING as the pane following this session has it (docs/DESIGN.md 36): a Claude model, no server, no hand-off. */
const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
const SESSION_A = activity(SESSION, T)

/** What the wall layout claims with the default modules (docs/DESIGN.md 31). */
const WALL_SHOWN: ReadonlySet<Fact> = new Set<Fact>([...factsOf(DEFAULT_ORDER), 'timeline'])

function scene(id: string, columns: number, size: SceneSize, frame: number, you?: You, shown?: ReadonlySet<Fact>): string {
  const sc = sceneById(id)
  return sc.draw({ s: RUNNING, a: A, frame, t: T, columns, rows: rowsFor(sc, size), orchestrator: 'claude-opus-5-5', you, transparent: true, palette: PALETTES.night, ambience: false, shown })
}

/** A scene as the pane draws it following this session: the worker named `claude`, no you, no orchestrator. */
function session(id: string, columns: number, size: SceneSize, frame: number, shown?: ReadonlySet<Fact>): string {
  const sc = sceneById(id)
  return sc.draw({ s: SESSION, a: SESSION_A, frame, t: T, columns, rows: rowsFor(sc, size), worker: 'claude', transparent: true, palette: PALETTES.night, ambience: false, shown })
}

/** A scene drawn taller than its large size (the showcase, docs/DESIGN.md 39), with you or following this session. */
function tall(id: string, columns: number, rows: number, frame: number, you?: You, solo = false): string {
  const sc = sceneById(id)
  if (solo) return sc.draw({ s: SESSION, a: SESSION_A, frame, t: T, columns, rows, worker: 'claude', transparent: true, palette: PALETTES.night, ambience: false })
  return sc.draw({ s: RUNNING, a: A, frame, t: T, columns, rows, orchestrator: 'claude-opus-5-5', you, transparent: true, palette: PALETTES.night, ambience: false })
}

function grid(columns: number, frame: number, you?: You): string {
  const ctx: ModuleCtx = { s: RUNNING, a: A, you, frame, t: T, compare: 'claude-sonnet-5-5', ui: UI, palette: PALETTES.night }
  const packed = packModules(DEFAULT_ORDER, columns, ctx)
  const c = new HiCanvas(columns, packed.rows)
  drawGrid(c, packed, ctx)
  return c.encode()
}

/** Every golden case: its name and the encoded cells. */
function cases(): [string, () => string][] {
  const out: [string, () => string][] = []
  for (const id of ['office-hd', 'office']) {
    for (const columns of [80, 144]) {
      for (const size of ['standard', 'large'] as const) {
        out.push([`${id} ${columns} ${size} f12`, () => scene(id, columns, size, 12)])
        out.push([`${id} ${columns} ${size} f12 you`, () => scene(id, columns, size, 12, YOU_THINKING)])
      }
    }
    out.push([`${id} 144 standard f13 you`, () => scene(id, 144, 'standard', 13, YOU_THINKING)])
    out.push([`${id} 144 large f12 you wall`, () => scene(id, 144, 'large', 12, YOU_THINKING, WALL_SHOWN)])
  }
  for (const id of ['office', 'office-hd']) {
    for (const columns of [80, 144]) {
      for (const size of ['compact', 'standard', 'large'] as const) out.push([`${id} ${columns} ${size} f12 session`, () => session(id, columns, size, 12)])
    }
    out.push([`${id} 144 large f12 session wall`, () => session(id, 144, 'large', 12, WALL_SHOWN)])
  }
  // The showcase (docs/DESIGN.md 39): office-hd taller than its large size.
  for (const id of ['office-hd']) {
    for (const [columns, rows] of [[100, 40], [100, 52], [144, 60]] as const) out.push([`${id} ${columns}x${rows} f12 you`, () => tall(id, columns, rows, 12, YOU_THINKING)])
    out.push([`${id} 100x52 f12`, () => tall(id, 100, 52, 12)])
    out.push([`${id} 100x52 f12 session`, () => tall(id, 100, 52, 12, undefined, true)])
  }
  for (const columns of [80, 144]) {
    out.push([`grid ${columns} f12`, () => grid(columns, 12)])
    out.push([`grid ${columns} f12 you`, () => grid(columns, 12, YOU_THINKING)])
  }
  out.push(['grid 144 f13 you', () => grid(144, 13, YOU_THINKING)])
  return out
}

// Captured after the scenes-memory pass (docs/DESIGN.md 31-37); the `wall` cases draw with the
// wall layout's claims, the `session` cases as the pane following this session draws them (36), the
// `100x52`-style cases at a showcase's height (39).
const GOLDEN: Record<string, string> = {
  'office-hd 80 standard f12': '2f5f9bc9',
  'office-hd 80 standard f12 you': '0f3b33ea',
  'office-hd 80 large f12': 'd1d993c9',
  'office-hd 80 large f12 you': 'b71d34ee',
  'office-hd 144 standard f12': '58fd1748',
  'office-hd 144 standard f12 you': '436fe1f4',
  'office-hd 144 large f12': 'f4c055b4',
  'office-hd 144 large f12 you': '09c65346',
  'office-hd 144 standard f13 you': 'ae1b7df2',
  'office-hd 144 large f12 you wall': '6ddb6982',
  'office 80 standard f12': '3379171f',
  'office 80 standard f12 you': 'd35cd08e',
  'office 80 large f12': '269ecf50',
  'office 80 large f12 you': 'd3bc4071',
  'office 144 standard f12': '14a4e64e',
  'office 144 standard f12 you': 'e666b257',
  'office 144 large f12': '14dabfbd',
  'office 144 large f12 you': '28251972',
  'office 144 standard f13 you': 'e756540a',
  'office 144 large f12 you wall': '85dde64b',
  'office 80 compact f12 session': '1e326bf9',
  'office 80 standard f12 session': 'f26ee2ed',
  'office 80 large f12 session': '319e9de6',
  'office 144 compact f12 session': 'bc4b3083',
  'office 144 standard f12 session': '74cb7778',
  'office 144 large f12 session': 'fcd1ecb7',
  'office 144 large f12 session wall': '5ab982ef',
  'office-hd 80 compact f12 session': 'c0e3d794',
  'office-hd 80 standard f12 session': 'aa157a4f',
  'office-hd 80 large f12 session': '9a583823',
  'office-hd 144 compact f12 session': '5326c36e',
  'office-hd 144 standard f12 session': '730e38e6',
  'office-hd 144 large f12 session': '1ac04506',
  'office-hd 144 large f12 session wall': '79d39b2b',
  // The showcase (docs/DESIGN.md 39): moves with hooks/thought.ts, which lays out its thinking screen.
  'office-hd 100x40 f12 you': 'ebf7ef49',
  'office-hd 100x52 f12 you': '9ba3d34d',
  'office-hd 144x60 f12 you': '69206a97',
  'office-hd 100x52 f12': '03629eef',
  'office-hd 100x52 f12 session': '5a7eee4e',
  'grid 80 f12': 'a8b231a0',
  'grid 80 f12 you': '216005c9',
  'grid 144 f12': '9e94963f',
  'grid 144 f12 you': '6c2678be',
  'grid 144 f13 you': '6c2678be',
}

const GOLDEN_PRINT = false

test('golden frames: the heaviest scenes and the module grid draw exactly as before', () => {
  const got: Record<string, string> = {}
  for (const [name, draw] of cases()) got[name] = fnv(draw())
  // The test runtime has a console; the es2023 lib does not declare it.
  if (GOLDEN_PRINT) (globalThis as unknown as { console: { log(s: string): void } }).console.log(JSON.stringify(got, null, 2))
  expect(Object.keys(got).length).toBe(Object.keys(GOLDEN).length)
  for (const name of Object.keys(got)) expect(`${name} ${got[name]}`).toBe(`${name} ${GOLDEN[name]}`)
})

test('golden frames: frames 12 and 13 differ (the frame counter is covered)', () => {
  for (const id of ['office-hd', 'office']) {
    expect(fnv(scene(id, 144, 'standard', 13, YOU_THINKING))).not.toBe(fnv(scene(id, 144, 'standard', 12, YOU_THINKING)))
  }
})
