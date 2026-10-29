import { expect, test } from 'claude-code/testing'

import type { ToolClass } from '../types'
import { activity, isDemo, modelLabel } from '../hooks/activity.ts'
import { DEMO_LOOP_SECS, demoPlain, demoSummary } from '../hooks/demo.ts'
import { FLIP_SECS, memoryOf } from '../hooks/memory.ts'
import { SCENES } from '../hooks/scenes/index.ts'
import { EXPLAINED_MAX, parseExplained, runsText } from '../hooks/thought.ts'
import { T } from './fixtures.ts'

const STEP = 0.5
const WIDTHS = [40, 80, 144]

/** One loop of the script at 0.5 s steps, starting `loops` loops in, on the fixtures' clock. */
function walk(loops = 0) {
  const out = []
  for (let i = 0; i < DEMO_LOOP_SECS / STEP; i++) {
    const elapsed = loops * DEMO_LOOP_SECS + i * STEP
    const t = T + elapsed
    const s = demoSummary(elapsed, t)
    out.push({ elapsed, t, s, a: activity(s, t) })
  }
  return out
}

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

function textOf(cells: string): string {
  const w = decode(cells)
  let s = ''
  for (let i = 0; i < w.length; i += 3) s += String.fromCodePoint(w[i]!)
  return s
}

test('demo: one loop visits every state, every tool class and every pulse', () => {
  const states = new Set<string>()
  const classes = new Set<ToolClass>()
  const pulses = new Set<string>()
  let doneOk = false
  let doneFail = false
  for (const { a } of walk()) {
    states.add(a.state)
    if (a.state === 'tool' && a.cls) classes.add(a.cls)
    if (a.state === 'done') {
      if (a.ok) doneOk = true
      else doneFail = true
    }
    if (a.pulse) pulses.add(a.pulse.kind)
  }
  for (const st of ['thinking', 'prefill', 'tool', 'stalled', 'done']) expect(states.has(st)).toBe(true)
  for (const cls of ['shell', 'edit', 'search', 'read', 'web', 'agent'] as ToolClass[]) expect(classes.has(cls)).toBe(true)
  expect(doneOk).toBe(true)
  expect(doneFail).toBe(true)
  for (const kind of ['tests-pass', 'tests-fail', 'error', 'denied', 'commit']) expect(pulses.has(kind)).toBe(true)
})

test('demo: the script lands where docs/DESIGN.md section 12 puts it', () => {
  const at = (sec: number, loops = 0) => {
    const elapsed = loops * DEMO_LOOP_SECS + sec
    const t = T + elapsed
    const s = demoSummary(elapsed, t)
    return { s, a: activity(s, t) }
  }
  expect(at(0).a.state).toBe('thinking')
  expect(at(5.5).a.intensity > at(0).a.intensity).toBe(true)
  expect(at(7).a.state).toBe('prefill')
  expect(at(10).a).toMatchObject({ state: 'tool', tool: 'Bash', cls: 'shell' })
  expect(at(15).a.pulse?.kind).toBe('tests-pass')
  expect(at(15).s.tests?.at(-1)).toMatchObject({ failed: 0, passed: 12, total: 12 })
  expect(at(22).s.last_diff?.path).toBe('src/todo.ts')
  expect(at(38).a.pulse?.kind).toBe('commit')
  expect(at(38).s.git?.commits[0]?.subject).toBe('Add due dates to todos')
  expect(at(51).a.pulse?.kind).toBe('tests-fail')
  expect(at(51).s.tests?.at(-1)).toMatchObject({ failed: 2, passed: 10, total: 12 })
  expect(at(55).a.pulse?.kind).toBe('error')
  expect(at(57).a.pulse?.kind).toBe('denied')
  expect(at(57).s.denials).toBe(1)
  // The tests run again and pass: the red → green flip (docs/DESIGN.md 32).
  expect(at(58).a).toMatchObject({ state: 'tool', tool: 'Bash', cls: 'shell' })
  expect(at(58).s.last_bash).toMatchObject({ cmd: 'npm test', status: 'running' })
  expect(at(60).a.pulse?.kind).toBe('tests-pass')
  expect(at(60).s.tests?.at(-1)).toMatchObject({ failed: 0, passed: 12, total: 12 })
  expect(at(60).s.last_bash).toMatchObject({ cmd: 'npm test', status: 'ok' })
  expect(at(60).s.last_bash?.out.at(-1)).toContain('12 passed')
  expect(at(62)).toMatchObject({ a: { state: 'stalled' }, s: { stalled: true, pending: { kind: 'model' } } })
  expect(at(62).s.mtime).toBe(at(62).s.started! + 60)
  expect(at(66)).toMatchObject({ a: { state: 'done', ok: true }, s: { pending: { kind: 'done' }, server: null } })
  expect(at(70).s.result?.subtype).toBe('error_max_turns')
  expect(at(70).s.cost).toBeTruthy()
  // A later loop starts over, with the turns and the context kept.
  expect(at(0, 2).a.state).toBe('thinking')
  expect(at(0, 2).s.turns! > at(71).s.turns!).toBe(true)
})

test('demo: every loop flips red → green at 60 s and celebrates into its success ending', () => {
  for (const loops of [0, 1, 3]) {
    const mem = (sec: number) => {
      const elapsed = loops * DEMO_LOOP_SECS + sec
      return memoryOf(demoSummary(elapsed, T + elapsed), T + elapsed)
    }
    expect(mem(52)).toMatchObject({ failing: 2, everRed: true, green: false })
    // Before the first loop's flip there is none; later loops remember the previous loop's.
    if (loops === 0) expect(mem(59).flip).toBe(null)
    for (const sec of [60, 61, 66, 71.5]) {
      const m = mem(sec)
      expect(m.flip).toBeTruthy()
      expect(m.flip!.age).toBe(sec - 60)
      expect(m.green).toBe(true)
      expect(m.failing).toBe(0)
      expect(m.celebrating).toBe(sec - 60 < FLIP_SECS)
    }
    // The success ending (65–69 s) falls inside the celebration.
    expect(mem(66).celebrating).toBe(true)
  }
})

test('demo: turns and context only grow within a loop, and context stays under the window', () => {
  for (const loops of [0, 1, 7]) {
    let turns = -1
    let ctx = -1
    for (const { s } of walk(loops)) {
      expect(s.turns! >= turns).toBe(true)
      expect(s.ctx! >= ctx).toBe(true)
      expect(s.ctx! <= 120_000).toBe(true)
      expect(s.ctx_series!.length).toBeGreaterThan(0)
      turns = s.turns!
      ctx = s.ctx!
    }
  }
  expect(demoSummary(10 * 3600, T).ctx! <= 120_000).toBe(true)
})

test('demo: pure, and tagged as the demo source', () => {
  expect(JSON.stringify(demoSummary(33.5, T))).toBe(JSON.stringify(demoSummary(33.5, T)))
  const s = demoSummary(3, T)
  expect(s.source.name).toBe('demo')
  expect(isDemo(s)).toBe(true)
  expect(modelLabel(s)).toBe('local/qwen-coder-32b-q4 · demo')
  expect(s.handoff?.text).toBe('Add due dates to todo items, with tests')
  expect(s.handoff?.since).toBe(T - 3)
  expect(modelLabel({ ...s, source: { name: 'worker', path: 'x' } })).toBe('local/qwen-coder-32b-q4')
})

for (const sc of SCENES) {
  test(`demo: ${sc.id} draws every sampled second at 40, 80 and 144 columns`, () => {
    for (const { elapsed, t, s, a } of walk()) {
      for (const columns of WIDTHS) {
        let cells = ''
        try {
          cells = sc.draw({ s, a, frame: Math.round(elapsed * 8), t, columns, rows: sc.rows.standard })
        } catch (err) {
          throw new Error(`${sc.id} at ${elapsed}s (${a.state}), ${columns} columns: ${String(err)}`)
        }
        expect(atob(cells).length).toBe(columns * sc.rows.standard * 3 * 4)
      }
    }
  })
}

test('demo: the scenes that print the model print the demo tag', () => {
  const s = demoSummary(3, T)
  const a = activity(s, T)
  for (const id of ['office', 'office-hd']) {
    const sc = SCENES.find(x => x.id === id)!
    expect(textOf(sc.draw({ s, a, frame: 0, t: T, columns: 144, rows: sc.rows.standard }))).toContain(' demo')
    const real = { ...s, source: { name: 'worker', path: 'x' } }
    expect(textOf(sc.draw({ s: real, a, frame: 0, t: T, columns: 144, rows: sc.rows.standard }))).not.toContain(' demo')
  }
})

test('demo: it carries plain words for every thinking block it shows, and they parse', () => {
  const seen = new Set<string>()
  for (let e = 0; e < DEMO_LOOP_SECS; e += 0.5) {
    const s = demoSummary(e, T + e)
    if (!s.thinking) continue
    seen.add(s.thinking)
    const words = demoPlain(s.thinking)
    expect(words).toBeTruthy()
    const runs = parseExplained(words!)
    expect(runsText(runs)).toMatch(/^The worker /)
    expect(runsText(runs).length).toBeLessThanOrEqual(EXPLAINED_MAX)
    // Deterministic: the same text, the same words.
    expect(demoPlain(s.thinking)).toBe(words)
  }
  expect(seen.size).toBe(4)
  expect(demoPlain('some other text')).toBe(null)
})
