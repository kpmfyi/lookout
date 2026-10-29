import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { ACHIEVEMENTS, achievementToast, earnedBy, finishedAt, newAchievements, readEarned, runKey } from '../hooks/achievements.ts'
import { FAILED, FINISHED, RUNNING } from './fixtures.ts'

/** Epoch seconds of a local wall-clock time, so the night-shift checks hold in any time zone. */
const local = (h: number, m = 0) => new Date(2026, 9, 28, h, m).getTime() / 1000
const NOON = local(12)

/** A finished run ending at local noon: FINISHED with only what a test overrides. */
const run = (over: Partial<Summary> = {}): Summary => ({ ...FINISHED, last_ts: NOON, ...over })
const none = new Set<string>()

test('the catalogue: eight ids, each with a title and a one-line description', () => {
  expect(ACHIEVEMENTS.map(a => a.id)).toEqual(['first-light', 'green', 'marathon', 'centurion', 'night-shift', 'clean-hands', 'frugal', 'handoff'])
  for (const a of ACHIEVEMENTS) {
    expect(a.title.length).toBeGreaterThan(0)
    expect(a.desc.includes('\n')).toBe(false)
  }
  expect(achievementToast('green')).toBe('🏆 green: tests passing, no errors')
})

test('a live run earns nothing until its result row', () => {
  expect(newAchievements(none, RUNNING, NOON)).toEqual([])
  expect(newAchievements(none, { ...FINISHED, exists: false }, NOON)).toEqual([])
})

test('the finished fixture: first light, green, clean hands and handoff', () => {
  // 80 tool calls, no denials, the last test run green, no errors, a handoff, 30 minutes, $1.71.
  expect(newAchievements(none, run(), NOON)).toEqual(['first-light', 'green', 'clean-hands', 'handoff'])
})

test('earned ids are never earned again', () => {
  expect(newAchievements(new Set(['first-light', 'green', 'clean-hands', 'handoff']), run(), NOON)).toEqual([])
  expect(newAchievements(new Set(['green']), run(), NOON)).toEqual(['first-light', 'clean-hands', 'handoff'])
})

test('green needs a passing last test run and no errors', () => {
  const ids = (s: Summary) => newAchievements(none, s, NOON)
  expect(ids(run({ errors: 1 }))).not.toContain('green')
  expect(ids(run({ tests: [] }))).not.toContain('green')
  expect(ids(run({ tests: [{ t: NOON - 10, failed: 1, passed: 23, total: 24 }] }))).not.toContain('green')
  expect(ids(run({ tests: [{ t: NOON - 10, failed: 0, passed: 0, total: 0 }] }))).not.toContain('green')
  // A failing run earlier does not matter; the last one does.
  expect(ids(run())).toContain('green')
})

test('marathon over an hour, centurion at 100 tool calls', () => {
  const r = FINISHED.result!
  expect(newAchievements(none, run({ result: { ...r, duration_ms: 3_600_000 } }), NOON)).not.toContain('marathon')
  expect(newAchievements(none, run({ result: { ...r, duration_ms: 3_600_001 } }), NOON)).toContain('marathon')
  expect(newAchievements(none, run({ tool_counts: [['Bash', 99]] }), NOON)).not.toContain('centurion')
  expect(newAchievements(none, run({ tool_counts: [['Bash', 60], ['Read', 40]] }), NOON)).toContain('centurion')
})

test('night shift: finished from midnight to before 5 am, local time', () => {
  for (const [h, m, yes] of [[0, 0, true], [2, 30, true], [4, 59, true], [5, 0, false], [23, 59, false], [12, 0, false]] as const) {
    expect(newAchievements(none, run({ last_ts: local(h, m) }), NOON).includes('night-shift')).toBe(yes)
  }
  // Without a last row the start plus the wall time, else now.
  const started = local(2)
  expect(finishedAt({ ...FINISHED, last_ts: null, started }, NOON)).toBe(started + 1800)
  expect(finishedAt({ ...FINISHED, last_ts: null, started: null }, local(3))).toBe(local(3))
})

test('clean hands: no denials in 20 or more tool calls', () => {
  expect(newAchievements(none, run({ tool_counts: [['Bash', 19]] }), NOON)).not.toContain('clean-hands')
  expect(newAchievements(none, run({ tool_counts: [['Bash', 20]] }), NOON)).toContain('clean-hands')
  expect(newAchievements(none, run({ denials: 1 }), NOON)).not.toContain('clean-hands')
  expect(newAchievements(none, { ...FAILED, last_ts: NOON }, NOON)).not.toContain('clean-hands')
})

test('frugal under $0.10 at the compare price; no estimate, no frugal', () => {
  const cost = FINISHED.cost!
  expect(newAchievements(none, run({ cost: { ...cost, usd: 0.09 } }), NOON)).toContain('frugal')
  expect(newAchievements(none, run({ cost: { ...cost, usd: 0.1 } }), NOON)).not.toContain('frugal')
  expect(newAchievements(none, run({ cost: null }), NOON)).not.toContain('frugal')
})

test('handoff needs the handoff file', () => {
  expect(newAchievements(none, run({ handoff: null }), NOON)).not.toContain('handoff')
})

test('the stored map is read defensively and matched to the run that earned it', () => {
  expect(readEarned(undefined)).toEqual({})
  expect(readEarned('junk')).toEqual({})
  expect(readEarned({ earned: [] })).toEqual({})
  const raw = { v: 1, earned: { green: { run: 'a', t: 1 }, bogus: { run: 'a', t: 1 }, frugal: { run: 2, t: 1 }, handoff: { run: 'b', t: 2 } } }
  const earned = readEarned(raw)
  expect(Object.keys(earned).sort()).toEqual(['green', 'handoff'])
  expect(earnedBy(earned, 'a').map(x => x.id)).toEqual(['green'])
  expect(runKey(FINISHED)).toBe(`${FINISHED.path}:${FINISHED.started}:${FINISHED.result!.duration_ms}`)
})
