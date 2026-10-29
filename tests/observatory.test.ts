import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import type { Fact } from '../hooks/facts.ts'
import { luminance } from '../hooks/canvas.ts'
import { glyphToMask } from '../hooks/hicanvas.ts'
import { PALETTES } from '../hooks/palette.ts'
import { obsLayout, observatory } from '../hooks/scenes/observatory.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING } from './fixtures.ts'

const NONE = 0x01000000
const NIGHT = PALETTES.night
const HEIGHTS = [observatory.rows.compact, observatory.rows.compact + 1, observatory.rows.standard, observatory.rows.standard + 2, observatory.rows.large]
const WIDTHS = [40, 80, 144, 200]

const VARIANTS: [string, Summary][] = [
  ['running', RUNNING],
  ['thinking', THINKING],
  ['finished', FINISHED],
  ['failed', FAILED],
  ['nolog', NOLOG],
  ['stalled', { ...THINKING, mtime: T - 600, stalled: true }],
  ['prefill', { ...RUNNING, pending: { kind: 'model', since: T - 1 }, server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } } }],
  ['waiting', { ...NOLOG, exists: true, size: 0, mtime: T - 1 }],
  ['tests-pass', { ...RUNNING, tests: [{ t: T - 2, failed: 0, passed: 11, total: 11 }] }],
  ['tests-fail', { ...THINKING, tests: [{ t: T - 2, failed: 3, passed: 8, total: 11 }] }],
  ['error', { ...RUNNING, last_error: { t: T - 1, tool: 'Bash', detail: 'exit 1' } }],
  ['commit', { ...THINKING, git: { branch: 'main', commits: [{ hash: 'abc1234', t: T - 1, subject: 'Tidy the store', stat: '' }], dirty: '', untracked: 0 } }],
  ['many turns', { ...THINKING, turns: 230, ctx: 2_000_000 }],
]

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

function draw(s: Summary, columns: number, rows: number, frame = 12, transparent?: boolean): string {
  return observatory.draw({ s, a: activity(s, T), frame, t: T, columns, rows, transparent })
}

function rowText(w: Uint32Array, columns: number, row: number): string {
  let out = ''
  for (let x = 0; x < columns; x++) out += String.fromCodePoint(w[(row * columns + x) * 3]!)
  return out
}

test('observatory: every state decodes to columns × rows cells at every height and width, without throwing', () => {
  expect(observatory.rows).toEqual({ compact: 7, standard: 12, large: 20 })
  expect(observatory.minColumns).toBe(40)
  for (const rows of [...HEIGHTS, 30]) {
    for (const columns of WIDTHS) {
      for (const [name, s] of VARIANTS) {
        for (const frame of [0, 1, 57, 999]) {
          let cells = ''
          try {
            cells = draw(s, columns, rows, frame)
          } catch (err) {
            throw new Error(`${name} at ${columns}×${rows}: ${String(err)}`)
          }
          expect(atob(cells).length).toBe(columns * rows * 3 * 4)
          const w = decode(cells)
          for (let i = 0; i < w.length; i += 3) {
            const cp = w[i]!
            if (cp < 0x20 || cp > 0xffff || (cp >= 0x7f && cp <= 0x9f)) throw new Error(`${name} ${columns}×${rows}: code point 0x${cp.toString(16)}`)
          }
        }
      }
    }
  }
})

test('observatory: frames differ while live; a finished run keeps an idle twinkle', () => {
  for (const rows of HEIGHTS) {
    for (const columns of [40, 80, 144]) {
      for (const [name, s] of VARIANTS) {
        if (activity(s, T).state === 'done') {
          expect(draw(s, columns, rows, 0)).not.toBe(draw(s, columns, rows, 8))
        } else if (draw(s, columns, rows, 1) === draw(s, columns, rows, 2)) {
          throw new Error(`${name} at ${columns}×${rows}: frames 1 and 2 are the same`)
        }
      }
    }
  }
})

test('observatory: the moon fills with the context window', () => {
  const withLimit = (ctx: number): Summary => ({ ...THINKING, ctx, server: RUNNING.server })
  for (const [columns, rows] of [[80, 12], [144, 20], [40, 7]] as const) {
    const { moon } = obsLayout(columns, rows)
    const lit = (s: Summary): number => {
      const w = decode(draw(s, columns, rows))
      let n = 0
      for (let row = (moon.y - moon.r - 1) >> 2; row <= (moon.y + moon.r + 1) >> 2; row++) {
        for (let col = (moon.x - moon.r - 1) >> 1; col <= (moon.x + moon.r + 1) >> 1; col++) {
          const i = (row * columns + col) * 3
          const mask = glyphToMask(w[i]!) ?? 0
          let bits = 0
          for (let b = 0; b < 8; b++) if (mask & (1 << b)) bits++
          if (w[i + 1]! !== NONE && luminance(w[i + 1]!) > 0.6) n += bits
          if (w[i + 2]! !== NONE && luminance(w[i + 2]!) > 0.6) n += 8 - bits
        }
      }
      return n
    }
    const thin = lit(withLimit(10_000))
    const half = lit(withLimit(65_000))
    const full = lit(withLimit(131_000))
    expect(thin > 0).toBe(true)
    expect(half > thin).toBe(true)
    expect(full > half).toBe(true)
    // No known limit: a steady half moon, whatever the context.
    expect(lit({ ...THINKING, ctx: 1_000 })).toBe(lit({ ...THINKING, ctx: 90_000 }))
  }
})

test('observatory: the door lamp takes the tool class colour, and blinks red on an error', () => {
  for (const [columns, rows] of [[80, 12], [144, 20], [40, 12]] as const) {
    const [lx, ly] = obsLayout(columns, rows).lamp
    const lampCell = (s: Summary, frame = 12): [number, number] => {
      const w = decode(draw(s, columns, rows, frame))
      const i = ((ly >> 2) * columns + (lx >> 1)) * 3
      return [w[i + 1]!, w[i + 2]!]
    }
    for (const [tool, cls] of [['WebFetch', 'web'], ['Bash', 'shell'], ['Edit', 'edit']] as const) {
      const s: Summary = { ...RUNNING, pending: { kind: 'tool', tool, cls, label: 'x', since: T - 3 } }
      expect(lampCell(s)).toContain(NIGHT.classes[cls])
    }
    const failing: Summary = { ...RUNNING, last_error: { t: T - 1, tool: 'Bash', detail: 'exit 1' } }
    expect(lampCell(failing, 0)).toContain(NIGHT.bad)
    expect(lampCell(FAILED)).toContain(NIGHT.bad)
  }
})

test('observatory: labels sit under their objects; the turn count once, under the dome', () => {
  for (const [columns, rows] of [[80, 12], [144, 12], [144, 20], [200, 14]] as const) {
    const g = obsLayout(columns, rows)
    const w = decode(draw(RUNNING, columns, rows))
    expect(rowText(w, columns, g.peakY / 4).includes('turn 18')).toBe(true)
    let all = ''
    for (let row = 0; row < rows - 1; row++) all += rowText(w, columns, row) + '\n'
    expect(all.includes('ctx 54k/131k')).toBe(true)
    // One home per fact (docs/DESIGN.md 31): no second count by the constellation.
    expect(all.match(/18/g)?.length).toBe(1)
    expect(all.includes('turns')).toBe(false)
    // The caption is the last row; no model name or stats line in the picture.
    expect(rowText(w, columns, rows - 1).includes('Bash · npm test -- todo')).toBe(true)
    expect(all.includes('qwen')).toBe(false)
  }
  // Narrow drops the constellation region.
  expect(obsLayout(40, 12).cons).toBe(null)
  expect(obsLayout(80, 12).cons).not.toBe(null)
})

test('observatory: the sky is painted either way; transparent leaves only the caption row unpainted', () => {
  for (const rows of [12, 20]) {
    const clear = decode(draw(RUNNING, 80, rows, 12, true))
    const solid = decode(draw(RUNNING, 80, rows, 12, false))
    expect(draw(RUNNING, 80, rows, 12)).toBe(draw(RUNNING, 80, rows, 12, true))
    for (const w of [clear, solid]) expect(w[1] !== NONE || w[2] !== NONE).toBe(true) // top-left sky
    const last = ((rows - 1) * 80 + 79) * 3
    expect(clear[last + 1] === NONE && clear[last + 2] === NONE).toBe(true)
    expect(solid[last + 1] === NONE && solid[last + 2] === NONE).toBe(false)
  }
})

test('observatory: a claimed fact drops its label and keeps the picture', () => {
  const text = (s: Summary, columns: number, rows: number, shown?: Fact[]) => {
    const w = decode(observatory.draw({ s, a: activity(s, T), frame: 12, t: T, columns, rows, shown: shown ? new Set(shown) : undefined }))
    let all = ''
    for (let row = 0; row < rows - 1; row++) all += rowText(w, columns, row) + '\n'
    return all
  }
  for (const rows of [observatory.rows.standard, observatory.rows.large]) {
    for (const columns of [80, 144]) {
      expect(text(RUNNING, columns, rows, ['turns']).includes('turn')).toBe(false)
      expect(text(RUNNING, columns, rows, ['turns']).includes('ctx 54k/131k')).toBe(true)
      expect(text(RUNNING, columns, rows, ['ctx']).includes('54k')).toBe(false)
      expect(text(RUNNING, columns, rows, ['ctx']).includes('turn 18')).toBe(true)
      // The dome, the moon and the constellation stay: only the two label rows change.
      const g = obsLayout(columns, rows)
      const labelRows = new Set([g.peakY / 4, Math.ceil((g.moon.y + g.moon.r + 1) / 4)])
      const a = decode(draw(RUNNING, columns, rows))
      const b = decode(observatory.draw({ s: RUNNING, a: activity(RUNNING, T), frame: 12, t: T, columns, rows, shown: new Set<Fact>(['turns', 'ctx']) }))
      for (let i = 0; i < a.length / 3; i++) {
        if (a[i * 3] !== b[i * 3] || a[i * 3 + 1] !== b[i * 3 + 1] || a[i * 3 + 2] !== b[i * 3 + 2]) expect(labelRows.has(Math.floor(i / columns))).toBe(true)
      }
    }
  }
})
