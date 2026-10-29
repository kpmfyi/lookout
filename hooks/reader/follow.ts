// Following one log incrementally (docs/DESIGN.md 43.5): a poll reads only the bytes appended
// since the last one and feeds their rows to the parse. The summariser re-parsed the whole file
// whenever its size or mtime changed (its ~/.cache entry only saved an unchanged file); this keeps
// the parse in memory instead.
//
// What starts it over from the first byte: another file at the path (the real path or the inode
// changed, the file shrank, or the bytes just before the read point are not the ones read last
// time: a file rewritten in place), and a last line read without its newline that the writer then
// carried on (it parsed, so it was counted, and Python would have read the longer line instead).
//
// Replay (docs/DESIGN.md 21) reads the log as if it ended at `until`: each row is indexed once
// (its timestamp, and for a result row its duration), the rows kept at `until` are worked out from
// the index, and when they extend the rows already applied (the replay clock moved on) only the
// new ones are applied; else (a seek back, out-of-order stamps) the parse starts over.
import type { Io, IoStat } from './io.ts'
import { LogParse } from './parse.ts'
import type { Parsed, Priv } from './parse.ts'
import { isDict, isoTs, truthy } from './py.ts'

type Row = Record<string, unknown>

const CHUNK = 2 * 1024 * 1024
const ANCHOR = 64
const NL = 0x0a
const TRANSCRIPT_KEYS = ['sessionId', 'parentUuid', 'isSidechain']
const TRANSCRIPT_TYPES = ['summary', 'file-history-snapshot']

/**
 * A JSON row as the summariser first meets it: null for what it skips (not an object; once the log
 * reads as a session transcript, its bookkeeping rows and subagents' side chains), and whether the
 * log reads as a transcript from here on (told by a row with a transcript's keys, docs/DESIGN.md 36).
 */
export function classify(d: unknown, tx: boolean): [Row | null, boolean] {
  if (!isDict(d)) return [null, tx]
  const t = d.type
  if (!tx && ((typeof t === 'string' && TRANSCRIPT_TYPES.includes(t)) || TRANSCRIPT_KEYS.some(k => k in d))) tx = true
  if (tx && ((t !== 'user' && t !== 'assistant' && t !== 'system') || truthy(d.isSidechain))) return [null, tx]
  return [d, tx]
}

// A decoder that keeps a leading BOM: json.loads drops one per line, which `line` below does.
const DECODER: TextDecoder = (() => {
  try {
    return new (TextDecoder as unknown as new (label: string, o: { ignoreBOM: boolean }) => TextDecoder)('utf-8', { ignoreBOM: true })
  } catch {
    return new TextDecoder()
  }
})()

/**
 * UTF-8 as json.loads reads a line's bytes: strict, but with Python's `surrogatepass` (an encoded
 * lone surrogate stands). null for bytes that are not UTF-8: the summariser skipped that row.
 */
function strictUtf8(b: Uint8Array): string | null {
  let out = ''
  let i = 0
  while (i < b.length) {
    const c = b[i]!
    let cp: number
    let n: number
    if (c < 0x80) {
      cp = c
      n = 1
    } else if (c >= 0xc2 && c <= 0xdf) {
      cp = c & 0x1f
      n = 2
    } else if (c >= 0xe0 && c <= 0xef) {
      cp = c & 0x0f
      n = 3
    } else if (c >= 0xf0 && c <= 0xf4) {
      cp = c & 0x07
      n = 4
    } else return null
    if (i + n > b.length) return null
    for (let k = 1; k < n; k++) {
      const x = b[i + k]!
      if ((x & 0xc0) !== 0x80) return null
      cp = (cp << 6) | (x & 0x3f)
    }
    if ((n === 3 && cp < 0x800) || (n === 4 && (cp < 0x10000 || cp > 0x10ffff))) return null
    out += String.fromCodePoint(cp)
    i += n
  }
  return out
}

/** A line's bytes as the row json.loads would see, or undefined for a row it would not read. */
function line(bytes: Uint8Array, fast: string | null): unknown {
  let s = fast !== null && !fast.includes('�') ? fast : strictUtf8(bytes)
  if (s === null) return undefined
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b
  if (!b.length) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Splits bytes into the lines they finish: each line's start offset and its row (undefined: unread). */
function* lines(buf: Uint8Array, base: number): Generator<[number, Uint8Array, unknown]> {
  const end = buf.lastIndexOf(NL)
  if (end < 0) return
  const text = DECODER.decode(buf.subarray(0, end + 1))
  const parts = text.split('\n')
  let p = 0
  for (let k = 0; k < parts.length - 1; k++) {
    const nl = buf.indexOf(NL, p)
    const bytes = buf.subarray(p, nl)
    yield [base + p, bytes, line(bytes, parts[k]!)]
    p = nl + 1
  }
}

/** A growable column of numbers. */
class Column {
  a = new Float64Array(1024)
  push(i: number, v: number): void {
    if (i >= this.a.length) {
      const b = new Float64Array(this.a.length * 2)
      b.set(this.a)
      this.a = b
    }
    this.a[i] = v
  }
}

export class Follower {
  parse: LogParse
  private real: string | undefined
  private ino: number | undefined
  private size = -1
  private mtime = -1
  /** Bytes consumed: whole lines, and a last line without its newline once it parsed. */
  private offset = 0
  /** The bytes just before `offset`, to tell an appended file from a rewritten one. */
  private anchor = new Uint8Array(0)
  /** The last consumed line had no newline. */
  private open = false
  /** Classifying: whether the log reads as a session transcript by now. */
  private tx: boolean

  // Replay only: one entry per row the summariser would look at.
  private n = 0
  private readonly when = new Column()
  private readonly dur = new Column()
  private readonly start = new Column()
  /** The first row read as a transcript's (-1: none yet). */
  private txAt = -1
  /** The rows applied, by index, and the last of them. */
  private kept = new Uint8Array(0)
  private last = -1
  /** The keep state after the last indexed row at the `until` applied: the summariser's `keep` and `started`. */
  private carry: { keep: boolean; started: number | null } = { keep: true, started: null }
  private until: number | null = null

  private readonly told: boolean
  private readonly replay: boolean

  constructor(told: boolean, replay: boolean) {
    this.told = told
    this.replay = replay
    this.tx = told
    this.parse = new LogParse(told)
  }

  private reset(real: string | undefined, ino: number | undefined): void {
    this.real = real
    this.ino = ino
    this.size = -1
    this.mtime = -1
    this.offset = 0
    this.anchor = new Uint8Array(0)
    this.open = false
    this.tx = this.told
    this.parse = new LogParse(this.told)
    this.n = 0
    this.txAt = this.told ? 0 : -1
    this.kept = new Uint8Array(0)
    this.last = -1
    this.carry = { keep: true, started: null }
    this.until = null
  }

  /** Brings the parse up to the file as `st` describes it (and, in replay, to `until`). */
  async sync(io: Io, path: string, st: IoStat, until: number | null): Promise<{ out: Parsed; priv: Priv }> {
    try {
      const other = st.real !== this.real || (st.ino !== undefined && this.ino !== undefined && st.ino !== this.ino)
      if (other || st.size < this.offset || this.size < 0) this.reset(st.real, st.ino)
      if (this.replay) await this.cut(io, path, until!)
      if (st.size !== this.size || st.mtime !== this.mtime) {
        await this.readNew(io, path, st.size)
        this.size = st.size
        this.mtime = st.mtime
      }
      this.parse.transcript = this.tx
      return this.parse.finish()
    } catch (err) {
      this.reset(undefined, undefined) // the next poll starts over
      throw err
    }
  }

  /** Reads from `offset` to `size`, starting over once when the file is not the one read before. */
  private async readNew(io: Io, path: string, size: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.readFrom(io, path, size)
      if (result === 'ok') return
      if (attempt > 0) throw new Error('the log changed while it was read')
      const { real, ino, until } = this
      this.reset(real, ino)
      this.until = until // read again from the first byte, cut at the same `until`
    }
  }

  private async readFrom(io: Io, path: string, size: number): Promise<'ok' | 'other'> {
    const anchor = this.anchor
    let pos = this.offset - anchor.length
    let pending = new Uint8Array(0)
    let first = true
    while (pos < size) {
      let buf = await io.read(path, pos, Math.min(CHUNK, size - pos))
      if (!buf.length) break
      let base = pos
      pos += buf.length
      if (first) {
        first = false
        if (anchor.length) {
          if (buf.length < anchor.length || !same(buf.subarray(0, anchor.length), anchor)) return 'other'
          buf = buf.subarray(anchor.length)
          base += anchor.length
        }
        if (this.open && buf.length && buf[0] !== NL) return 'other'
      }
      const all = concat(pending, buf)
      const allBase = base - pending.length
      const end = all.lastIndexOf(NL)
      for (const [at, , row] of lines(all, allBase)) this.take(row, at)
      if (end >= 0) {
        this.consumed(all.subarray(0, end + 1), allBase + end + 1)
        pending = all.slice(end + 1)
      } else pending = all.slice()
    }
    // The last line without its newline: read when it parses (as the summariser did), and remembered as open.
    if (pending.length) {
      const row = line(pending, null)
      if (row !== undefined) {
        this.take(row, this.offset)
        this.consumed(pending, this.offset + pending.length)
        this.open = true
      }
    }
    return 'ok'
  }

  private consumed(bytes: Uint8Array, offset: number): void {
    this.offset = offset
    this.open = false
    this.anchor = bytes.length >= ANCHOR ? bytes.slice(bytes.length - ANCHOR) : concat(this.anchor, bytes).slice(-ANCHOR)
  }

  /** One row read for the first time, at byte `at`. */
  private take(raw: unknown, at: number): void {
    if (raw === undefined) return // a truncated last line, or noise
    const [d, tx] = classify(raw, this.tx)
    if (tx && !this.tx && this.txAt < 0) this.txAt = this.n
    this.tx = tx
    if (!d) return
    const when = isoTs(d.timestamp)
    if (!this.replay) {
      this.parse.transcript = this.tx
      this.parse.apply(d, when)
      return
    }
    const i = this.n++
    this.when.push(i, when ?? NaN)
    this.dur.push(i, d.type === 'result' ? durOf(d.duration_ms) : NaN)
    this.start.push(i, at)
    // Kept or not at the `until` applied, carried on from the rows before (a row with no stamp follows them).
    const keep = this.keeps(i, this.carry)
    if (this.kept.length <= i) {
      const k = new Uint8Array(Math.max(1024, this.kept.length * 2))
      k.set(this.kept)
      this.kept = k
    }
    this.kept[i] = keep ? 1 : 0
    if (keep) {
      this.parse.transcript = this.txOf(i)
      this.parse.apply(d, when)
      this.last = i
    }
  }

  /** The summariser's replay cut for row `i`, moving `state` on. */
  private keeps(i: number, state: { keep: boolean; started: number | null }): boolean {
    const until = this.until
    if (until === null) return false
    const w = this.when.a[i]!
    const when = Number.isNaN(w) ? null : w
    let at = when
    const dur = this.dur.a[i]!
    if (at === null && !Number.isNaN(dur) && state.started) at = state.started + dur / 1000
    if (at !== null) state.keep = at <= until
    if (state.keep && when) state.started = state.started || when
    return state.keep
  }

  private txOf(i: number): boolean {
    return this.told || (this.txAt >= 0 && i >= this.txAt)
  }

  /**
   * Replay: the rows kept at `until` over the rows indexed so far. When they extend the rows already
   * applied, the new ones are applied (read again from their bytes); else the parse starts over
   * from the index.
   */
  private async cut(io: Io, path: string, until: number): Promise<void> {
    if (until === this.until) return
    const prev = this.until
    this.until = until
    const state = { keep: true, started: null as number | null }
    const keep = new Uint8Array(Math.max(1024, this.kept.length))
    for (let i = 0; i < this.n; i++) keep[i] = this.keeps(i, state) ? 1 : 0
    let extends_ = prev !== null
    for (let i = 0; extends_ && i <= this.last; i++) if (keep[i] !== this.kept[i]) extends_ = false
    const from = extends_ ? this.last + 1 : 0
    if (!extends_) {
      this.parse = new LogParse(this.told)
      this.last = -1
    }
    const want: number[] = []
    for (let i = from; i < this.n; i++) if (keep[i]) want.push(i)
    this.kept = keep
    this.carry = state
    if (want.length) await this.reapply(io, path, want)
  }

  /** Applies indexed rows again from their bytes (all of them before `offset`). */
  private async reapply(io: Io, path: string, want: number[]): Promise<void> {
    const lastRow = want[want.length - 1]!
    const startAt = this.start.a[want[0]!]!
    const endAt = lastRow + 1 < this.n ? this.start.a[lastRow + 1]! : this.offset
    let j = 0
    let pos = startAt
    let pending = new Uint8Array(0)
    const apply = (at: number, row: unknown): void => {
      if (j >= want.length || at !== this.start.a[want[j]!]) return
      const i = want[j++]!
      const [d] = classify(row, this.txOf(i))
      if (!d) throw new Error('the log changed while it was read')
      this.parse.transcript = this.txOf(i)
      const w = this.when.a[i]!
      this.parse.apply(d, Number.isNaN(w) ? null : w)
      this.last = i
    }
    while (pos < endAt && j < want.length) {
      const buf = await io.read(path, pos, Math.min(CHUNK, endAt - pos))
      if (!buf.length) break
      const all = concat(pending, buf)
      const base = pos - pending.length
      pos += buf.length
      for (const [at, , row] of lines(all, base)) apply(at, row)
      const end = all.lastIndexOf(NL)
      pending = end >= 0 ? all.slice(end + 1) : all.slice()
    }
    if (pending.length && j < want.length) apply(pos - pending.length, line(pending, null))
    if (j < want.length) throw new Error('the log changed while it was read')
  }
}

/** A result row's duration as the summariser placed an unstamped one: an int or float (a bool counts), else none. */
function durOf(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return NaN
}
