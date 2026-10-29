import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { diffEvents, resetNotify, statusLine, takeNew } from '../hooks/notify.ts'
import { FAILED, FINISHED, RUNNING, T } from './fixtures.ts'
import { SESSION_RUNNING, SESSION_WAITING } from './session-fixture.ts'

const LIVE: Summary = { ...RUNNING, result: null, stalled: false }

test('a first poll (no previous summary) yields nothing', () => {
  expect(diffEvents(null, FAILED, T)).toEqual([])
  expect(diffEvents(null, { ...LIVE, stalled: true }, T)).toEqual([])
})

test('a new failing test run yields one event, and not again', () => {
  resetNotify('a')
  const next: Summary = { ...LIVE, tests: [...LIVE.tests!, { t: T - 1, failed: 2, passed: 10, total: 12 }] }
  const evs = diffEvents(LIVE, next, T)
  expect(evs.length).toBe(1)
  expect(evs[0]!.kind).toBe('tests-fail')
  expect(evs[0]!.text).toBe('✖ worker: 2 of 12 tests failing')
  expect(takeNew(evs).length).toBe(1)
  // The same run seen again: no new diff, and the key is not emitted twice.
  expect(diffEvents(next, next, T + 2)).toEqual([])
  expect(takeNew(diffEvents(LIVE, next, T + 2))).toEqual([])
  // A passing run raises nothing.
  const pass: Summary = { ...next, tests: [...next.tests!, { t: T, failed: 0, passed: 12, total: 12 }] }
  expect(diffEvents(next, pass, T + 3)).toEqual([])
})

test('stalling then resuming yields stalled, then resumed, once each', () => {
  resetNotify('b')
  const stalled: Summary = { ...LIVE, stalled: true, mtime: T - 180, pending: { kind: 'model', since: T - 200 } }
  const s1 = takeNew(diffEvents(LIVE, stalled, T))
  expect(s1.map(e => e.kind)).toEqual(['stalled'])
  expect(s1[0]!.text).toBe('⏸ worker: no log movement for 3m')
  expect(takeNew(diffEvents(stalled, stalled, T + 2))).toEqual([])
  const back: Summary = { ...LIVE, stalled: false, mtime: T + 5 }
  const s2 = takeNew(diffEvents(stalled, back, T + 6))
  expect(s2.map(e => e.kind)).toEqual(['resumed'])
  expect(s2[0]!.text).toBe('▶ worker resumed')
  expect(takeNew(diffEvents(stalled, back, T + 8))).toEqual([])
})

test('finishing yields one event', () => {
  resetNotify('c')
  const before: Summary = { ...FINISHED, result: null }
  const evs = takeNew(diffEvents(before, FINISHED, T))
  expect(evs.length).toBe(1)
  expect(evs[0]!.text).toBe('✓ api finished: success · 42 turns · 30m')
  expect(takeNew(diffEvents(before, FINISHED, T + 2))).toEqual([])
  expect(diffEvents(FINISHED, FINISHED, T + 4)).toEqual([])
  const failed = diffEvents({ ...FAILED, result: null }, FAILED, T)
  expect(failed.find(e => e.kind === 'finished')?.text).toBe('✖ worker finished: error_max_turns')
})

test('a reset forgets what was emitted', () => {
  resetNotify('d')
  const next: Summary = { ...LIVE, tests: [...LIVE.tests!, { t: T - 1, failed: 1, passed: 11, total: 12 }] }
  expect(takeNew(diffEvents(LIVE, next, T)).length).toBe(1)
  resetNotify('d')
  expect(takeNew(diffEvents(LIVE, next, T)).length).toBe(1)
})

test('the status line names the running tool and the context share', () => {
  const line = statusLine(RUNNING, T)
  expect(line).toContain('Bash npm test -- todo')
  expect(line).toContain('41%')
  expect(line!.startsWith('lookout · ')).toBe(true)
  expect(statusLine(null, T)).toBe(undefined)
  expect(statusLine({ ...RUNNING, exists: false }, T)).toBe(undefined)
  expect(statusLine(FINISHED, T)).toContain('finished · success')
})

test('a session is claude, its end is the person\'s move: no finished toast, the status line says your turn', () => {
  resetNotify('session')
  const failing: Summary = { ...SESSION_RUNNING, tests: [...SESSION_RUNNING.tests!, { t: T - 1, failed: 2, passed: 10, total: 12 }] }
  expect(diffEvents(SESSION_RUNNING, failing, T).map(e => e.text)).toEqual(['✖ claude: 2 of 12 tests failing'])
  // Even a result row (a transcript never has one) raises no finish for a session.
  const ended: Summary = { ...SESSION_WAITING, result: { ...FINISHED.result! } }
  expect(diffEvents(SESSION_WAITING, ended, T).filter(e => e.kind === 'finished')).toEqual([])
  expect(statusLine(SESSION_WAITING, T)).toBe('lookout · your turn · ctx 2%')
  expect(statusLine(SESSION_RUNNING, T)).toBe('lookout · Bash Typecheck the project · 4s · ctx 2%')
})
