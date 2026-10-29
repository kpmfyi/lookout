// Summary → Activity: what the worker is doing at time `t`. Every scene and the pane's status row
// read this, never the raw Summary, so the mapping lives in one place (docs/DESIGN.md section 4).
import type { Summary, ToolClass } from '../types'

export type PulseKind = 'tests-pass' | 'tests-fail' | 'error' | 'denied' | 'commit'

export type Activity = {
  state: 'nolog' | 'waiting' | 'prefill' | 'thinking' | 'tool' | 'stalled' | 'done'
  /** When state is 'tool'. */
  tool?: string
  cls?: ToolClass
  /** When state is 'done'. */
  ok?: boolean
  /** Seconds in the current state. */
  secs: number
  /** One line for the status row. */
  text: string
  /** 0..1: decode tok/s against a soft cap of 60, or 0.5 when unknown. */
  intensity: number
  pulse: { kind: PulseKind; age: number } | null
}

export const PULSE_SECS = 8
export const DECODE_CAP = 60
export const DEFAULT_STALL_SECS = 180

export function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

export function k(n: number | undefined | null): string {
  n = n ?? 0
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}

/** The tool classes of the contract: Bash→shell, Read→read, Edit/Write→edit, and so on. */
export function toolClass(tool: string | undefined): ToolClass {
  switch (tool) {
    case 'Bash':
      return 'shell'
    case 'Read':
    case 'NotebookRead':
      return 'read'
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit'
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'search'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    case 'Task':
    case 'Agent':
      return 'agent'
    default:
      return 'other'
  }
}

/** True for the scripted demo run (docs/DESIGN.md section 12): its source is named `demo`. */
export function isDemo(s: Summary | null | undefined): boolean {
  return s?.source?.name === 'demo'
}

/** True for a Claude Code session transcript (docs/DESIGN.md 36): the pane's own session, or one named by path. */
export function isSession(s: Summary | null | undefined): boolean {
  return s?.transcript === true
}

/** Who is at the worker's desk: `claude` in a session (docs/DESIGN.md 36), else `worker`. */
export function workerName(s: Summary | null | undefined): string {
  return isSession(s) ? 'claude' : 'worker'
}

/** The worker's model as the pane prints it, with ` · demo` beside it for the demo run. */
export function modelLabel(s: Summary, name: string = s.model ?? workerName(s)): string {
  return isDemo(s) ? `${name} · demo` : name
}

/** Calls per tool class, from the summary's per-tool counts. */
export function classCounts(s: Summary): Record<ToolClass, number> {
  const out: Record<ToolClass, number> = { shell: 0, read: 0, edit: 0, search: 0, web: 0, agent: 0, other: 0 }
  for (const [name, n] of s.tool_counts ?? []) out[toolClass(name)] += n
  return out
}

/** Wall time of the run: the result's duration when finished, else since the first row. */
export function elapsedOf(s: Summary, t: number): number {
  return s.result ? (s.result.duration_ms ?? 0) / 1000 : t - (s.started ?? t)
}

/** The context window: the server's when it says, else 1M for a Claude model, else unknown. */
export function ctxLimitOf(s: Summary): number | null {
  return s.server?.ctx_limit ?? (String(s.model ?? '').startsWith('claude') ? 1_000_000 : null)
}

/** The newest decode speed the server reports, or null. */
export function decodeTps(s: Summary): number | null {
  const srv = s.server
  if (!srv || !srv.ok) return null
  return srv.rates?.decode_tps ?? srv.done?.at(-1)?.decode_tps ?? null
}

function prefillTps(s: Summary): number | null {
  const srv = s.server
  if (!srv || !srv.ok) return null
  return srv.done?.at(-1)?.prefill_tps ?? srv.rates?.prefill_tps ?? null
}

function newestPulse(s: Summary, t: number): Activity['pulse'] {
  const cands: { kind: PulseKind; t: number }[] = []
  const test = s.tests?.at(-1)
  if (test?.t != null) cands.push({ kind: test.failed > 0 ? 'tests-fail' : 'tests-pass', t: test.t })
  if (s.last_error?.t != null) cands.push({ kind: 'error', t: s.last_error.t })
  const events = s.events ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!
    if (ev.status === 'denied' && ev.t != null) {
      cands.push({ kind: 'denied', t: ev.t })
      break
    }
  }
  const commit = (s.git?.commits ?? []).reduce<number | null>((m, c) => (m == null || c.t > m ? c.t : m), null)
  if (commit != null) cands.push({ kind: 'commit', t: commit })
  let best: { kind: PulseKind; t: number } | null = null
  for (const c of cands) if (!best || c.t > best.t) best = c
  if (!best) return null
  const age = t - best.t
  return age >= 0 && age < PULSE_SECS ? { kind: best.kind, age } : null
}

export function activity(s: Summary, t: number, stallSecs: number = DEFAULT_STALL_SECS): Activity {
  const tps = decodeTps(s)
  const intensity = tps == null ? 0.5 : Math.max(0, Math.min(1, tps / DECODE_CAP))
  const pulse = s.exists ? newestPulse(s, t) : null
  const base = { intensity, pulse }

  if (!s.exists) return { ...base, state: 'nolog', secs: 0, text: isSession(s) ? 'waiting for your first prompt' : `waiting for ${s.path}` }

  const p = s.pending
  if (s.result || p?.kind === 'done') {
    const ok = s.result ? s.result.subtype === 'success' : false
    const secs = s.mtime != null ? Math.max(0, t - s.mtime) : 0
    const text = s.result ? `finished · ${s.result.subtype}` : 'stopped · no result row'
    return { ...base, state: 'done', ok, secs, text }
  }

  // A session waits on its person between turns (docs/DESIGN.md 36): never stalled, never done.
  if (p?.kind === 'user') {
    return { ...base, state: 'waiting', secs: Math.max(0, t - (p.since ?? t)), text: 'your turn' }
  }

  if (s.started == null && !s.model) {
    const secs = s.mtime != null ? Math.max(0, t - s.mtime) : 0
    return { ...base, state: 'waiting', secs, text: 'log open · waiting for the worker to start' }
  }

  if (p?.kind === 'tool') {
    const secs = Math.max(0, t - (p.since ?? t))
    const cls = p.cls ?? toolClass(p.tool)
    return { ...base, state: 'tool', tool: p.tool, cls, secs, text: `${p.tool} · ${p.label}` }
  }

  // Pending model (or nothing pending yet).
  const since = p?.kind === 'model' ? p.since : s.last_ts ?? null
  const secs = Math.max(0, t - (since ?? t))
  const quiet = s.mtime != null ? t - s.mtime : 0
  if (s.stalled || quiet > stallSecs) {
    return { ...base, state: 'stalled', secs: quiet, text: `stalled · no log movement for ${fmtDur(quiet)}` }
  }
  const fl = s.server?.ok ? s.server.inflight : null
  if (fl?.prompt) {
    const fresh = Math.max(0, fl.prompt - (fl.cached ?? 0))
    const rate = prefillTps(s)
    const prefillS = rate && rate > 0 ? fresh / rate : 0
    if (secs < prefillS + 1) return { ...base, state: 'prefill', secs, text: `reading ${k(fresh)} new prompt tokens` }
  }
  return { ...base, state: 'thinking', secs, text: 'thinking / writing' }
}
