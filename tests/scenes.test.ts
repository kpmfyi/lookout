import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { Canvas } from '../hooks/canvas.ts'
import { factsOf } from '../hooks/facts.ts'
import type { Fact } from '../hooks/facts.ts'
import { DEFAULT_ORDER } from '../hooks/modules/index.ts'
import { RETIRED, SCENES, SCENE_SIZES, fitRows, nextScene, rowsFor, sceneById } from '../hooks/scenes/index.ts'
import type { Scene } from '../hooks/scenes/index.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING } from './fixtures.ts'

const FIXTURES: [string, Summary][] = [
  ['running', RUNNING],
  ['thinking', THINKING],
  ['finished', FINISHED],
  ['failed', FAILED],
  ['nolog', NOLOG],
]
const WIDTHS = [40, 80, 144, 200]

/** Variants that light up every state and pulse at least once. */
const VARIANTS: [string, Summary, number][] = [
  ['stalled', { ...THINKING, mtime: T - 600, stalled: true }, T],
  ['prefill', { ...RUNNING, pending: { kind: 'model', since: T - 1 }, server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } } }, T],
  ['waiting', { ...NOLOG, exists: true, size: 0, mtime: T - 1 }, T],
  ['tests-pass', { ...RUNNING, tests: [{ t: T - 2, failed: 0, passed: 11, total: 11 }] }, T],
  ['tests-fail', { ...THINKING, tests: [{ t: T - 2, failed: 3, passed: 8, total: 11 }] }, T],
  ['error', { ...RUNNING, last_error: { t: T - 1, tool: 'Bash', detail: 'exit 1' } }, T],
  ['commit', { ...THINKING, git: { branch: 'main', commits: [{ hash: 'abc1234', t: T - 1, subject: 'Tidy the store', stat: '' }], dirty: '', untracked: 0 } }, T],
  ['web tool', { ...RUNNING, pending: { kind: 'tool', tool: 'WebFetch', cls: 'web', label: 'docs', since: T - 3 } }, T],
]

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

function check(cells: string, columns: number, rows: number): void {
  expect(atob(cells).length).toBe(columns * rows * 3 * 4)
  const words = decode(cells)
  for (let i = 0; i < words.length; i += 3) {
    const cp = words[i]!
    const ok = cp >= 0x20 && cp <= 0xffff && !(cp >= 0x7f && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff)
    if (!ok) throw new Error(`cell ${i / 3}: code point 0x${cp.toString(16)} is not printable`)
  }
}

/**
 * The heights every scene must draw at (docs/DESIGN.md 14): its three sizes and two in-between
 * heights a layout may hand it (compact + 1, standard + 2).
 */
function heights(sc: Scene): number[] {
  return [...new Set([...SCENE_SIZES.map(z => sc.rows[z]), sc.rows.compact + 1, sc.rows.standard + 2])]
}

for (const sc of SCENES) {
  test(`${sc.id}: every fixture draws at every height and at 40, 80, 144 and 200 columns`, () => {
    for (const rows of heights(sc)) {
      for (const [name, s] of [...FIXTURES, ...VARIANTS.map(([n, v]) => [n, v] as [string, Summary])]) {
        for (const columns of WIDTHS) {
          const a = activity(s, T)
          for (const frame of [0, 1, 2, 57]) {
            let cells = ''
            try {
              cells = sc.draw({ s, a, frame, t: T, columns, rows })
            } catch (err) {
              throw new Error(`${sc.id} ${name} at ${columns}×${rows}: ${String(err)}`)
            }
            check(cells, columns, rows)
          }
        }
      }
    }
  })

  test(`${sc.id}: frames 1 and 2 differ while the worker is live, at every height`, () => {
    for (const rows of heights(sc)) {
      for (const [name, s] of [...FIXTURES, ...VARIANTS.map(([n, v]) => [n, v] as [string, Summary])]) {
        const a = activity(s, T)
        if (a.state === 'done') continue
        for (const columns of WIDTHS) {
          const one = sc.draw({ s, a, frame: 1, t: T, columns, rows })
          const two = sc.draw({ s, a, frame: 2, t: T, columns, rows })
          if (one === two) throw new Error(`${sc.id} ${name} (${a.state}) at ${columns}×${rows}: frames 1 and 2 are the same`)
        }
      }
    }
  })

  test(`${sc.id}: a finished run keeps a slow idle motion, at every height`, () => {
    for (const rows of heights(sc)) {
      for (const s of [FINISHED, FAILED]) {
        const a = activity(s, T)
        expect(a.state).toBe('done')
        expect(sc.draw({ s, a, frame: 0, t: T, columns: 80, rows })).not.toBe(sc.draw({ s, a, frame: 8, t: T, columns: 80, rows }))
      }
    }
  })

  test(`${sc.id}: rowsFor reads the size, standard when unknown`, () => {
    for (const z of SCENE_SIZES) expect(rowsFor(sc, z)).toBe(sc.rows[z])
    expect(rowsFor(sc, 'huge')).toBe(sc.rows.standard)
    expect(rowsFor(sc, undefined)).toBe(sc.rows.standard)
    expect(sc.rows.compact <= sc.rows.standard && sc.rows.standard <= sc.rows.large).toBe(true)
  })
}

const NONE = 0x01000000

/** The [code point, fg, bg] of the cell at (col, row). */
function cellAt(words: Uint32Array, columns: number, col: number, row: number): [number, number, number] {
  const i = (row * columns + col) * 3
  return [words[i]!, words[i + 1]!, words[i + 2]!]
}

// Transparent scenes leave their background as the terminal's own colour (NONE): the four corner
// cells, where no scene draws an object, come out as a blank cell on NONE. The observatory paints
// its sky in both modes (the sky is the picture), so it is left out.
for (const sc of SCENES.filter(sc => sc.id !== 'observatory')) {
  test(`${sc.id}: transparent leaves the background unpainted; scene paints it`, () => {
    const columns = 80
    const a = activity(RUNNING, T)
    for (const rows of [sc.rows.standard, sc.rows.standard + 2]) {
      const clear = decode(sc.draw({ s: RUNNING, a, frame: 12, t: T, columns, rows, transparent: true }))
      const corners: [number, number][] = [[0, 0], [columns - 1, 0], [0, rows - 1], [columns - 1, rows - 1]]
      for (const [col, row] of corners) {
        const [cp, fg, bg] = cellAt(clear, columns, col, row)
        if (cp !== 0x20 || fg !== NONE || bg !== NONE) {
          throw new Error(`${sc.id} ${rows} rows, cell (${col}, ${row}): 0x${cp.toString(16)} fg 0x${fg.toString(16)} bg 0x${bg.toString(16)}`)
        }
      }
      // Undefined counts as transparent.
      expect(sc.draw({ s: RUNNING, a, frame: 12, t: T, columns, rows })).toBe(sc.draw({ s: RUNNING, a, frame: 12, t: T, columns, rows, transparent: true }))
      const painted = decode(sc.draw({ s: RUNNING, a, frame: 12, t: T, columns, rows, transparent: false }))
      const [, fg, bg] = cellAt(painted, columns, 0, 0)
      expect(fg === NONE && bg === NONE).toBe(false)
    }
  })
}

// One home per fact (docs/DESIGN.md 31): within one frame of a scene no reading is spelled out
// twice: not the current call, the turn count, the speed, the context, the server's absence or a
// stall's length, at any size, with or without you, the claims or this session's naming (36).
test('no scene says the same reading twice in one frame', () => {
  const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
  const STALLED: Summary = { ...THINKING, mtime: T - 600, stalled: true }
  const WALL = new Set<Fact>([...factsOf(DEFAULT_ORDER), 'timeline'])
  const text = (cells: string) => {
    const w = decode(cells)
    let out = ''
    for (let i = 0; i < w.length; i += 3) out += String.fromCodePoint(w[i]!)
    return out
  }
  const once = (all: string, needle: RegExp, where: string) => {
    const n = all.match(needle)?.length ?? 0
    if (n > 1) throw new Error(`${where}: ${needle} ${n} times`)
  }
  for (const sc of SCENES) {
    for (const size of SCENE_SIZES) {
      for (const columns of [80, 144]) {
        for (const [name, s, you, worker] of [['running', RUNNING, undefined], ['running you', RUNNING, YOU_THINKING], ['session', SESSION, undefined, 'claude'], ['stalled', STALLED, undefined]] as [string, Summary, typeof YOU_THINKING | undefined, string | undefined][]) {
          for (const shown of [undefined, WALL]) {
            const all = text(sc.draw({ s, a: activity(s, T), frame: 12, t: T, columns, rows: rowsFor(sc, size), you, worker, shown }))
            const where = `${sc.id} ${size} ${columns} ${name}${shown ? ' wall' : ''}`
            once(all, /npm test -- todo/g, where)
            once(all, /\bturns? 18\b|\b18 turns\b/g, where)
            once(all, /tok\/s|t\/s/g, where)
            once(all, /54\.2k|54k/g, where)
            once(all, /no server|no srv/g, where)
            once(all, /10m00s/g, where)
          }
        }
      }
    }
  }
})

test('the activity model maps the fixtures', () => {
  expect(activity(NOLOG, T).state).toBe('nolog')
  expect(activity(RUNNING, T).state).toBe('tool')
  expect(activity(RUNNING, T).cls).toBe('shell')
  expect(activity(THINKING, T).state).toBe('thinking')
  expect(activity(THINKING, T).intensity).toBe(0.5)
  expect(activity(FINISHED, T)).toMatchObject({ state: 'done', ok: true })
  expect(activity(FAILED, T)).toMatchObject({ state: 'done', ok: false })
  expect(activity({ ...THINKING, mtime: T - 600 }, T, 180).state).toBe('stalled')
  expect(activity({ ...THINKING, mtime: T - 60 }, T, 30).state).toBe('stalled')
  for (const [name, s, t] of VARIANTS) {
    const a = activity(s, t)
    if (name === 'prefill') expect(a.state).toBe('prefill')
    if (name === 'waiting') expect(a.state).toBe('waiting')
    if (name === 'tests-pass') expect(a.pulse?.kind).toBe('tests-pass')
    if (name === 'tests-fail') expect(a.pulse?.kind).toBe('tests-fail')
    if (name === 'error') expect(a.pulse?.kind).toBe('error')
    if (name === 'commit') expect(a.pulse?.kind).toBe('commit')
  }
  expect(Math.abs(activity(RUNNING, T).intensity - 30.4 / 60) < 1e-9).toBe(true)
})

test('an unknown scene id falls back to the first scene, the office (the default)', () => {
  expect(SCENES.map(sc => sc.id)).toEqual(['office', 'office-hd', 'observatory'])
  expect(sceneById('nope').id).toBe('office')
  expect(sceneById(undefined).id).toBe('office')
  expect(sceneById('office').rows.standard).toBe(15)
})

test('a retired scene falls back to its stand-in, and the cycle goes on from there', () => {
  // docs/DESIGN.md 35, 37: factory, terrarium and network to the office; 43.1: controlroom to
  // office-hd, aurora to the observatory.
  const STAND_IN: Record<string, string> = { factory: 'office', terrarium: 'office', network: 'office', controlroom: 'office-hd', aurora: 'observatory' }
  expect(RETIRED).toEqual(STAND_IN)
  for (const [id, to] of Object.entries(STAND_IN)) {
    expect(SCENES.map(sc => sc.id)).not.toContain(id)
    expect(sceneById(id).id).toBe(to)
    expect(nextScene(id).id).toBe(nextScene(to).id)
  }
})

test('fitRows anchors a native drawing at the bottom: sky above, the top cropped when shorter', () => {
  const columns = 6
  const native = new Canvas(columns, 2)
  native.fill((x, y) => (y < 2 ? 0x112233 : 0x445566))
  native.label(1, 1, 'ok')
  const cells = native.encode()
  const ctx = (rows: number) => ({ s: RUNNING, a: activity(RUNNING, T), frame: 0, t: T, columns, rows })
  expect(fitRows(2, ctx(2), cells)).toBe(cells)
  const nat = decode(cells)
  // Taller: two blank rows, then the drawing untouched.
  const tall = decode(fitRows(2, ctx(4), cells))
  expect(tall.length).toBe(columns * 4 * 3)
  expect(cellAt(tall, columns, 0, 0)).toEqual([0x20, NONE, NONE])
  expect([...tall.slice(columns * 2 * 3)]).toEqual([...nat])
  // Taller with a sky: the band is painted.
  const sky = decode(fitRows(2, ctx(3), cells, () => 0x778899))
  expect(cellAt(sky, columns, 3, 0)).toEqual([0x2588, 0x778899, NONE])
  expect([...sky.slice(columns * 3)]).toEqual([...nat])
  // Shorter: the top row is cropped.
  const short = decode(fitRows(2, ctx(1), cells))
  expect([...short]).toEqual([...nat.slice(columns * 3)])
})
