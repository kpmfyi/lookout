// The text of the `status` tool (docs/DESIGN.md 18): the summary the pane shows, as a few lines the
// orchestrating model can read instead of the worker's log. Pure: the summary and the time in,
// the text out. Lines whose data is absent are left out; `brief` stays within 25 lines. Following
// this session (docs/DESIGN.md 36) it speaks of `claude`, its turns and its latest prompt.
import type { Summary, WatchEvent } from '../types'
import { activity, ctxLimitOf, decodeTps, elapsedOf, fmtDur, isSession, k, modelLabel, workerName } from './activity.ts'

export type StatusDetail = 'brief' | 'full'

const TIMELINE_ROWS = 10
const BASH_TAIL = 12

function ago(t: number, at: number | null | undefined): string {
  return at == null ? '' : ` (${fmtDur(t - at)} ago)`
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function stateLine(s: Summary, t: number): string {
  const a = activity(s, t)
  const p = s.pending
  let what: string
  switch (a.state) {
    case 'tool':
      what = `running ${a.tool ?? '?'}${p?.kind === 'tool' && p.label ? ` "${oneLine(p.label, 80)}"` : ''} for ${fmtDur(a.secs)}`
      break
    case 'done':
      what = `${a.text}${s.mtime != null ? ` ${fmtDur(t - s.mtime)} ago` : ''}`
      break
    case 'stalled':
      what = a.text
      break
    case 'waiting':
      what = p?.kind === 'user' ? `${a.text} · ${p.since != null ? `the last turn ended ${fmtDur(a.secs)} ago` : 'nothing asked yet'}` : a.text
      break
    default:
      what = `${a.text} for ${fmtDur(a.secs)}`
  }
  const parts = [`state: ${what}`]
  if (s.turns != null) parts.push(`turn ${s.turns}`)
  const limit = ctxLimitOf(s)
  if (s.ctx != null) parts.push(limit ? `ctx ${k(s.ctx)}/${k(limit)} (${Math.round((s.ctx / limit) * 100)}%)` : `ctx ${k(s.ctx)}`)
  if (s.started != null || s.result) parts.push(`${fmtDur(elapsedOf(s, t))} elapsed`)
  return parts.join(' · ')
}

function checksLine(s: Summary, t: number): string {
  const parts: string[] = []
  const test = s.tests?.at(-1)
  if (test) parts.push(`last run ${test.passed}/${test.total} passed${test.failed > 0 ? `, ${test.failed} failing` : ''}${ago(t, test.t)}`)
  const tsc = s.tsc?.at(-1)
  if (tsc) parts.push(tsc.errors > 0 ? `tsc ${tsc.errors} errors` : 'tsc clean')
  parts.push(`errors ${s.errors ?? 0}`, `denials ${s.denials ?? 0}`)
  return `${test ? 'tests' : 'checks'}: ${parts.join(' · ')}`
}

function gitLine(s: Summary): string | null {
  const g = s.git
  if (!g) return null
  const n = g.commits.length
  const files = Number((g.dirty.match(/(\d+) files? changed/) ?? [])[1] ?? 0)
  const parts = [g.branch || '?', `${n} commit${n === 1 ? '' : 's'} since start`]
  if (files > 0) parts.push(`${files} file${files === 1 ? '' : 's'} dirty`)
  if (g.untracked > 0) parts.push(`${g.untracked} untracked`)
  if (files === 0 && g.untracked === 0) parts.push('clean')
  return `git: ${parts.join(' · ')}`
}

function serverLine(s: Summary): string | null {
  const srv = s.server
  if (!srv) return null
  if (!srv.ok) return `server: ${srv.adapter} not answering${srv.note ? ` (${oneLine(srv.note, 80)})` : ''}`
  const parts: string[] = []
  const dec = decodeTps(s)
  if (dec != null) parts.push(`${Math.round(dec)} tok/s decode`)
  const pre = srv.done?.at(-1)?.prefill_tps ?? srv.rates?.prefill_tps
  if (pre != null) parts.push(`${k(pre)} tok/s prefill`)
  return `server: ${srv.adapter}${parts.length ? ` ${parts.join(' · ')}` : ''}`
}

function eventRow(ev: WatchEvent, t: number): string {
  const when = ev.t != null ? `${fmtDur(t - ev.t)} ago`.padStart(11) : '          ?'
  if (ev.kind === 'think') return `  ${when}  thinking: ${oneLine(ev.label, 100)}`
  if (ev.kind === 'text') return `  ${when}  says: ${oneLine(ev.label, 100)}`
  const mark = ev.status === 'running' ? '…' : ev.status === 'error' ? '✖' : ev.status === 'denied' ? '⊘' : '✓'
  const dur = ev.dur != null && ev.dur >= 1 ? ` (${fmtDur(ev.dur)})` : ''
  const why = (ev.status === 'error' || ev.status === 'denied') && ev.detail ? ` · ${ev.status}: ${oneLine(ev.detail, 80)}` : ''
  return `  ${when}  ${mark} ${ev.tool ?? '?'} ${oneLine(ev.label, 80)}${dur}${why}`
}

/**
 * The status text for summary `s` at `t` (seconds since the epoch). `opts.path` is the log as the
 * pane follows it (as given, or `this session`); `opts.session` says the pane follows this
 * session, for when no summary has been read yet (null).
 */
export function statusText(s: Summary | null, t: number, detail: StatusDetail, opts: { path: string; session?: boolean }): string {
  const path = opts.path || s?.path || '?'
  const who = s ? workerName(s) : opts.session ? 'claude' : 'worker'
  if (!s) return `lookout · ${who} · following ${path}\nstate: no summary yet (the first read of the log has not finished)`
  if (!s.exists) {
    const missing = isSession(s)
      ? `state: no transcript yet: ${s.path} starts with the session's first prompt`
      : `state: log missing: ${s.path} does not exist yet (the worker has not started, or the path is wrong)`
    const lines = [`lookout · ${who} · following ${path}`, missing]
    if (s.error) lines.push(`error: ${oneLine(s.error, 160)}`)
    return lines.join('\n')
  }

  const lines: string[] = [`lookout · ${who} · ${modelLabel(s, s.model ?? '?')} · following ${path}`, stateLine(s, t)]
  const r = s.result
  if (r) {
    lines.push(
      `result: ${r.subtype} · ${r.turns} turns · wall ${fmtDur(r.duration_ms / 1000)} · api ${fmtDur(r.api_ms / 1000)}${r.cost != null ? ` · real $${r.cost.toFixed(2)}` : ''}`,
    )
  }
  lines.push(checksLine(s, t))
  const err = s.last_error
  if (err) lines.push(`last error: ${err.tool}${ago(t, err.t)}: "${oneLine(err.detail, 160)}"`)
  const git = gitLine(s)
  if (git) lines.push(git)
  const srv = serverLine(s)
  if (srv) lines.push(srv)
  if (s.cost) lines.push(`cost: ≈ $${s.cost.usd.toFixed(2)} at ${s.cost.compare} (estimate)`)
  if (s.handoff) lines.push(`handoff: "${oneLine(s.handoff.text, 120)}" · since ${fmtDur(t - s.handoff.since)}`)
  if (s.prompt) lines.push(`prompt: "${oneLine(s.prompt.text, 120)}"${ago(t, s.prompt.t)}`)
  if (s.error) lines.push(`log reader: ${oneLine(s.error, 160)}`)

  if (detail === 'full') {
    if (s.text) lines.push(`last text: "${oneLine(s.text, 300)}"`)
    const events = (s.events ?? []).slice(-TIMELINE_ROWS)
    if (events.length) {
      lines.push(`timeline (last ${events.length}):`)
      for (const ev of events) lines.push(eventRow(ev, t))
    }
    const diff = s.last_diff
    if (diff) {
      const header = diff.diff.split('\n').find(l => l.startsWith('@@')) ?? ''
      lines.push(`last edit: ${diff.path}${ago(t, diff.t)}${header ? ` · ${header}` : ''}`)
    }
    const bash = s.last_bash
    if (bash) {
      lines.push(`last command: $ ${oneLine(bash.cmd.split('\n')[0] ?? '', 160)} · ${bash.status}${ago(t, bash.t)}`)
      const tail = bash.out.slice(-BASH_TAIL)
      const above = bash.more + (bash.out.length - tail.length)
      if (above > 0) lines.push(`  … ${above} lines above`)
      for (const line of tail) lines.push(`  ${line}`)
    }
  }
  return lines.join('\n')
}
