// Ambience on the night sky (docs/DESIGN.md 42): the observatory. The rules of 42.1 as tests, at
// every size, 60 to 144 columns, every palette and the states through to done: ambience touches art cells only,
// never in a meaning colour, keeps a finished scene moving every frame, and `ambience: false`
// draws exactly the pictures the scene drew before it (FNV-1a hashes captured at the commit
// that brought section 42, before the scenes changed).
import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { PaletteId } from '../hooks/palette.ts'
import { sceneById } from '../hooks/scenes/index.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import type { You } from '../hooks/you.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING } from './fixtures.ts'

const IDS = ['observatory'] as const
const COLUMNS = [60, 80, 100, 144]
const PALETTE_IDS: PaletteId[] = ['night', 'paper', 'phosphor']
const FRAMES = [0, 9, 250]
/** The states drawn: through every kind of activity to done, a stall and a pulse, and with you. */
const FIXTURES: [string, Summary, You | undefined][] = [
  ['running', RUNNING, undefined],
  ['thinking', THINKING, undefined],
  ['finished', FINISHED, undefined],
  ['failed', FAILED, undefined],
  ['nolog', NOLOG, undefined],
  ['stalled', { ...THINKING, mtime: T - 600, stalled: true }, undefined],
  ['tests-fail', { ...THINKING, tests: [{ t: T - 2, failed: 3, passed: 8, total: 11 }] }, undefined],
  ['you', RUNNING, YOU_THINKING],
]

/** A scene's heights by name: its three sizes. */
function sizes(id: string): [string, number][] {
  const sc = sceneById(id)
  return [['compact', sc.rows.compact], ['standard', sc.rows.standard], ['large', sc.rows.large]]
}

function draw(id: string, s: Summary, you: You | undefined, frame: number, columns: number, rows: number, pid: PaletteId, ambience?: boolean): string {
  // `ambience` undefined counts as on (docs/DESIGN.md 42.1).
  const ctx: SceneCtx = { s, a: activity(s, T), frame, t: T, columns, rows, you, transparent: true, palette: PALETTES[pid], ambience }
  return sceneById(id).draw(ctx)
}

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

/** 32-bit FNV-1a over the UTF-16 code units of `s`, continuing from `h`. */
function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h
}

/** Art, not text: a blank, a block element (▀ ▄ █ ▂ ▌ and the quadrants) or a braille pattern. */
function isArt(cp: number): boolean {
  return cp === 0x20 || (cp >= 0x2580 && cp <= 0x259f) || (cp >= 0x2800 && cp <= 0x28ff)
}

/** Every palette's meaning colours (docs/DESIGN.md 42.1); the skies paint a light palette's picture in night's. */
const MEANING = new Set<number>(PALETTE_IDS.flatMap(id => [PALETTES[id].bad, PALETTES[id].good, PALETTES[id].warn, PALETTES[id].think]))

// The hashes of `ambience: false` per scene, size and palette, over every column count, fixture
// and frame above in that order: the pictures as they were before section 42.
const BEFORE: Record<string, string> = {
  'observatory compact night': '7e13afad',
  'observatory compact paper': '9106175d',
  'observatory compact phosphor': '2979ccf2',
  'observatory standard night': '9f62e992',
  'observatory standard paper': 'c8212ab2',
  'observatory standard phosphor': 'ec1bbfe1',
  'observatory large night': '2c904232',
  'observatory large paper': '64f6ca36',
  'observatory large phosphor': 'b4039684',
}

for (const id of IDS) {
  test(`${id}: ambience off draws exactly what it drew before section 42`, () => {
    const got: Record<string, string> = {}
    for (const [zn, rows] of sizes(id)) {
      for (const pid of PALETTE_IDS) {
        let h = 0x811c9dc5
        for (const columns of COLUMNS) for (const [, s, you] of FIXTURES) for (const frame of FRAMES) h = fnv(h, draw(id, s, you, frame, columns, rows, pid, false))
        got[`${id} ${zn} ${pid}`] = (h >>> 0).toString(16).padStart(8, '0')
      }
    }
    const want = Object.keys(BEFORE).filter(name => name.startsWith(`${id} `))
    expect(Object.keys(got).sort()).toEqual(want.sort())
    for (const name of want) expect(`${name} ${got[name]}`).toBe(`${name} ${BEFORE[name]}`)
  })
}

test('ambience is on by default, and changes each scene', () => {
  for (const id of IDS) {
    const rows = sceneById(id).rows.large
    expect(draw(id, RUNNING, undefined, 9, 100, rows, 'night')).toBe(draw(id, RUNNING, undefined, 9, 100, rows, 'night', true))
    expect(draw(id, FINISHED, undefined, 9, 100, rows, 'night', true)).not.toBe(draw(id, FINISHED, undefined, 9, 100, rows, 'night', false))
  }
})

// One test per scene and palette, so each stays inside the runner's time limit.
for (const id of IDS) {
  for (const pid of PALETTE_IDS) {
    test(`${id} in ${pid}: ambience touches art cells only, and never in a meaning colour`, () => {
      for (const [zn, rows] of sizes(id)) {
        for (const columns of COLUMNS) {
          for (const [name, s, you] of FIXTURES) {
            for (const frame of [...FRAMES, 57]) {
              const off = decode(draw(id, s, you, frame, columns, rows, pid, false))
              const on = decode(draw(id, s, you, frame, columns, rows, pid, true))
              for (let i = 0; i < off.length; i += 3) {
                if (off[i] === on[i] && off[i + 1] === on[i + 1] && off[i + 2] === on[i + 2]) continue
                const where = `${id} ${zn} ${columns}x${rows} ${pid} ${name} f${frame}, cell (${(i / 3) % columns}, ${Math.floor(i / 3 / columns)})`
                if (!isArt(off[i]!)) throw new Error(`${where}: ambience changed a text cell (0x${off[i]!.toString(16)})`)
                if (!isArt(on[i]!)) throw new Error(`${where}: ambience drew text (0x${on[i]!.toString(16)})`)
                for (const c of [on[i + 1]!, on[i + 2]!]) if (MEANING.has(c)) throw new Error(`${where}: ambience in a meaning colour 0x${c.toString(16)}`)
              }
            }
          }
        }
      }
    })
  }
}

test('with ambience on, a finished scene changes every frame', () => {
  for (const id of IDS) {
    for (const [zn, rows] of sizes(id)) {
      for (const pid of PALETTE_IDS) {
        for (const columns of COLUMNS) {
          for (const [name, s] of [['finished', FINISHED], ['failed', FAILED]] as [string, Summary][]) {
            expect(activity(s, T).state).toBe('done')
            for (const frame of [0, 1, 2, 9, 57, 250]) {
              if (draw(id, s, undefined, frame, columns, rows, pid, true) === draw(id, s, undefined, frame + 1, columns, rows, pid, true)) {
                throw new Error(`${id} ${zn} ${columns}x${rows} ${pid} ${name}: frames ${frame} and ${frame + 1} are the same`)
              }
            }
          }
        }
      }
    }
  }
})
