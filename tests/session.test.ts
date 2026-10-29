// This session as the followed source (docs/DESIGN.md 36): the activity of a session transcript's
// summary. The pane, the log reader and the texts have their own tests (pane, reader, status,
// notify, modules).
import { expect, test } from 'claude-code/testing'

import { activity, isSession, modelLabel, workerName } from '../hooks/activity.ts'
import { RUNNING, T } from './fixtures.ts'
import { SESSION_NOFILE, SESSION_RUNNING, SESSION_WAITING } from './session-fixture.ts'

test('a session between turns waits on its person: never stalled, never done', () => {
  const a = activity(SESSION_WAITING, T, 180)
  expect(a.state).toBe('waiting')
  expect(a.text).toBe('your turn')
  expect(a.secs).toBe(60)
  // An hour later, still the person's move (a worker this quiet would be stalled).
  const later = activity(SESSION_WAITING, T + 3600, 180)
  expect(later.state).toBe('waiting')
  expect(activity({ ...SESSION_WAITING, pending: { kind: 'user', since: null } }, T).secs).toBe(0)
})

test('mid-turn a session has the usual states', () => {
  expect(activity(SESSION_RUNNING, T).state).toBe('tool')
  const thinking = activity({ ...SESSION_RUNNING, pending: { kind: 'model', since: T - 5 } }, T)
  expect(thinking.state).toBe('thinking')
  // A turn that stops moving mid-way is stalled, as a worker's would be.
  expect(activity({ ...SESSION_RUNNING, mtime: T - 400, pending: { kind: 'model', since: T - 400 } }, T, 180).state).toBe('stalled')
})

test("before the first prompt a session waits for it, not for a path", () => {
  const a = activity(SESSION_NOFILE, T)
  expect(a.state).toBe('nolog')
  expect(a.text).toBe('waiting for your first prompt')
})

test('the desk is claude in a session and the worker elsewhere', () => {
  expect(isSession(SESSION_WAITING)).toBe(true)
  expect(isSession(RUNNING)).toBe(false)
  expect(workerName(SESSION_WAITING)).toBe('claude')
  expect(workerName(RUNNING)).toBe('worker')
  expect(modelLabel({ ...SESSION_WAITING, model: null })).toBe('claude')
  expect(modelLabel({ ...RUNNING, model: null })).toBe('worker')
})
