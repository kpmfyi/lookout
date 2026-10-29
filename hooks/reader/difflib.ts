// difflib.unified_diff over lines, as CPython 3.13 computes it (SequenceMatcher with autojunk,
// no isjunk): the Summary's `last_diff` is the summariser's, line for line (docs/DESIGN.md 3).

type Block = [number, number, number]
type Opcode = ['replace' | 'delete' | 'insert' | 'equal', number, number, number, number]

class SequenceMatcher {
  private readonly b2j = new Map<string, number[]>()

  private readonly a: readonly string[]
  private readonly b: readonly string[]

  constructor(a: readonly string[], b: readonly string[]) {
    this.a = a
    this.b = b
    b.forEach((elt, i) => {
      const at = this.b2j.get(elt)
      if (at) at.push(i)
      else this.b2j.set(elt, [i])
    })
    const n = b.length
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1
      for (const [elt, idxs] of [...this.b2j]) if (idxs.length > ntest) this.b2j.delete(elt)
    }
  }

  private longest(alo: number, ahi: number, blo: number, bhi: number): Block {
    const { a, b, b2j } = this
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>()
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        next.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = next
    }
    // No junk: only the popular elements were left out of b2j; extend over equal neighbours.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--
      bestj--
      bestsize++
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++
    return [besti, bestj, bestsize]
  }

  private matchingBlocks(): Block[] {
    const la = this.a.length
    const lb = this.b.length
    const queue: [number, number, number, number][] = [[0, la, 0, lb]]
    const blocks: Block[] = []
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!
      const x = this.longest(alo, ahi, blo, bhi)
      const [i, j, k] = x
      if (k) {
        blocks.push(x)
        if (alo < i && blo < j) queue.push([alo, i, blo, j])
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])
    let [i1, j1, k1] = [0, 0, 0]
    const out: Block[] = []
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
      else {
        if (k1) out.push([i1, j1, k1])
        ;[i1, j1, k1] = [i2, j2, k2]
      }
    }
    if (k1) out.push([i1, j1, k1])
    out.push([la, lb, 0])
    return out
  }

  private opcodes(): Opcode[] {
    let i = 0
    let j = 0
    const out: Opcode[] = []
    for (const [ai, bj, size] of this.matchingBlocks()) {
      const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : ''
      if (tag) out.push([tag, i, ai, j, bj])
      i = ai + size
      j = bj + size
      if (size) out.push(['equal', ai, i, bj, j])
    }
    return out
  }

  groupedOpcodes(n: number): Opcode[][] {
    const codes = this.opcodes()
    if (!codes.length) codes.push(['equal', 0, 1, 0, 1])
    const first = codes[0]!
    if (first[0] === 'equal') codes[0] = ['equal', Math.max(first[1], first[2] - n), first[2], Math.max(first[3], first[4] - n), first[4]]
    const last = codes[codes.length - 1]!
    if (last[0] === 'equal') codes[codes.length - 1] = ['equal', last[1], Math.min(last[2], last[1] + n), last[3], Math.min(last[4], last[3] + n)]
    const nn = n + n
    const groups: Opcode[][] = []
    let group: Opcode[] = []
    for (const code of codes) {
      let [tag, i1, i2, j1, j2] = code
      if (tag === 'equal' && i2 - i1 > nn) {
        group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)])
        groups.push(group)
        group = []
        i1 = Math.max(i1, i2 - n)
        j1 = Math.max(j1, j2 - n)
      }
      group.push([tag, i1, i2, j1, j2])
    }
    if (group.length && !(group.length === 1 && group[0]![0] === 'equal')) groups.push(group)
    return groups
  }
}

function range(start: number, stop: number): string {
  let beginning = start + 1
  const length = stop - start
  if (length === 1) return String(beginning)
  if (!length) beginning -= 1
  return `${beginning},${length}`
}

/** unified_diff(a, b, fromfile, tofile, n=n, lineterm=''): the lines, no header when nothing differs. */
export function unifiedDiff(a: readonly string[], b: readonly string[], fromfile: string, tofile: string, n: number): string[] {
  const out: string[] = []
  for (const group of new SequenceMatcher(a, b).groupedOpcodes(n)) {
    if (!out.length) out.push(`--- ${fromfile}`, `+++ ${tofile}`)
    const first = group[0]!
    const last = group[group.length - 1]!
    out.push(`@@ -${range(first[1], last[2])} +${range(first[3], last[4])} @@`)
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === 'equal') {
        for (const line of a.slice(i1, i2)) out.push(` ${line}`)
        continue
      }
      if (tag === 'replace' || tag === 'delete') for (const line of a.slice(i1, i2)) out.push(`-${line}`)
      if (tag === 'replace' || tag === 'insert') for (const line of b.slice(j1, j2)) out.push(`+${line}`)
    }
  }
  return out
}
