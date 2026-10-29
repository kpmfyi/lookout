// Notifications (docs/DESIGN.md 20): what changed between two summaries of the followed log, as
// toasts, and the one-line activity for the status line. `diffEvents` and `statusLine` are pure;
// the keys already emitted live in this module (`takeNew`), cleared on a source change.
import type { Summary } from '../types'
import { activity, ctxLimitOf, fmtDur, isSession, k } from './activity.ts'

export type NotifyKind = 'tests-fail' | 'stalled' | 'resumed' | 'finished'
export type NotifyEvent = { key: string; text: string; kind: NotifyKind }

// Source names that say where the path came from rather than what runs there.
const GENERIC = new Set(['', 'default', 'path', 'log', 'LOOKOUT_LOG'])

/** What the notifications call the run: `claude` for a session (docs/DESIGN.md 36), else its source name, or `worker`. */
function who(s: Summary): string {
  if (isSession(s)) return 'claude'
  const name = s.source?.name ?? ''
  return GENERIC.has(name) ? 'worker' : name
}

/** A duration the short way a notification says it: `45s`, `3m`, `1h05m`. */
export function shortDur(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/**
 * The events between the previous summary and the next, at time `t`: a new test run with
 * failures, the run stalling or resuming, the run finishing (never a session's: it has no result
 * row, and its end is the person's move). Nothing on a first poll (`prev` null), so opening the
 * pane on a run never raises a storm.
 */
export function diffEvents(prev: Summary | null, next: Summary, t: number): NotifyEvent[] {
  if (!prev || !next.exists) return []
  const out: NotifyEvent[] = []
  const name = who(next)
  const path = next.path

  const run = next.tests?.at(-1)
  const before = prev.tests?.at(-1)
  const isNewRun = run != null && ((next.tests?.length ?? 0) !== (prev.tests?.length ?? 0) || run.t !== before?.t)
  if (run && isNewRun && run.failed > 0) {
    out.push({
      key: `tests:${path}:${run.t ?? next.tests!.length}`,
      text: `✖ ${name}: ${run.failed} of ${run.total} tests failing`,
      kind: 'tests-fail',
    })
  }

  if (!next.result) {
    if (next.stalled && !prev.stalled) {
      const quiet = next.mtime != null ? t - next.mtime : 0
      out.push({ key: `stalled:${path}:${next.mtime ?? ''}`, text: `⏸ ${name}: no log movement for ${shortDur(quiet)}`, kind: 'stalled' })
    } else if (!next.stalled && prev.stalled) {
      out.push({ key: `resumed:${path}:${next.mtime ?? ''}`, text: `▶ ${name} resumed`, kind: 'resumed' })
    }
  }

  const r = next.result
  if (r && !prev.result && !isSession(next)) {
    const text =
      r.subtype === 'success'
        ? `✓ ${name} finished: success · ${r.turns} turns · ${shortDur(r.duration_ms / 1000)}`
        : `✖ ${name} finished: ${r.subtype}`
    out.push({ key: `finished:${path}:${next.started ?? ''}:${r.duration_ms}`, text, kind: 'finished' })
  }
  return out
}

// The keys already emitted for the followed source.
let seen = new Set<string>()
let seenSource = ''

/** Forgets what was emitted: a new source starts clean. */
export function resetNotify(source: string): void {
  seen = new Set()
  seenSource = source
}

/** The source the emitted keys belong to. */
export function notifySource(): string {
  return seenSource
}

/** The events not emitted before, remembered as emitted now. */
export function takeNew(events: NotifyEvent[]): NotifyEvent[] {
  const out: NotifyEvent[] = []
  for (const ev of events) {
    if (seen.has(ev.key)) continue
    seen.add(ev.key)
    out.push(ev)
  }
  return out
}

/** The status line: `lookout · Bash npm test · 4s · ctx 41%`; undefined when nothing is followed. */
export function statusLine(s: Summary | null, t: number, stallSecs?: number): string | undefined {
  if (!s || !s.exists) return undefined
  const a = activity(s, t, stallSecs)
  let what: string
  switch (a.state) {
    case 'tool': {
      const p = s.pending
      const label = p?.kind === 'tool' ? p.label.replace(/\s+/g, ' ').trim() : ''
      what = `${a.tool ?? '?'}${label ? ` ${label.length > 40 ? `${label.slice(0, 39)}…` : label}` : ''} · ${fmtDur(a.secs)}`
      break
    }
    case 'done':
      what = s.result ? `${a.ok ? '✓' : '✖'} finished · ${s.result.subtype}` : 'stopped'
      break
    case 'stalled':
      what = `stalled · ${fmtDur(a.secs)}`
      break
    case 'waiting':
      what = isSession(s) ? 'your turn' : 'waiting for the worker'
      break
    case 'prefill':
      what = `reading prompt · ${fmtDur(a.secs)}`
      break
    default:
      what = `thinking · ${fmtDur(a.secs)}`
  }
  const limit = ctxLimitOf(s)
  const ctx = s.ctx != null ? (limit ? ` · ctx ${Math.round((s.ctx / limit) * 100)}%` : ` · ctx ${k(s.ctx)}`) : ''
  return `lookout · ${what}${ctx}`
}
