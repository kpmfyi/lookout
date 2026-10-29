// The log reader (docs/DESIGN.md 3, 43.5): one Summary for one stream-json log or session
// transcript, as the Python summariser it replaced printed it, from an Io. A Reader keeps what one
// poll leaves the next: each log's parse (follow.ts), and the live parts' last answers, each on its
// own clock.
//
//   - the log: every poll, reading only what was appended;
//   - git: at most every 3 s while the log moves, else every 15 s (the summariser ran four git
//     commands on every poll; a commit or an edit shows within a poll or two of its tool call);
//   - memory: every 10 s (the summariser's mem.json did the same);
//   - the model server: every poll (in-flight requests move), `auto`'s answer kept 60 s when
//     found and 15 s when not (the summariser's auto.json); with no URL set, the first answer of
//     the servers' own default URLs is kept for the log and probed again at most every 30 s;
//   - the hand-off file: stat every poll, read again when it changes;
//   - prices.json: read again every 30 s.
import type { Summary } from '../../types'
import { estimateCost, costAtAll, ownPrice } from './cost.ts'
import type { PriceTable, Prices } from './cost.ts'
import { Follower } from './follow.ts'
import type { Io, IoStat } from './io.ts'
import { readGit, readMemory, realpath, resolveHandoff } from './live.ts'
import { turnSecs } from './parse.ts'
import type { Parsed, Priv } from './parse.ts'
import { basename, dirname, expandUser, isDict, joinPath, pyDumps, pyEq, pyRound, pyStr, roundHalfEven, splitlines, truthy } from './py.ts'
import { ORDER, defaultUrl, detect, isAdapter, serverStats } from './server.ts'
import type { Adapter, Get, ServerCtx, VllmSample } from './server.ts'

/** The reader's options: the summariser's flags (docs/DESIGN.md 3), by name. */
export type ReaderOptions = {
  /** The log's path as given (`~` allowed). */
  log: string
  /** `auto` (default), `none`, or an adapter. */
  server?: 'auto' | 'none' | Adapter | string
  /** The server's base URL; unset, each adapter's own default URL (hooks/worker-setup.ts). */
  serverUrl?: string
  /** mlx-serve's log file. */
  serverLog?: string
  /** An API model id from prices.json, `custom`, or `off` (default claude-sonnet-5-5). */
  compare?: string
  /** `in,out,cacheWrite,cacheRead` in $/Mtok, with compare `custom`. */
  customPrices?: string
  /** The hand-off file; default `<log>.handoff.md` beside the log. */
  handoff?: string
  /** Seconds without a write, the model's move, before `stalled` (default 180). */
  stallSecs?: number
  /** Replay (docs/DESIGN.md 21): the log as if it ended at this epoch second. */
  until?: number
  /** Where finished runs are appended (docs/DESIGN.md 22); default runs.jsonl beside the log's real path. */
  runsFile?: string
  /** Append no finished runs. */
  noRuns?: boolean
  /** Read the log as a session transcript even before it exists (docs/DESIGN.md 36). */
  transcript?: boolean
}

const MAX_LOGS = 8
const GIT_MOVING = 3
const GIT_IDLE = 15
const MEMORY_SECS = 10
const PRICES_SECS = 30
const FOUND_SECS = 60
const NONE_SECS = 15
const SWEEP_SECS = 30
const FETCH_MS = 1500
const LOG_TAIL = 400_000

type Timed<T> = { at: number; value: T }

export class Reader {
  private readonly logs = new Map<string, Follower>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private prices: Timed<PriceTable | Error> | null = null
  private memory: Timed<NonNullable<Summary['memory']>> | null = null
  private readonly git = new Map<string, Timed<Summary['git']> & { sig: string }>()
  private readonly detected = new Map<string, Timed<Adapter | null>>()
  /** With no URL set: per log, the server found at the adapters' default URLs. */
  private readonly swept = new Map<string, Timed<{ name: Adapter; url: string } | null>>()
  private readonly vllm = new Map<string, VllmSample>()
  private readonly tails = new Map<string, { size: number; mtime: number; lines: string[] }>()
  private readonly handoffs = new Map<string, { size: number; mtime: number; head: string }>()
  /** Runs this reader has seen written (or already there), by real path and start. */
  private readonly recorded = new Set<string>()

  /** The Summary of `o.log` now; never throws (a failure is the Summary's `error`). */
  async summarize(io: Io, o: ReaderOptions): Promise<Summary> {
    try {
      return await this.build(io, o)
    } catch (err) {
      const home = await io.env('HOME').catch(() => undefined)
      const path = expandUser(o.log, home)
      const st = await io.stat(path).catch(() => null)
      return { path, exists: st?.kind === 'file', source: { name: sourceName(o.log), path: o.log }, error: `log reader failed: ${errName(err)}` }
    }
  }

  private async build(io: Io, o: ReaderOptions): Promise<Summary> {
    const clock = await io.now()
    const until = o.until ?? null
    const untilKey = until !== null ? roundHalfEven(until) : null
    const now = until ?? clock // the last turn runs to the replay clock
    const home = await io.env('HOME')
    const given = o.log
    const path = expandUser(given, home)
    const told = !!o.transcript
    const compareOpt = o.compare ?? 'claude-sonnet-5-5'
    const out: Summary = { path, exists: false, source: { name: sourceName(given), path: given } }

    const st = await io.stat(path)
    if (st && st.kind !== 'file') out.error = 'not a regular file'
    let parsed: Parsed | null = null
    let priv: Priv | null = null
    let real = st?.real ?? path
    if (st && st.kind === 'file') {
      if (!st.real) real = await realpath(io, path)
      out.exists = true
      out.size = st.size
      out.mtime = st.mtime
      if (until !== null) {
        out.mtime = until
        out.until = until
      }
      try {
        ;({ out: parsed, priv } = await this.follow(io, path, st, told, untilKey))
      } catch (err) {
        out.error = `parse failed: ${errName(err)}`
      }
      if (parsed && priv) {
        const prices = this.priceTable(io, clock)
        Object.assign(out, parsed)
        out.turn_secs = turnSecs(parsed, priv, now, x => pyRound(x, 1))
        out.stalled = until === null && parsed.pending?.kind === 'model' && now - st.mtime > (o.stallSecs ?? 180)
        const table = await prices
        const compare = parsed.transcript ? ownPrice(parsed.model, compareOpt, table) : compareOpt
        out.cost = safeSync(() => estimateCost(priv!, parsed!.out_est, compare, o.customPrices ?? '', table))
        out.git = await safe(this.gitOf(io, parsed.cwd, parsed.started, `${st.size}:${st.mtime}`, clock))
        if (parsed.result && until === null && !o.noRuns) await safe(this.record(io, out, priv, real, o.runsFile ?? '', clock, home, table))
      }
    }

    // A session (docs/DESIGN.md 36) has no hand-off (its prompt is the task) and no model server to
    // probe; its file may not exist yet, so the flag says it is one too.
    const session = told || !!parsed?.transcript
    if (session && !parsed) {
      out.transcript = true
      out.prompt = null
    }
    const model = parsed?.model
    const done = !!parsed?.result
    const [handoff, server, memory] = await Promise.all([
      session ? null : safe(this.handoffOf(io, given, o.handoff ? expandUser(o.handoff, home) : null, home)),
      session ? null : safe(this.serverOf(io, o, model, done, path, clock, home)),
      safe(this.memoryOf(io, clock)),
    ])
    out.handoff = handoff
    out.server = server
    let mem = memory
    if (mem && server && server.ok) {
      mem = { ...mem }
      if (server.resident_gb !== undefined && server.resident_gb !== null) mem.server_gb = server.resident_gb
      if (truthy(server.model)) mem.server_model = server.model!
    }
    out.memory = mem
    return out
  }

  /** The log's parse, one poll at a time per log (a slow poll and the next one never interleave). */
  private follow(io: Io, path: string, st: IoStat, told: boolean, until: number | null): Promise<{ out: Parsed; priv: Priv }> {
    const key = `${told ? 't' : 'l'}${until === null ? 'live' : 'replay'}\0${path}`
    return this.serial(key, async () => {
      let f = this.logs.get(key)
      if (f) this.logs.delete(key)
      else f = new Follower(told, until !== null)
      this.logs.set(key, f) // newest last: the oldest is dropped past MAX_LOGS
      while (this.logs.size > MAX_LOGS) this.logs.delete(this.logs.keys().next().value!)
      return f.sync(io, path, st, until)
    })
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)
    this.queues.set(key, tail)
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return next
  }

  private async priceTable(io: Io, clock: number): Promise<Prices> {
    if (!this.prices || clock - this.prices.at >= PRICES_SECS || clock < this.prices.at) {
      let value: PriceTable | Error
      try {
        const t = JSON.parse(await io.readText(joinPath(io.root, 'hooks/prices.json'))) as unknown
        value = isDict(t) ? t : new TypeError('prices.json is not an object')
      } catch (err) {
        value = err instanceof Error ? err : new Error(String(err))
      }
      this.prices = { at: clock, value }
    }
    const v = this.prices.value
    return () => {
      if (v instanceof Error) throw v
      return v
    }
  }

  private async memoryOf(io: Io, clock: number): Promise<NonNullable<Summary['memory']>> {
    if (this.memory && clock - this.memory.at < MEMORY_SECS && clock >= this.memory.at) return { ...this.memory.value }
    const value = await readMemory(io, clock)
    this.memory = { at: clock, value }
    return { ...value }
  }

  private async gitOf(io: Io, cwd: unknown, since: number | null | undefined, sig: string, clock: number): Promise<Summary['git']> {
    if (typeof cwd !== 'string' || !cwd) return null
    const key = `${cwd}\0${Math.trunc(since || 0)}`
    const c = this.git.get(key)
    if (c && clock >= c.at) {
      const age = clock - c.at
      if (age < (c.sig === sig ? GIT_IDLE : GIT_MOVING)) return copyGit(c.value)
    }
    const value = await readGit(io, cwd, since)
    this.git.set(key, { at: clock, value, sig })
    if (this.git.size > MAX_LOGS) this.git.delete(this.git.keys().next().value!)
    return copyGit(value)
  }

  /** The hand-off, its head read again only when the file's size or mtime moved. */
  private handoffOf(io: Io, given: string, explicit: string | null, home: string | undefined): Promise<Summary['handoff']> {
    return resolveHandoff(io, expandUser(given, home), explicit, async (c, st) => {
      const h = this.handoffs.get(c)
      if (h && h.size === st.size && h.mtime === st.mtime) return h.head
      const head = new TextDecoder().decode(await io.read(c, 0, 65536))
      this.handoffs.set(c, { size: st.size, mtime: st.mtime, head })
      if (this.handoffs.size > MAX_LOGS) this.handoffs.delete(this.handoffs.keys().next().value!)
      return head
    })
  }

  private async serverOf(io: Io, o: ReaderOptions, model: unknown, done: boolean, logKey: string, clock: number, home: string | undefined): Promise<Summary['server']> {
    const name = o.server ?? 'auto'
    if (name === 'none' || done || pyStr(model ?? null).startsWith('claude')) return null
    const get: Get = async url => {
      const r = await io.fetch(url, FETCH_MS)
      if (r.status === null) return [null, r.text]
      return [r.status, r.status >= 200 && r.status < 300 ? r.text : '']
    }
    const ctx: ServerCtx = {
      get,
      now: clock,
      vllm: this.vllm,
      tail: p => this.tail(io, expandUser(p, home)),
    }
    const log = o.serverLog || null
    const set = o.serverUrl || undefined
    if (name !== 'auto') {
      if (!isAdapter(name)) return null
      return serverStats(name, set ?? defaultUrl(name), log, ctx)
    }
    if (set !== undefined) {
      const found = await this.detectAt(get, set, clock)
      return found ? serverStats(found, set, log, ctx) : null
    }
    // No URL set: each adapter's own default URL, the first that answers kept for this log; looked
    // for again at most every 30 s while none answers, or once the one found stops answering.
    const kept = this.swept.get(logKey)
    const fresh = !!kept && clock >= kept.at && clock - kept.at < SWEEP_SECS
    let last: Summary['server'] = null
    if (kept?.value) {
      last = await serverStats(kept.value.name, kept.value.url, log, ctx)
      if (last.ok || fresh) return last
    } else if (fresh) return null
    const found = await sweep(get)
    this.swept.set(logKey, { at: clock, value: found })
    if (this.swept.size > MAX_LOGS) this.swept.delete(this.swept.keys().next().value!)
    if (!found) return null
    if (last && kept?.value && found.name === kept.value.name && found.url === kept.value.url) return last
    return serverStats(found.name, found.url, log, ctx)
  }

  private async detectAt(get: Get, url: string, clock: number): Promise<Adapter | null> {
    const c = this.detected.get(url)
    if (c && clock >= c.at && clock - c.at < (c.value ? FOUND_SECS : NONE_SECS)) return c.value
    const value = await detect(get, url)
    this.detected.set(url, { at: clock, value })
    return value
  }

  /** The last 400 KB of mlx-serve's log as lines, read again only when it changed. */
  private async tail(io: Io, p: string): Promise<{ lines: string[]; mtime: number }> {
    const st = await io.stat(p)
    if (!st || st.kind !== 'file') throw new Error('no server log')
    const c = this.tails.get(p)
    if (c && c.size === st.size && c.mtime === st.mtime) return { lines: c.lines, mtime: st.mtime }
    const from = Math.max(0, st.size - LOG_TAIL)
    const lines = splitlines(new TextDecoder().decode(await io.read(p, from, st.size - from)))
    this.tails.set(p, { size: st.size, mtime: st.mtime, lines })
    return { lines, mtime: st.mtime }
  }

  /**
   * Appends the run to runs.jsonl once per (real path, start) (docs/DESIGN.md 22), remembered in
   * `<cache>/lookout/runs-seen.json`, the file the summariser kept, so a run it recorded is not
   * recorded again. There is no lock: two panes finishing the same run in the same instant may
   * both append it.
   */
  private async record(io: Io, out: Summary, priv: Priv, real: string, runsFile: string, clock: number, home: string | undefined, prices: Prices): Promise<void> {
    const key = `${real}\0${out.started}`
    if (this.recorded.has(key)) return
    const cdir = joinPath((await io.env('XDG_CACHE_HOME')) || joinPath(home ?? '', '.cache'), 'lookout')
    const seenFile = joinPath(cdir, 'runs-seen.json')
    let seen: Record<string, unknown> = {}
    try {
      const v = JSON.parse(await io.readText(seenFile)) as unknown
      if (isDict(v)) seen = v
    } catch {
      // no file yet, or not JSON: none seen
    }
    const prev = seen[real]
    if (isDict(prev) && pyEq(prev.started ?? null, out.started ?? null)) {
      this.recorded.add(key)
      return
    }
    const target = runsFile ? expandUser(runsFile, home) : joinPath(dirname(real), 'runs.jsonl')
    const line = `${pyDumps(runRecord(out, priv, real, clock, prices))}\n`
    await io.append(target, line)
    seen[real] = { started: out.started ?? null, at: clock, file: target }
    let entries = Object.entries(seen)
    if (entries.length > 500) {
      const at = (v: unknown): number => (isDict(v) && typeof v.at === 'number' ? v.at : 0)
      entries = entries.sort((a, b) => at(a[1]) - at(b[1])).slice(-500)
    }
    await io.write(seenFile, pyDumps(Object.fromEntries(entries)))
    this.recorded.add(key)
  }
}

/** One runs.jsonl line (docs/DESIGN.md 22) for a finished summary. */
export function runRecord(out: Summary, priv: Priv, real: string, now: number, prices: Prices): Record<string, unknown> {
  const r = (out.result ?? {}) as Record<string, unknown>
  const [at, checked] = costAtAll(priv, out.out_est, prices)
  const tests = out.tests ?? []
  const last = tests.length ? tests[tests.length - 1]! : null
  return {
    t: truthy(out.last_ts) ? out.last_ts : now, path: real, source: out.source.name,
    model: out.model ?? null, subtype: r.subtype ?? null,
    turns: r.turns !== null && r.turns !== undefined ? r.turns : out.turns ?? null,
    duration_ms: r.duration_ms ?? null, ctx_max: priv.ctx_max, out_est: out.out_est ?? null,
    tests_last: last ? { failed: last.failed, passed: last.passed, total: last.total } : null,
    errors: out.errors ?? null, denials: out.denials ?? null,
    cost_at: at, priced_at: checked,
  }
}

/** Every adapter's own default URL, in probe order: the first server that answers. */
async function sweep(get: Get): Promise<{ name: Adapter; url: string } | null> {
  const urls = [...new Set(ORDER.map(defaultUrl))]
  const found = await Promise.all(urls.map(url => detect(get, url).catch(() => null)))
  const i = found.findIndex(x => x)
  return i < 0 ? null : { name: found[i]!, url: urls[i]! }
}

/** The source's name: the log's file name less `.jsonl` and `-current`. */
export function sourceName(path: string): string {
  let b = basename(path.replace(/\/+$/, ''))
  if (b.endsWith('.jsonl')) b = b.slice(0, -6)
  if (b.endsWith('-current')) b = b.slice(0, -8)
  return b || 'worker'
}

function copyGit(g: Summary['git']): Summary['git'] {
  return g && { ...g, commits: g.commits.map(c => ({ ...c })) }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'Error'
}

async function safe<T>(p: Promise<T> | T): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}

function safeSync<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

const DEFAULT = new Reader()

/** The Summary of `o.log` now, through the module's own Reader (its state lasts while the module is loaded). */
export function summarize(io: Io, o: ReaderOptions): Promise<Summary> {
  return DEFAULT.summarize(io, o)
}
