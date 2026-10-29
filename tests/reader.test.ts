// The log reader (docs/DESIGN.md 3, 43.5) over an in-memory Io: the summariser's tests, ported,
// plus the incremental reads and the clocks the TypeScript reader adds. The logs are the synthetic
// fixtures (tests/log-fixtures.ts), the server answers tests/server-samples.ts; no file, process or
// network is touched.
import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { BASIS, ownPrice } from '../hooks/reader/cost.ts'
import { detectTests } from '../hooks/reader/detect.ts'
import type { Io, IoStat } from '../hooks/reader/io.ts'
import { parseMeminfo, parseVmStat } from '../hooks/reader/live.ts'
import { modIo } from '../hooks/reader/mod-io.ts'
import { floatRepr, isoTs, oneLine, pyDumps, pyRound, splitlines, strip } from '../hooks/reader/py.ts'
import { Reader, sourceName } from '../hooks/reader/reader.ts'
import type { ReaderOptions } from '../hooks/reader/reader.ts'
import {
  detect, parseLlamacppMetrics, parseLlamacppProps, parseLlamacppSlots, parseLmstudioModels, parseMlxLog, parseMlxModels,
  parseOllamaPs, parsePrometheus, parseVllmMetrics, serverStats, vllmSample,
} from '../hooks/reader/server.ts'
import type { Get, ServerCtx } from '../hooks/reader/server.ts'
import { fixtureLogs } from './log-fixtures.ts'
import { sample } from './server-samples.ts'

const LOGS = fixtureLogs()
const DIR = '/home/dev/work/acme-todo/logs'
const ROOT = '/plugin'
const HOME = '/home/dev'
/** The fixtures' first row, 2026-10-01T09:00:00Z. */
const START = 1_790_845_200
const NOW = START + 3600

/** A synthetic price table in prices.json's shape. */
const PRICES = {
  checked: '2026-10-28',
  source: 'https://example.com/pricing',
  models: {
    'claude-sonnet-5-5': { in: 2.0, out: 10.0, cache_write: 2.5, cache_read: 0.2 },
    'claude-opus-5-5': { in: 4.0, out: 20.0, cache_write: 5.0, cache_read: 0.2 },
    'claude-haiku-5-5': { in: 0.1, out: 0.5, cache_write: 0.125, cache_read: 0.01 },
  },
}

const CONTRACT_KEYS = new Set(`path exists size mtime error source model cwd started last_ts turns ctx out_est think_ms tool_ms thinking text
errors denials result pending stalled tool_counts files events last_diff last_bash last_error turn_secs ctx_series tests tsc handoff cost
server memory git until transcript prompt`.split(/\s+/))
const TOOL_CLASSES = ['shell', 'read', 'edit', 'search', 'web', 'agent', 'other']
const VM_STAT = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  100000.\nPages active: 5.\nPages inactive:  50000.\nPages speculative:  10000.\n'

const enc = new TextEncoder()

type File = { data: Uint8Array; mtime: number; ino: number }

/** An in-memory file system, clock, commands and network behind the reader's Io. */
class World {
  files = new Map<string, File>()
  links = new Map<string, string>()
  dirs = new Set<string>(['/', HOME, '/home', '/home/dev/work', '/home/dev/work/acme-todo', DIR])
  now = NOW
  env: Record<string, string> = { HOME }
  platform: string | undefined = 'darwin'
  runs: (readonly string[])[] = []
  fetches: string[] = []
  bytesRead = 0
  routes: Record<string, [number | null, string]> = {}
  /** Base URLs where a server answers (404 for a path it has no route for); anything else is refused. */
  up = new Set<string>()
  commands: (argv: readonly string[]) => { code: number; stdout: string } | undefined = () => undefined
  private inode = 1

  constructor() {
    this.put(`${ROOT}/hooks/prices.json`, JSON.stringify(PRICES))
  }

  put(path: string, text: string | Uint8Array, mtime = this.now - 2): void {
    const data = typeof text === 'string' ? enc.encode(text) : text
    const old = this.files.get(path)
    this.files.set(path, { data, mtime, ino: old?.ino ?? this.inode++ })
    this.dirs.add(path.slice(0, path.lastIndexOf('/')) || '/')
  }

  append(path: string, text: string, mtime = this.now - 1): void {
    const f = this.files.get(path)!
    const add = enc.encode(text)
    const data = new Uint8Array(f.data.length + add.length)
    data.set(f.data)
    data.set(add, f.data.length)
    this.files.set(path, { data, mtime, ino: f.ino })
  }

  /** A fixture copied to `path` (default beside the other logs, by its own name). */
  log(name: string, path = `${DIR}/${name}`, mtime = this.now - 2): string {
    this.put(path, LOGS[name]!, mtime)
    return path
  }

  text(path: string): string {
    return new TextDecoder().decode(this.files.get(path)?.data ?? new Uint8Array(0))
  }

  private resolve(path: string): string {
    for (let i = 0; i < 8 && this.links.has(path); i++) path = this.links.get(path)!
    return path
  }

  io(): Io {
    return {
      root: ROOT,
      platform: this.platform,
      now: async () => this.now,
      env: async name => this.env[name],
      stat: async (path): Promise<IoStat | null> => {
        const real = this.resolve(path)
        const f = this.files.get(real)
        if (f) return { kind: 'file', size: f.data.length, mtime: f.mtime, real, ino: f.ino }
        if (this.dirs.has(real)) return { kind: 'dir', size: 0, mtime: 0, real }
        return null
      },
      read: async (path, offset, length) => {
        const f = this.files.get(this.resolve(path))
        if (!f) throw new Error('ENOENT')
        const out = f.data.slice(offset, offset + length)
        this.bytesRead += out.length
        return out
      },
      readText: async path => {
        const f = this.files.get(this.resolve(path))
        if (!f) throw new Error('ENOENT')
        return new TextDecoder().decode(f.data)
      },
      write: async (path, text) => this.put(path, text, this.now),
      append: async (path, text) => {
        if (!this.dirs.has(path.slice(0, path.lastIndexOf('/')) || '/')) throw new Error('ENOENT')
        if (!this.files.has(path)) this.put(path, '', this.now)
        this.append(path, text, this.now)
      },
      run: async (argv, _ms) => {
        this.runs.push(argv)
        const own = this.commands(argv)
        if (own) return own
        if (argv[0] === 'vm_stat') return { code: 0, stdout: VM_STAT }
        if (argv[0] === 'sysctl') return { code: 0, stdout: `${64 * 2 ** 30}\n` }
        throw new Error(`no ${argv[0]}`)
      },
      fetch: async (url, _ms) => {
        this.fetches.push(url)
        for (const [suffix, r] of Object.entries(this.routes)) if (url.endsWith(suffix)) return { status: r[0], text: r[1] }
        return [...this.up].some(u => url.startsWith(u)) ? { status: 404, text: '' } : { status: null, text: 'connection refused' }
      },
    }
  }
}

function summary(w: World, o: Partial<ReaderOptions> & { log: string }, reader = new Reader()): Promise<Summary> {
  return reader.summarize(w.io(), { server: 'none', noRuns: true, ...o })
}

/** A fixture's summary in a fresh world, with server none. */
async function of(name: string, o: Partial<ReaderOptions> = {}): Promise<Summary> {
  const w = new World()
  return summary(w, { log: w.log(name), ...o })
}

const epoch = (iso: string): number => isoTs(iso)!

// ── Contract

test('reader: the keys are the contract\'s, the required ones always there', async () => {
  for (const name of ['running.jsonl', 'thinking.jsonl', 'finished.jsonl', 'failed.jsonl', 'runners.jsonl', 'truncated.jsonl']) {
    const d = await of(name)
    for (const k of Object.keys(d)) expect([name, k, CONTRACT_KEYS.has(k)]).toEqual([name, k, true])
    for (const k of ['path', 'exists', 'source', 'pending', 'events', 'turn_secs', 'ctx_series', 'cost', 'server', 'memory', 'git']) expect([name, k, k in d]).toEqual([name, k, true])
    expect(d.exists).toBe(true)
    expect(d.server).toBeNull()
    expect(typeof d.stalled).toBe('boolean')
    for (const ev of d.events!) {
      expect(['think', 'text', 'tool'].includes(ev.kind)).toBe(true)
      if (ev.kind === 'tool') {
        expect(TOOL_CLASSES.includes(ev.cls!)).toBe(true)
        expect(['running', 'ok', 'error', 'denied'].includes(ev.status!)).toBe(true)
      }
    }
  }
})

test('reader: the source is named from the file', async () => {
  expect(sourceName('~/logs/worker-current.jsonl')).toBe('worker')
  expect(sourceName('/x/run-7.jsonl')).toBe('run-7')
  expect(sourceName('/x/')).toBe('x')
  expect((await of('running.jsonl')).source).toEqual({ name: 'running', path: `${DIR}/running.jsonl` })
})

test('reader: a missing log, a directory, an unknown server', async () => {
  const w = new World()
  const d = await summary(w, { log: '/nonexistent/dir/worker-current.jsonl' })
  expect(d.exists).toBe(false)
  expect(d.source.name).toBe('worker')
  for (const k of Object.keys(d)) expect(CONTRACT_KEYS.has(k)).toBe(true)
  const dir = await summary(w, { log: DIR })
  expect(dir.exists).toBe(false)
  expect(dir.error).toBe('not a regular file')
  expect((await summary(w, { log: w.log('running.jsonl'), server: 'nonsense' })).server).toBeNull()
  expect((await summary(w, { log: '~/x.jsonl' })).path).toBe('/home/dev/x.jsonl')
})

// ── A running log

test('reader: mid tool call', async () => {
  const d = await of('running.jsonl')
  expect(d.model).toBe('local/qwen-coder-32b-q4')
  expect(d.pending).toEqual({ kind: 'tool', tool: 'Bash', cls: 'shell', label: 'Typecheck the project', since: d.pending!.kind === 'tool' ? d.pending!.since : null })
  expect(d.last_bash!.status).toBe('running')
  expect(d.stalled).toBe(false) // waiting on a tool, never stalled
  expect(d.turns).toBe(8)
  expect(d.ctx_series!.length).toBe(8)
  expect(d.turn_secs!.length).toBe(8)
  expect(d.result).toBeNull()
  expect(d.files![0]).toEqual(['src/todo.ts', 2])
  expect(d.tests!.map(t => [t.failed, t.passed, t.total])).toEqual([[1, 11, 12], [0, 12, 12]])
  const e = d.last_error!
  expect(e.tool).toBe('Bash')
  expect(e.detail.length <= 300).toBe(true)
})

test('reader: the last edit as a unified diff', async () => {
  const diff = (await of('running.jsonl')).last_diff!
  expect(diff.path).toBe('src/todo.ts')
  expect(diff.diff.includes('+++ b/src/todo.ts')).toBe(true)
  expect(diff.diff.includes('+export function dueSoon(list: Todo[], now: number): Todo[] {')).toBe(true)
  expect(diff.diff.includes('-  return [...list, { id, title, done: false }]')).toBe(true)
  expect(diff.diff.split('\n').slice(0, 3)).toEqual(['--- a/src/todo.ts', '+++ b/src/todo.ts', '@@ -1,4 +1,8 @@'])
})

test('reader: stalled when the model has said nothing for longer than stallSecs', async () => {
  const w = new World()
  const log = w.log('thinking.jsonl', `${DIR}/thinking.jsonl`, w.now - 600)
  const d = await summary(w, { log, stallSecs: 180 })
  expect(d.pending!.kind).toBe('model')
  expect(d.stalled).toBe(true)
  expect((await summary(w, { log, stallSecs: 100_000 })).stalled).toBe(false)
})

test('reader: a truncated last line is skipped', async () => {
  const d = await of('truncated.jsonl')
  expect('error' in d).toBe(false)
  expect(d.turns).toBe(7)
  expect(d.pending!.kind).toBe('model')
})

// ── A finished log and the estimate

test('reader: a finished run, its result and the Write as a diff', async () => {
  const d = await of('finished.jsonl')
  expect(d.pending).toEqual({ kind: 'done' })
  expect(d.stalled).toBe(false)
  expect(d.result!.subtype).toBe('success')
  expect(d.result!.cost).toBe(0.0421) // real: the model is an API Claude model
  const w = d.last_diff!
  expect(w.path).toBe('CHANGELOG.md')
  expect(w.diff.startsWith('--- /dev/null\n+++ b/CHANGELOG.md\n@@ -0,0 +1,6 @@\n+# Changelog')).toBe(true)
  expect(w.lines).toBe(6)
})

test('reader: the estimate is growth × cache_write + rest × cache_read + output × out', async () => {
  let growth = 0
  let rest = 0
  let prev = 0
  let outEst = 0
  let last: unknown = null
  for (const line of LOGS['finished.jsonl']!.trim().split('\n')) {
    const d = JSON.parse(line) as { type: string; message: { id: string; usage: Record<string, number>; content: Record<string, unknown>[] } }
    if (d.type !== 'assistant') continue
    const m = d.message
    if (m.id !== last) {
      last = m.id
      const ctx = m.usage.input_tokens! + m.usage.cache_read_input_tokens! + m.usage.cache_creation_input_tokens!
      const grown = Math.max(ctx - prev, 0)
      growth += grown
      rest += ctx - grown
      prev = ctx
    }
    for (const b of m.content) {
      if (b.type === 'thinking') outEst += Math.floor(String(b.thinking).length / 4)
      else if (b.type === 'text') outEst += Math.floor(String(b.text).length / 4)
      else if (b.type === 'tool_use') outEst += Math.floor(pyDumps(b.input).length / 4)
    }
  }
  expect([growth, rest]).toEqual([5000 + 2000 + 0, 0 + 5000 + 6500]) // contexts 5000, 7000, 6500
  const p = PRICES.models['claude-sonnet-5-5']
  const d = await of('finished.jsonl', { compare: 'claude-sonnet-5-5' })
  expect(d.out_est).toBe(outEst)
  const c = d.cost!
  expect(c.usd).toBe(pyRound((growth * p.cache_write + rest * p.cache_read + outEst * p.out) / 1e6, 4))
  expect(c.compare).toBe('claude-sonnet-5-5')
  expect(c.priced_at).toBe(PRICES.checked)
  expect(c.prices).toEqual(p)
  expect(c.basis).toBe(BASIS)
})

test('reader: compare off, unknown, custom; every model priced', async () => {
  expect((await of('finished.jsonl', { compare: 'off' })).cost).toBeNull()
  expect((await of('finished.jsonl', { compare: 'no-such-model' })).cost).toBeNull()
  expect((await of('finished.jsonl', { compare: 'custom', customPrices: '1,2,x' })).cost).toBeNull()
  expect((await of('finished.jsonl', { compare: 'custom', customPrices: '1,2,3' })).cost).toBeNull()
  expect((await of('finished.jsonl', { compare: 'custom', customPrices: '1,2,3,inf' })).cost).toBeNull() // Python priced at inf
  const c = (await of('finished.jsonl', { compare: 'custom', customPrices: '1, 10, 1.25 ,0.1' })).cost!
  const outEst = (await of('finished.jsonl')).out_est!
  expect(c.usd).toBe(pyRound((7000 * 1.25 + 11500 * 0.1 + outEst * 10) / 1e6, 4))
  expect(c.prices).toEqual({ in: 1, out: 10, cache_write: 1.25, cache_read: 0.1 })
  expect(c.priced_at).toBe('custom')
  expect(Object.keys(c.at_all!).sort()).toEqual(Object.keys(PRICES.models).sort())
  for (const id of Object.keys(PRICES.models)) {
    const x = (await of('finished.jsonl', { compare: id })).cost!
    expect(x.usd > 0).toBe(true)
    expect(x.at_all![id]).toBe(x.usd)
  }
})

test('reader: no prices.json, no estimate (and no failure)', async () => {
  const w = new World()
  w.files.delete(`${ROOT}/hooks/prices.json`)
  const d = await summary(w, { log: w.log('finished.jsonl') })
  expect(d.cost).toBeNull()
  expect(d.turns).toBe(3)
})

// ── Errors, denials and the runners

test('reader: an error and a denial', async () => {
  const d = await of('failed.jsonl')
  expect(d.errors).toBe(2)
  expect(d.denials).toBe(1)
  const tools = d.events!.filter(e => e.kind === 'tool')
  expect(tools.map(e => e.status)).toEqual(['denied', 'error'])
  expect(tools[0]!.detail!.includes('denied')).toBe(true)
  expect(d.last_error!.tool).toBe('Read')
  expect(d.last_error!.detail.includes('does not exist')).toBe(true)
  expect(d.result!.subtype).toBe('error_max_turns')
  expect(d.result!.cost).toBeNull() // a local model: the result's cost is not real
  expect(d.pending).toEqual({ kind: 'done' })
})

test('reader: every test runner\'s summary, and tsc', async () => {
  const d = await of('runners.jsonl')
  expect(d.tests!.map(t => [t.failed, t.passed, t.total])).toEqual([
    [2, 9, 11], // jest
    [1, 8, 9], // pytest with a failure
    [0, 8, 8], // pytest all passing
    [1, 2, 3], // go test -v
    [1, 8, 9], // cargo, two test binaries summed
    [1, 7, 8], // bun
    [1, 5, 7], // mocha (1 pending)
    [0, 12, 12], // vitest
  ])
  expect(d.tsc!.map(t => t.errors)).toEqual([2])
})

test('detectTests: one runner\'s output at a time', () => {
  expect(detectTests(' Tests  3 failed (3)')).toEqual({ failed: 3, passed: 0, total: 3 })
  expect(detectTests(' Tests  2 failed | 1 skipped | 7 passed (10)')).toEqual({ failed: 2, passed: 7, total: 10 })
  expect(detectTests('==== 3 failed in 0.40s ====')).toEqual({ failed: 3, passed: 0, total: 3 })
  expect(detectTests('10 passed, 2 skipped in 1.02s')).toEqual({ failed: 0, passed: 10, total: 12 })
  expect(detectTests('ok  \texample.com/a\t0.010s\nok  \texample.com/b\t(cached)\n')).toEqual({ failed: 0, passed: 2, total: 2 })
  expect(detectTests('--- FAIL: TestX (0.00s)\nFAIL\texample.com/a\t0.01s\nok  \texample.com/b\t0.02s\n')).toEqual({ failed: 1, passed: 1, total: 2 })
  expect(detectTests('test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured')).toEqual({ failed: 0, passed: 4, total: 5 })
  expect(detectTests('everything is fine, 3 files changed')).toBeNull()
  // Two vitest runs in one output: the newest wins.
  expect(detectTests(' Tests  1 failed | 2 passed (3)\n...\n Tests  3 passed (3)')).toEqual({ failed: 0, passed: 3, total: 3 })
  // A line is cut at \n only, as Python's MULTILINE reads it: a carriage return is no line end.
  expect(detectTests(' 3 pass\r 1 fail\n')).toBeNull()
  expect(detectTests(' 3 pass\n 1 fail\n')).toEqual({ failed: 1, passed: 3, total: 4 })
})

// ── The hand-off

test('reader: the hand-off beside the real path, beside the link, or named', async () => {
  const w = new World()
  const real = w.log('running.jsonl', '/home/dev/logs/runs/run-7.jsonl')
  const link = '/home/dev/logs/worker-current.jsonl'
  w.links.set(link, real)
  w.put('/home/dev/logs/runs/run-7.handoff.md', '\n\n# Add due dates to todo items\n\nDetails follow.\n', NOW - 100)
  let d = await summary(w, { log: link })
  expect(d.source.name).toBe('worker')
  expect(d.handoff).toEqual({ text: 'Add due dates to todo items', path: '/home/dev/logs/runs/run-7.handoff.md', since: NOW - 100 })
  // Without the real sibling, the given path's sibling is used.
  w.files.delete('/home/dev/logs/runs/run-7.handoff.md')
  w.put('/home/dev/logs/worker-current.handoff.md', 'Fix the flaky export test\n')
  const reader = new Reader()
  expect((await summary(w, { log: link }, reader)).handoff!.text).toBe('Fix the flaky export test')
  // An edit shows on the next poll (its head is read again when its size or mtime moves).
  w.put('/home/dev/logs/worker-current.handoff.md', 'Fix the flaky import test\n', NOW)
  expect((await summary(w, { log: link }, reader)).handoff!.text).toBe('Fix the flaky import test')
  // A named one wins.
  w.put('/home/dev/task.md', `${'x'.repeat(500)}\n`)
  d = await summary(w, { log: link, handoff: '~/task.md' })
  expect(d.handoff!.path).toBe('/home/dev/task.md')
  expect(d.handoff!.text.length <= 200).toBe(true)
  expect((await of('running.jsonl')).handoff).toBeNull()
})

// ── Incremental reads (docs/DESIGN.md 43.5)

test('reader: a poll reads only the bytes appended since the last one', async () => {
  const w = new World()
  const log = w.log('thinking.jsonl')
  const reader = new Reader()
  const first = await summary(w, { log }, reader)
  const size = w.files.get(log)!.data.length
  expect(w.bytesRead).toBe(size)
  // Unchanged: nothing read.
  w.bytesRead = 0
  expect(await summary(w, { log }, reader)).toEqual(first)
  expect(w.bytesRead).toBe(0)
  // A row appended: the anchor before it and the row.
  const row = `${JSON.stringify({ type: 'assistant', message: { id: 'msg_new', content: [{ type: 'text', text: 'more' }], usage: { input_tokens: 9000 } }, timestamp: '2026-10-01T09:10:00.000Z' })}\n`
  w.append(log, row)
  w.bytesRead = 0
  const grown = await summary(w, { log }, reader)
  expect(grown.turns).toBe(first.turns! + 1)
  expect(w.bytesRead).toBe(64 + enc.encode(row).length)
  // The same as a fresh reader on the whole file.
  expect(grown).toEqual(await summary(w, { log }))
})

test('reader: half a row waits for the rest; a last line that parsed and then grew is read again from the start', async () => {
  const w = new World()
  const log = w.log('thinking.jsonl')
  const reader = new Reader()
  await summary(w, { log }, reader)
  const row = JSON.stringify({ type: 'assistant', message: { id: 'msg_new', content: [{ type: 'text', text: 'half' }] }, timestamp: '2026-10-01T09:10:00.000Z' })
  w.append(log, row.slice(0, 30))
  expect((await summary(w, { log }, reader)).text).not.toBe('half')
  w.append(log, row.slice(30))
  expect((await summary(w, { log }, reader)).text).toBe('half') // no newline yet: parsed, as the summariser read it
  w.append(log, ' trailing garbage\n') // the writer carried that line on: the summariser now skips it
  const d = await summary(w, { log }, reader)
  expect(d.text).not.toBe('half')
  expect(d).toEqual(await summary(w, { log }))
})

test('reader: a re-pointed link, a file rewritten in place and a shrunk file are read afresh', async () => {
  const w = new World()
  const a = w.log('thinking.jsonl', `${DIR}/a.jsonl`)
  const b = w.log('finished.jsonl', `${DIR}/b.jsonl`)
  const link = `${DIR}/worker-current.jsonl`
  w.links.set(link, a)
  const reader = new Reader()
  expect((await summary(w, { log: link }, reader)).turns).toBe(7)
  w.links.set(link, b)
  const d = await summary(w, { log: link }, reader)
  expect(d.pending).toEqual({ kind: 'done' })
  expect(d.turns).toBe(3)
  // Rewritten in place, larger, the inode kept: the bytes before the read point differ.
  w.links.delete(link)
  w.put(link, LOGS['thinking.jsonl']!)
  await summary(w, { log: link }, reader)
  w.put(link, LOGS['runners.jsonl']! + LOGS['runners.jsonl']!)
  expect(await summary(w, { log: link }, reader)).toEqual(await summary(w, { log: link }))
  w.put(link, LOGS['failed.jsonl']!.slice(0, 300))
  expect(await summary(w, { log: link }, reader)).toEqual(await summary(w, { log: link }))
})

test('reader: a log fed a few bytes at a time reads as the whole file does', async () => {
  for (const name of ['running.jsonl', 'session-waiting.jsonl']) {
    const w = new World()
    const full = enc.encode(LOGS[name]!)
    const log = `${DIR}/${name}`
    const reader = new Reader()
    const cuts = [...Array.from({ length: Math.ceil(full.length / 1777) }, (_, i) => i * 1777), full.length]
    for (const cut of cuts) {
      w.put(log, full.slice(0, cut), NOW - 100 + cut / 1000)
      expect(await summary(w, { log }, reader)).toEqual(await summary(w, { log }))
    }
  }
})

test('reader: rows that are not UTF-8 are skipped, a BOM is not a row\'s', async () => {
  const w = new World()
  const row = (text: string): string => JSON.stringify({ type: 'assistant', message: { id: text, content: [{ type: 'text', text }] }, timestamp: '2026-10-01T09:00:01Z' })
  const bad = new Uint8Array([...enc.encode(row('ok')), 10, ...enc.encode('{"type": "assistant", "message": {"id": "x", "content": [{"type": "text", "text": "bad '), 0xff, ...enc.encode('"}]}}'), 10, 0xef, 0xbb, 0xbf, ...enc.encode(row('after a BOM')), 10])
  w.put(`${DIR}/odd.jsonl`, bad)
  const d = await summary(w, { log: `${DIR}/odd.jsonl` })
  expect(d.turns).toBe(2)
  expect(d.text).toBe('after a BOM')
})

// ── Replay (docs/DESIGN.md 21)

test('replay: before the first assistant row, mid run, mid tool, after the end', async () => {
  let d = await of('finished.jsonl', { until: START + 2 })
  expect(d.turns).toBe(0)
  expect(d.result).toBeNull()
  expect(d.pending!.kind).toBe('model')
  expect(d.events).toEqual([])
  expect(d.model).toBe('claude-sonnet-5-5') // the init row is before until
  expect(d.until).toBe(START + 2)
  expect(d.mtime).toBe(START + 2)
  expect(d.stalled).toBe(false)
  d = await of('finished.jsonl', { until: START + 7 })
  expect(d.turns).toBe(1)
  expect(d.pending).toEqual({ kind: 'model', since: epoch('2026-10-01T09:00:04.150Z') })
  expect(d.events!.filter(e => e.kind === 'tool').map(e => e.tool)).toEqual(['Read'])
  expect(d.last_diff).toBeNull() // the Write comes later
  expect(d.turn_secs).toEqual([pyRound(START + 7 - epoch('2026-10-01T09:00:04.100Z'), 1)])
  expect(d.cost!.usd < (await of('finished.jsonl')).cost!.usd).toBe(true)
  d = await of('running.jsonl', { until: START + 35 })
  expect(d.pending!.kind).toBe('tool')
  expect(d.pending!.kind === 'tool' && d.pending!.since).toBe(epoch('2026-10-01T09:00:34.220Z'))
  expect(d.turns).toBe(5)
  const live = await of('finished.jsonl')
  d = await of('finished.jsonl', { until: START + 60 })
  expect(d.pending).toEqual({ kind: 'done' })
  expect(d.result).toEqual(live.result)
  expect(d.events).toEqual(live.events)
  expect('until' in live).toBe(false)
})

test('replay: an unstamped row follows the row before it; an unstamped result lands at started + duration', async () => {
  const rows = LOGS['finished.jsonl']!.trim().split('\n').map(l => {
    const r = JSON.parse(l) as Record<string, unknown>
    if (r.type === 'user' || r.type === 'result') delete r.timestamp
    return JSON.stringify(r)
  })
  const w = new World()
  w.put(`${DIR}/unstamped.jsonl`, `${rows.join('\n')}\n`)
  const log = `${DIR}/unstamped.jsonl`
  expect((await summary(w, { log, until: START + 7 })).pending!.kind).toBe('model') // the Read's result follows its kept call
  let d = await summary(w, { log, until: START + 12 })
  expect(d.result).toBeNull()
  expect(d.turns).toBe(2)
  d = await summary(w, { log, until: START + 60 })
  expect(d.pending).toEqual({ kind: 'done' })
})

test('replay: one reader played forwards, seeking back, then live, reads as fresh readers do', async () => {
  for (const name of ['running.jsonl', 'session-waiting.jsonl']) {
    const w = new World()
    const log = w.log(name)
    const reader = new Reader()
    const until = [START - 2, START + 3, START + 9, START + 21, START + 40, START + 12, START + 200, START + 1, START + 90]
    for (const u of until) expect(await summary(w, { log, until: u }, reader)).toEqual(await summary(w, { log, until: u }))
    // Playing forwards re-reads only the rows the clock reached.
    w.bytesRead = 0
    await summary(w, { log, until: START + 92 }, reader)
    expect(w.bytesRead < 2000).toBe(true)
    expect(await summary(w, { log }, reader)).toEqual(await summary(w, { log }))
  }
})

test('replay: a transcript too', async () => {
  const full = await of('session-waiting.jsonl')
  const early = await of('session-waiting.jsonl', { until: Math.trunc(full.prompt!.t!) - 1 })
  expect(early.prompt!.text).toBe('Why does the dueSoon test fail? Fix it.')
  expect(early.pending!.kind).toBe('user')
})

// ── runs.jsonl (docs/DESIGN.md 22)

test('runs: one line for a finished log, once per real path and start', async () => {
  const w = new World()
  const log = w.log('finished.jsonl')
  w.links.set(`${DIR}/worker-current.jsonl`, log)
  const reader = new Reader()
  const d = await summary(w, { log: `${DIR}/worker-current.jsonl`, noRuns: false }, reader)
  await summary(w, { log: `${DIR}/worker-current.jsonl`, noRuns: false }, reader)
  await summary(w, { log, noRuns: false }) // the same real path, another reader: runs-seen.json says so
  const lines = w.text(`${DIR}/runs.jsonl`).trim().split('\n')
  expect(lines.length).toBe(1)
  const r = JSON.parse(lines[0]!) as Record<string, unknown>
  expect(Object.keys(r).sort()).toEqual(['cost_at', 'ctx_max', 'denials', 'duration_ms', 'errors', 'model', 'out_est', 'path', 'priced_at', 'source', 'subtype', 't', 'tests_last', 'turns'])
  expect(r.path).toBe(log)
  expect(r.source).toBe('worker')
  expect([r.model, r.subtype, r.turns]).toEqual([d.model, 'success', d.result!.turns])
  expect(r.duration_ms).toBe(d.result!.duration_ms)
  expect(r.ctx_max).toBe(Math.max(...d.ctx_series!))
  expect([r.out_est, r.errors, r.denials, r.t]).toEqual([d.out_est, d.errors, d.denials, d.last_ts])
  expect(r.priced_at).toBe(PRICES.checked)
  expect(r.cost_at).toEqual(d.cost!.at_all)
  // Written as the summariser wrote it: `, ` and `: ` between items.
  expect(lines[0]!.startsWith('{"t": ')).toBe(true)
  const seen = JSON.parse(w.text('/home/dev/.cache/lookout/runs-seen.json')) as Record<string, { started: number; file: string }>
  expect(seen[log]!.started).toBe(d.started!)
  expect(seen[log]!.file).toBe(`${DIR}/runs.jsonl`)
})

test('runs: tests_last, a runs file, never for a running log, a replay, or noRuns; an unwritable file is no failure', async () => {
  const w = new World()
  const log = w.log('runners.jsonl')
  const d = await summary(w, { log, noRuns: false })
  const r = JSON.parse(w.text(`${DIR}/runs.jsonl`).trim()) as { tests_last: unknown }
  const last = d.tests!.at(-1)!
  expect(r.tests_last).toEqual({ failed: last.failed, passed: last.passed, total: last.total })
  const w2 = new World()
  await summary(w2, { log: w2.log('running.jsonl'), noRuns: false })
  const fin = w2.log('finished.jsonl')
  await summary(w2, { log: fin, noRuns: true })
  await summary(w2, { log: fin, noRuns: false, until: START + 60 })
  expect(w2.files.has(`${DIR}/runs.jsonl`)).toBe(false)
  w2.dirs.add('/home/dev/elsewhere')
  await summary(w2, { log: fin, noRuns: false, runsFile: '~/elsewhere/scoreboard.jsonl' })
  expect(w2.text('/home/dev/elsewhere/scoreboard.jsonl').trim().split('\n').length).toBe(1)
  const w3 = new World()
  const x = await summary(w3, { log: w3.log('finished.jsonl'), noRuns: false, runsFile: '/no/such/dir/runs.jsonl' })
  expect(x.pending).toEqual({ kind: 'done' })
  expect('error' in x).toBe(false)
})

test('runs: a run the summariser recorded is not recorded again', async () => {
  const w = new World()
  const log = w.log('finished.jsonl')
  const started = (await summary(w, { log })).started
  w.put('/home/dev/.cache/lookout/runs-seen.json', JSON.stringify({ [log]: { started, at: NOW - 50, file: `${DIR}/runs.jsonl` } }))
  await summary(w, { log, noRuns: false })
  expect(w.files.has(`${DIR}/runs.jsonl`)).toBe(false)
})

// ── git, memory and their clocks

function gitWorld(): World {
  const w = new World()
  w.dirs.add('/home/dev/work/acme-todo/.git')
  w.commands = argv => {
    if (argv[0] !== 'git') return undefined
    const sub = argv[5]
    if (sub === 'log') return { code: 0, stdout: 'abc1234\t1790846000\tAdd due dates to todo items\n\n 1 file changed, 3 insertions(+)\n' }
    if (sub === 'branch') return { code: 0, stdout: 'main\n' }
    if (sub === 'diff') return { code: 0, stdout: ' 1 file changed, 1 insertion(+)\n' }
    if (sub === 'ls-files') return { code: 0, stdout: 'notes.txt\n' }
    return { code: 1, stdout: '' }
  }
  return w
}

test('git: commits since the start, the branch, the diff, the untracked files', async () => {
  const w = gitWorld()
  const g = (await summary(w, { log: w.log('finished.jsonl') })).git!
  expect(g).toEqual({ branch: 'main', commits: [{ hash: 'abc1234', t: 1790846000, subject: 'Add due dates to todo items', stat: '1 file changed, 3 insertions(+)' }], dirty: '1 file changed, 1 insertion(+)', untracked: 1 })
  const log = w.runs.find(a => a[5] === 'log')!
  expect(log.slice(0, 5)).toEqual(['git', '-c', 'core.fsmonitor=false', '-C', '/home/dev/work/acme-todo'])
  expect(log[6]).toBe(`--since=@${START}`)
  const none = new World()
  expect((await summary(none, { log: none.log('finished.jsonl') })).git).toBeNull() // no .git
})

test('git: asked again at most every 3 s while the log moves, every 15 s while it does not', async () => {
  const w = gitWorld()
  const log = w.log('thinking.jsonl')
  const reader = new Reader()
  const gits = (): number => w.runs.filter(a => a[0] === 'git').length
  await summary(w, { log }, reader)
  expect(gits()).toBe(4)
  w.now += 2
  await summary(w, { log }, reader)
  expect(gits()).toBe(4)
  w.append(log, '\n')
  w.now += 1.5
  await summary(w, { log }, reader)
  expect(gits()).toBe(8)
  w.now += 10
  await summary(w, { log }, reader)
  expect(gits()).toBe(8)
  w.now += 6
  await summary(w, { log }, reader)
  expect(gits()).toBe(12)
})

test('memory: vm_stat and sysctl on macOS, /proc/meminfo on Linux, kept 10 s', async () => {
  expect(parseMeminfo('MemTotal:       32768000 kB\nMemFree:  1000 kB\nMemAvailable:   16384000 kB\n')).toEqual({ free_gb: 16384000 / 2 ** 20, total_gb: 32768000 / 2 ** 20 })
  expect(parseVmStat(VM_STAT, String(64 * 2 ** 30))).toEqual({ free_gb: (160000 * 16384) / 2 ** 30, total_gb: 64 })
  const w = new World()
  const log = w.log('running.jsonl')
  const reader = new Reader()
  expect((await summary(w, { log }, reader)).memory).toEqual({ at: NOW, free_gb: (160000 * 16384) / 2 ** 30, total_gb: 64 })
  w.now += 5
  expect((await summary(w, { log }, reader)).memory!.at).toBe(NOW)
  w.now += 6
  expect((await summary(w, { log }, reader)).memory!.at).toBe(NOW + 11)
  const linux = new World()
  linux.platform = 'linux'
  linux.put('/proc/meminfo', 'MemTotal: 2097152 kB\nMemAvailable: 1048576 kB\n')
  expect((await summary(linux, { log: linux.log('running.jsonl') })).memory).toEqual({ at: NOW, free_gb: 1, total_gb: 2 })
  const neither = new World()
  neither.platform = undefined
  neither.commands = argv => (argv[0] === 'vm_stat' || argv[0] === 'sysctl' ? { code: 1, stdout: '' } : undefined)
  expect((await summary(neither, { log: neither.log('running.jsonl') })).memory).toEqual({ at: NOW })
})

// ── Model servers (docs/DESIGN.md 7)

test('adapters: the parsers', () => {
  const r = parseMlxLog(splitlines(sample('mlx-serve-log.txt')))
  expect(r.ctx_limit).toBe(131072)
  expect(r.done.length).toBe(2)
  expect(r.done[0]).toEqual({ prompt: 8200, gen: 310, prefill_tps: 512.4, cached: 7900, decode_tps: 41.7, stop: 'end_turn', spec: 2.55 })
  expect(r.done[1]!.spec).toBeNull()
  expect(r.done[1]!.stop).toBe('tool_use')
  expect(r.inflight).toEqual({ msgs: 16, prompt: 9600, cached: 9172 })
  expect(parseMlxModels(JSON.parse(sample('mlx-models.json')))).toEqual({ model: 'local/qwen-coder-32b-q4', resident_gb: 18, ctx_limit: 131072 })
  expect(parseMlxModels({ data: [] })).toBeNull()
  const m = parsePrometheus(sample('vllm-metrics-1.txt'))
  expect(m['vllm:num_requests_running']).toBe(1)
  expect(m['vllm:prompt_tokens_total']).toBe(100000)
  expect('vllm:time_to_first_token_seconds_bucket' in m).toBe(false) // NaN dropped
  expect(parsePrometheus('a{x="1"} 2\na{x="2"} 3\n# c\nbad line\n')).toEqual({ a: 5 })
  expect(parseLlamacppProps(JSON.parse(sample('llamacpp-props.json')))).toEqual({ model: 'qwen-coder-32b-q4_k_m', ctx_limit: 32768 })
  const s = parseLlamacppSlots(JSON.parse(sample('llamacpp-slots.json')))!
  expect(s.running).toBe(1)
  expect(s.inflight!.prompt).toBe(5120)
  expect(parseLlamacppMetrics(sample('llamacpp-metrics.txt'))).toEqual({ prefill_tps: 612.4, decode_tps: 35.8, kv_used: 0.417, running: 1 })
  expect(parseOllamaPs(JSON.parse(sample('ollama-ps.json')))).toEqual({ model: 'qwen-coder:32b-q4', resident_gb: 19, ctx_limit: 32768 })
  expect(parseOllamaPs({ models: [] })).toEqual({ model: null, resident_gb: null, ctx_limit: null })
  expect(parseOllamaPs('nope')).toBeNull()
  expect(parseLmstudioModels(JSON.parse(sample('lmstudio-models.json')))).toEqual({ model: 'qwen-coder-32b-instruct', ctx_limit: 32768 })
  const prev = vllmSample(sample('vllm-metrics-1.txt'), 100)
  expect(parseVllmMetrics(sample('vllm-metrics-1.txt'), null, 100)).toEqual({ running: 1, kv_used: 0.25 })
  expect(parseVllmMetrics(sample('vllm-metrics-2.txt'), prev, 102)).toEqual({ running: 2, kv_used: 0.375, decode_tps: 75, prefill_tps: 1500 })
  // A counter going backwards (a server restart) gives no rate.
  expect('decode_tps' in parseVllmMetrics(sample('vllm-metrics-1.txt'), vllmSample(sample('vllm-metrics-2.txt'), 0), 1)!).toBe(false)
})

const URL_ = 'http://model-server.invalid:1'

function fake(routes: Record<string, [number | null, string]>): Get {
  return async url => {
    for (const [suffix, r] of Object.entries(routes)) if (url.endsWith(suffix)) return [r[0], r[0] !== null && r[0] >= 200 && r[0] < 300 ? r[1] : r[0] === null ? r[1] : '']
    return [404, '']
  }
}

function ctxOf(get: Get, now = NOW, log: string[] | null = null): ServerCtx {
  return { get, now, vllm: new Map(), tail: async () => (log ? { lines: log, mtime: NOW - 5 } : Promise.reject(new Error('no log'))) }
}

test('adapters: stats for each server, and none of them throws', async () => {
  let st = await serverStats('mlx-serve', URL_, '/logs/server.log', ctxOf(fake({ '/v1/models': [200, sample('mlx-models.json')] }), NOW, splitlines(sample('mlx-serve-log.txt'))))
  expect([st.adapter, st.ok, st.model, st.resident_gb, st.done!.length, st.log_mtime, st.sampled_at]).toEqual(['mlx-serve', true, 'local/qwen-coder-32b-q4', 18, 2, NOW - 5, NOW])
  st = await serverStats('mlx-serve', URL_, null, ctxOf(fake({ '/v1/models': [null, 'refused'] })))
  expect([st.ok, st.note]).toEqual([false, 'no server log set; models endpoint unavailable'])
  const llama = { '/props': [200, sample('llamacpp-props.json')], '/slots': [200, sample('llamacpp-slots.json')] } as Record<string, [number | null, string]>
  st = await serverStats('llama.cpp', URL_, null, ctxOf(fake({ ...llama, '/metrics': [501, ''] })))
  expect([st.ok, st.note, st.ctx_limit, st.inflight!.prompt, st.rates]).toEqual([true, 'metrics disabled', 32768, 5120, { running: 1 }])
  st = await serverStats('llama.cpp', URL_, null, ctxOf(fake({ ...llama, '/metrics': [200, sample('llamacpp-metrics.txt')] })))
  expect([st.rates!.decode_tps, 'note' in st]).toEqual([35.8, false])
  st = await serverStats('ollama', URL_, null, ctxOf(fake({ '/api/ps': [200, sample('ollama-ps.json')] })))
  expect([st.ok, st.rates, st.note]).toEqual([true, null, 'rates unavailable'])
  st = await serverStats('lmstudio', URL_, null, ctxOf(fake({ '/api/v0/models': [200, sample('lmstudio-models.json')] })))
  expect([st.ok, st.ctx_limit]).toEqual([true, 32768])
  const vctx = ctxOf(fake({ '/metrics': [200, sample('vllm-metrics-1.txt')], '/v1/models': [200, sample('vllm-models.json')] }))
  st = await serverStats('vllm', URL_, null, vctx)
  expect([st.ctx_limit, 'decode_tps' in st.rates!, st.note]).toEqual([65536, false, 'rates after the next poll'])
  st = await serverStats('vllm', URL_, null, { ...vctx, now: NOW + 2, get: fake({ '/metrics': [200, sample('vllm-metrics-2.txt')], '/v1/models': [200, sample('vllm-models.json')] }) })
  expect([st.rates!.decode_tps, st.rates!.running]).toEqual([75, 2])
  const boom: Get = async () => {
    throw new TypeError('boom')
  }
  for (const name of ['mlx-serve', 'llama.cpp', 'vllm', 'ollama', 'lmstudio'] as const) {
    const x = await serverStats(name, URL_, null, ctxOf(boom))
    expect([x.ok, typeof x.note]).toEqual([false, 'string'])
  }
})

test('adapters: auto finds the first server that answers, and stops when nothing does', async () => {
  expect(await detect(fake({ '/api/version': [200, '{"version": "0.0.0"}'] }), URL_)).toBe('ollama')
  expect(await detect(fake({ '/props': [200, sample('llamacpp-props.json')], '/v1/models': [200, '{"data": [{"id": "m"}]}'] }), URL_)).toBe('llama.cpp')
  let calls = 0
  const refused: Get = async () => {
    calls++
    return [null, 'connection refused']
  }
  expect(await detect(refused, URL_)).toBeNull()
  expect(calls).toBe(1) // nothing answers: stop after the first probe
  expect(await detect(fake({}), URL_)).toBeNull() // 404 everywhere
})

test('server: none for an API model, a finished run or a transcript; auto at a set URL kept 60 s', async () => {
  expect((await of('finished.jsonl', { server: 'auto', serverUrl: URL_ })).server).toBeNull()
  const t = new World()
  await summary(t, { log: t.log('session-running.jsonl'), server: 'auto', serverUrl: URL_ })
  expect(t.fetches).toEqual([])
  const w = new World()
  w.routes = { '/api/version': [200, '{"version": "0.0.0"}'], '/api/ps': [200, sample('ollama-ps.json')] }
  w.up.add(URL_)
  const log = w.log('running.jsonl')
  const reader = new Reader()
  const d = await summary(w, { log, server: 'auto', serverUrl: URL_ }, reader)
  expect([d.server!.adapter, d.server!.model]).toEqual(['ollama', 'qwen-coder:32b-q4'])
  expect(d.memory!.server_gb).toBe(19)
  expect(d.memory!.server_model).toBe('qwen-coder:32b-q4')
  const probes = w.fetches.filter(u => !u.endsWith('/api/ps')).length
  w.now += 30
  await summary(w, { log, server: 'auto', serverUrl: URL_ }, reader)
  expect(w.fetches.filter(u => !u.endsWith('/api/ps')).length).toBe(probes)
  w.now += 31
  await summary(w, { log, server: 'auto', serverUrl: URL_ }, reader)
  expect(w.fetches.filter(u => !u.endsWith('/api/ps')).length > probes).toBe(true)
})

test('server: with no URL set, auto finds a server at its own default port and keeps it for the log', async () => {
  const w = new World()
  // Ollama on 11434 and nothing on 8080, 8000 or 1234.
  w.routes = { ':11434/api/version': [200, '{"version": "0.0.0"}'], ':11434/api/ps': [200, sample('ollama-ps.json')] }
  w.up.add('http://127.0.0.1:11434')
  const log = w.log('running.jsonl')
  const reader = new Reader()
  const d = await summary(w, { log, server: 'auto' }, reader)
  expect([d.server!.adapter, d.server!.ok]).toEqual(['ollama', true])
  const sweep = w.fetches.length
  w.fetches = []
  w.now += 100
  await summary(w, { log, server: 'auto' }, reader)
  expect(w.fetches).toEqual(['http://127.0.0.1:11434/api/ps']) // kept: no sweep while it answers
  // It stops answering: one more sweep, then none for 30 s.
  w.routes = {}
  w.fetches = []
  expect((await summary(w, { log, server: 'auto' }, reader)).server).toBeNull()
  expect(w.fetches.length > 1 && w.fetches.length <= sweep + 1).toBe(true)
  w.fetches = []
  w.now += 10
  expect((await summary(w, { log, server: 'auto' }, reader)).server).toBeNull()
  expect(w.fetches).toEqual([])
  // A named adapter with no URL asks at its own default port.
  w.routes = { ':1234/api/v0/models': [200, sample('lmstudio-models.json')] }
  expect((await summary(w, { log, server: 'lmstudio' })).server!.model).toBe('qwen-coder-32b-instruct')
})

// ── Session transcripts (docs/DESIGN.md 36)

type Kind = ['prompt' | 'meta', string] | ['asst', string[], string | null] | ['result'] | ['end'] | ['interrupt']

/** Session transcript rows, each with the bookkeeping keys and a timestamp a second after the last. */
function transcriptRows(...rows: Kind[]): Record<string, unknown>[] {
  return rows.map((r, i) => {
    const s = i + 1
    const when = `2026-10-01T09:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000Z`
    const base = { parentUuid: null, isSidechain: false, sessionId: 's-1', uuid: `u-${i}`, cwd: '/home/dev/work/acme-todo', timestamp: when }
    if (r[0] === 'prompt' || r[0] === 'meta') return { ...base, type: 'user', message: { role: 'user', content: r[1] }, ...(r[0] === 'meta' ? { isMeta: true } : {}) }
    if (r[0] === 'interrupt') return { ...base, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }
    if (r[0] === 'asst') {
      const blocks = r[1].map(b => (b === 'tool_use' ? { type: 'tool_use', id: `toolu_${i}`, name: 'Bash', input: { command: 'npm test' } } : b === 'thinking' ? { type: 'thinking', thinking: 'Plan the change.' } : { type: 'text', text: 'Done.' }))
      return { ...base, type: 'assistant', message: { id: `msg_${i}`, model: 'claude-opus-5-5', role: 'assistant', content: blocks, stop_reason: r[2], usage: { input_tokens: 10, cache_read_input_tokens: 1000 * i, cache_creation_input_tokens: 0 } } }
    }
    if (r[0] === 'result') return { ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i - 1}`, content: 'ok', is_error: false }] } }
    return { ...base, type: 'system', subtype: 'turn_duration', durationMs: 1000 }
  })
}

test('transcript: told by its rows; the model from the messages; no result, hand-off or server', async () => {
  const d = await of('session-waiting.jsonl')
  expect(d.transcript).toBe(true)
  expect(d.model).toBe('claude-opus-5-5')
  expect(d.cwd).toBe('/home/dev/work/acme-todo')
  expect(d.result).toBeNull()
  expect(d.handoff).toBeNull()
  for (const name of ['running.jsonl', 'finished.jsonl']) {
    const x = await of(name)
    expect(['transcript' in x, 'prompt' in x]).toEqual([false, false])
  }
})

test('transcript: the latest prompt is the task; a turn that ended waits on the person, never stalled', async () => {
  const d = await of('session-waiting.jsonl')
  expect(d.prompt!.text).toBe("Now add a --due flag to the CLI's add command.")
  expect(typeof d.prompt!.t).toBe('number')
  expect(d.pending).toEqual({ kind: 'user', since: d.last_ts! })
  expect(d.stalled).toBe(false)
  const w = new World()
  expect((await summary(w, { log: w.log('session-waiting.jsonl', `${DIR}/quiet.jsonl`, NOW - 3600), stallSecs: 60 })).stalled).toBe(false)
  const r = await of('session-running.jsonl')
  expect(r.pending!.kind === 'tool' && r.pending!.label).toBe('Typecheck the project')
})

test('transcript: side chains left out; turns timed from what they answer; priced at its own model', async () => {
  const d = await of('session-waiting.jsonl')
  const tools = Object.fromEntries(d.tool_counts!)
  expect('Grep' in tools).toBe(false) // the subagent's
  expect(tools.Agent).toBe(1)
  expect(d.turns).toBe(8)
  expect(d.tests!.map(t => [t.failed, t.total])).toEqual([[1, 12], [0, 12]])
  expect(d.think_ms).toBe(5700)
  expect(d.turn_secs!.length).toBe(8)
  expect(Math.max(...d.turn_secs!) < 60).toBe(true) // the 95 s the person took is no turn's
  expect((await of('session-waiting.jsonl', { compare: 'claude-sonnet-5-5' })).cost!.compare).toBe('claude-opus-5-5')
  expect((await of('session-waiting.jsonl', { compare: 'off' })).cost).toBeNull()
  const prices = (): Record<string, unknown> => PRICES
  expect(ownPrice('claude-opus-5-5-20261001', 'claude-sonnet-5-5', prices)).toBe('claude-opus-5-5')
  expect(ownPrice('claude-opus-5-5[1m]', 'claude-sonnet-5-5', prices)).toBe('claude-opus-5-5')
  expect(ownPrice('local/qwen-coder-32b-q4', 'claude-sonnet-5-5', prices)).toBe('claude-sonnet-5-5')
  expect(ownPrice('claude-opus-5-5', 'off', prices)).toBe('off')
})

test('transcript: a missing one with the flag says so', async () => {
  const w = new World()
  const d = await summary(w, { log: '/nonexistent/dir/s-2.jsonl', transcript: true })
  expect([d.exists, d.transcript, d.prompt, d.server]).toEqual([false, true, null, null])
  expect('transcript' in (await summary(w, { log: '/nonexistent/dir/s-2.jsonl' }))).toBe(false)
})

test('transcript: whose move it is', async () => {
  const cases: [Kind[], string][] = [
    [[['prompt', 'Fix it.']], 'model'],
    [[['prompt', 'Fix it.'], ['asst', ['thinking'], null]], 'model'], // thinking never ends a turn
    [[['prompt', 'Fix it.'], ['asst', ['thinking'], 'tool_use']], 'model'], // its tool call is coming
    [[['prompt', 'Fix it.'], ['asst', ['tool_use'], 'tool_use']], 'tool'],
    [[['prompt', 'Fix it.'], ['asst', ['tool_use'], 'tool_use'], ['result']], 'model'],
    [[['prompt', 'Fix it.'], ['asst', ['text'], 'end_turn']], 'user'],
    [[['prompt', 'Fix it.'], ['asst', ['text'], null]], 'user'], // no stop reason written: no tool call pending
    [[['prompt', 'Fix it.'], ['asst', ['text'], 'end_turn'], ['end']], 'user'],
    [[['prompt', 'Fix it.'], ['asst', ['tool_use'], 'tool_use'], ['interrupt']], 'user'],
    [[['prompt', 'Fix it.'], ['asst', ['text'], 'end_turn'], ['meta', '<local-command-caveat>x</local-command-caveat>'], ['prompt', '<command-name>/model</command-name>']], 'user'],
    [[['prompt', 'Fix it.'], ['asst', ['text'], 'end_turn'], ['meta', "A teammate's message."]], 'model'],
    [[], 'user'], // nothing asked yet
  ]
  for (const [rows, kind] of cases) {
    const w = new World()
    const body = rows.length ? transcriptRows(...rows) : [{ type: 'file-history-snapshot', snapshot: {} }]
    w.put(`${DIR}/s-1.jsonl`, `${body.map(r => JSON.stringify(r)).join('\n')}\n`)
    const d = await summary(w, { log: `${DIR}/s-1.jsonl`, transcript: true })
    expect([JSON.stringify(rows), d.pending!.kind]).toEqual([JSON.stringify(rows), kind])
  }
})

test('transcript: only what the person typed is a prompt', async () => {
  const rows = transcriptRows(['prompt', 'Add due dates.'], ['asst', ['text'], 'end_turn'], ['meta', "A teammate's message."], ['asst', ['text'], 'end_turn'], ['prompt', '<task-notification>done</task-notification>'])
  rows[rows.length - 1]!.origin = { kind: 'task-notification' }
  const w = new World()
  w.put(`${DIR}/s-1.jsonl`, `${rows.map(r => JSON.stringify(r)).join('\n')}\n`)
  expect((await summary(w, { log: `${DIR}/s-1.jsonl` })).prompt!.text).toBe('Add due dates.')
})

// ── Python's semantics, where the output depends on them

test('py: rounding, float repr, json.dumps, whitespace, lines and timestamps as Python has them', () => {
  expect([pyRound(2.25, 1), pyRound(2.35, 1), pyRound(0.125, 2), pyRound(-0.25, 1), pyRound(1.0004999, 3), pyRound(2.675, 2)]).toEqual([2.2, 2.4, 0.12, -0.2, 1, 2.67])
  expect([floatRepr(0.0001), floatRepr(1e-5), floatRepr(1e16), floatRepr(123.0), floatRepr(1.5e-7), floatRepr(0.1)]).toEqual(['0.0001', '1e-05', '1e+16', '123.0', '1.5e-07', '0.1'])
  expect(pyDumps({ a: 'café 😀', b: [1, 2.5, true, null], c: '\u007f' })).toBe('{"a": "caf\\u00e9 \\ud83d\\ude00", "b": [1, 2.5, true, null], "c": "\\u007f"}')
  expect(pyDumps({ a: 'café' }, false)).toBe('{"a": "café"}')
  expect(oneLine('  a b\x1c\nc  ', 160)).toBe('a b c')
  expect(oneLine('x'.repeat(300), 10)).toBe(`${'x'.repeat(9)}…`)
  expect(oneLine('😀'.repeat(20), 5)).toBe(`${'😀'.repeat(4)}…`)
  expect(splitlines('a\r\nb\rc d\n')).toEqual(['a', 'b', 'c', 'd'])
  expect(splitlines('')).toEqual([])
  expect(strip('﻿ x \x85')).toBe('﻿ x')
  expect(isoTs('2026-10-01T09:00:00.000Z')).toBe(START)
  expect(isoTs('2026-10-01 09:00:00.123456789Z')).toBe(START + 0.123456)
  expect(isoTs('2026-10-01T09:00:00.1+01:00')).toBe(START - 3600 + 0.1)
  expect(isoTs('20261001T090000Z')).toBe(START)
  expect(isoTs('2026-10-01T09:00:00,5Z')).toBe(START + 0.5)
  expect(isoTs('2026-10-01T09:00:00-00:00:30.5')).toBe(START + 30.5)
  expect([isoTs('2026-10-01T24:00:00Z'), isoTs('2026-02-30T00:00:00Z'), isoTs(' 2026-10-01T09:00:00Z'), isoTs('2026-10-01T09:00:00.Z'), isoTs(1790845200)]).toEqual([null, null, null, null, null])
})

// ── The Io over the mod's `$`

test('modIo: small reads whole through $.fs, large ones through a process; append by tee; a fetch that hangs times out', async () => {
  const calls: unknown[] = []
  const bytes = enc.encode('0123456789')
  const b64 = (u: Uint8Array): string => (u as unknown as { toBase64(): string }).toBase64()
  const $ = {
    plugin: { root: ROOT },
    clock: { now: async () => NOW * 1000, sleep: async (_ms: number, o?: { signal?: AbortSignal }) => new Promise<void>((res, rej) => { o?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); void Promise.resolve().then(res) }) },
    env: { get: async (n: string) => (n === 'HOME' ? HOME : undefined) },
    fs: {
      read: async (p: string, o?: { as: string }) => {
        calls.push(['fs.read', p, o?.as])
        return o?.as === 'bytes' ? { base64: b64(bytes) } : 'text'
      },
      write: async (p: string, t: string) => void calls.push(['fs.write', p, t]),
      stat: async (p: string) => ({ kind: 'file', size: 10, mtimeMs: 1500, isLink: false, realPath: `/real${p}` }),
    },
    process: {
      run: async (argv: string[], init: { stdin?: string }) => {
        calls.push(['run', argv, init.stdin])
        return { exitCode: 0, stdout: argv[0] === '/bin/sh' ? b64(bytes.slice(3, 7)) : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      },
    },
    http: { fetch: () => new Promise(() => {}) },
  }
  const io = modIo($ as never)
  expect(await io.now()).toBe(NOW)
  expect(await io.env('HOME')).toBe(HOME)
  expect(await io.stat('/x')).toEqual({ kind: 'file', size: 10, mtime: 1.5, real: '/real/x' })
  expect([...(await io.read('/x', 2, 3))]).toEqual([...enc.encode('234')])
  expect(calls.at(-1)).toEqual(['fs.read', '/x', 'bytes'])
  expect([...(await io.read('/x', 2 * 1024 * 1024, 4))]).toEqual([...enc.encode('3456')])
  expect(calls.at(-1)).toEqual(['run', ['/bin/sh', '-c', 'tail -c +"$1" -- "$2" | head -c "$3" | base64', 'sh', String(2 * 1024 * 1024 + 1), '/x', '4'], undefined])
  await io.append('/logs/runs.jsonl', 'line\n')
  expect(calls.at(-1)).toEqual(['run', ['tee', '-a', '/logs/runs.jsonl'], 'line\n'])
  expect(await io.fetch('http://127.0.0.1:9/x', 1500)).toEqual({ status: null, text: 'timed out' })
})
