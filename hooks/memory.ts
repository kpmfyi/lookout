// Run memory (docs/DESIGN.md 32): what a scene remembers of the run so far, so the picture
// accumulates instead of only showing "now". A pure function of the summary's histories (tests,
// tsc, commits, tool counts, errors) and the clock: nothing is kept between frames, so a replay
// (`--until`) and the golden frames stay honest. Every scene reads the same memory, so the
// two offices agree on what happened.
import type { Summary } from '../types'
import { classCounts, ctxLimitOf, elapsedOf } from './activity.ts'

/** How long after the red → green flip the scenes celebrate, in seconds. */
export const FLIP_SECS = 45
/** One mug per this many turns. */
export const TURNS_PER_MUG = 10
export const MAX_MUGS = 5
export const MAX_PAGES = 6
export const MAX_CRUMPLES = 9
/** Test runs remembered on the tally (the log reader keeps the newest 30). */
export const MAX_RUNS = 12

/** One test run on the tally. */
export type TestMark = { t: number | null; ok: boolean; failed: number; total: number }

export type RunMemory = {
  turns: number
  /** One per TURNS_PER_MUG full turns, at most MAX_MUGS. */
  mugs: number
  /** Edit, Write, MultiEdit and NotebookEdit calls. */
  edits: number
  /** The paper stack: 0 with no edits, else 1 + floor(log2(edits)), at most MAX_PAGES. */
  pages: number
  /** Distinct files edited (the summary lists at most 8). */
  files: number
  /** The newest MAX_RUNS test runs, oldest first. */
  runs: TestMark[]
  /** Failing tests at the newest run; 0 with no runs. */
  failing: number
  /** The most failing tests in any remembered run. */
  peakFailing: number
  /** Some remembered run failed. */
  everRed: boolean
  /** The newest run passed (and there is one). */
  green: boolean
  /**
   * The newest red → green change: the first passing run after a failing one. `age` is seconds
   * since it (never negative). null when tests never went from red to green.
   */
  flip: { t: number; age: number } | null
  /** Within FLIP_SECS of the flip: the scenes' moment to celebrate. */
  celebrating: boolean
  /** tsc errors at the newest type-check; null with none. */
  tscErrors: number | null
  /** Commits made in the worker's directory since the run started. */
  commits: number
  /** Errors plus denials: the paper balls in the bin, at most MAX_CRUMPLES. */
  crumples: number
  /** Context used against the window, 0..1; null when the limit is unknown. */
  ctxFrac: number | null
  /** Wall seconds of the run so far (the result's duration once finished). */
  elapsed: number
}

/** The run's memory at time `t`. */
export function memoryOf(s: Summary, t: number): RunMemory {
  const turns = s.turns ?? 0
  const edits = classCounts(s).edit
  const all: TestMark[] = (s.tests ?? []).map(r => ({ t: r.t, ok: r.failed === 0 && r.total > 0, failed: r.failed, total: r.total }))
  const runs = all.slice(-MAX_RUNS)
  const last = all.at(-1)
  let flipAt: number | null = null
  for (let i = 1; i < all.length; i++) {
    if (all[i]!.ok && !all[i - 1]!.ok) flipAt = all[i]!.t ?? s.last_ts ?? t
  }
  const flip = flipAt == null ? null : { t: flipAt, age: Math.max(0, t - flipAt) }
  const limit = ctxLimitOf(s)
  return {
    turns,
    mugs: Math.min(MAX_MUGS, Math.floor(turns / TURNS_PER_MUG)),
    edits,
    pages: edits <= 0 ? 0 : Math.min(MAX_PAGES, 1 + Math.floor(Math.log2(edits))),
    files: (s.files ?? []).length,
    runs,
    failing: last ? last.failed : 0,
    peakFailing: runs.reduce((m, r) => Math.max(m, r.failed), 0),
    everRed: runs.some(r => !r.ok),
    green: last != null && last.ok,
    flip,
    celebrating: flip != null && flip.age < FLIP_SECS,
    tscErrors: s.tsc?.length ? s.tsc.at(-1)!.errors : null,
    commits: s.git?.commits.length ?? 0,
    crumples: Math.min(MAX_CRUMPLES, (s.errors ?? 0) + (s.denials ?? 0)),
    ctxFrac: limit && s.ctx != null ? Math.min(1, s.ctx / limit) : null,
    elapsed: s.exists ? elapsedOf(s, t) : 0,
  }
}
