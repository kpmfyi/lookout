// SYNTHETIC summaries of a Claude Code session transcript (docs/DESIGN.md 36), hand-written against
// the Summary contract like tests/fixtures.ts: the fictional acme-todo project, invented prompts
// and output, no real transcript data. What the log reader gives for this session's own
// transcript: `transcript: true`, the latest prompt, no hand-off, no model server.
import type { Summary } from '../types'
import { T } from './fixtures.ts'

const CWD = '/home/dev/work/acme-todo'
export const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
/** Where the transcript of a session in CWD lives under a home of `/home/dev`. */
export const SESSION_FILE = `/home/dev/.claude/projects/-home-dev-work-acme-todo/${SESSION_ID}.jsonl`
const MODEL = 'claude-opus-5-5'

const COST = {
  compare: MODEL,
  usd: 0.38,
  priced_at: '2026-10-28',
  prices: { in: 4, out: 20, cache_write: 5, cache_read: 0.2 },
  basis: 'estimate: context growth priced as cache writes, the rest as cache reads, output from characters/4',
}

/** The second prompt's turn ended a minute ago: the person's move. */
export const SESSION_WAITING: Summary = {
  path: SESSION_FILE,
  exists: true,
  size: 48_211,
  mtime: T - 60,
  source: { name: SESSION_ID, path: SESSION_FILE },
  model: MODEL,
  cwd: CWD,
  started: T - 900,
  last_ts: T - 60,
  turns: 9,
  ctx: 21_400,
  out_est: 2_310,
  think_ms: 9_200,
  tool_ms: 14_000,
  thinking: 'The CLI parses its flags by hand; add --due beside --tag.',
  text: 'Added `--due <date>` to `todo add`; it parses the date and passes it to addTodo.',
  errors: 1,
  denials: 0,
  result: null,
  pending: { kind: 'user', since: T - 60 },
  stalled: false,
  tool_counts: [
    ['Read', 3],
    ['Bash', 2],
    ['Edit', 2],
  ],
  files: [['src/cli.ts', 2]],
  events: [
    { t: T - 880, kind: 'text', label: "dueSoon is missing; I'll add it and run the tests." },
    { t: T - 870, kind: 'tool', tool: 'Bash', cls: 'shell', label: 'Run the unit tests', status: 'error', dur: 2.4, detail: 'Exit code 1' },
    { t: T - 840, kind: 'tool', tool: 'Edit', cls: 'edit', label: 'src/todo.ts', status: 'ok', dur: 0.1 },
    { t: T - 820, kind: 'tool', tool: 'Bash', cls: 'shell', label: 'Run the unit tests', status: 'ok', dur: 2.1 },
    { t: T - 120, kind: 'tool', tool: 'Read', cls: 'read', label: 'src/cli.ts', status: 'ok', dur: 0.1 },
    { t: T - 60, kind: 'text', label: 'Added `--due <date>` to `todo add`; it parses the date and passes it to addTodo.' },
  ],
  last_diff: null,
  last_bash: { cmd: 'npx vitest run', desc: 'Run the unit tests', out: ['      Tests  12 passed (12)'], more: 6, status: 'ok', t: T - 820 },
  last_error: { t: T - 870, tool: 'Bash', detail: 'Exit code 1' },
  turn_secs: [3, 4, 6, 9, 4, 3, 4, 7, 5],
  ctx_series: [8_000, 9_000, 10_200, 11_000, 12_000, 13_500, 15_000, 19_000, 21_400],
  tests: [
    { t: T - 870, failed: 1, passed: 11, total: 12 },
    { t: T - 820, failed: 0, passed: 12, total: 12 },
  ],
  tsc: [],
  handoff: null,
  cost: COST,
  server: null,
  memory: null,
  git: null,
  transcript: true,
  prompt: { text: "Now add a --due flag to the CLI's add command.", t: T - 130 },
}

/** The same session mid-turn: Claude running a Bash call. */
export const SESSION_RUNNING: Summary = {
  ...SESSION_WAITING,
  mtime: T - 2,
  last_ts: T - 2,
  pending: { kind: 'tool', tool: 'Bash', cls: 'shell', label: 'Typecheck the project', since: T - 4 },
}

/** This session before its first prompt: no transcript yet. */
export const SESSION_NOFILE: Summary = {
  path: SESSION_FILE,
  exists: false,
  source: { name: SESSION_ID, path: SESSION_FILE },
  handoff: null,
  server: null,
  transcript: true,
  prompt: null,
}
