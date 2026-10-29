// The world under the pane tests (docs/DESIGN.md 43.5). The log reader runs inside the mod, so a
// pane test hands it what it reads through the kit's hooks: the log and the files beside it
// ($.fs), git, free memory and appends ($.process), and the model server ($.http), all from
// memory; the real reader turns them into the Summary the pane draws. The scenes below are the
// runs tests/fixtures.ts describes as summaries, written as the logs a worker or a session leaves.
// SYNTHETIC: the fictional acme-todo project, a fictional local model, invented output; no real
// log, path or server.
import type { On } from 'claude-code'

import type { Summary } from '../types'
import { Reader } from '../hooks/reader/index.ts'
import type { Io, IoStat, ReaderOptions } from '../hooks/reader/index.ts'
import { T } from './fixtures.ts'

export { T }
export const CWD = '/home/dev/work/acme-todo'
export const HOME = '/home/dev'
/** The worker log of the convention (docs/DESIGN.md 2). */
export const LOG = `${CWD}/logs/worker-current.jsonl`
export const LOCAL = 'local/qwen-coder-32b-q4'
export const API = 'claude-sonnet-5-5'
export const OPUS = 'claude-opus-5-5'
/** llama.cpp on its own port: where the reader looks with no `serverUrl` (docs/DESIGN.md 43.5). */
export const LLAMA = 'http://127.0.0.1:8080'
export const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
/** Where the transcript of a session in CWD lives under a home of `/home/dev`. */
export const SESSION_FILE = `${HOME}/.claude/projects/-home-dev-work-acme-todo/${SESSION_ID}.jsonl`

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64(u: Uint8Array): string {
  const native = (u as unknown as { toBase64?: () => string }).toBase64
  if (native) return native.call(u)
  let bin = ''
  for (const b of u) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** A synthetic price table in prices.json's shape, for every model the Result block lists. */
const PRICES = {
  checked: '2026-10-28',
  source: 'https://example.com/pricing',
  models: {
    'claude-sonnet-5-5': { in: 3, out: 15, cache_write: 3.75, cache_read: 0.3 },
    'claude-opus-5-5': { in: 5, out: 25, cache_write: 6.25, cache_read: 0.5 },
    'claude-haiku-5-5': { in: 1, out: 5, cache_write: 1.25, cache_read: 0.1 },
    'claude-fable-5-1': { in: 6, out: 30, cache_write: 7.5, cache_read: 0.6 },
  },
}

/** 16 KiB pages: 1,409,024 free, inactive and speculative are 21.5 GiB; 64 GiB in all. */
const VM_STAT = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  800000.\nPages active: 900000.\nPages inactive:  509024.\nPages speculative:  100000.\n'
const MEMSIZE = String(64 * 2 ** 30)

type File = { data: Uint8Array; mtime: number }
type Route = [status: number, body: string]
export type Git = { branch: string; log: string; dirty: string; untracked: number }

/** The files, commands and servers the mod reaches, in memory, with what it asked for recorded. */
export class World {
  readonly files = new Map<string, File>()
  readonly dirs = new Set<string>(['/'])
  /** Base URL → path → answer; any other base URL refuses the connection. */
  readonly servers = new Map<string, Record<string, Route>>()
  /** git in CWD (a `.git` folder there), or none. */
  git: Git | null = null
  /** Whether `tee -a` may append (false: a read-only folder, so the reader records no run). */
  appendable = true
  /** Every path the mod stat'ed, read and wrote, every command and every URL, in order. */
  readonly stats: string[] = []
  readonly reads: string[] = []
  readonly writes: string[] = []
  readonly runs: (readonly string[])[] = []
  readonly fetches: string[] = []

  put(path: string, text: string, mtime = T - 2): string {
    this.files.set(path, { data: enc.encode(text), mtime })
    for (let d = path.slice(0, path.lastIndexOf('/')); d; d = d.slice(0, d.lastIndexOf('/'))) this.dirs.add(d)
    return path
  }

  append(path: string, text: string, mtime?: number): void {
    const f = this.files.get(path)
    const add = enc.encode(text)
    const data = new Uint8Array((f?.data.length ?? 0) + add.length)
    if (f) data.set(f.data)
    data.set(add, f?.data.length ?? 0)
    this.files.set(path, { data, mtime: mtime ?? (f ? f.mtime + 1 : T - 1) })
  }

  text(path: string): string {
    const f = this.files.get(path)
    return f ? dec.decode(f.data) : ''
  }

  /** The reader's `${root}/hooks/prices.json`, wherever the kit puts the plugin. */
  private file(path: string): File | undefined {
    if (path.endsWith('/hooks/prices.json')) return { data: enc.encode(JSON.stringify(PRICES)), mtime: T - 86_400 }
    return this.files.get(path)
  }

  private stat(path: string): IoStat | null {
    const f = this.file(path)
    if (f) return { kind: 'file', size: f.data.length, mtime: f.mtime, real: path }
    if (this.dirs.has(path) || (this.git && path === `${CWD}/.git`)) return { kind: 'dir', size: 0, mtime: 0, real: path }
    return null
  }

  private command(argv: readonly string[], stdin: string | undefined): { code: number; stdout: string } {
    const [cmd] = argv
    if (cmd === 'tee' && argv[1] === '-a') {
      if (!this.appendable) return { code: 1, stdout: '' }
      this.append(argv[2]!, stdin ?? '')
      return { code: 0, stdout: stdin ?? '' }
    }
    if (cmd === '/bin/sh' && /^tail -c/.test(argv[2] ?? '')) {
      const f = this.file(argv[5]!)
      if (!f) return { code: 1, stdout: '' }
      const from = Number(argv[4]) - 1
      return { code: 0, stdout: toBase64(f.data.slice(from, from + Number(argv[6]))) }
    }
    if (cmd === 'vm_stat') return { code: 0, stdout: VM_STAT }
    if (cmd === 'sysctl') return { code: 0, stdout: `${MEMSIZE}\n` }
    if (cmd === 'git') {
      const at = argv.indexOf('-C')
      const sub = argv[at + 2]
      if (!this.git || argv[at + 1] !== CWD) return { code: 128, stdout: '' }
      if (sub === 'log') return { code: 0, stdout: this.git.log }
      if (sub === 'branch') return { code: 0, stdout: `${this.git.branch}\n` }
      if (sub === 'diff') return { code: 0, stdout: this.git.dirty ? ` ${this.git.dirty}\n` : '' }
      if (sub === 'ls-files') return { code: 0, stdout: Array.from({ length: this.git.untracked }, (_, i) => `notes-${i}.md\n`).join('') }
    }
    return { code: 127, stdout: '' }
  }

  private fetch(url: string): Route | null {
    const u = new URL(url)
    const routes = this.servers.get(u.origin)
    if (!routes) return null
    return routes[u.pathname] ?? [404, 'not found']
  }

  /** Answers the mod's $.fs, $.process and $.http from this world. */
  install(on: On): void {
    on('fs.exists', (_, e) => ({ value: this.stat(e.path) != null }))
    on('fs.stat', (_, e) => {
      this.stats.push(e.path)
      const st = this.stat(e.path)
      if (!st) return { deny: `ENOENT: ${e.path}` }
      return { value: { kind: st.kind, size: st.size, mtimeMs: st.mtime * 1000, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }
    })
    on('fs.read', (_, e) => {
      this.reads.push(e.path)
      const f = this.file(e.path)
      if (!f) return { deny: `ENOENT: ${e.path}` }
      return { value: e.as === 'bytes' ? { base64: toBase64(f.data) } : dec.decode(f.data) }
    })
    on('fs.write', (_, e) => {
      this.writes.push(e.path)
      this.put(e.path, e.text, T)
      return { value: undefined }
    })
    on('fs.list', (_, e) => {
      const dir = e.path.replace(/\/+$/, '')
      const entries = [...this.files].filter(([p]) => p.slice(0, p.lastIndexOf('/')) === dir).map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file' as const, size: f.data.length, mtimeMs: f.mtime * 1000, isLink: false }))
      if (!entries.length && !this.dirs.has(dir)) return { deny: `ENOENT: ${dir}` }
      return { value: entries }
    })
    on('process.run', (_, e) => {
      this.runs.push(e.argv)
      const r = this.command(e.argv, e.init?.stdin)
      return { value: { exitCode: r.code, stdout: r.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('http.fetch', (_, e) => {
      this.fetches.push(e.url)
      const r = this.fetch(e.url)
      if (!r) return { deny: `connect ECONNREFUSED ${new URL(e.url).host}` }
      return { value: { status: r[0], ok: r[0] >= 200 && r[0] < 300, headers: { 'content-type': 'application/json' }, text: r[1] } }
    })
  }

  /** The same world as the reader's Io, at clock `now`. */
  io(now = T): Io {
    return {
      root: '/plugin',
      now: async () => now,
      env: async name => (name === 'HOME' ? HOME : undefined),
      stat: async path => this.stat(path),
      read: async (path, offset, length) => {
        const f = this.file(path)
        if (!f) throw new Error('ENOENT')
        return f.data.slice(offset, offset + length)
      },
      readText: async path => {
        const f = this.file(path)
        if (!f) throw new Error('ENOENT')
        return dec.decode(f.data)
      },
      write: async () => {},
      append: async () => {},
      run: async argv => this.command(argv, undefined),
      fetch: async url => {
        const r = this.fetch(url)
        return r ? { status: r[0], text: r[1] } : { status: null, text: 'refused' }
      },
    }
  }

  /** What the reader makes of `path` here (docs/DESIGN.md 3): what a test expects the pane to show. */
  summary(path: string, o: Partial<ReaderOptions> = {}): Promise<Summary> {
    return new Reader().summarize(this.io(), { log: path, noRuns: true, transcript: path === SESSION_FILE, ...o })
  }
}

// ── Logs

type Row = Record<string, unknown>
const iso = (t: number): string => new Date(Math.round(t * 1000)).toISOString()

export const think = (s: string): Row => ({ type: 'thinking', thinking: s, signature: '' })
export const say = (s: string): Row => ({ type: 'text', text: s })
export const call = (name: string, input: Row): Row => ({ type: 'tool_use', name, input })
const at = (path: string): string => `${CWD}/${path}`

/** A `claude -p --output-format stream-json --verbose` log, each row at the time it is given; `ids` prefixes its message and tool ids (rows appended to a log need their own). */
export class StreamLog {
  rows: Row[] = []
  private msg = 0
  private tool = 0
  readonly model: string
  private readonly ids: string

  constructor(model: string, ids = '') {
    this.model = model
    this.ids = ids
  }

  init(t: number, prompt: string): this {
    this.rows.push({ type: 'system', subtype: 'init', cwd: CWD, session_id: 'w-1', model: this.model, tools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob'], timestamp: iso(t) })
    this.rows.push({ type: 'user', message: { role: 'user', content: prompt }, timestamp: iso(t) })
    return this
  }

  /** One assistant message (a turn) sent with `ctx` tokens of context, a row per block; its tool calls' ids. */
  turn(t: number, ctx: number, blocks: Row[], thinkMs = 0): string[] {
    const id = `msg_${this.ids}${++this.msg}`
    const ids: string[] = []
    blocks.forEach((b, i) => {
      if (b.type === 'tool_use') {
        b = { ...b, id: `toolu_${this.ids}${++this.tool}` }
        ids.push(b.id as string)
      }
      const usage = { input_tokens: ctx, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }
      const row: Row = { type: 'assistant', message: { id, type: 'message', role: 'assistant', model: this.model, content: [b], stop_reason: null, usage }, session_id: 'w-1', timestamp: iso(t) }
      if (i === 0 && thinkMs) row.thinking_duration_ms = thinkMs
      this.rows.push(row)
    })
    return ids
  }

  /** A tool's result; `stdout` as Bash reports it beside the text. */
  result(t: number, id: string, content: string, o: { error?: boolean; stdout?: string } = {}): this {
    const row: Row = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: o.error ?? false }] }, session_id: 'w-1', timestamp: iso(t) }
    if (o.stdout !== undefined) row.tool_use_result = { stdout: o.stdout, stderr: '', interrupted: false, isImage: false }
    this.rows.push(row)
    return this
  }

  done(t: number, o: { subtype?: string; turns: number; durationMs: number; cost?: number }): this {
    const subtype = o.subtype ?? 'success'
    this.rows.push({ type: 'result', subtype, is_error: subtype !== 'success', num_turns: o.turns, duration_ms: o.durationMs, duration_api_ms: Math.trunc(o.durationMs * 0.6),
      result: subtype === 'success' ? 'Done.' : '', total_cost_usd: o.cost ?? 0, usage: { input_tokens: 1820, cache_creation_input_tokens: 96_000, cache_read_input_tokens: 2_410_000, output_tokens: 21_900 }, timestamp: iso(t) })
    return this
  }

  text(): string {
    return `${this.rows.map(r => JSON.stringify(r)).join('\n')}\n`
  }
}

/** A Claude Code session transcript: the same messages, each row with the session's bookkeeping; `ids` as StreamLog's. */
export class SessionLog {
  rows: Row[] = []
  private msg = 0
  private tool = 0
  private uuid = 0
  private parent: string | null = null
  private readonly ids: string

  constructor(ids = '') {
    this.ids = ids
  }

  private row(type: string, fields: Row): void {
    const uuid = `00000000-0000-4000-9000-${this.ids}${String(++this.uuid).padStart(12, '0')}`
    this.rows.push({ parentUuid: this.parent, isSidechain: false, userType: 'external', cwd: CWD, sessionId: SESSION_ID, version: '9.9.9', type, uuid, ...fields })
    this.parent = uuid
  }

  prompt(t: number, text: string): this {
    this.row('user', { message: { role: 'user', content: text }, origin: { kind: 'human' }, timestamp: iso(t) })
    return this
  }

  turn(t: number, ctx: number, blocks: Row[]): string[] {
    const id = `msg_s${this.ids}${++this.msg}`
    const ids: string[] = []
    const stop = blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
    for (let b of blocks) {
      if (b.type === 'tool_use') {
        b = { ...b, id: `toolu_s${this.ids}${++this.tool}` }
        ids.push(b.id as string)
      }
      const usage = { input_tokens: 6, cache_creation_input_tokens: 600, cache_read_input_tokens: ctx - 606, output_tokens: 40 }
      this.row('assistant', { message: { model: OPUS, id, type: 'message', role: 'assistant', content: [b], stop_reason: stop, usage }, requestId: `req_${this.msg}`, timestamp: iso(t) })
    }
    return ids
  }

  result(t: number, id: string, content: string, o: { error?: boolean; stdout?: string } = {}): this {
    const fields: Row = { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: o.error ?? false }] }, timestamp: iso(t) }
    if (o.stdout !== undefined) fields.toolUseResult = { stdout: o.stdout, stderr: '', interrupted: false, isImage: false }
    this.row('user', fields)
    return this
  }

  turnEnd(t: number, ms: number): this {
    this.row('system', { subtype: 'turn_duration', durationMs: ms, isMeta: false, timestamp: iso(t) })
    return this
  }

  text(): string {
    return `${this.rows.map(r => JSON.stringify(r)).join('\n')}\n`
  }
}

/** vitest's summary for a run of `failed` + `passed` tests. */
export function vitest(failed: number, passed: number, file = 'tests/todo.test.ts'): string {
  const total = failed + passed
  return failed
    ? `\n RUN  v3.2.4 ${CWD}\n\n ❯ ${file} (${total} tests | ${failed} failed) 14ms\n\n Test Files  1 failed (1)\n      Tests  ${failed} failed | ${passed} passed (${total})\n   Duration  412ms\n`
    : `\n RUN  v3.2.4 ${CWD}\n\n ✓ ${file} (${total} tests) 11ms\n\n Test Files  1 passed (1)\n      Tests  ${passed} passed (${total})\n   Duration  398ms\n`
}

const TSC_ERRORS = "src/todo.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/todo.ts(21,3): error TS2554: Expected 2 arguments, but got 1.\nsrc/store.ts(8,1): error TS2304: Cannot find name 'save'.\n"

/** llama.cpp answering the reader with a request in flight and its /metrics rates. */
export function llamacpp(w: World, o: { decode?: number; prefill?: number; kv?: number; ctx?: number } = {}): void {
  w.servers.set(LLAMA, {
    '/props': [200, JSON.stringify({ default_generation_settings: { n_ctx: o.ctx ?? 131_072 }, total_slots: 1, model_path: '/models/qwen-coder-32b-q4.gguf' })],
    '/slots': [200, JSON.stringify([{ id: 0, n_ctx: o.ctx ?? 131_072, is_processing: true, n_prompt_tokens: 55_100, n_prompt_tokens_cache: 54_200 }])],
    '/metrics': [200, [
      `llamacpp:prompt_tokens_seconds ${o.prefill ?? 1900}`,
      `llamacpp:predicted_tokens_seconds ${o.decode ?? 42}`,
      `llamacpp:kv_cache_usage_ratio ${o.kv ?? 0.37}`,
      'llamacpp:requests_processing 1',
      '',
    ].join('\n')],
  })
}

// ── The scenes

export const RUNNING_THINKING = 'The failing case is the empty title. The validator in src/todo.ts trims first and then checks length, so a title of spaces passes. Move the trim before the check and add a test for it.'
export const RUNNING_TEXT = 'Fixing the empty-title validation in src/todo.ts and adding a regression test.'

export type RunningOpts = {
  path?: string
  /** No thinking anywhere in the run (calm then shows the latest reply). */
  noThinking?: boolean
  /** The running command's description (null: none, so the command is its label). */
  desc?: string | null
  /** The last command finished: its result's text and whether it failed. */
  lastResult?: { content: string; stdout?: string; error?: boolean }
}

/**
 * Mid-run on a local model (tests/fixtures.ts RUNNING): 18 turns, a failing test run then one still
 * failing, two type checks, the trim moved in src/todo.ts, `npm test -- todo` running, the hand-off
 * beside the log, git, free memory and llama.cpp with a request in flight. Returns the log's path.
 */
export function running(w: World, o: RunningOpts = {}): string {
  const path = o.path ?? LOG
  const S = T - 1260
  const L = new StreamLog(LOCAL).init(S, 'Fix empty-title validation in the todo store.')
  let ctx = 6_000
  const turn = (t: number, blocks: Row[], thinkMs = 0) => L.turn(t, (ctx += 2_800), blocks.filter(b => !(o.noThinking && b.type === 'thinking')), thinkMs)
  let [id] = turn(S + 10, [say('Reading the todo module and its tests first.'), call('Read', { file_path: at('src/todo.ts') })])
  L.result(S + 11, id!, '     1→export function validateTitle(title: string): boolean {')
  ;[id] = turn(S + 60, [call('Read', { file_path: at('tests/todo.test.ts') })])
  L.result(S + 61, id!, "     1→import { describe, it } from 'vitest'")
  ;[id] = turn(S + 120, [call('Grep', { pattern: 'validateTitle', path: at('src') })])
  L.result(S + 121, id!, 'src/todo.ts\nsrc/store.ts')
  ;[id] = turn(S + 180, [call('Bash', { command: 'npx tsc --noEmit' })])
  L.result(S + 186, id!, TSC_ERRORS, { stdout: TSC_ERRORS })
  ;[id] = turn(S + 300, [call('Bash', { command: 'npm test' })], 4_000)
  L.result(S + 310, id!, `Exit code 1\n${vitest(2, 9)}`, { error: true, stdout: vitest(2, 9) })
  ;[id] = turn(S + 400, [think('The trim happens after the length check.'), call('Write', { file_path: at('tests/todo.test.ts'), content: "import { expect, it } from 'vitest'\nimport { validateTitle } from '../src/todo'\n\nit('refuses a title of spaces', () => {\n  expect(validateTitle('   ')).toBe(false)\n})\n" })], 12_000)
  L.result(S + 401, id!, `File created successfully at: ${at('tests/todo.test.ts')}`)
  ;[id] = turn(S + 500, [call('Read', { file_path: at('src/store.ts') })])
  L.result(S + 501, id!, '     1→export const store = new Map()')
  ;[id] = turn(S + 560, [call('Grep', { pattern: 'trim', path: at('src') })])
  L.result(S + 561, id!, 'src/todo.ts')
  ;[id] = turn(S + 640, [call('Read', { file_path: at('src/todo.ts') })])
  L.result(S + 641, id!, '     1→export function validateTitle(title: string): boolean {')
  ;[id] = turn(S + 700, [call('Edit', { file_path: at('src/todo.ts'),
    old_string: '  if (title.length === 0) return false\n  return title.trim().length > 0',
    new_string: '  const t = title.trim()\n  if (t.length === 0) return false\n  return t.length <= 200' })], 20_000)
  L.result(S + 701, id!, `The file ${at('src/todo.ts')} has been updated.`)
  ;[id] = turn(S + 760, [call('Bash', { command: 'npx tsc --noEmit' })])
  L.result(S + 766, id!, '', { stdout: '' })
  ;[id] = turn(S + 900, [call('Bash', { command: 'npm test' })], 9_000)
  L.result(S + 910, id!, vitest(1, 10), { stdout: vitest(1, 10) })
  ;[id] = turn(S + 1000, [call('Read', { file_path: at('tests/todo.test.ts') })])
  L.result(S + 1001, id!, "     1→import { expect, it } from 'vitest'")
  ;[id] = turn(S + 1060, [call('Grep', { pattern: 'validateTitle', path: at('tests') })])
  L.result(S + 1061, id!, 'tests/todo.test.ts')
  ;[id] = turn(S + 1120, [call('Read', { file_path: at('src/store.ts') })])
  L.result(S + 1121, id!, '     1→export const store = new Map()')
  ;[id] = turn(S + 1180, [call('Read', { file_path: at('src/todo.ts') })])
  L.result(S + 1181, id!, '     1→export function validateTitle(title: string): boolean {')
  ;[id] = turn(S + 1220, [call('Grep', { pattern: 'length', path: at('src/todo.ts') })])
  L.result(S + 1221, id!, 'src/todo.ts')
  ctx = 54_200 - 2_800
  const desc = o.desc === undefined ? 'Run the todo tests' : o.desc
  const last = [think(RUNNING_THINKING), say(RUNNING_TEXT), call('Bash', { command: 'npm test -- todo', ...(desc ? { description: desc } : {}) })]
  ;[id] = turn(T - 4, last, 30_000)
  if (o.lastResult) L.result(T - 3, id!, o.lastResult.content, { error: o.lastResult.error, stdout: o.lastResult.stdout })
  w.put(path, L.text(), T - 2)
  w.put(`${path.replace(/\.jsonl$/, '')}.handoff.md`, '# Fix empty-title validation in the todo store\n\nThe validator lets a title of spaces through.\n', T - 1300)
  w.git = {
    branch: 'fix/empty-title',
    log: `a1b2c3d\t${T - 900}\tAdd title length limit to todo validator\n\n 2 files changed, 18 insertions(+), 3 deletions(-)\ne4f5a6b\t${T - 1100}\tExtract validateTitle from the store\n\n 1 file changed, 9 insertions(+), 6 deletions(-)\n`,
    dirty: '2 files changed, 11 insertions(+), 2 deletions(-)',
    untracked: 1,
  }
  llamacpp(w)
  return path
}

/** A run of `RUNNING` growing by a test run of `failed` of `failed + passed` (a new tool call and its result). */
export function appendTests(w: World, path: string, failed: number, passed: number, t = T): void {
  const L = new StreamLog(LOCAL, `t${t}-`)
  const [id] = L.turn(t, 60_000, [call('Bash', { command: 'npm test' })])
  L.result(t + 1, id!, vitest(failed, passed), { error: failed > 0, stdout: vitest(failed, passed) })
  w.append(path, L.text(), t + 1)
}

/** Waiting on the model three turns in (tests/fixtures.ts THINKING): no hand-off, no server, no git. */
export function thinking(w: World, path = LOG): string {
  const S = T - 95
  const L = new StreamLog(LOCAL).init(S, 'Find where todos are stored.')
  let [id] = L.turn(S + 5, 4_100, [say('Looking at how todos are stored.'), call('Glob', { pattern: 'src/**/*.ts' })])
  L.result(S + 6, id!, 'src/store.ts\nsrc/todo.ts')
  ;[id] = L.turn(S + 50, 8_800, [call('Read', { file_path: at('src/store.ts') })])
  L.result(S + 51, id!, '     1→export const store = new Map()')
  L.turn(T - 6, 12_400, [think('Start with the store: where are todos persisted?')], 21_000)
  return w.put(path, L.text(), T - 6)
}

export const FINISHED_PATH = `${CWD}/logs/api-run.jsonl`
export const FINISHED_TEXT = 'Done: due dates are parsed, stored and sorted; 24 tests pass.'

/**
 * A finished run on an API model (tests/fixtures.ts FINISHED): 42 turns, 30 minutes, $1.86 real,
 * tests failing then 24 passing, no errors or denials in 40 tool calls, a hand-off and a commit.
 * `end` is its result row's time.
 */
export function finished(w: World, o: { path?: string; end?: number } = {}): string {
  const path = o.path ?? FINISHED_PATH
  const end = o.end ?? T - 30
  const S = end - 1800
  const L = new StreamLog(API).init(S, 'Add due dates to todos.')
  const files = ['src/todo.ts', 'src/due.ts', 'src/store.ts', 'tests/todo.test.ts']
  let id: string | undefined
  for (let i = 0; i < 38; i++) {
    const t = S + 10 + i * 44
    const f = at(files[i % files.length]!)
    const tool = i % 4 === 0 ? call('Read', { file_path: f }) : i % 4 === 1 ? call('Grep', { pattern: 'due', path: at('src') }) : i % 4 === 2 ? call('Edit', { file_path: f, old_string: `// step ${i}`, new_string: `// step ${i}\nexport const STEP_${i} = ${i}` }) : call('Bash', { command: 'npm test' })
    ;[id] = L.turn(t, 8_000 + i * 1_950, i === 0 ? [think('Start with how a todo is parsed.'), tool] : [tool], 4_000)
    const out = i % 4 === 3 ? (i < 20 ? vitest(3, 18) : vitest(0, 24)) : ''
    L.result(t + 2, id!, out || 'ok', out ? { stdout: out } : {})
  }
  ;[id] = L.turn(end - 200, 82_000, [think('All tests pass and tsc is clean. Summarise the change for the handoff.'), call('Edit', { file_path: at('src/due.ts'), old_string: 'export function parseDue(s: string): number | null {', new_string: 'export const DAY = 86_400_000\nexport function parseDue(s: string): number | null {' })])
  L.result(end - 199, id!, `The file ${at('src/due.ts')} has been updated.`)
  ;[id] = L.turn(end - 170, 85_000, [call('Bash', { command: 'git commit -am "Sort todos by due date"' })])
  L.result(end - 169, id!, '[feat/due-dates 0c9d8e7] Sort todos by due date\n 3 files changed, 64 insertions(+), 5 deletions(-)', { stdout: '[feat/due-dates 0c9d8e7] Sort todos by due date\n 3 files changed, 64 insertions(+), 5 deletions(-)' })
  L.turn(end - 40, 88_600, [say(FINISHED_TEXT)])
  L.done(end, { turns: 42, durationMs: 1_800_000, cost: 1.86 })
  w.put(path, L.text(), end)
  w.put(`${path.replace(/\.jsonl$/, '')}.handoff.md`, '# Add due dates to todos\n', S - 70)
  w.git = { branch: 'feat/due-dates', log: `0c9d8e7\t${end - 170}\tSort todos by due date\n\n 3 files changed, 64 insertions(+), 5 deletions(-)\n`, dirty: '', untracked: 0 }
  return path
}

/** A finished run ending at local noon (so `night-shift` never depends on the time zone). */
export const NOON = new Date(2026, 9, 28, 12).getTime() / 1000

/** A run whose result comes 20 s in, though it says it took 30 minutes (replay's end: docs/DESIGN.md 21). */
export function quick(w: World, path = `${CWD}/logs/quick.jsonl`): string {
  const S = T - 600
  const L = new StreamLog(API).init(S, 'Say hello.')
  L.turn(S + 5, 3_000, [think('A short one.')])
  L.turn(S + 10, 3_400, [say('Hello.')])
  L.done(S + 20, { turns: 2, durationMs: 1_800_000, cost: 0.01 })
  return w.put(path, L.text(), S + 20)
}

/**
 * Ended on max turns (tests/fixtures.ts FAILED): a denied `rm -rf data/`, three failed commands,
 * migration tests failing, a type check with two errors.
 */
export function failed(w: World, path = LOG): string {
  const S = T - 2400
  const L = new StreamLog(LOCAL).init(S, 'Migrate the legacy rows.')
  let [id] = L.turn(S + 10, 6_000, [think('Clear the old data first.'), call('Bash', { command: 'rm -rf data/' })])
  L.result(S + 11, id!, 'Permission to use Bash with command rm -rf data/ has been denied.', { error: true })
  const fail = (failed: number, passed: number) => `Exit code 1\n FAIL  tests/migrate.test.ts > legacy rows\n${vitest(failed, passed, 'tests/migrate.test.ts')}`
  ;[id] = L.turn(S + 600, 40_000, [call('Bash', { command: 'npm test -- migrate' })])
  L.result(S + 608, id!, fail(4, 12), { error: true, stdout: fail(4, 12) })
  ;[id] = L.turn(S + 1200, 80_000, [call('Bash', { command: 'npx tsc --noEmit' })])
  L.result(S + 1206, id!, `Exit code 2\n${TSC_ERRORS.split('\n').slice(0, 2).join('\n')}\n`, { error: true, stdout: TSC_ERRORS.split('\n').slice(0, 2).join('\n') })
  ;[id] = L.turn(S + 2100, 118_000, [think('The migration still fails on the legacy rows.'), call('Bash', { command: 'npm test -- migrate' })])
  L.result(S + 2108, id!, fail(2, 14), { error: true, stdout: fail(2, 14) })
  L.turn(T - 70, 118_000, [say('Stopping: hit the turn limit with two migration tests failing.')])
  L.done(T - 60, { subtype: 'error_max_turns', turns: 60, durationMs: 2_340_000 })
  return w.put(path, L.text(), T - 60)
}

export const SESSION_THINKING = 'The CLI parses its flags by hand; add --due beside --tag.'
export const SESSION_PROMPT = "Now add a --due flag to the CLI's add command."

/**
 * This session's transcript (tests/session-fixture.ts): a first prompt whose turn ran the tests
 * (failing, then passing), then the latest prompt. `waiting`: its turn ended a minute ago;
 * otherwise Claude is running `npm run typecheck`.
 */
export function session(w: World, o: { waiting?: boolean; path?: string } = {}): string {
  const path = o.path ?? SESSION_FILE
  const S = T - 900
  const L = new SessionLog().prompt(S, 'Why does the dueSoon test fail? Fix it.')
  let [id] = L.turn(S + 10, 8_000, [say("dueSoon is missing; I'll add it and run the tests."), call('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })])
  L.result(S + 12, id!, `Exit code 1\n${vitest(1, 11)}`, { error: true, stdout: vitest(1, 11) })
  ;[id] = L.turn(S + 40, 9_000, [call('Edit', { file_path: at('src/todo.ts'), old_string: 'export function toggle(', new_string: 'export function dueSoon(list: Todo[], now: number): Todo[] {\n  return list.filter((t) => t.due !== undefined && t.due - now < 86400e3)\n}\n\nexport function toggle(' })])
  L.result(S + 41, id!, `The file ${at('src/todo.ts')} has been updated.`)
  ;[id] = L.turn(S + 60, 10_200, [call('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })])
  L.result(S + 62, id!, vitest(0, 12), { stdout: vitest(0, 12) })
  L.turn(S + 70, 11_000, [say('Fixed: `dueSoon()` was missing. All 12 tests pass.')])
  L.turnEnd(S + 71, 61_000)
  L.prompt(T - 130, SESSION_PROMPT)
  ;[id] = L.turn(T - 120, 19_000, [call('Read', { file_path: at('src/cli.ts') })])
  L.result(T - 119, id!, "     1→import { addTodo } from './todo'")
  if (o.waiting) {
    L.turn(T - 90, 20_000, [think(SESSION_THINKING)])
    L.turn(T - 60, 21_400, [say('Added `--due <date>` to `todo add`; it parses the date and passes it to addTodo.')])
    L.turnEnd(T - 60, 70_000)
    return w.put(path, L.text(), T - 60)
  }
  L.turn(T - 4, 21_400, [think(SESSION_THINKING), call('Bash', { command: 'npm run typecheck', description: 'Typecheck the project' })])
  return w.put(path, L.text(), T - 2)
}

/** This session's running turn going on: a test run of `failed` of `failed + passed` (a tool call and its result) at `t`. */
export function sessionTests(w: World, failed: number, passed: number, t = T, path = SESSION_FILE): void {
  const L = new SessionLog(`t${t}-`)
  const [id] = L.turn(t, 22_000, [call('Bash', { command: 'npx vitest run', description: 'Run the unit tests' })])
  L.result(t + 1, id!, vitest(failed, passed), { error: failed > 0, stdout: vitest(failed, passed) })
  w.append(path, L.text(), t + 1)
}

/** This session's turn ending at `t`: the person's move. */
export function sessionEnds(w: World, t: number, path = SESSION_FILE): void {
  const L = new SessionLog(`e${t}-`)
  L.turn(t, 22_400, [say('Done.')])
  L.turnEnd(t, 5_000)
  w.append(path, L.text(), t)
}

/** This session going on: a new thinking block (`dt` seconds after the last), then a new tool call. */
export function sessionThinks(w: World, text: string, dt: number, path = SESSION_FILE): void {
  const L = new SessionLog(`n${dt}-`)
  L.turn(T + dt, 22_000, [think(text)])
  w.append(path, L.text(), T + dt)
}
