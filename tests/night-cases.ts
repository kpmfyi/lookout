// The golden frames for docs/DESIGN.md 27 (the `night` rule: converting the scenes and modules to
// palette roles must not change one cell of the `night` look). `nightCases` draws the scenes and
// modules converted to roles over the fixtures at frame 12 and returns a hash of each encoded
// frame; tests/palette.test.ts compares them with the hashes taken before the conversion.
import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { drawGrid, packModules } from '../hooks/grid.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { MODULES } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import type { Palette } from '../hooks/palette.ts'
import { observatory } from '../hooks/scenes/observatory.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING, YOU_TOOL } from './fixtures.ts'

export const OWN_SCENES = [observatory]

export const CASE_SUMMARIES: [string, Summary][] = [
  ['running', RUNNING],
  ['thinking', THINKING],
  ['finished', FINISHED],
  ['failed', FAILED],
  ['nolog', NOLOG],
  ['stalled', { ...THINKING, mtime: T - 600, stalled: true }],
  ['prefill', { ...RUNNING, pending: { kind: 'model', since: T - 1 }, server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } } }],
  ['tests-pass', { ...RUNNING, tests: [{ t: T - 2, failed: 0, passed: 11, total: 11 }] }],
  ['tests-fail', { ...THINKING, tests: [{ t: T - 2, failed: 3, passed: 8, total: 11 }] }],
  ['error', { ...RUNNING, last_error: { t: T - 1, tool: 'Bash', detail: 'exit 1' } }],
  ['commit', { ...THINKING, git: { branch: 'main', commits: [{ hash: 'abc1234', t: T - 1, subject: 'Tidy the store', stat: '' }], dirty: '', untracked: 0 } }],
  ['web', { ...RUNNING, pending: { kind: 'tool', tool: 'WebFetch', cls: 'web', label: 'docs', since: T - 3 } }],
]

/** A 53-bit string hash (cyrb53), printed as hex. */
export function hashOf(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** Every case's encoded frame (frame 12), keyed `scene/fixture/rows/columns/bg` or `grid/fixture/columns`. */
export function nightCases(palette?: Palette): Record<string, string> {
  const out: Record<string, string> = {}
  for (const sc of OWN_SCENES) {
    const sizes = [...new Set([sc.rows.compact, sc.rows.standard, sc.rows.large])]
    for (const [name, s] of CASE_SUMMARIES) {
      const a = activity(s, T)
      for (const rows of sizes) {
        for (const columns of [40, 80, 144]) {
          for (const transparent of [true, false]) {
            const you = name === 'running' ? YOU_TOOL : name === 'thinking' ? YOU_THINKING : undefined
            const ctx = { s, a, frame: 12, t: T, columns, rows, transparent, you, orchestrator: 'claude-opus-5-5', palette, ambience: false }
            out[`${sc.id}/${name}/${rows}/${columns}/${transparent ? 't' : 'o'}`] = sc.draw(ctx)
          }
        }
      }
    }
  }
  const ids = Object.keys(MODULES)
  for (const [name, s] of CASE_SUMMARIES) {
    for (const columns of [60, 100, 144]) {
      const you = name === 'running' ? YOU_TOOL : name === 'thinking' ? YOU_THINKING : undefined
      // `view: 'dash'` is the retired view's value the golden frames were captured with (the switches
      // module prints it); the pane now passes the details fold, `fold` or `full`.
      const ctx: ModuleCtx = { s, a: activity(s, T), you, frame: 12, t: T, compare: 'claude-sonnet-5-5', ui: { view: 'dash', scene: 'office', size: 'large', source: 'worker' }, palette }
      const packed = packModules(ids, columns, ctx)
      const c = new HiCanvas(columns, Math.max(1, packed.rows))
      drawGrid(c, packed, ctx)
      out[`grid/${name}/${columns}`] = c.encode()
    }
  }
  return out
}

/** The hashes of `nightCases`, in key order. */
export function nightHashes(palette?: Palette): Record<string, string> {
  const cases = nightCases(palette)
  return Object.fromEntries(Object.keys(cases).sort().map(k => [k, hashOf(cases[k]!)]))
}

/** The hashes grouped per scene (or the grid) and fixture: one hash of each group's hashes. */
export function nightGroups(palette?: Palette): Record<string, string> {
  const each = nightHashes(palette)
  const groups: Record<string, string[]> = {}
  for (const k of Object.keys(each).sort()) (groups[k.split('/').slice(0, 2).join('/')] ??= []).push(each[k]!)
  return Object.fromEntries(Object.entries(groups).map(([g, hs]) => [g, hashOf(hs.join(','))]))
}
