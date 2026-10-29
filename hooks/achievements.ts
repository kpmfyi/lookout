// Achievements (docs/DESIGN.md 24): a few run milestones, kept per user in the plugin's store
// across sessions. Pure here: the catalogue, which a finished run earns, and the toast's words;
// register.tsx loads and saves the earned set and raises the toasts.
import type { Summary } from '../types'

export type AchievementId = 'first-light' | 'green' | 'marathon' | 'centurion' | 'night-shift' | 'clean-hands' | 'frugal' | 'handoff'

export type Achievement = {
  id: AchievementId
  /** Shown after the trophy: `🏆 green`. */
  title: string
  /** One line: what the run did. */
  desc: string
}

/** The catalogue, in the order the toasts and the Result block list them. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-light', title: 'first light', desc: 'the first finished run' },
  { id: 'green', title: 'green', desc: 'tests passing, no errors' },
  { id: 'marathon', title: 'marathon', desc: 'a run over an hour' },
  { id: 'centurion', title: 'centurion', desc: '100 tool calls in one run' },
  { id: 'night-shift', title: 'night shift', desc: 'a run finished between midnight and 5 am' },
  { id: 'clean-hands', title: 'clean hands', desc: 'no denials in 20 or more tool calls' },
  { id: 'frugal', title: 'frugal', desc: 'a run under $0.10 at the compare price' },
  { id: 'handoff', title: 'handoff', desc: 'the first run with a handoff file' },
]

const MARATHON_MS = 3_600_000
const CENTURION_CALLS = 100
const CLEAN_CALLS = 20
const FRUGAL_USD = 0.1
const NIGHT_END_HOUR = 5

/** The tool calls of a run. */
export function toolCalls(s: Summary): number {
  return (s.tool_counts ?? []).reduce((n, [, c]) => n + c, 0)
}

/** When a finished run ended (epoch seconds): its last row, else its start plus its wall time, else `t`. */
export function finishedAt(s: Summary, t: number): number {
  if (s.last_ts != null) return s.last_ts
  if (s.started != null && s.result) return s.started + s.result.duration_ms / 1000
  return t
}

/** One finished run, the same across polls and sessions: its path, start and wall time. */
export function runKey(s: Summary): string {
  return `${s.path}:${s.started ?? ''}:${s.result?.duration_ms ?? ''}`
}

/** Whether the finished run `s` earns `id` (ignoring what was earned before). */
function earns(id: AchievementId, s: Summary, t: number): boolean {
  const r = s.result
  if (!r) return false
  switch (id) {
    case 'first-light':
      return true
    case 'green': {
      const last = s.tests?.at(-1)
      return last != null && last.total > 0 && last.failed === 0 && (s.errors ?? 0) === 0
    }
    case 'marathon':
      return r.duration_ms > MARATHON_MS
    case 'centurion':
      return toolCalls(s) >= CENTURION_CALLS
    case 'night-shift':
      return new Date(finishedAt(s, t) * 1000).getHours() < NIGHT_END_HOUR
    case 'clean-hands':
      return (s.denials ?? 0) === 0 && toolCalls(s) >= CLEAN_CALLS
    case 'frugal':
      return s.cost != null && r.turns > 0 && s.cost.usd < FRUGAL_USD
    case 'handoff':
      return s.handoff != null
  }
}

/**
 * The achievements the run `s` earns that are not in `prev`, in catalogue order; none until the
 * run has its result row. `t` is now (epoch seconds), the finish time when the summary has none.
 */
export function newAchievements(prev: Set<string>, s: Summary, t: number): string[] {
  if (!s.exists || !s.result) return []
  return ACHIEVEMENTS.filter(x => !prev.has(x.id) && earns(x.id, s, t)).map(x => x.id)
}

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find(x => x.id === id)
}

/** The toast: `🏆 green: tests passing, no errors`. */
export function achievementToast(id: string): string {
  const a = achievementById(id)
  return a ? `🏆 ${a.title}: ${a.desc}` : `🏆 ${id}`
}

/** What the store keeps under STORE_KEY: each earned id, the run that earned it and when. */
export type Earned = Record<string, { run: string; t: number }>
export const STORE_KEY = 'achievements'

/** The earned map from whatever the store held (anything malformed is dropped). */
export function readEarned(raw: unknown): Earned {
  const out: Earned = {}
  const earned = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { earned?: unknown }).earned : undefined
  if (!earned || typeof earned !== 'object' || Array.isArray(earned)) return out
  for (const [id, v] of Object.entries(earned as Record<string, unknown>)) {
    if (!achievementById(id) || !v || typeof v !== 'object') continue
    const { run, t } = v as { run?: unknown; t?: unknown }
    if (typeof run === 'string' && typeof t === 'number') out[id] = { run, t }
  }
  return out
}

/** The ids `run` earned, in catalogue order. */
export function earnedBy(earned: Earned, run: string): Achievement[] {
  return ACHIEVEMENTS.filter(x => earned[x.id]?.run === run)
}
