// What the pane says outside itself (docs/DESIGN.md 20, 24): the status line, toasts for a live
// source's new events, and achievements for a finished run. Never for the demo or a replay.
import type { EngineInterface } from 'claude-code'

import type { Summary } from '../../types'
import { STORE_KEY, achievementToast, newAchievements, readEarned, runKey } from '../achievements.ts'
import type { Earned } from '../achievements.ts'
import { diffEvents, notifySource, resetNotify, statusLine, takeNew } from '../notify.ts'
import { mod, updateAchieved } from './state.ts'

/** Sets the plugin's status line, only when it changed. */
export function setStatus($: EngineInterface, text: string | undefined): void {
  if (text === mod.lastStatus) return
  mod.lastStatus = text
  try {
    $.ui.status(text)
  } catch {
    // No status line on this host: nothing to keep up to date.
  }
}

/** Whether the `notify` setting keeps the status line. */
export function statusShown(): boolean {
  return mod.cfg.notify === 'status' || mod.cfg.notify === 'both'
}

/** Whether the `notify` setting shows toasts. */
function toasts(): boolean {
  return mod.cfg.notify === 'toasts' || mod.cfg.notify === 'both'
}

function toast($: EngineInterface, text: string): void {
  try {
    $.ui.toast(text)
  } catch {
    // A host without toasts: the pane still shows it.
  }
}

/**
 * Notifications after a poll of the live source (docs/DESIGN.md 20): toasts for the new events,
 * the status line with the current activity. The first poll of a source only takes note.
 */
export function notify($: EngineInterface, path: string, prev: Summary | null, next: Summary | null, t: number): void {
  if (mod.cfg.notify === 'off') return
  const first = notifySource() !== path
  if (first) resetNotify(path)
  if (next && toasts()) {
    for (const ev of takeNew(diffEvents(first ? null : prev, next, t))) toast($, ev.text)
  }
  if (statusShown()) setStatus($, statusLine(next, t, mod.cfg.stallSecs))
}

/**
 * Achievements (docs/DESIGN.md 24) for a finished run of the live source: the earned set is read
 * from the plugin store (shared by every session of this user), the run's new ones are saved,
 * then toasted once each when `notify` shows toasts. Never for the demo or a replay (their polls
 * do not come here). With no store there are no achievements: nothing could keep them.
 */
export async function award($: EngineInterface, s: Summary, t: number): Promise<void> {
  if (!s.exists || !s.result) return
  let earned: Earned
  try {
    earned = readEarned(await $.store.get(STORE_KEY))
  } catch {
    return
  }
  const fresh = newAchievements(new Set(Object.keys(earned)), s, t)
  if (fresh.length > 0) {
    const run = runKey(s)
    for (const id of fresh) earned[id] = { run, t: Math.round(t) }
    try {
      await $.store.set(STORE_KEY, { v: 1, earned })
    } catch {
      return // not kept, so not announced: the next poll of a finished run tries again
    }
    if (toasts()) for (const id of fresh) toast($, achievementToast(id))
  }
  await updateAchieved($, () => earned)
}
