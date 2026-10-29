// SYNTHETIC summaries, hand-written against the Summary contract (types/index.d.ts). A fictional
// project (~/work/acme-todo), a fictional local model and fictional commits; no real log data.
import type { Summary, WatchEvent } from '../types'
import type { You } from '../hooks/you.ts'

/** The clock the fixtures are written against (seconds since the epoch). */
export const T = 1_790_000_000

const LOG = '/home/dev/work/acme-todo/logs/worker-current.jsonl'
const LOCAL = 'local/qwen-coder-32b-q4'
const API = 'claude-sonnet-5-5'

const COST_BASIS = 'estimate: context growth priced as cache writes, the rest as cache reads, output from characters/4'
const PRICES = { in: 3, out: 15, cache_write: 3.75, cache_read: 0.3 }

function ramp(n: number, from: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(from + i * step + ((i * 37) % 11) * step * 0.2))
}

function events(t0: number, list: [number, Omit<WatchEvent, 't'>][]): WatchEvent[] {
  return list.map(([dt, ev]) => ({ t: t0 + dt, ...ev }))
}

const TURN_SECS = [3.1, 2.4, 6.8, 1.9, 12.5, 4.2, 3.3, 8.7, 2.2, 5.6, 15.1, 3.9, 2.8, 7.4, 4.4, 1.6, 9.2, 3.0]

/** Mid-run on a local model: mlx-serve stats with a request in flight, a Bash call running. */
export const RUNNING: Summary = {
  path: LOG,
  exists: true,
  size: 482_113,
  mtime: T - 2,
  source: { name: 'worker', path: LOG },
  model: LOCAL,
  cwd: '/home/dev/work/acme-todo',
  started: T - 1260,
  last_ts: T - 2,
  turns: 18,
  ctx: 54_200,
  out_est: 9_840,
  think_ms: 212_000,
  tool_ms: 148_000,
  thinking: 'The failing case is the empty title. The validator in src/todo.ts trims first and then checks length, so a title of spaces passes. Move the trim before the check and add a test for it.',
  text: 'Fixing the empty-title validation in src/todo.ts and adding a regression test.',
  errors: 1,
  denials: 0,
  result: null,
  pending: { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test -- todo', since: T - 4 },
  stalled: false,
  tool_counts: [
    ['Read', 14],
    ['Edit', 6],
    ['Bash', 9],
    ['Grep', 4],
    ['Write', 1],
  ],
  files: [
    ['src/todo.ts', 7],
    ['src/store.ts', 3],
    ['tests/todo.test.ts', 4],
  ],
  events: events(T - 300, [
    [0, { kind: 'text', label: 'Reading the todo module and its tests first.' }],
    [12, { kind: 'tool', tool: 'Read', cls: 'read', label: 'src/todo.ts', status: 'ok', dur: 0.1 }],
    [30, { kind: 'think', label: 'The trim happens after the length check.' }],
    [55, { kind: 'tool', tool: 'Grep', cls: 'search', label: 'validateTitle', status: 'ok', dur: 0.2 }],
    [90, { kind: 'tool', tool: 'Edit', cls: 'edit', label: 'src/todo.ts', status: 'ok', dur: 0.1 }],
    [140, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npx tsc --noEmit', status: 'ok', dur: 6.2 }],
    [200, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test', status: 'error', dur: 9.8, detail: 'exit code 1' }],
    [240, { kind: 'tool', tool: 'Write', cls: 'edit', label: 'tests/todo.test.ts', status: 'ok', dur: 0.1 }],
    [296, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test -- todo', status: 'running', dur: null }],
  ]),
  last_diff: {
    path: 'src/todo.ts',
    diff: '@@ -12,4 +12,5 @@\n export function validateTitle(title: string): boolean {\n-  if (title.length === 0) return false\n-  return title.trim().length > 0\n+  const t = title.trim()\n+  if (t.length === 0) return false\n+  return t.length <= 200\n }',
    t: T - 210,
    lines: 7,
  },
  last_bash: {
    cmd: 'npm test -- todo',
    desc: 'Run the todo tests',
    out: [' RUN  v2.1.0 /home/dev/work/acme-todo', ' ✓ tests/todo.test.ts (11 tests)'],
    more: 0,
    status: 'running',
    t: T - 4,
  },
  last_error: { t: T - 100, tool: 'Bash', detail: 'npm test: exit code 1' },
  turn_secs: TURN_SECS,
  ctx_series: ramp(18, 6_000, 2_800),
  tests: [
    { t: T - 600, failed: 2, passed: 9, total: 11 },
    { t: T - 100, failed: 1, passed: 10, total: 11 },
  ],
  tsc: [
    { t: T - 700, errors: 3 },
    { t: T - 160, errors: 0 },
  ],
  handoff: { text: 'Fix empty-title validation in the todo store', path: '/home/dev/work/acme-todo/logs/worker-current.handoff.md', since: T - 1300 },
  cost: { compare: API, usd: 0.47, priced_at: '2026-10-01', prices: PRICES, basis: COST_BASIS },
  server: {
    adapter: 'mlx-serve',
    ok: true,
    sampled_at: T - 1,
    model: LOCAL,
    ctx_limit: 131_072,
    resident_gb: 19.4,
    inflight: { msgs: 37, prompt: 55_100, cached: 54_200 },
    done: [
      { prompt: 48_000, gen: 410, prefill_tps: 820, cached: 46_900, decode_tps: 31.5, stop: 'tool_use', spec: null },
      { prompt: 51_300, gen: 220, prefill_tps: 790, cached: 50_100, decode_tps: 29.8, stop: 'tool_use', spec: 1.6 },
      { prompt: 54_200, gen: 515, prefill_tps: 805, cached: 53_000, decode_tps: 30.4, stop: 'tool_use', spec: 1.7 },
    ],
    rates: null,
    log_mtime: T - 3,
  },
  memory: { at: T - 5, free_gb: 21.5, total_gb: 64, server_gb: 19.4, server_model: LOCAL },
  git: {
    branch: 'fix/empty-title',
    commits: [
      { hash: 'a1b2c3d', t: T - 900, subject: 'Add title length limit to todo validator', stat: '2 files changed, 18 insertions(+), 3 deletions(-)' },
      { hash: 'e4f5a6b', t: T - 1100, subject: 'Extract validateTitle from the store', stat: '1 file changed, 9 insertions(+), 6 deletions(-)' },
    ],
    dirty: '2 files changed, 11 insertions(+), 2 deletions(-)',
    untracked: 1,
  },
}

/** Waiting on the model, no model server configured and no handoff file. */
export const THINKING: Summary = {
  path: LOG,
  exists: true,
  size: 41_220,
  mtime: T - 6,
  source: { name: 'default', path: LOG },
  model: LOCAL,
  cwd: '/home/dev/work/acme-todo',
  started: T - 95,
  last_ts: T - 6,
  turns: 3,
  ctx: 12_400,
  out_est: 640,
  think_ms: 21_000,
  tool_ms: 1_200,
  thinking: 'Start with the store: where are todos persisted?',
  text: 'Looking at how todos are stored.',
  errors: 0,
  denials: 0,
  result: null,
  pending: { kind: 'model', since: T - 6 },
  stalled: false,
  tool_counts: [
    ['Read', 2],
    ['Glob', 1],
  ],
  files: [['src/store.ts', 1]],
  events: events(T - 90, [
    [0, { kind: 'text', label: 'Looking at how todos are stored.' }],
    [20, { kind: 'tool', tool: 'Glob', cls: 'search', label: 'src/**/*.ts', status: 'ok', dur: 0.1 }],
    [50, { kind: 'tool', tool: 'Read', cls: 'read', label: 'src/store.ts', status: 'ok', dur: 0.1 }],
    [84, { kind: 'think', label: 'Start with the store.' }],
  ]),
  last_diff: null,
  last_bash: null,
  last_error: null,
  turn_secs: [5.2, 8.1, 3.4],
  ctx_series: [4_100, 8_800, 12_400],
  tests: [],
  tsc: [],
  handoff: null,
  cost: { compare: API, usd: 0.04, priced_at: '2026-10-01', prices: PRICES, basis: COST_BASIS },
  server: null,
  memory: null,
  git: null,
}

/** A finished run on an API model, with its real cost beside the estimate. */
export const FINISHED: Summary = {
  path: '/home/dev/work/acme-todo/logs/api-run.jsonl',
  exists: true,
  size: 1_204_000,
  mtime: T - 30,
  source: { name: 'api', path: '/home/dev/work/acme-todo/logs/api-run.jsonl' },
  model: API,
  cwd: '/home/dev/work/acme-todo',
  started: T - 1830,
  last_ts: T - 30,
  turns: 42,
  ctx: 88_600,
  out_est: 21_300,
  think_ms: 340_000,
  tool_ms: 410_000,
  thinking: 'All tests pass and tsc is clean. Summarise the change for the handoff.',
  text: 'Done: due dates are parsed, stored and sorted; 24 tests pass.',
  errors: 0,
  denials: 0,
  result: { subtype: 'success', turns: 42, duration_ms: 1_800_000, api_ms: 1_120_000, input: 1_820, cache_read: 2_410_000, cache_write: 96_000, output: 21_900, cost: 1.86 },
  pending: { kind: 'done' },
  stalled: false,
  tool_counts: [
    ['Read', 30],
    ['Edit', 18],
    ['Bash', 21],
    ['Grep', 9],
    ['WebFetch', 1],
    ['Task', 1],
  ],
  files: [
    ['src/todo.ts', 12],
    ['src/due.ts', 9],
  ],
  events: events(T - 200, [
    [0, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test', status: 'ok', dur: 11.2 }],
    [30, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'git commit -m "Sort todos by due date"', status: 'ok', dur: 0.4 }],
    [170, { kind: 'text', label: 'Done: due dates are parsed, stored and sorted; 24 tests pass.' }],
  ]),
  last_diff: { path: 'src/due.ts', diff: '@@ -1,1 +1,2 @@\n+export const DAY = 86_400_000\n export function parseDue(s: string): number | null {', t: T - 400, lines: 2 },
  last_bash: { cmd: 'npm test', desc: null, out: [' Tests  24 passed (24)'], more: 12, status: 'ok', t: T - 200 },
  last_error: null,
  turn_secs: ramp(42, 20, 0.6).map(x => x / 10),
  ctx_series: ramp(42, 8_000, 1_950),
  tests: [
    { t: T - 900, failed: 3, passed: 18, total: 21 },
    { t: T - 200, failed: 0, passed: 24, total: 24 },
  ],
  tsc: [{ t: T - 220, errors: 0 }],
  handoff: { text: 'Add due dates to todos', path: '/home/dev/work/acme-todo/logs/api-run.handoff.md', since: T - 1900 },
  cost: { compare: API, usd: 1.71, priced_at: '2026-10-01', prices: PRICES, basis: COST_BASIS },
  server: null,
  memory: { at: T - 30, free_gb: 40, total_gb: 64 },
  git: {
    branch: 'feat/due-dates',
    commits: [{ hash: '0c9d8e7', t: T - 170, subject: 'Sort todos by due date', stat: '3 files changed, 64 insertions(+), 5 deletions(-)' }],
    dirty: '',
    untracked: 0,
  },
}

/** Ended on max turns: a denied call, a last error and failing tests. */
export const FAILED: Summary = {
  path: LOG,
  exists: true,
  size: 903_000,
  mtime: T - 60,
  source: { name: 'worker', path: LOG },
  model: LOCAL,
  cwd: '/home/dev/work/acme-todo',
  started: T - 2400,
  last_ts: T - 60,
  turns: 60,
  ctx: 118_000,
  out_est: 30_100,
  think_ms: 800_000,
  tool_ms: 520_000,
  thinking: 'The migration still fails on the legacy rows.',
  text: 'Stopping: hit the turn limit with two migration tests failing.',
  errors: 4,
  denials: 1,
  result: { subtype: 'error_max_turns', turns: 60, duration_ms: 2_340_000, api_ms: 1_900_000, input: 0, cache_read: 0, cache_write: 0, output: 0, cost: null },
  pending: { kind: 'done' },
  stalled: false,
  tool_counts: [
    ['Read', 25],
    ['Edit', 20],
    ['Bash', 30],
  ],
  files: [['src/migrate.ts', 18]],
  events: events(T - 400, [
    [0, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'rm -rf data/', status: 'denied', dur: 0, detail: 'denied by the permission rules' }],
    [100, { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test -- migrate', status: 'error', dur: 8.1, detail: '2 failed' }],
    [330, { kind: 'text', label: 'Stopping: hit the turn limit with two migration tests failing.' }],
  ]),
  last_diff: null,
  last_bash: { cmd: 'npm test -- migrate', desc: null, out: [' FAIL  tests/migrate.test.ts > legacy rows', ' Tests  2 failed | 14 passed (16)'], more: 30, status: 'error', t: T - 300 },
  last_error: { t: T - 300, tool: 'Bash', detail: '2 migration tests failed' },
  turn_secs: ramp(60, 10, 0.5).map(x => x / 5),
  ctx_series: ramp(60, 6_000, 1_900),
  tests: [
    { t: T - 1200, failed: 4, passed: 12, total: 16 },
    { t: T - 300, failed: 2, passed: 14, total: 16 },
  ],
  tsc: [{ t: T - 320, errors: 2 }],
  handoff: null,
  cost: null,
  server: { adapter: 'llama.cpp', ok: false, note: 'no answer from the server URL', sampled_at: T - 60 },
  memory: null,
  git: null,
}

/** The log does not exist yet. */
export const NOLOG: Summary = {
  path: LOG,
  exists: false,
  source: { name: 'default', path: LOG },
}

/** All five, for loops. */
export const ALL = { RUNNING, THINKING, FINISHED, FAILED, NOLOG } as const

/** The orchestrator (docs/DESIGN.md 17): mid-turn, thinking. */
export const YOU_THINKING: You = { state: 'thinking', since: T - 5, turns: 4, model: 'claude-opus-5-5' }

/** The orchestrator running a Bash call. */
export const YOU_TOOL: You = { state: 'tool', tool: 'Bash', cls: 'shell', since: T - 2, turns: 4, model: 'claude-opus-5-5' }

/** The orchestrator's turn ended: the person's move. */
export const YOU_WAITING: You = { state: 'waiting', since: T - 30, turns: 5, model: 'claude-opus-5-5' }
