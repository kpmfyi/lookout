// Test-runner and typecheck summaries in one command's output (docs/DESIGN.md 3): vitest, jest,
// pytest, go test, cargo test, bun test, mocha and tsc, by their own summary lines. The patterns
// are the summariser's; `\s` is Python's and `^`/`$` its MULTILINE ones (a line is cut at \n only).
import { S, NS, pyStr, truthy } from './py.ts'

export type TestRun = { failed: number; passed: number; total: number }

/** `^` and `$` under re.M: at a \n or an end of the text, never at \r or U+2028 as JS's `m` flag would. */
const BOL = '(?<![^\\n])'
const EOL = '(?![^\\n])'

const VITEST = new RegExp(`Tests${S}+(?:(\\d+) failed \\| )?(?:(\\d+) skipped \\| )?(\\d+) passed(?: \\| \\d+ \\w+)* \\((\\d+)\\)`, 'g')
const VITEST_FAIL_ONLY = new RegExp(`Tests${S}+(\\d+) failed(?: \\| \\d+ \\w+)* \\((\\d+)\\)`, 'g')
const JEST = new RegExp(`Tests:${S}+((?:\\d+ \\w+, )*)(\\d+) total`, 'g')
const PYTEST = /((?:\d+ (?:passed|failed|errors?|skipped|xfailed|xpassed|deselected|warnings?)(?:, )?)+) in [\d.]+s/g
const GO_FAIL = new RegExp(`${BOL}${S}*--- FAIL: `, 'g')
const GO_PASS = new RegExp(`${BOL}${S}*--- PASS: `, 'g')
const GO_OK_PKG = new RegExp(`${BOL}ok${S}+${NS}+${S}+(?:[\\d.]+s|\\(cached\\))`, 'g')
const GO_FAIL_PKG = new RegExp(`${BOL}FAIL${S}+${NS}+${S}+[\\d.]+s`, 'g')
const CARGO = /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed(?:; (\d+) ignored)?/g
const BUN_PASS = new RegExp(`${BOL}${S}*(\\d+) pass${S}*${EOL}`, 'g')
const BUN_FAIL = new RegExp(`${BOL}${S}*(\\d+) fail${S}*${EOL}`, 'g')
const MOCHA_PASS = new RegExp(`${BOL}${S}*(\\d+) passing\\b`, 'g')
const MOCHA_FAIL = new RegExp(`${BOL}${S}*(\\d+) failing\\b`, 'g')
const MOCHA_PEND = new RegExp(`${BOL}${S}*(\\d+) pending\\b`, 'g')
const TSC = /error TS\d+/g
const COUNTS = /(\d+) (\w+)/g

function all(re: RegExp, text: string): RegExpMatchArray[] {
  return [...text.matchAll(re)]
}

function last(re: RegExp, text: string): RegExpMatchArray | undefined {
  let m: RegExpMatchArray | undefined
  for (m of text.matchAll(re));
  return m
}

const end = (m: RegExpMatchArray): number => m.index! + m[0].length
const int = (s: string | undefined): number => (s ? Number(s) : 0)

function counts(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of text.matchAll(COUNTS)) out[m[2]!] = Number(m[1])
  return out
}

/**
 * The newest test-run summary in one command's output, or null. Each runner's last summary
 * competes by position, the one that ends latest winning; runners that print one summary per
 * binary or package (cargo, go) are summed over the output.
 */
export function detectTests(v: unknown): TestRun | null {
  const text = truthy(v) ? pyStr(v) : ''
  const found: [number, TestRun][] = []

  let m = last(VITEST, text)
  if (m) found.push([end(m), { failed: int(m[1]), passed: int(m[3]), total: int(m[4]) }])
  m = last(VITEST_FAIL_ONLY, text)
  if (m) found.push([end(m), { failed: int(m[1]), passed: 0, total: int(m[2]) }])
  m = last(JEST, text)
  if (m) {
    const c = counts(m[1]!)
    found.push([end(m), { failed: c.failed ?? 0, passed: c.passed ?? 0, total: int(m[2]) }])
  }
  m = last(PYTEST, text)
  if (m) {
    const c = counts(m[1]!)
    const failed = (c.failed ?? 0) + (c.error ?? 0) + (c.errors ?? 0)
    if ('passed' in c || failed) {
      const total = (c.passed ?? 0) + failed + (c.skipped ?? 0) + (c.xfailed ?? 0) + (c.xpassed ?? 0)
      found.push([end(m), { failed, passed: c.passed ?? 0, total }])
    }
  }
  const cargo = all(CARGO, text)
  if (cargo.length) {
    let p = 0
    let f = 0
    let i = 0
    for (const x of cargo) {
      p += int(x[1])
      f += int(x[2])
      i += int(x[3])
    }
    found.push([end(cargo[cargo.length - 1]!), { failed: f, passed: p, total: p + f + i }])
  }
  const goF = all(GO_FAIL, text)
  const goP = all(GO_PASS, text)
  const goOk = all(GO_OK_PKG, text)
  const goFp = all(GO_FAIL_PKG, text)
  if (goF.length || goP.length || goOk.length || goFp.length) {
    let f: number
    let p: number
    if (goF.length || goP.length) {
      // verbose or failing run: count tests; a quiet run with failures counts passing packages once each
      f = goF.length
      p = goP.length
      if (!goP.length && goOk.length) p = goOk.length
    } else {
      f = goFp.length
      p = goOk.length
    }
    const at = Math.max(...[...goF, ...goP, ...goOk, ...goFp].map(end))
    found.push([at, { failed: f, passed: p, total: f + p }])
  }
  const bp = last(BUN_PASS, text)
  const bf = last(BUN_FAIL, text)
  if (bp || bf) {
    const p = bp ? int(bp[1]) : 0
    const f = bf ? int(bf[1]) : 0
    found.push([Math.max(bp ? end(bp) : -1, bf ? end(bf) : -1), { failed: f, passed: p, total: p + f }])
  }
  const mp = last(MOCHA_PASS, text)
  const mf = last(MOCHA_FAIL, text)
  if (mp || mf) {
    const pe = last(MOCHA_PEND, text)
    const p = mp ? int(mp[1]) : 0
    const f = mf ? int(mf[1]) : 0
    found.push([Math.max(mp ? end(mp) : -1, mf ? end(mf) : -1), { failed: f, passed: p, total: p + f + (pe ? int(pe[1]) : 0) }])
  }
  if (!found.length) return null
  // max() keeps the first of equal keys
  let best = found[0]!
  for (const x of found) if (x[0] > best[0]) best = x
  return best[1]
}

/** How many `error TS1234` the output holds. */
export function countTsc(text: string): number {
  return all(TSC, text).length
}
