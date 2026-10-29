// The SYNTHETIC stream-json fixtures of tests/logs/ and two synthetic Claude Code session
// transcripts (session-*.jsonl, docs/DESIGN.md 36), built in memory: scripts/make-logs.ts writes
// them, tests/reader.test.ts and the pane tests read them from here. Deterministic, byte for byte
// the files the earlier Python generator wrote (docs/DESIGN.md 43.5). Everything is invented: a
// fictional project (acme-todo), a fictional local model id and fictional output.
import { PyFloat, cpHead, cpLen, pyDumps } from '../hooks/reader/py.ts'

const CWD = '/home/dev/work/acme-todo'
const LOCAL = 'local/qwen-coder-32b-q4'
const API = 'claude-sonnet-5-5'
/** 2026-10-01T09:00:00Z, in microseconds. */
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0) * 1000
const SESSION = '00000000-0000-4000-8000-000000000001'
const SESSION_MODEL = 'claude-opus-5-5'

const TODO_TS = `export type Todo = { id: number; title: string; done: boolean }

export function addTodo(list: Todo[], title: string): Todo[] {
  const id = list.length ? Math.max(...list.map((t) => t.id)) + 1 : 1
  return [...list, { id, title, done: false }]
}

export function toggle(list: Todo[], id: number): Todo[] {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
}
`

const TEST_TS = `import { describe, expect, it } from 'vitest'
import { addTodo, toggle, dueSoon } from '../src/todo'

describe('todo', () => {
  it('adds with increasing ids', () => {
    const l = addTodo(addTodo([], 'buy milk'), 'walk dog')
    expect(l.map((t) => t.id)).toEqual([1, 2])
  })
  it('toggles', () => {
    expect(toggle(addTodo([], 'x'), 1)[0].done).toBe(true)
  })
  it('lists items due within a day', () => {
    const now = Date.UTC(2026, 0, 1)
    const l = addTodo([], 'pay rent', now + 3600e3)
    expect(dueSoon(l, now)).toHaveLength(1)
  })
})
`

const VITEST_FAIL = `
 RUN  v3.2.4 /home/dev/work/acme-todo

 ❯ tests/todo.test.ts (12 tests | 1 failed) 14ms
   × todo > lists items due within a day 4ms
     → expected [] to have a length of 1 but got +0

 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
   Start at  09:03:10
   Duration  412ms
`

const VITEST_OK = `
 RUN  v3.2.4 /home/dev/work/acme-todo

 ✓ tests/todo.test.ts (12 tests) 11ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  09:04:02
   Duration  398ms
`

const JEST_OUT = `PASS tests/store.test.js
FAIL tests/api.test.js
  ● api › rejects an empty title

Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 9 passed, 11 total
Snapshots:   0 total
Time:        1.204 s
`

const PYTEST_OUT = `============================= test session starts ==============================
collected 9 items

tests/test_export.py ......F..                                           [100%]

=================================== FAILURES ===================================
_______________________________ test_csv_quotes ________________________________
E       AssertionError: assert 'a,"b' == 'a,""b'
=========================== short test summary info ============================
FAILED tests/test_export.py::test_csv_quotes - AssertionError
========================= 8 passed, 1 failed in 0.21s ==========================
`

const PYTEST_OK = '........\n8 passed in 0.18s\n'

const GO_OUT = `=== RUN   TestParseDue
--- PASS: TestParseDue (0.00s)
=== RUN   TestOverdue
--- FAIL: TestOverdue (0.00s)
    due_test.go:31: want 2 overdue, got 1
=== RUN   TestEmpty
--- PASS: TestEmpty (0.00s)
FAIL
FAIL\texample.com/acme-todo/due\t0.004s
ok  \texample.com/acme-todo/store\t0.012s
`

const CARGO_OUT = `running 6 tests
test parse::tests::empty ... ok
test parse::tests::dates ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

running 3 tests
test it_exports ... FAILED
test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
`

const BUN_OUT = `tests/todo.test.ts:
✓ adds [0.11ms]
✓ toggles [0.04ms]
✗ due soon [0.30ms]

 7 pass
 1 fail
 14 expect() calls
Ran 8 tests across 1 file. [21.00ms]
`

const MOCHA_OUT = `  todo
    ✔ adds
    ✔ toggles
    1) due soon

  5 passing (18ms)
  1 pending
  1 failing
`

const TSC_OUT = `src/todo.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/todo.ts(21,3): error TS2554: Expected 2 arguments, but got 1.
`

type Row = Record<string, unknown>
type Usage = Record<string, number>
type TurnOpts = { grow?: number; thinkMs?: number; usage?: Usage; secs?: number }

const pad = (n: number, w: number): string => String(n).padStart(w, '0')

/** A stream-json log, one row per content block as `claude -p` writes it. */
class Log {
  rows: Row[] = []
  msg = 0
  tool = 0
  ctx = 3000
  /** The clock, microseconds since the epoch. */
  protected t = T0

  readonly model: string
  readonly step: number

  constructor(model: string, step = 4.0) {
    this.model = model
    this.step = step
  }

  get elapsedUs(): number {
    return this.t - T0
  }

  at(secs?: number): string {
    this.t += Math.round((secs ?? this.step) * 1e6)
    return new Date(Math.floor(this.t / 1000)).toISOString()
  }

  init(): void {
    this.rows.push({ type: 'system', subtype: 'init', cwd: CWD, session_id: SESSION, model: this.model,
      tools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob'], permissionMode: 'default', timestamp: this.at(0) })
    this.rows.push({ type: 'user', message: { role: 'user', content: 'Add due dates to todo items and a dueSoon() helper, with tests.' }, timestamp: this.at(0.1) })
  }

  usage(grow: number, api = false): Usage {
    this.ctx += grow
    if (api) {
      // API-shaped usage: a real cache split
      const cw = Math.max(grow - 6, 0)
      return { input_tokens: grow - cw, cache_creation_input_tokens: cw, cache_read_input_tokens: this.ctx - grow, output_tokens: 1 }
    }
    return { input_tokens: this.ctx, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }
  }

  /** One assistant message, one row per content block. Returns the tool ids. */
  turn(blocks: Row[], o: TurnOpts = {}): string[] {
    this.msg += 1
    const mid = `msg_${pad(this.msg, 4)}`
    const u = o.usage ?? this.usage(o.grow ?? 600)
    const ids: string[] = []
    const when = this.at(o.secs)
    blocks.forEach((b, i) => {
      if (b.type === 'tool_use') {
        this.tool += 1
        b = { ...b, id: `toolu_${pad(this.tool, 4)}` }
        ids.push(b.id as string)
      }
      const row: Row = { type: 'assistant', message: { id: mid, type: 'message', role: 'assistant', model: this.model, content: [b], stop_reason: null, usage: u },
        parent_tool_use_id: null, session_id: SESSION, timestamp: when }
      if (i === 0 && o.thinkMs) row.thinking_duration_ms = o.thinkMs
      this.rows.push(row)
    })
    return ids
  }

  result(tid: string, content: string, o: { isError?: boolean; stdout?: string; stderr?: string; secs?: number } = {}): void {
    const row: Row = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content, is_error: o.isError ?? false }] },
      parent_tool_use_id: null, session_id: SESSION, timestamp: this.at(o.secs ?? 1.0) }
    if (o.stdout !== undefined) row.tool_use_result = { stdout: o.stdout, stderr: o.stderr ?? '', interrupted: false, isImage: false }
    this.rows.push(row)
  }

  done(o: { subtype?: string; turns?: number; cost?: number; usage?: Usage; durationMs?: number } = {}): void {
    const subtype = o.subtype ?? 'success'
    const dur = o.durationMs ?? Math.trunc((this.elapsedUs / 1e6) * 1000) + 500
    this.rows.push({ type: 'result', subtype, is_error: subtype !== 'success', num_turns: o.turns || this.msg,
      duration_ms: dur, duration_api_ms: Math.trunc(dur * 0.9), session_id: SESSION,
      result: subtype === 'success' ? 'Done.' : '', total_cost_usd: new PyFloat(o.cost ?? 0.0),
      usage: o.usage ?? { input_tokens: this.ctx, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 900 },
      timestamp: this.at(0.5) })
  }

  /** The file's text; `truncate`: the writer was cut off mid-row. */
  text(truncate = false): string {
    const lines = this.rows.map(r => pyDumps(r, false))
    if (!truncate) return `${lines.join('\n')}\n`
    const last = lines[lines.length - 1]!
    return `${lines.slice(0, -1).join('\n')}\n${cpHead(last, Math.floor(cpLen(last) / 2))}`
  }
}

type SessionTurnOpts = TurnOpts & { stop?: string; side?: boolean; model?: string }

/**
 * A session transcript: the same messages, one row per content block, each row stamped with the
 * session's bookkeeping (uuid, parentUuid, sessionId, isSidechain, cwd), and rows of its own around
 * them (snapshots, titles, attachments, turn ends, local commands).
 */
class Transcript extends Log {
  uuid = 0
  parent: string | null = null

  constructor(model = SESSION_MODEL, step = 4.0) {
    super(model, step)
  }

  row(kind: string, side: boolean, fields: Row): Row {
    this.uuid += 1
    const uid = `00000000-0000-4000-9000-${pad(this.uuid, 12)}`
    const row: Row = { parentUuid: this.parent, isSidechain: side, userType: 'external', cwd: CWD, sessionId: SESSION, version: '9.9.9', gitBranch: 'main', type: kind, uuid: uid, ...fields }
    if (!side) this.parent = uid
    this.rows.push(row)
    return row
  }

  snapshot(): void {
    this.rows.push({ type: 'file-history-snapshot', messageId: `00000000-0000-4000-9000-${pad(this.uuid + 1, 12)}`,
      snapshot: { trackedFileBackups: {}, timestamp: this.at(0) }, isSnapshotUpdate: false })
  }

  bookkeeping(title: string): void {
    this.rows.push({ type: 'ai-title', sessionId: SESSION, aiTitle: title })
    this.row('attachment', false, { attachment: { type: 'todo_reminder', content: [] }, timestamp: this.at(0.01) })
  }

  prompt(text: string, secs?: number): void {
    this.row('user', false, { message: { role: 'user', content: text }, promptSource: 'typed', origin: { kind: 'human' }, timestamp: this.at(secs) })
  }

  /** `/name` typed at the prompt: the caveat, the command and its output, no turn. */
  localCommand(name: string, out: string): void {
    this.row('user', false, { isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>' },
      timestamp: this.at(0) })
    this.row('user', false, { message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args></command-args>` },
      timestamp: this.at(0.01) })
    this.row('system', false, { subtype: 'local_command', content: `<local-command-stdout>${out}</local-command-stdout>`, level: 'info', isMeta: false, timestamp: this.at(0.01) })
  }

  /** One assistant message, one row per content block, every row with the message's stop reason. */
  override turn(blocks: Row[], o: SessionTurnOpts = {}): string[] {
    this.msg += 1
    const mid = `msg_s${pad(this.msg, 4)}`
    const u = o.usage ?? this.usage(o.grow ?? 600, true)
    const ids: string[] = []
    const when = this.at(o.secs)
    const stop = blocks.some(b => b.type === 'tool_use') ? 'tool_use' : o.stop ?? 'end_turn'
    blocks.forEach((b, i) => {
      if (b.type === 'tool_use') {
        this.tool += 1
        b = { ...b, id: `toolu_s${pad(this.tool, 4)}` }
        ids.push(b.id as string)
      }
      const fields: Row = { message: { model: o.model ?? this.model, id: mid, type: 'message', role: 'assistant', content: [b], stop_reason: stop, stop_sequence: null, usage: u },
        requestId: `req_s${pad(this.msg, 4)}`, timestamp: when }
      if (i === 0 && o.thinkMs) fields.thinkingDurationMs = o.thinkMs
      this.row('assistant', o.side ?? false, fields)
    })
    return ids
  }

  override result(tid: string, content: string, o: { isError?: boolean; stdout?: string; stderr?: string; secs?: number; side?: boolean } = {}): void {
    const fields: Row = { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content, is_error: o.isError ?? false }] }, timestamp: this.at(o.secs ?? 1.0) }
    if (o.stdout !== undefined) fields.toolUseResult = { stdout: o.stdout, stderr: o.stderr ?? '', interrupted: false, isImage: false }
    this.row('user', o.side ?? false, fields)
  }

  turnEnd(ms: number): void {
    this.row('system', false, { subtype: 'turn_duration', durationMs: ms, isMeta: false, timestamp: this.at(0.01) })
  }
}

const think = (s: string): Row => ({ type: 'thinking', thinking: s, signature: '' })
const text = (s: string): Row => ({ type: 'text', text: s })
const use = (name: string, input: Row): Row => ({ type: 'tool_use', name, input })
const numbered = (src: string): string => src.replace(/\n$/, '').split('\n').map((l, i) => `${String(i + 1).padStart(6)}→${l}`).join('\n')

/** The shared opening of the running, thinking and truncated logs (turns 1-7). */
function commonStart(L: Log): void {
  L.init()
  const [b] = L.turn([think('Start by reading the todo module and its tests to see the current shape.'),
    use('Bash', { command: 'ls src tests && wc -l src/*.ts', description: 'List sources and tests' })], { grow: 0, thinkMs: 2100 })
  L.result(b!, 'src:\ntodo.ts\ntests:\ntodo.test.ts\n  11 src/todo.ts', { stdout: 'src:\ntodo.ts\ntests:\ntodo.test.ts\n  11 src/todo.ts' })
  const [r] = L.turn([use('Read', { file_path: `${CWD}/src/todo.ts` })], { grow: 420 })
  L.result(r!, numbered(TODO_TS), { secs: 0.05 })
  const [e] = L.turn([think('Todo needs an optional due timestamp; addTodo takes it as a third argument.'),
    text("I'll add an optional `due` field and a `dueSoon()` helper."),
    use('Edit', { file_path: `${CWD}/src/todo.ts`,
      old_string: 'export type Todo = { id: number; title: string; done: boolean }',
      new_string: 'export type Todo = { id: number; title: string; done: boolean; due?: number }' })],
  { grow: 900, thinkMs: 5400, secs: 9 })
  L.result(e!, `The file ${CWD}/src/todo.ts has been updated.`, { secs: 0.04 })
  const [w] = L.turn([use('Write', { file_path: `${CWD}/tests/todo.test.ts`, content: TEST_TS })], { grow: 700, secs: 12 })
  L.result(w!, `File created successfully at: ${CWD}/tests/todo.test.ts`, { secs: 0.03 })
  const [v] = L.turn([use('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })], { grow: 650 })
  L.result(v!, `Exit code 1\n${VITEST_FAIL}`, { isError: true, stdout: VITEST_FAIL, secs: 2.4 })
  const [e2] = L.turn([think('dueSoon is not implemented yet, so the new test fails. Add it and pass `due` through addTodo.'),
    use('Edit', { file_path: `${CWD}/src/todo.ts`,
      old_string: 'export function addTodo(list: Todo[], title: string): Todo[] {\n  const id = list.length ? Math.max(...list.map((t) => t.id)) + 1 : 1\n  return [...list, { id, title, done: false }]\n}',
      new_string: 'export function addTodo(list: Todo[], title: string, due?: number): Todo[] {\n  const id = list.length ? Math.max(...list.map((t) => t.id)) + 1 : 1\n  return [...list, { id, title, done: false, due }]\n}\n\nexport function dueSoon(list: Todo[], now: number): Todo[] {\n  return list.filter((t) => !t.done && t.due !== undefined && t.due - now < 86400e3)\n}' })],
  { grow: 1100, thinkMs: 8800, secs: 21 })
  L.result(e2!, `The file ${CWD}/src/todo.ts has been updated.`, { secs: 0.04 })
  const [v2] = L.turn([use('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })], { grow: 500 })
  L.result(v2!, VITEST_OK, { stdout: VITEST_OK, secs: 2.1 })
}

function running(): string {
  const L = new Log(LOCAL)
  commonStart(L)
  L.turn([think('Tests pass. Typecheck before committing.'), use('Bash', { command: 'npm run typecheck', description: 'Typecheck the project' })], { grow: 380, thinkMs: 1900 })
  return L.text()
}

function thinking(): string {
  const L = new Log(LOCAL)
  commonStart(L)
  return L.text()
}

function truncated(): string {
  const L = new Log(LOCAL)
  commonStart(L)
  L.turn([text('All twelve tests pass; next I will update the README with the new due-date option.')], { grow: 300 })
  return L.text(true)
}

/** A 3-turn run on an API model with a real cache split and a result row (the cost test). */
function finished(): string {
  const L = new Log(API)
  L.ctx = 0
  L.init()
  const [r] = L.turn([think('Read the module first.'), use('Read', { file_path: `${CWD}/src/todo.ts` })], { usage: L.usage(5000, true), thinkMs: 1200 })
  L.result(r!, numbered(TODO_TS), { secs: 0.05 })
  const [w] = L.turn([text('Adding a CHANGELOG entry for due dates.'),
    use('Write', { file_path: `${CWD}/CHANGELOG.md`, content: '# Changelog\n\n## 0.4.0\n\n- Todo items take an optional due date.\n- New `dueSoon(list, now)` helper.\n' })],
  { usage: L.usage(2000, true), secs: 6 })
  L.result(w!, `File created successfully at: ${CWD}/CHANGELOG.md`, { secs: 0.03 })
  L.ctx -= 500 // context shrank (growth counts as zero, the whole context as a read)
  L.turn([text('Done: due dates, `dueSoon()`, tests and a changelog entry.')], { usage: L.usage(0, true), secs: 4 })
  L.done({ cost: 0.0421, turns: 3, usage: { input_tokens: 20, cache_creation_input_tokens: 6474, cache_read_input_tokens: 11500, output_tokens: 640 } })
  return L.text()
}

/** An error and a denial, then the run stops on max turns. */
function failed(): string {
  const L = new Log(LOCAL)
  L.init()
  const [b] = L.turn([think('Clear the old build output first.'), use('Bash', { command: 'rm -rf build dist', description: 'Remove build output' })], { grow: 0, thinkMs: 900 })
  L.result(b!, 'Permission to use Bash with command rm -rf build dist has been denied.', { isError: true })
  const [r] = L.turn([use('Read', { file_path: `${CWD}/src/due.ts` })], { grow: 300 })
  L.result(r!, `File does not exist. Current working directory: ${CWD}`, { isError: true, secs: 0.02 })
  L.turn([text('I could not find src/due.ts and was not allowed to clean the build directory.')], { grow: 200 })
  L.done({ subtype: 'error_max_turns', turns: 3 })
  return L.text()
}

/** One Bash result per test runner and typecheck format, then a result row. */
function runners(): string {
  const L = new Log(LOCAL)
  L.init()
  const cases: [string, string, boolean][] = [
    ['npx jest', JEST_OUT, true],
    ['python -m pytest -q', PYTEST_OUT, true],
    ['python -m pytest -q tests/test_export.py', PYTEST_OK, false],
    ['go test -v ./...', GO_OUT, true],
    ['cargo test', CARGO_OUT, true],
    ['bun test', BUN_OUT, true],
    ['npx mocha', MOCHA_OUT, true],
    ['npx tsc --noEmit', TSC_OUT, true],
    ['npx vitest run', VITEST_OK, false],
  ]
  for (const [cmd, out, err] of cases) {
    const [b] = L.turn([use('Bash', { command: cmd })], { grow: 250 })
    L.result(b!, (err ? 'Exit code 1\n' : '') + out, { isError: err, stdout: out, secs: 1.5 })
  }
  L.turn([text('Ran every suite.')], { grow: 100 })
  L.done()
  return L.text()
}

/**
 * A session's opening: a snapshot, a /model check, the first prompt and a turn that ran the tests
 * (a subagent's side chain in the middle), ended by the engine.
 */
function sessionStart(L: Transcript): void {
  L.snapshot()
  L.localCommand('model', 'Kept model as claude-opus-5-5')
  L.prompt('Why does the dueSoon test fail? Fix it.', 20)
  L.bookkeeping('Fix the dueSoon test')
  const [r] = L.turn([think('Read the module and its test first.'), use('Read', { file_path: `${CWD}/src/todo.ts` })], { usage: L.usage(8000, true), thinkMs: 1500, secs: 3 })
  L.result(r!, numbered(TODO_TS), { secs: 0.05 })
  const [a] = L.turn([use('Agent', { description: 'Find every caller of addTodo', prompt: 'List the callers of addTodo.' })], { usage: L.usage(900, true) })
  // The subagent's own rows: a side chain, left out of the summary (its model is not the session's).
  const [g] = L.turn([use('Grep', { pattern: 'addTodo', path: `${CWD}/src` })], { model: 'claude-haiku-5-5', side: true, secs: 2 })
  L.result(g!, 'src/todo.ts\nsrc/cli.ts', { side: true, secs: 0.1 })
  L.turn([text('addTodo is called from src/todo.ts and src/cli.ts.')], { model: 'claude-haiku-5-5', side: true, secs: 2 })
  L.result(a!, 'addTodo is called from src/todo.ts and src/cli.ts.', { secs: 0.5 })
  const [v] = L.turn([text("dueSoon is missing; I'll add it and run the tests."), use('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })],
    { usage: L.usage(1200, true), secs: 6 })
  L.result(v!, `Exit code 1\n${VITEST_FAIL}`, { isError: true, stdout: VITEST_FAIL, secs: 2.4 })
  const [e] = L.turn([think('Add dueSoon and pass due through addTodo.'),
    use('Edit', { file_path: `${CWD}/src/todo.ts`,
      old_string: 'export function toggle(', new_string: 'export function dueSoon(list: Todo[], now: number): Todo[] {\n  return list.filter((t) => !t.done && t.due !== undefined && t.due - now < 86400e3)\n}\n\nexport function toggle(' })],
  { usage: L.usage(700, true), thinkMs: 4200, secs: 9 })
  L.result(e!, `The file ${CWD}/src/todo.ts has been updated.`, { secs: 0.04 })
  const [v2] = L.turn([use('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })], { usage: L.usage(500, true) })
  L.result(v2!, VITEST_OK, { stdout: VITEST_OK, secs: 2.1 })
  L.turn([text('Fixed: `dueSoon()` was missing. All 12 tests pass.')], { usage: L.usage(400, true), secs: 3 })
  L.turnEnd(61_000)
}

/** Two prompts; the second turn ended (the session waits on the person). The latest prompt is the task. */
function sessionWaiting(): string {
  const L = new Transcript()
  sessionStart(L)
  L.prompt("Now add a --due flag to the CLI's add command.", 95)
  const [r] = L.turn([use('Read', { file_path: `${CWD}/src/cli.ts` })], { usage: L.usage(600, true), secs: 4 })
  L.result(r!, "     1→import { addTodo } from './todo'", { secs: 0.05 })
  L.turn([text('Added `--due <date>` to `todo add`; it parses the date and passes it to addTodo.')], { usage: L.usage(500, true), secs: 7 })
  L.turnEnd(12_000)
  return L.text()
}

/** The second prompt's turn mid-way: a Bash call running. */
function sessionRunning(): string {
  const L = new Transcript()
  sessionStart(L)
  L.prompt("Now add a --due flag to the CLI's add command.", 95)
  L.turn([think('Typecheck after the change.'), use('Bash', { command: 'npm run typecheck', description: 'Typecheck the project' })], { usage: L.usage(600, true), thinkMs: 900, secs: 5 })
  return L.text()
}

/** Every fixture by file name, in the order the generator writes them. */
export function fixtureLogs(): Record<string, string> {
  return {
    'running.jsonl': running(),
    'thinking.jsonl': thinking(),
    'truncated.jsonl': truncated(),
    'finished.jsonl': finished(),
    'failed.jsonl': failed(),
    'runners.jsonl': runners(),
    'session-waiting.jsonl': sessionWaiting(),
    'session-running.jsonl': sessionRunning(),
  }
}
