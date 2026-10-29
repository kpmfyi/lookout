// The Summary's live parts beside the log (docs/DESIGN.md 3, 7): the hand-off file, free memory
// and git. Each reaches the world through the Io and is null (or memory's bare `{ at }`) where the
// summariser's safe() said null.
import type { Summary } from '../../types'
import type { Io, IoStat } from './io.ts'
import { dirname, basename, joinPath, oneLine, pyInt, splitlines, strip, S } from './py.ts'

/** os.path.realpath: links followed where the path exists, the rest of it kept as spelled. */
export async function realpath(io: Io, p: string): Promise<string> {
  const st = await io.stat(p).catch(() => null)
  if (st?.real) return st.real
  const dir = dirname(p)
  const base = basename(p)
  if (!base || dir === p) return p
  const parent = await realpath(io, dir || '.')
  if (base === '.') return parent
  if (base === '..') return dirname(parent) || '/'
  return joinPath(parent, base)
}

const HEADING = new RegExp(`^#+${S}*`)

/**
 * The hand-off (docs/DESIGN.md 3): the first non-empty line of `explicit`, or of
 * `<log>.handoff.md` beside the log's real path, else beside the path as given; its mtime is
 * `since`, which the office reads as the moment the task was handed over. `head` reads a
 * candidate's first 64 KiB as text.
 */
export async function resolveHandoff(io: Io, path: string, explicit: string | null, head: (path: string, st: IoStat) => Promise<string>): Promise<Summary['handoff']> {
  const cands: string[] = []
  if (explicit) cands.push(explicit)
  else {
    const real = await realpath(io, path)
    for (const base of [real, path]) cands.push(`${base.endsWith('.jsonl') ? base.slice(0, -6) : base}.handoff.md`)
  }
  for (const c of cands) {
    try {
      const st = await io.stat(c)
      if (!st || st.kind !== 'file') continue
      const text = (splitlines(await head(c, st)).map(l => strip(l)).find(l => l) ?? '').replace(HEADING, '')
      return { text: oneLine(text, 200), path: c, since: st.mtime }
    } catch {
      continue
    }
  }
  return null
}

export function parseVmStat(vm: string, memsize: string): { free_gb: number; total_gb: number } {
  const page = /page size of (\d+)/.exec(vm)
  if (!page) throw new TypeError('no page size')
  const pages = (k: string): number => {
    const m = new RegExp(`${k}:${S}+(\\d+)`).exec(vm)
    if (!m) throw new TypeError(`no ${k}`)
    return Number(m[1])
  }
  const free = ((pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * Number(page[1])) / 2 ** 30
  return { free_gb: free, total_gb: pyInt(memsize) / 2 ** 30 }
}

export function parseMeminfo(text: string): { free_gb: number; total_gb: number } {
  const kb: Record<string, number> = {}
  for (const l of splitlines(text)) {
    const m = new RegExp(`^(\\w+):${S}+(\\d+)`).exec(l)
    if (m) kb[m[1]!] = Number(m[2])
  }
  if (!('MemAvailable' in kb) || !('MemTotal' in kb)) throw new TypeError('no MemAvailable')
  return { free_gb: kb.MemAvailable! / 2 ** 20, total_gb: kb.MemTotal! / 2 ** 20 }
}

/** Free and total memory now: macOS by vm_stat and sysctl, Linux by /proc/meminfo, elsewhere `{ at }` alone. */
export async function readMemory(io: Io, at: number): Promise<NonNullable<Summary['memory']>> {
  const c: NonNullable<Summary['memory']> = { at }
  try {
    if (io.platform === 'darwin' || (io.platform === undefined && !(await io.stat('/proc/meminfo')))) {
      const [vm, ms] = await Promise.all([io.run(['vm_stat'], 3000), io.run(['sysctl', '-n', 'hw.memsize'], 3000)])
      Object.assign(c, parseVmStat(vm.stdout, strip(ms.stdout)))
    } else if (await io.stat('/proc/meminfo')) {
      Object.assign(c, parseMeminfo(await io.readText('/proc/meminfo')))
    }
  } catch {
    // neither answered: the time alone
  }
  return c
}

/** Commits made since the session started (the newest eight), the branch, the uncommitted diff's size and the untracked files. */
export async function readGit(io: Io, cwd: unknown, since: number | null | undefined): Promise<Summary['git']> {
  if (typeof cwd !== 'string' || !cwd || !(await io.stat(joinPath(cwd, '.git')))) return null
  const run = async (...a: string[]): Promise<string> => (await io.run(['git', '-c', 'core.fsmonitor=false', '-C', cwd, ...a], 5000)).stdout
  try {
    const [log, branch, dirty, others] = await Promise.all([
      run('log', `--since=@${Math.trunc(since || 0)}`, '--pretty=%h\t%ct\t%s', '--shortstat'),
      run('branch', '--show-current'),
      run('diff', 'HEAD', '--shortstat'),
      run('ls-files', '--others', '--exclude-standard'),
    ])
    const commits: NonNullable<Summary['git']>['commits'] = []
    let last: (typeof commits)[number] | null = null
    for (const l of splitlines(log)) {
      if (l.includes('\t')) {
        const [h, ct, ...subj] = l.split('\t')
        if (!subj.length) return null // the summariser could not unpack it
        last = { hash: h!, t: pyInt(ct), subject: subj.join('\t'), stat: '' }
        commits.push(last)
      } else if (strip(l) && last) last.stat = strip(l)
    }
    return { branch: strip(branch), commits: commits.slice(0, 8), dirty: strip(dirty), untracked: splitlines(others).filter(x => x).length }
  } catch {
    return null
  }
}
