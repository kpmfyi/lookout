// The few Python semantics the log reader's output depends on (docs/DESIGN.md 43.5): the reader
// was a Python script, and the Summary it printed is the contract, so whitespace, line breaks,
// lengths, rounding, number formatting and timestamps follow Python 3.13 exactly where a log can
// tell them apart. Pure; no `$`.

/** A Python exception by its class name, so a message that names one (`adapter failed: ValueError`) reads the same. */
export class PyError extends Error {
  constructor(name: 'ValueError' | 'KeyError' | 'TypeError', message = '') {
    super(message)
    this.name = name
  }
}

// ── Whitespace and lines

/** Python's str.isspace(): what split(), strip() and `\s` treat as whitespace (JS's `\s` differs: it has U+FEFF, not \x1c-\x1f or \x85). */
const WS_CLASS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
/** Python's `\s` and `\S`, to build regular expressions with. */
export const S = `[${WS_CLASS}]`
export const NS = `[^${WS_CLASS}]`

export function isSpace(c: number): boolean {
  return (c >= 9 && c <= 13) || (c >= 0x1c && c <= 0x20) || c === 0x85 || c === 0xa0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000
}

/** str.strip() (a loop, not a regex: a trailing-whitespace regex is quadratic on long runs). */
export function strip(s: string): string {
  let a = 0
  let b = s.length
  while (a < b && isSpace(s.charCodeAt(a))) a++
  while (b > a && isSpace(s.charCodeAt(b - 1))) b--
  return a === 0 && b === s.length ? s : s.slice(a, b)
}

export function rstrip(s: string): string {
  let b = s.length
  while (b > 0 && isSpace(s.charCodeAt(b - 1))) b--
  return b === s.length ? s : s.slice(0, b)
}

const WORD = new RegExp(`${NS}+`, 'g')

/** str.split() with no arguments: the runs of non-whitespace. */
export function words(s: string): string[] {
  return s.match(WORD) ?? []
}

const LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c-\x1e\x85\u2028\u2029]/

/** str.splitlines(): every Python line boundary, the last one ending the last line rather than starting an empty one. */
export function splitlines(s: string): string[] {
  if (s === '') return []
  const parts = s.split(LINE_BREAK)
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

// ── Lengths and slices in code points (Python's), not UTF-16 units

const SURROGATE = /[\ud800-\udfff]/

/** len(s): a surrogate pair is one character, a lone surrogate one too. */
export function cpLen(s: string): number {
  if (!SURROGATE.test(s)) return s.length
  let n = 0
  for (const _ of s) n++
  return n
}

/** s[:n] */
export function cpHead(s: string, n: number): string {
  if (n <= 0) return ''
  if (!SURROGATE.test(s)) return s.slice(0, n)
  return Array.from(s).slice(0, n).join('')
}

/** s[-n:] */
export function cpTail(s: string, n: number): string {
  if (n <= 0) return ''
  if (!SURROGATE.test(s)) return s.length <= n ? s : s.slice(s.length - n)
  const cps = Array.from(s)
  return cps.length <= n ? s : cps.slice(cps.length - n).join('')
}

/**
 * The summariser's one_line: whitespace runs to one space, then at most `n` characters, the last
 * an ellipsis when cut. Stops reading once the cut is certain, so a megabyte of output costs a prefix.
 */
export function oneLine(v: unknown, n = 160): string {
  const s = pyStr(v)
  let out = ''
  WORD.lastIndex = 0
  for (let m = WORD.exec(s); m; m = WORD.exec(s)) {
    out += out ? ` ${m[0]}` : m[0]
    if (out.length > 2 * n + 2) break // at least n + 1 characters whatever the surrogates
  }
  WORD.lastIndex = 0
  return cpLen(out) <= n ? out : `${cpHead(out, n - 1)}…`
}

// ── Values as Python sees them

export function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Python truthiness: None, False, 0, '', [] and {} are false. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** `a or b` */
export function or<A, B>(a: A, b: B): A | B {
  return truthy(a) ? a : b
}

/** A number as `x or 0` adds it (a bool counts 0 or 1); anything else adds nothing. */
export function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (v === true) return 1
  return 0
}

/** A key with Python's equality for JSON values (1 == 1.0 == True); unhashable values by their JSON text. */
export function pyKey(v: unknown): string {
  if (v === null || v === undefined) return 'z'
  if (typeof v === 'string') return `s${v}`
  if (typeof v === 'number' || typeof v === 'boolean') return `n${Number(v)}`
  return `j${JSON.stringify(v)}`
}

export function pyEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b
  return pyKey(a) === pyKey(b)
}

/** str(v) for a JSON value. */
export function pyStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return pyNum(v)
  return pyRepr(v)
}

/**
 * A JSON number as Python prints it. JSON written by Claude Code (JavaScript) spells an integral
 * value below 1e21 with digits, which Python reads as an int; anything else is a float.
 */
function pyNum(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return BigInt(x).toString()
  return floatRepr(x)
}

/** float.__repr__: the shortest round-trip digits, fixed between 1e-4 and 1e16, else d.ddde±XX. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (x === Infinity) return 'inf'
  if (x === -Infinity) return '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const [mant, expPart] = x.toExponential().split('e') as [string, string]
  const exp = Number(expPart)
  const neg = mant.startsWith('-')
  const digits = mant.replace('-', '').replace('.', '')
  let body: string
  if (exp < -4 || exp >= 16) body = sci(digits, exp)
  else if (exp < 0) body = `0.${'0'.repeat(-exp - 1)}${digits}`
  else if (digits.length <= exp + 1) body = `${digits}${'0'.repeat(exp + 1 - digits.length)}.0`
  else body = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  return neg ? `-${body}` : body
}

function sci(digits: string, exp: number): string {
  const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
  const e = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : String(Math.abs(exp))
  return `${m}e${exp < 0 ? '-' : '+'}${e}`
}

const NON_PRINTABLE = /[\p{C}\p{Zl}\p{Zp}\p{Zs}]/u

/** repr(v) for a JSON value: a dict, list or str as Python writes it. */
export function pyRepr(v: unknown): string {
  if (typeof v === 'string') return strRepr(v)
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`
  if (isDict(v)) return `{${Object.entries(v).map(([k, x]) => `${strRepr(k)}: ${pyRepr(x)}`).join(', ')}}`
  return pyStr(v)
}

function strRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = q
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === q) out += `\\${q}`
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`
    else if (c < 0x80 || ch === ' ' || !NON_PRINTABLE.test(ch)) out += ch
    else if (c < 0x100) out += `\\x${c.toString(16).padStart(2, '0')}`
    else if (c < 0x10000) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += `\\U${c.toString(16).padStart(8, '0')}`
  }
  return out + q
}

/** A float that prints with its point (`0.0`), for the fixture writer: JSON numbers alone cannot say so. */
export class PyFloat {
  readonly value: number
  constructor(value: number) {
    this.value = value
  }
}

const NON_ASCII = /[\u007f-￿]/g

/**
 * json.dumps(v): `, ` and `: ` between items; with `ensureAscii` (Python's default) every
 * character outside ' '..'~' as \uXXXX (a surrogate pair as two).
 */
export function pyDumps(v: unknown, ensureAscii = true): string {
  if (v instanceof PyFloat) return floatRepr(v.value)
  if (typeof v === 'string') {
    const j = JSON.stringify(v)
    return ensureAscii ? j.replace(NON_ASCII, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`) : j
  }
  if (v === null || v === undefined) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
    return pyNum(v)
  }
  if (Array.isArray(v)) return `[${v.map(x => pyDumps(x, ensureAscii)).join(', ')}]`
  if (typeof v === 'object') {
    const items = Object.entries(v as object).filter(([, x]) => x !== undefined)
    return `{${items.map(([k, x]) => `${pyDumps(k, ensureAscii)}: ${pyDumps(x, ensureAscii)}`).join(', ')}}`
  }
  return 'null'
}

// ── Numbers

/** round(x, nd) for a float: on the exact binary value, an exact tie to even. */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x
  const full = Math.abs(x).toFixed(100) // exact for every magnitude the reader rounds
  const dot = full.indexOf('.')
  const keep = full.slice(0, dot + 1 + nd)
  const rest = full.slice(dot + 1 + nd)
  const first = rest.charCodeAt(0) - 48
  const beyond = /[1-9]/.test(rest.slice(1))
  const last = keep.charCodeAt(keep.length - 1) - 48
  const up = first > 5 || (first === 5 && (beyond || last % 2 === 1))
  let s = keep
  if (up) s = bumpDecimal(keep)
  const r = Number(s.endsWith('.') ? s.slice(0, -1) : s)
  return x < 0 ? -r : r
}

function bumpDecimal(s: string): string {
  const chars = s.split('')
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!
    if (c === '.') continue
    if (c === '9') chars[i] = '0'
    else {
      chars[i] = String.fromCharCode(c.charCodeAt(0) + 1)
      return chars.join('')
    }
  }
  return `1${chars.join('')}`
}

/** round(x) to an int: half to even. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

const FLOAT_LIT = /^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/
const SPECIAL = /^[+-]?(?:inf|infinity|nan)$/i

/** float(v): numbers as they are, a bool as 0/1, a str in Python's float syntax; else ValueError/TypeError. */
export function pyFloat(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') throw new PyError('TypeError')
  const s = strip(v)
  if (FLOAT_LIT.test(s)) return Number(s.replace(/_/g, ''))
  if (SPECIAL.test(s)) {
    const neg = s.startsWith('-')
    return /nan/i.test(s) ? NaN : neg ? -Infinity : Infinity
  }
  throw new PyError('ValueError', `could not convert string to float: ${strRepr(v)}`)
}

const INT_LIT = /^[+-]?\d(?:_?\d)*$/

/** int(v): a float truncated, a bool as 0/1, a str of digits; else ValueError/TypeError. */
export function pyInt(v: unknown): number {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new PyError('ValueError')
    return Math.trunc(v)
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') throw new PyError('TypeError')
  const s = strip(v)
  if (!INT_LIT.test(s)) throw new PyError('ValueError', `invalid literal for int(): ${strRepr(v)}`)
  return Number(s.replace(/_/g, ''))
}

// ── Timestamps

const ISO_DATE = /^(\d{4})-?(\d{2})-?(\d{2})/
const ISO_TIME = /^(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?/
const ISO_TZ = /^([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?$/

/**
 * The summariser's ts(): a row's `timestamp` as epoch seconds, or null. Every `Z` reads as
 * `+00:00`, then datetime.fromisoformat (3.11+): an extended or basic date, any one separator, an
 * extended or basic time with a fraction of any length (cut to microseconds), an offset; without
 * one the time is local. Week dates are not read.
 */
export function isoTs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/Z/g, '+00:00')
  const d = ISO_DATE.exec(s)
  if (!d) return null
  const extended = s[4] === '-'
  if (extended !== (s[7] === '-')) return null
  const dateLen = extended ? 10 : 8
  if (d[0].length !== dateLen) return null
  const y = Number(d[1])
  const mo = Number(d[2])
  const day = Number(d[3])
  if (mo < 1 || mo > 12 || day < 1 || day > daysIn(y, mo)) return null
  let H = 0
  let M = 0
  let Sec = 0
  let us = 0
  let off: number | null = null
  let rest = s.slice(dateLen)
  if (rest.length > 0) {
    rest = Array.from(rest).slice(1).join('') // the separator: any one character
    const t = ISO_TIME.exec(rest)
    if (!t) return null
    H = Number(t[1])
    M = t[2] ? Number(t[2]) : 0
    Sec = t[3] ? Number(t[3]) : 0
    us = t[4] ? Number(t[4].slice(0, 6).padEnd(6, '0')) : 0
    if (H > 23 || M > 59 || Sec > 59) return null
    rest = rest.slice(t[0].length)
    if (rest.length > 0) {
      const z = ISO_TZ.exec(rest)
      if (!z) return null
      const oh = Number(z[2])
      const om = z[3] ? Number(z[3]) : 0
      const os = z[4] ? Number(z[4]) : 0
      const ous = z[5] ? Number(z[5].slice(0, 6).padEnd(6, '0')) : 0
      if (om > 59 || os > 59) return null
      off = (((oh * 60 + om) * 60 + os) * 1e6 + ous) * (z[1] === '-' ? -1 : 1)
      if (Math.abs(off) >= 86400e6) return null
    }
  }
  const at = new Date(0)
  if (off === null) {
    at.setFullYear(y, mo - 1, day)
    at.setHours(H, M, Sec, 0)
  } else {
    at.setUTCFullYear(y, mo - 1, day)
    at.setUTCHours(H, M, Sec, 0)
  }
  const ms = at.getTime()
  // Python: whole microseconds since the epoch over 10**6, one correctly rounded division.
  const total = ms * 1000 + us - (off ?? 0)
  return Math.abs(total) < 2 ** 53 ? total / 1e6 : Math.round(total / 1000) / 1000
}

function daysIn(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

// ── Counter

/** collections.Counter over raw values: counts by Python equality, most_common() stable on ties. */
export class Counter {
  private readonly m = new Map<string, { v: unknown; n: number }>()

  add(v: unknown): void {
    const k = pyKey(v)
    const e = this.m.get(k)
    if (e) e.n++
    else this.m.set(k, { v, n: 1 })
  }

  mostCommon(limit?: number): [unknown, number][] {
    const all = [...this.m.values()].sort((a, b) => b.n - a.n).map(e => [e.v, e.n] as [unknown, number])
    return limit === undefined ? all : all.slice(0, limit)
  }
}

// ── Paths (posixpath)

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/') + 1
  const head = p.slice(0, i)
  return head && head !== '/'.repeat(head.length) ? head.replace(/\/+$/, '') : head
}

export function joinPath(a: string, b: string): string {
  if (b.startsWith('/')) return b
  return !a || a.endsWith('/') ? a + b : `${a}/${b}`
}

/** os.path.expanduser for `~` and `~/…` (HOME, its trailing slashes dropped). */
export function expandUser(p: string, home: string | undefined): string {
  if (home === undefined || !(p === '~' || p.startsWith('~/'))) return p
  return home.replace(/\/+$/, '') + p.slice(1) || '/'
}
