// Demo mode (docs/DESIGN.md section 12): a scripted, looping synthetic run, so every scene can show
// all of its states and pulses with no worker at all. Pure: the same (elapsed, now) gives the same
// Summary. A 72-second script loops; turns, context and cost keep growing across loops (context
// capped below the window). Every time in the summary sits on the caller's clock: the run started
// at `now − elapsed`, and each scripted moment of the current loop is that loop's start plus its
// script second, so activity() computes states, durations and pulses as it would for a real log.
// The tests go red at 51 s and green again at 60 s, so every loop holds a red → green flip
// (docs/DESIGN.md 32) before its success ending.
// Fictional throughout: the project, model, commits and numbers are made up.
import type { Summary, WatchEvent } from '../types'
import { toolClass } from './activity.ts'
import { hash } from './canvas.ts'

export const DEMO = 'demo'
export const DEMO_LOOP_SECS = 72

const MODEL = 'local/qwen-coder-32b-q4'
const CWD = '~/work/acme-todo'
const TASK = 'Add due dates to todo items, with tests'
const COMPARE = 'claude-sonnet-5-5'
const PRICES = { in: 3, out: 15, cache_write: 3.75, cache_read: 0.3 }
const COST_BASIS = 'estimate: context growth priced as cache writes, the rest as cache reads, output from characters/4'
const CTX_START = 6_000
const CTX_CAP = 120_000
const CTX_LIMIT = 131_072
const PREFILL_NEW = 24_000

type Kind = 'think' | 'prefill' | 'tool' | 'stalled' | 'ok' | 'fail'
type Seg = {
  at: number
  end: number
  kind: Kind
  tool?: string
  label?: string
  /** How the tool call ends. */
  status?: 'ok' | 'error' | 'denied'
  detail?: string
  /** The thinking block or message that opens the segment. */
  think?: string
  text?: string
  /** The thinking in plain words, marked as the small model marks them (docs/DESIGN.md 40.2). */
  plain?: string
}

/** The script: one loop, in script seconds. Every segment up to the stall starts a turn. */
const SCRIPT: Seg[] = [
  { at: 0, end: 6, kind: 'think', think: 'Plan: a dueDate field on Todo, parse it from the input, sort the list by it. Check the existing tests first.', plain: 'The worker is planning how to give each to-do a due date. It will check the tests that already exist before it changes anything.', text: 'Starting on due dates: the model first, then parsing and sorting.' },
  { at: 6, end: 9, kind: 'prefill' },
  { at: 9, end: 15, kind: 'tool', tool: 'Bash', label: 'npm test -- todo', status: 'ok' },
  { at: 15, end: 21, kind: 'think', think: 'The todo tests are green. Add an optional dueDate to Todo and keep old rows valid.', plain: 'The worker sees that [+the existing tests pass]. Next it adds a due date to each to-do, making sure old to-dos without one still work.' },
  { at: 21, end: 26, kind: 'tool', tool: 'Edit', label: 'src/todo.ts', status: 'ok' },
  { at: 26, end: 29, kind: 'tool', tool: 'Grep', label: 'dueDate', status: 'ok' },
  { at: 29, end: 33, kind: 'tool', tool: 'Read', label: 'src/store.ts', status: 'ok' },
  { at: 33, end: 38, kind: 'think', think: 'The store sorts by created time. Sort by dueDate instead, with undated todos last.', plain: 'The worker found that the list is sorted by when each to-do was made. It will sort by due date instead, with the to-dos that have none at the end.', text: 'Committing the model change, then the parser.' },
  { at: 38, end: 43, kind: 'tool', tool: 'WebFetch', label: 'date-fns docs', status: 'ok' },
  { at: 43, end: 47, kind: 'tool', tool: 'Task', label: 'review the diff', status: 'ok' },
  { at: 47, end: 51, kind: 'tool', tool: 'Bash', label: 'npm test', status: 'error', detail: '2 tests failed' },
  { at: 51, end: 55, kind: 'think', think: 'Two parse cases fail: "tomorrow" and "next week" are read as UTC midnight. Use the local day.', plain: 'The worker found that [!two date tests fail]: "tomorrow" and "next week" land on the wrong day. It will read dates in local time instead.' },
  { at: 55, end: 55.5, kind: 'tool', tool: 'Bash', label: 'npm run lint', status: 'error', detail: 'exit code 1' },
  { at: 55.5, end: 57, kind: 'tool', tool: 'Bash', label: 'git push --force', status: 'denied', detail: 'denied by the permission rules' },
  { at: 57, end: 60, kind: 'tool', tool: 'Bash', label: 'npm test', status: 'ok' },
  { at: 60, end: 65, kind: 'stalled' },
  { at: 65, end: 69, kind: 'ok', text: 'Done: due dates are parsed, stored and sorted; 12 tests pass.' },
  { at: 69, end: 72, kind: 'fail', text: 'Stopping: hit the turn limit before the overdue view.' },
]
const PLAIN = new Map(SCRIPT.filter(sg => sg.think && sg.plain).map(sg => [sg.think!, sg.plain!]))

/**
 * The demo's canned plain words for one of its thinking blocks (docs/DESIGN.md 40.2), marked as the
 * small model marks them; null for any other text. The demo asks no model.
 */
export function demoPlain(thinking: string): string | null {
  return PLAIN.get(thinking.trim()) ?? null
}

const TURN_SEGS = SCRIPT.filter(sg => sg.kind !== 'ok' && sg.kind !== 'fail')
const TURNS_PER_LOOP = TURN_SEGS.length

const TESTS_PASS = 15
const TESTS_FAIL = 51
const COMMIT_AT = 38
const ERROR_AT = 55
const PUSH_AT = 55.5
const DENIED_AT = 57 // the push is refused; the tests run again
const TESTS_GREEN = 60 // and pass: the flip
const SUBJECTS = ['Add due dates to todos', 'Sort todos by due date', 'Parse relative due dates', 'Show overdue todos first']

const DIFF =
  '@@ -3,6 +3,7 @@ export type Todo = {\n   id: string\n   title: string\n   done: boolean\n+  dueDate?: string | null\n   created: number\n }\n@@ -21,3 +22,6 @@\n export function makeTodo(title: string): Todo {\n-  return { id: newId(), title, done: false, created: Date.now() }\n+  return { id: newId(), title, done: false, dueDate: null, created: Date.now() }\n }'

// ── Per-turn numbers, by global turn index (0, 1, 2, … across loops).

function ctxInc(n: number): number {
  return Math.round(2_500 + 1_500 * hash(n + 1))
}

function outOf(n: number): number {
  return Math.round(120 + 480 * hash(n + 501))
}

function decodeOf(n: number): number {
  return Math.round((18 + 28 * hash(n + 1301)) * 10) / 10
}

function prefillOf(n: number): number {
  return Math.round(700 + 250 * hash(n + 907))
}

type Totals = { ctx: number[]; out: number; cost: number; cacheRead: number }

/** Context after each of the first `turns` turns (the last 60), total output and the cost estimate. */
function totals(turns: number): Totals {
  const series: number[] = []
  let ctx = CTX_START
  let out = 0
  let cost = 0
  let cacheRead = 0
  for (let n = 0; n < turns; n++) {
    const before = ctx
    ctx = Math.min(CTX_CAP, ctx + ctxInc(n))
    const o = outOf(n)
    out += o
    cacheRead += before
    cost += ((ctx - before) * PRICES.cache_write + before * PRICES.cache_read + o * PRICES.out) / 1e6
    if (n >= turns - 60) series.push(ctx)
  }
  return { ctx: series, out, cost, cacheRead }
}

/** The script segment at script second `e` (0 ≤ e < 72). */
function segAt(e: number): Seg {
  for (let i = SCRIPT.length - 1; i >= 0; i--) if (e >= SCRIPT[i]!.at) return SCRIPT[i]!
  return SCRIPT[0]!
}

/** Seconds of segments of `kinds` that lie before script second `e`. */
function spent(e: number, kinds: Kind[]): number {
  let sum = 0
  for (const sg of SCRIPT) if (kinds.includes(sg.kind)) sum += Math.max(0, Math.min(e, sg.end) - sg.at)
  return sum
}

/** The timeline rows of one loop that start before script second `e` (`e` = 72: the whole loop). */
function loopEvents(base: number, e: number): WatchEvent[] {
  const out: WatchEvent[] = []
  for (const sg of SCRIPT) {
    if (sg.at > e) break
    const t = base + sg.at
    if (sg.think) out.push({ t, kind: 'think', label: sg.think })
    if (sg.text) out.push({ t, kind: 'text', label: sg.text })
    if (sg.kind === 'tool') {
      const running = e < sg.end
      const ev: WatchEvent = {
        t,
        kind: 'tool',
        tool: sg.tool!,
        cls: toolClass(sg.tool),
        label: sg.label!,
        status: running ? 'running' : sg.status!,
        dur: running ? null : sg.end - sg.at,
      }
      if (!running && sg.detail && sg.status !== 'ok') ev.detail = sg.detail
      out.push(ev)
    }
  }
  return out
}

function commitHash(loop: number): string {
  return Math.floor(hash(loop + 77) * 0xfffffff)
    .toString(16)
    .padStart(7, '0')
}

/** The newest step of the shell output the pane's "Last command" shows, at script second `e`. */
function lastBash(base: number, e: number): Summary['last_bash'] {
  if (e >= DENIED_AT) {
    const done = e >= TESTS_GREEN
    return {
      cmd: 'npm test',
      desc: 'Run all the tests again',
      out: done
        ? [' ✓ tests/todo.test.ts (8 tests)', ' ✓ tests/due.test.ts (4 tests)', ' Tests  12 passed (12)']
        : [` RUN  v2.1.0 ${CWD}`],
      more: done ? 6 : 0,
      status: done ? 'ok' : 'running',
      t: base + DENIED_AT,
    }
  }
  if (e >= PUSH_AT) {
    return {
      cmd: 'git push --force',
      desc: 'Push the branch',
      out: [],
      more: 0,
      status: 'running',
      t: base + PUSH_AT,
    }
  }
  if (e >= ERROR_AT) {
    return { cmd: 'npm run lint', desc: 'Lint', out: ["src/due.ts:14:7  error  'd' is never reassigned  prefer-const", '✖ 1 problem (1 error, 0 warnings)'], more: 0, status: 'error', t: base + ERROR_AT }
  }
  if (e >= 47) {
    const done = e >= TESTS_FAIL
    return {
      cmd: 'npm test',
      desc: 'Run all the tests',
      out: done
        ? [' ✓ tests/todo.test.ts (8 tests)', ' FAIL  tests/due.test.ts > parses "tomorrow"', ' FAIL  tests/due.test.ts > parses "next week"', ' Tests  2 failed | 10 passed (12)']
        : [` RUN  v2.1.0 ${CWD}`],
      more: done ? 14 : 0,
      status: done ? 'error' : 'running',
      t: base + 47,
    }
  }
  if (e >= 9) {
    const done = e >= TESTS_PASS
    return {
      cmd: 'npm test -- todo',
      desc: 'Run the todo tests',
      out: done ? [` RUN  v2.1.0 ${CWD}`, ' ✓ tests/todo.test.ts (12 tests)', ' Tests  12 passed (12)'] : [` RUN  v2.1.0 ${CWD}`],
      more: 0,
      status: done ? 'ok' : 'running',
      t: base + 9,
    }
  }
  return null
}

/**
 * The summary of the demo run `elapsed` seconds in, on a clock where it is now `now` (seconds
 * since the epoch). The run started at `now − elapsed`; the script loops every 72 s.
 */
export function demoSummary(elapsed: number, now: number): Summary {
  elapsed = Math.max(0, elapsed)
  const loops = Math.floor(elapsed / DEMO_LOOP_SECS)
  const e = elapsed - loops * DEMO_LOOP_SECS
  const started = now - elapsed
  const base = now - e // this loop's second 0
  const at = (sec: number) => base + sec
  const seg = segAt(e)
  const finished = seg.kind === 'ok' || seg.kind === 'fail'
  const stalled = seg.kind === 'stalled'

  // Turns so far: every turn-starting segment of earlier loops, and those begun in this one.
  const turns = loops * TURNS_PER_LOOP + TURN_SEGS.filter(sg => sg.at <= e).length
  const tot = totals(turns)
  const ctx = tot.ctx.at(-1) ?? CTX_START
  const turnSecs: number[] = []
  for (let n = Math.max(0, turns - 1 - 60); n < turns - 1; n++) {
    const sg = TURN_SEGS[n % TURNS_PER_LOOP]!
    turnSecs.push(Math.round((sg.end - sg.at + hash(n + 211) * 0.6) * 10) / 10)
  }

  // Previous loop's rows, then this loop's so far.
  const events = [...(loops > 0 ? loopEvents(base - DEMO_LOOP_SECS, DEMO_LOOP_SECS) : []), ...loopEvents(base, e)].slice(-40)
  let thinking = ''
  let text = ''
  for (const ev of events) {
    if (ev.kind === 'think') thinking = ev.label
    if (ev.kind === 'text') text = ev.label
  }

  // Tool counts: whole earlier loops plus the calls begun in this one, in order of first use.
  const counts = new Map<string, number>()
  for (const sg of SCRIPT) if (sg.kind === 'tool') counts.set(sg.tool!, (counts.get(sg.tool!) ?? 0) + loops + (sg.at <= e ? 1 : 0))
  const toolCounts = [...counts].filter(([, n]) => n > 0)

  // Checks, errors and commits, from the oldest loop still worth showing to now.
  const tests: NonNullable<Summary['tests']> = []
  const commits: NonNullable<Summary['git']>['commits'] = []
  for (let L = Math.max(0, loops - 5); L <= loops; L++) {
    const b = base - (loops - L) * DEMO_LOOP_SECS
    const upTo = L < loops ? DEMO_LOOP_SECS : e
    if (upTo >= TESTS_PASS) tests.push({ t: b + TESTS_PASS, failed: 0, passed: 12, total: 12 })
    if (upTo >= TESTS_FAIL) tests.push({ t: b + TESTS_FAIL, failed: 2, passed: 10, total: 12 })
    if (upTo >= TESTS_GREEN) tests.push({ t: b + TESTS_GREEN, failed: 0, passed: 12, total: 12 })
    if (upTo >= COMMIT_AT) {
      commits.unshift({ hash: commitHash(L), t: b + COMMIT_AT, subject: SUBJECTS[L % SUBJECTS.length]!, stat: `${2 + (L % 2)} files changed, ${18 + (L % 5) * 7} insertions(+), ${3 + (L % 3)} deletions(-)` })
    }
  }
  const errorsPerLoop = 2 // the failing test run and the lint
  const errors = loops * errorsPerLoop + (e >= TESTS_FAIL ? 1 : 0) + (e >= ERROR_AT ? 1 : 0)
  const denials = loops + (e >= DENIED_AT ? 1 : 0)
  const prev = base - DEMO_LOOP_SECS
  const lastError: Summary['last_error'] =
    e >= ERROR_AT
      ? { t: at(ERROR_AT), tool: 'Bash', detail: 'npm run lint: exit code 1' }
      : e >= TESTS_FAIL
        ? { t: at(TESTS_FAIL), tool: 'Bash', detail: 'npm test: 2 tests failed' }
        : loops > 0
          ? { t: prev + ERROR_AT, tool: 'Bash', detail: 'npm run lint: exit code 1' }
          : null
  const lastDiff: Summary['last_diff'] = e >= 21 ? { path: 'src/todo.ts', diff: DIFF, t: at(21), lines: 12 } : loops > 0 ? { path: 'src/todo.ts', diff: DIFF, t: prev + 21, lines: 12 } : null
  const bash = lastBash(base, e) ?? (loops > 0 ? lastBash(prev, DEMO_LOOP_SECS) : null)

  // The log moves while the worker is live; it freezes at the stall and at the end of the run.
  const mtime = stalled || finished ? at(seg.at) : now
  const thinkS = loops * spent(DEMO_LOOP_SECS, ['think']) + spent(e, ['think'])
  const toolS = loops * spent(DEMO_LOOP_SECS, ['tool']) + spent(e, ['tool'])

  let pending: Summary['pending']
  if (finished) pending = { kind: 'done' }
  else if (seg.kind === 'tool') pending = { kind: 'tool', tool: seg.tool!, cls: toolClass(seg.tool), label: seg.label!, since: at(seg.at) }
  else pending = { kind: 'model', since: at(seg.at) }

  // The model server (mlx-serve-shaped): one finished request per turn; a request in flight while
  // reading the prompt; decode speed ramping up through the loop's opening thought.
  const done: NonNullable<NonNullable<Summary['server']>['done']> = []
  for (let n = Math.max(0, turns - 12); n < turns; n++) {
    const prompt = tot.ctx[tot.ctx.length - (turns - n)] ?? ctx
    const fresh = Math.min(prompt, ctxInc(n))
    done.push({
      prompt,
      gen: outOf(n),
      prefill_tps: prefillOf(n),
      cached: prompt - fresh,
      decode_tps: decodeOf(n),
      stop: TURN_SEGS[n % TURNS_PER_LOOP]!.kind === 'tool' ? 'tool_use' : 'end_turn',
      spec: null,
    })
  }
  const server: Summary['server'] = finished
    ? null
    : {
        adapter: 'mlx-serve',
        ok: true,
        sampled_at: now,
        model: MODEL,
        ctx_limit: CTX_LIMIT,
        resident_gb: 19.4,
        inflight: seg.kind === 'prefill' ? { msgs: 2 * turns + 1, prompt: ctx + PREFILL_NEW, cached: ctx } : null,
        done,
        rates: seg.kind === 'think' && seg.at === 0 ? { decode_tps: Math.round(18 + 36 * (e / 6)) } : null,
        log_mtime: mtime,
      }

  const runSecs = loops * DEMO_LOOP_SECS + seg.at
  const result: Summary['result'] = finished
    ? {
        subtype: seg.kind === 'ok' ? 'success' : 'error_max_turns',
        turns,
        duration_ms: Math.round(runSecs * 1000),
        api_ms: Math.round(runSecs * 700),
        input: 0,
        cache_read: tot.cacheRead,
        cache_write: ctx,
        output: tot.out,
        cost: null,
      }
    : null

  return {
    path: DEMO,
    exists: true,
    size: 20_000 + turns * 7_300,
    mtime,
    source: { name: DEMO, path: DEMO },
    model: MODEL,
    cwd: CWD,
    started,
    last_ts: mtime,
    turns,
    ctx,
    out_est: tot.out,
    think_ms: Math.round(thinkS * 1000),
    tool_ms: Math.round(toolS * 1000),
    thinking,
    text,
    errors,
    denials,
    result,
    pending,
    stalled,
    tool_counts: toolCounts,
    files: [
      ['src/todo.ts', loops * 2 + (e >= 21 ? 2 : 0) + 1],
      ['src/store.ts', loops + (e >= 29 ? 1 : 0)],
    ].filter(([, n]) => (n as number) > 0) as [string, number][],
    events,
    last_diff: lastDiff,
    last_bash: bash,
    last_error: lastError,
    turn_secs: turnSecs,
    ctx_series: tot.ctx,
    tests: tests.slice(-12),
    tsc: [],
    handoff: { text: TASK, path: `${CWD}/logs/worker-current.handoff.md`, since: started },
    cost: { compare: COMPARE, usd: Math.round(tot.cost * 100) / 100, priced_at: '2026-10-01', prices: PRICES, basis: COST_BASIS },
    server,
    memory: { at: now, free_gb: 21.5, total_gb: 64, server_gb: 19.4, server_model: MODEL },
    git: { branch: 'feat/due-dates', commits: commits.slice(0, 5), dirty: e >= 21 && e < COMMIT_AT ? '1 file changed, 4 insertions(+), 1 deletion(-)' : '', untracked: 0 },
  }
}
