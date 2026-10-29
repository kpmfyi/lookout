import { expect, test } from 'claude-code/testing'

import { statusText } from '../hooks/status.ts'
import { ALL, FAILED, FINISHED, NOLOG, RUNNING, T } from './fixtures.ts'
import { SESSION_NOFILE, SESSION_RUNNING, SESSION_WAITING } from './session-fixture.ts'

const PATH = 'logs/worker-current.jsonl'

test('brief for a running worker: the header, the tool it runs, the context share', () => {
  const text = statusText(RUNNING, T, 'brief', { path: PATH })
  const lines = text.split('\n')
  expect(lines[0]).toBe(`lookout · worker · ${RUNNING.model} · following ${PATH}`)
  const state = lines.find(l => l.startsWith('state: '))
  expect(state).toContain('running Bash "npm test -- todo" for 4s')
  expect(state).toContain('turn 18')
  expect(state).toContain('ctx 54.2k/131.1k (41%)')
  expect(state).toContain('21m00s elapsed')
  expect(text).toContain('tests: last run 10/11 passed, 1 failing (1m40s ago) · tsc clean · errors 1 · denials 0')
  expect(text).toContain('last error: Bash (1m40s ago): "npm test: exit code 1"')
  expect(text).toContain('git: fix/empty-title · 2 commits since start · 2 files dirty · 1 untracked')
  expect(text).toContain('server: mlx-serve 30 tok/s decode · 805 tok/s prefill')
  expect(text).toContain('cost: ≈ $0.47 at claude-sonnet-5-5 (estimate)')
  expect(text).toContain('handoff: "Fix empty-title validation in the todo store" · since 21m40s')
  // Brief holds no timeline and no command output.
  expect(text).not.toContain('timeline')
  expect(text).not.toContain('RUN  v2.1.0')
})

test('brief stays within 25 lines for every fixture', () => {
  for (const s of Object.values(ALL)) {
    expect(statusText(s, T, 'brief', { path: PATH }).split('\n').length <= 25).toBe(true)
  }
})

test('a finished run has the result line', () => {
  const text = statusText(FINISHED, T, 'brief', { path: PATH })
  expect(text).toContain('state: finished · success')
  expect(text).toContain('result: success · 42 turns · wall 30m00s · api 18m40s · real $1.86')
  expect(statusText(FAILED, T, 'brief', { path: PATH })).toContain('result: error_max_turns · 60 turns')
})

test('compare off: no cost line', () => {
  const text = statusText({ ...RUNNING, cost: null }, T, 'brief', { path: PATH })
  expect(text).not.toContain('cost:')
  expect(text).not.toContain('$')
})

test('lines without data are left out', () => {
  const text = statusText({ ...RUNNING, git: null, server: null, handoff: null, last_error: null }, T, 'brief', { path: PATH })
  for (const head of ['git:', 'server:', 'handoff:', 'last error:']) expect(text).not.toContain(head)
})

test('a missing log says so', () => {
  const text = statusText(NOLOG, T, 'brief', { path: PATH })
  expect(text.split('\n')[0]).toBe(`lookout · worker · following ${PATH}`)
  expect(text).toContain(`log missing: ${NOLOG.path} does not exist yet`)
  expect(statusText(null, T, 'brief', { path: PATH })).toContain('no summary yet')
})

test('full adds the timeline, the last edit header and the command output tail', () => {
  const text = statusText(RUNNING, T, 'full', { path: PATH })
  expect(text).toContain('timeline (last 9):')
  expect(text).toMatch(/ago {2}✖ Bash npm test \(10s\) · error: exit code 1/)
  expect(text).toMatch(/ago {2}… Bash npm test -- todo/)
  expect(text).toContain('last edit: src/todo.ts (3m30s ago) · @@ -12,4 +12,5 @@')
  expect(text).toContain('last command: $ npm test -- todo · running (4s ago)')
  expect(text).toContain('   ✓ tests/todo.test.ts (11 tests)')

  const failed = statusText(FAILED, T, 'full', { path: PATH })
  expect(failed).toContain('  … 30 lines above')
  expect(failed).toContain('   Tests  2 failed | 14 passed (16)')
  // The tail keeps the last 12 lines of a long output.
  const long = { ...RUNNING, last_bash: { ...RUNNING.last_bash!, out: Array.from({ length: 20 }, (_, i) => `line ${i}`), more: 0 } }
  const tail = statusText(long, T, 'full', { path: PATH })
  expect(tail).toContain('  … 8 lines above')
  expect(tail).toContain('  line 8')
  expect(tail).not.toContain('  line 7\n')
  expect(tail).toContain('  line 19')
})

test('following this session: claude, whose turn it is, and the latest prompt; nothing says worker', () => {
  const text = statusText(SESSION_WAITING, T, 'brief', { path: 'this session', session: true })
  const lines = text.split('\n')
  expect(lines[0]).toBe('lookout · claude · claude-opus-5-5 · following this session')
  expect(lines[1]).toBe('state: your turn · the last turn ended 1m00s ago · turn 9 · ctx 21.4k/1.00M (2%) · 15m00s elapsed')
  expect(text).toContain('prompt: "Now add a --due flag to the CLI\'s add command." (2m10s ago)')
  expect(text).toContain('cost: ≈ $0.38 at claude-opus-5-5 (estimate)')
  for (const gone of ['worker', 'handoff:', 'server:', 'result:']) expect(text).not.toContain(gone)
  // Mid-turn the usual states.
  expect(statusText(SESSION_RUNNING, T, 'brief', { path: 'this session', session: true })).toContain('state: running Bash "Typecheck the project" for 4s')
  // Before the first prompt there is no file yet, and that is no fault.
  const none = statusText(SESSION_NOFILE, T, 'brief', { path: 'this session', session: true })
  expect(none.split('\n')[0]).toBe('lookout · claude · following this session')
  expect(none).toContain("no transcript yet: ")
  expect(none).toContain("starts with the session's first prompt")
  expect(statusText(null, T, 'brief', { path: 'this session', session: true }).split('\n')[0]).toBe('lookout · claude · following this session')
})
