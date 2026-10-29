// The pane's words and marks, as strings (docs/DESIGN.md 8, 38.2): times and model ids the short
// way, sparklines and bars, a diff cut to fit, a command's state, the orchestrator strip. Pure.
import type { Summary } from '../../types'
import { isSession, modelLabel } from '../activity.ts'
import type { Activity } from '../activity.ts'
import { cut } from '../scenes/index.ts'
import { orchestratorModel } from './layout.ts'

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const PULSE = ['○', '◔', '◑', '◕', '●', '◕', '◑', '◔']
export const BLOCKS = '▁▂▃▄▅▆▇█'

/** `hh:mm` of an epoch time, local. */
export function hhmm(t: number | undefined): string {
  return t ? new Date(t * 1000).toTimeString().slice(0, 5) : '--:--'
}

/** `hh:mm:ss` of an epoch time, local. */
export function clock(t: number | null | undefined): string {
  if (!t) return '--:--:--'
  return new Date(t * 1000).toTimeString().slice(0, 8)
}

/** A model id the short way: no provider prefix, no `claude-`. */
export function shortModel(m: string | null | undefined): string {
  return cut((m ?? '?').split('/').at(-1)!.replace(/^claude-/, ''), 22)
}

export function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

export function avg(xs: number[]): number {
  return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0
}

export function spark(values: number[], width: number, max?: number): string {
  const vs = values.slice(-width)
  if (vs.length === 0) return ''
  const top = max ?? Math.max(...vs, 1e-9)
  return vs.map(v => BLOCKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))]).join('')
}

export function bar(fraction: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export function lineColor(line: string): string | undefined {
  if (/\b(fail(ed|ure)?|error|✗|✖|exception)\b/i.test(line)) return 'error'
  if (/\b(pass(ed)?|ok|✓)\b/i.test(line)) return 'success'
  return undefined
}

export function statusColor(a: Activity): string {
  switch (a.state) {
    case 'done':
      return a.ok ? 'success' : 'error'
    case 'stalled':
      return 'warning'
    case 'tool':
      return 'suggestion'
    case 'nolog':
    case 'waiting':
      return 'subtle'
    default:
      return 'claude'
  }
}

// Keep the first `max` lines of a unified diff and rewrite each kept hunk header's line counts to
// match, so a cut hunk still parses as a diff (Code refuses mismatched counts and logs a warning).
export function trimDiff(text: string, max: number): string {
  const lines = text.split('\n').slice(0, max)
  let header = -1
  let before = 0
  let after = 0
  const close = () => {
    if (header < 0) return
    lines[header] = lines[header]!.replace(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
      (_m, a: string, b: string) => `@@ -${a},${before} +${b},${after} @@`,
    )
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('@@')) {
      close()
      header = i
      before = 0
      after = 0
    } else if (header >= 0) {
      if (line.startsWith('-')) before++
      else if (line.startsWith('+')) after++
      else if (!line.startsWith('\\')) {
        before++
        after++
      }
    }
  }
  close()
  return lines.join('\n')
}

/** The lines a unified diff adds and removes (its `+++`/`---` file headers left out). */
export function diffCounts(diff: string): { plus: number; minus: number } {
  let plus = 0
  let minus = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) plus++
    else if (line.startsWith('-') && !line.startsWith('---')) minus++
  }
  return { plus, minus }
}

/** How the last command stands, folded: `running`, `ok`, or `exit N` when its output names the code. */
export function commandStatus(b: NonNullable<Summary['last_bash']>): string {
  if (b.status !== 'error') return b.status
  const code = b.out.map(line => /\bexit code (\d+)/i.exec(line)?.[1]).find(x => x != null)
  return code != null ? `exit ${code}` : 'failed'
}

/**
 * The orchestrator strip (docs/DESIGN.md section 8), or null when there is nothing to say. Following
 * this session (docs/DESIGN.md 36): `claude · <model> · "<the latest prompt>" · since hh:mm`.
 */
export function stripText(s: Summary, cols: number): string | null {
  if (isSession(s)) {
    if (!s.exists || !s.prompt) return null
    const who = `claude · ${modelLabel(s, s.model ?? '?')}`
    const tail = s.prompt.t != null ? `  ·  since ${hhmm(s.prompt.t)}` : ''
    return `${who}  ·  "${cut(s.prompt.text.replace(/\s+/g, ' ').trim(), Math.max(8, cols - who.length - tail.length - 7))}"${tail}`
  }
  const orchestrator = orchestratorModel()
  if (!s.exists || (!s.handoff && !orchestrator)) return null
  const firstText = (s.events ?? []).find(ev => ev.kind === 'text')?.label
  const task = (s.handoff?.text ?? firstText ?? 'started').replace(/\s+/g, ' ').trim()
  // The hand-off's time of day, as the strip module has it (docs/DESIGN.md 31): a duration here
  // would read as a second elapsed.
  const since = s.handoff?.since ?? s.started ?? null
  const you = cols >= 60 && orchestrator ? `you · ${orchestrator}  →  ` : ''
  const worker = `worker · ${modelLabel(s, s.model ?? '?')}`
  const tail = since != null ? `  ·  since ${hhmm(since)}` : ''
  const room = cols - you.length - worker.length - tail.length - 7
  return `${you}${worker}  ·  "${cut(task, Math.max(8, room))}"${tail}`
}
