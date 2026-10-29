// Run memory (docs/DESIGN.md 32): memoryOf is a pure function of the summary's histories and the
// clock, so the same summary at the same time remembers the same things.
import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { FLIP_SECS, MAX_CRUMPLES, MAX_MUGS, MAX_PAGES, MAX_RUNS, memoryOf } from '../hooks/memory.ts'
import { FINISHED, NOLOG, RUNNING, T } from './fixtures.ts'

type Run = NonNullable<Summary['tests']>[number]
const pass = (t: number): Run => ({ t, failed: 0, passed: 12, total: 12 })
const fail = (t: number, failed = 2): Run => ({ t, failed, passed: 12 - failed, total: 12 })

test('memory: one mug per 10 turns, at most five', () => {
  expect(memoryOf({ ...RUNNING, turns: 9 }, T).mugs).toBe(0)
  expect(memoryOf({ ...RUNNING, turns: 10 }, T).mugs).toBe(1)
  expect(memoryOf(RUNNING, T)).toMatchObject({ turns: 18, mugs: 1 })
  expect(memoryOf({ ...RUNNING, turns: 49 }, T).mugs).toBe(4)
  expect(memoryOf({ ...RUNNING, turns: 400 }, T).mugs).toBe(MAX_MUGS)
})

test('memory: the paper stack grows by levels of edits, none without edits, at most six sheets', () => {
  const edits = (n: number) => memoryOf({ ...RUNNING, tool_counts: n ? [['Edit', n]] : [['Read', 3]] }, T)
  expect(edits(0)).toMatchObject({ edits: 0, pages: 0 })
  expect(edits(1).pages).toBe(1)
  expect(edits(2).pages).toBe(2)
  expect(edits(3).pages).toBe(2)
  expect(edits(4).pages).toBe(3)
  expect(edits(10_000).pages).toBe(MAX_PAGES)
  // Edit, Write, MultiEdit and NotebookEdit all count: RUNNING has 6 edits and 1 write.
  expect(memoryOf(RUNNING, T)).toMatchObject({ edits: 7, pages: 3, files: 3 })
})

test('memory: the tally keeps the newest runs, oldest first; failing now and at the worst', () => {
  const tests = [pass(T - 900), fail(T - 600, 3), fail(T - 300, 1)]
  const m = memoryOf({ ...RUNNING, tests }, T)
  expect(m.runs.map(r => r.ok)).toEqual([true, false, false])
  expect(m).toMatchObject({ failing: 1, peakFailing: 3, everRed: true, green: false, flip: null, celebrating: false })
  const many = Array.from({ length: 30 }, (_, i) => pass(T - 3000 + i * 10))
  const kept = memoryOf({ ...RUNNING, tests: many }, T).runs
  expect(kept.length).toBe(MAX_RUNS)
  expect(kept[0]!.t).toBe(many[30 - MAX_RUNS]!.t)
  // A run with no tests at all is not a pass.
  expect(memoryOf({ ...RUNNING, tests: [{ t: T - 5, failed: 0, passed: 0, total: 0 }] }, T)).toMatchObject({ green: false, everRed: true })
})

test('memory: the newest red → green flip, celebrated for FLIP_SECS after it', () => {
  const tests = [fail(T - 400), pass(T - 300), fail(T - 200), pass(T - 30)]
  const at = (t: number) => memoryOf({ ...RUNNING, tests }, t)
  expect(at(T).flip).toEqual({ t: T - 30, age: 30 })
  expect(at(T)).toMatchObject({ green: true, failing: 0, peakFailing: 2, everRed: true, celebrating: true })
  expect(at(T - 30 + FLIP_SECS - 1).celebrating).toBe(true)
  expect(at(T - 30 + FLIP_SECS).celebrating).toBe(false)
  // The age never goes negative (a clock behind the newest run).
  expect(at(T - 60).flip!.age).toBe(0)
  // Green from the start is no flip; neither is red → red.
  expect(memoryOf({ ...RUNNING, tests: [pass(T - 60), pass(T - 10)] }, T).flip).toBe(null)
  expect(memoryOf({ ...RUNNING, tests: [fail(T - 60), fail(T - 10)] }, T).flip).toBe(null)
  // A flip without a timestamp sits at the log's newest row.
  expect(memoryOf({ ...RUNNING, tests: [fail(T - 60), { ...pass(0), t: null }] }, T).flip).toEqual({ t: RUNNING.last_ts!, age: T - RUNNING.last_ts! })
})

test('memory: errors plus denials crumple paper, nine balls at most', () => {
  expect(memoryOf({ ...RUNNING, errors: 0, denials: 0 }, T).crumples).toBe(0)
  expect(memoryOf({ ...RUNNING, errors: 2, denials: 1 }, T).crumples).toBe(3)
  expect(memoryOf({ ...RUNNING, errors: 40, denials: 7 }, T).crumples).toBe(MAX_CRUMPLES)
})

test('memory: the context fraction needs a window, and stops at one', () => {
  expect(Math.abs(memoryOf(RUNNING, T).ctxFrac! - 54_200 / 131_072) < 1e-9).toBe(true)
  // A local model with no server: the window is unknown.
  expect(memoryOf({ ...RUNNING, server: null }, T).ctxFrac).toBe(null)
  expect(memoryOf({ ...RUNNING, ctx: undefined }, T).ctxFrac).toBe(null)
  expect(memoryOf({ ...RUNNING, ctx: 500_000 }, T).ctxFrac).toBe(1)
})

test('memory: commits, tsc and the elapsed; a finished run counts its result duration', () => {
  const m = memoryOf(RUNNING, T)
  expect(m.commits).toBe(RUNNING.git?.commits.length ?? 0)
  expect(m.elapsed).toBe(1260)
  expect(memoryOf({ ...RUNNING, tsc: [{ t: T - 9, errors: 4 }, { t: T - 2, errors: 0 }] }, T).tscErrors).toBe(0)
  expect(memoryOf({ ...RUNNING, tsc: [] }, T).tscErrors).toBe(null)
  expect(memoryOf(FINISHED, T + 999).elapsed).toBe(FINISHED.result!.duration_ms / 1000)
})

test('memory: an empty summary remembers nothing', () => {
  expect(memoryOf(NOLOG, T)).toEqual({
    turns: 0,
    mugs: 0,
    edits: 0,
    pages: 0,
    files: 0,
    runs: [],
    failing: 0,
    peakFailing: 0,
    everRed: false,
    green: false,
    flip: null,
    celebrating: false,
    tscErrors: null,
    commits: 0,
    crumples: 0,
    ctxFrac: null,
    elapsed: 0,
  })
})

test('memory: pure, the same summary and clock give the same memory', () => {
  expect(JSON.stringify(memoryOf(RUNNING, T))).toBe(JSON.stringify(memoryOf(RUNNING, T)))
})
