// Following and polling (docs/DESIGN.md 2, 21, 36): every POLL_MS the followed source is read into
// the `summary` atom (the demo scripted, a live log through the reader, a replay as of its clock),
// and the notifications and the explain policy run after it; following another source or a replay
// starts that afresh.
import type { EngineInterface } from 'claude-code'

import type { Replay, Summary } from '../../types'
import { fmtDur } from '../activity.ts'
import { demoSummary } from '../demo.ts'
import { statusLine } from '../notify.ts'
import { setYouHandoff } from '../session-watch.ts'
import { award, notify, setStatus, statusShown } from './alerts.ts'
import { SEEK_SECS, nextSpeed } from './config.ts'
import type { Source } from './config.ts'
import { explainNow, stopExplaining } from './explain.ts'
import { clockMs, defaultSource, fileOf, isDemoPath, isSessionPath, summarize } from './sources.ts'
import { asked, mod, readLogPath, readReplay, readSourceName, readSummary, replayed, updateLogPath, updateNow, updatePlain, updateReplay, updateSourceName, updateSummary } from './state.ts'

/** A hand-off the worker has picked up (its log moved after the handoff file): the office's paper. */
function noteHandoff(s: Summary): void {
  const h = s.handoff
  if (h && s.mtime != null && s.mtime >= h.since) setYouHandoff(h.since)
}

export async function poll($: EngineInterface): Promise<void> {
  const rp = await readReplay($)
  if (rp) return pollReplay($, rp)
  let path = await readLogPath($)
  // No source yet (session.start never finished, as when two copies of the mod are loaded): take
  // the default rather than wait on an empty path for ever.
  if (!path) {
    const src = await defaultSource($)
    try {
      await updateLogPath($, () => src.path)
      await updateSourceName($, () => src.name)
    } catch {
      return // the write lost; the next poll tries again
    }
    path = src.path
  }
  if (isDemoPath(path)) {
    setStatus($, undefined) // the demo never notifies
    // The demo needs no log reader: the scripted run at this moment, fresh on every poll.
    const t = Date.now() / 1000
    if (!mod.demoStart) mod.demoStart = t
    const s = demoSummary(t - mod.demoStart, t)
    if (mod.cfg.compare === 'off') s.cost = null
    noteHandoff(s)
    await updateSummary($, () => s)
    await updateNow($, () => t)
    return
  }
  if (path) {
    try {
      const prev = await readSummary($)
      const file = await fileOf($, path)
      const { raw, summary: next } = await summarize($, file, { transcript: isSessionPath(path) })
      if (raw !== mod.lastRaw) {
        mod.lastRaw = raw
        noteHandoff(next)
        await updateSummary($, () => next)
        notify($, file, prev, next, Date.now() / 1000)
        await award($, next, Date.now() / 1000)
      } else if (statusShown()) {
        setStatus($, statusLine(next, Date.now() / 1000, mod.cfg.stallSecs))
      }
      // Every poll, not only a changed one: a text skipped for the 15 s pace is asked for later.
      await explainNow($, next)
    } catch {
      // A failed poll leaves the last summary up; the next one tries again.
    }
  } else setStatus($, undefined)
  await updateNow($, () => Date.now() / 1000)
}

/** Follows `src` from its start: the demo from the top, no replay, no plain words of the old source. */
export async function follow($: EngineInterface, src: Source): Promise<void> {
  mod.demoStart = 0 // entering the demo starts it from the top; leaving it forgets it
  resetReplay() // following a source leaves a replay
  await updateReplay($, () => null)
  // The plain words were the old source's (docs/DESIGN.md 40.2).
  stopExplaining()
  asked.drawnThinking = ''
  await updatePlain($, () => ({ answer: null, failed: '' }))
  await updateLogPath($, () => src.path)
  await updateSourceName($, () => src.name)
  await updateSummary($, () => null)
  mod.lastRaw = ''
  await poll($)
}

/** `/lookout next` and `n`: the named source after the followed one. */
export async function cycleSource($: EngineInterface): Promise<string> {
  const sources = mod.cfg.sources
  if (sources.length === 0) return 'no named sources (set `sources` in the plugin settings)'
  const current = await readSourceName($)
  const i = sources.findIndex(x => x.name === current)
  const src = sources[(i + 1) % sources.length]!
  await follow($, src)
  return `following ${src.name} (${src.path})`
}

// ── Replay (docs/DESIGN.md 21)

/**
 * A replay poll: the replay clock moves on by the time since the last poll × the speed (not while
 * paused, never past the log's end), then the log reader reads the log as if it ended there.
 * Replay never notifies and never writes runs.jsonl.
 */
async function pollReplay($: EngineInterface, rp: Replay): Promise<void> {
  const ms = await clockMs($)
  const dt = replayed.lastMs == null ? 0 : Math.max(0, (ms - replayed.lastMs) / 1000)
  replayed.lastMs = ms
  let at = rp.at
  if (!rp.paused && !replayed.ended && dt > 0) {
    at = Math.min(rp.at + dt * rp.speed, replayed.end ?? Number.POSITIVE_INFINITY)
    await updateReplay($, r => (r ? { ...r, at } : r))
  }
  await replayAt($, rp.path, at)
}

/** The replayed log as of `at`: the summary, the end reached, or why reading it failed. */
async function replayAt($: EngineInterface, path: string, at: number): Promise<void> {
  try {
    const { raw, summary: next } = await summarize($, path, { until: at })
    replayed.error = ''
    if (next.result) replayed.total = next.result.duration_ms / 1000
    replayed.ended = next.result != null || (replayed.end != null && at >= replayed.end)
    if (raw !== mod.lastRaw) {
      mod.lastRaw = raw
      await updateSummary($, () => next)
    }
  } catch (err) {
    replayed.error = `replay: ${err instanceof Error ? err.message : String(err)}`
  }
  await updateNow($, () => at)
}

function resetReplay(): void {
  replayed.started = 0
  replayed.end = null
  replayed.total = 0
  replayed.ended = false
  replayed.error = ''
  replayed.lastMs = null
}

/** `/lookout replay [<path>|<source>|session]`: the log from its start, at ×8, the live source left alone. */
export async function startReplay($: EngineInterface, arg: string): Promise<string> {
  const named = arg ? mod.cfg.sources.find(x => x.name.toLowerCase() === arg.toLowerCase()) : undefined
  const picked = named?.path ?? (arg || (await readLogPath($)))
  if (!picked) return 'nothing to replay: follow a log first, or name one'
  if (isDemoPath(picked)) return 'the demo is not replayed (it plays by itself: /lookout demo)'
  // This session replays its transcript as it stands now (a later /clear does not move the replay).
  const path = await fileOf($, picked)
  let probe: Summary
  try {
    probe = (await summarize($, path, { until: Date.now() / 1000 })).summary
  } catch (err) {
    return `cannot replay ${path}: ${err instanceof Error ? err.message : String(err)}`
  }
  if (!probe.exists) return `cannot replay ${path}: no such log`
  if (probe.started == null) return `cannot replay ${path}: no timestamped rows yet`
  resetReplay()
  replayed.started = probe.started
  const ends = [probe.last_ts ?? 0, probe.result ? probe.started + probe.result.duration_ms / 1000 : 0]
  replayed.end = Math.ceil(Math.max(...ends, probe.started)) + 1
  replayed.total = probe.result ? probe.result.duration_ms / 1000 : 0
  setStatus($, undefined)
  stopExplaining() // never in replay (docs/DESIGN.md 40.2)
  await updateReplay($, () => ({ path, at: probe.started!, speed: 8, paused: false }))
  await updateSummary($, () => null)
  mod.lastRaw = ''
  await poll($)
  return `replaying ${path} from its start at ×8 (on the pane: p pause · b/f −/+${SEEK_SECS} s · x speed · r live)`
}

/** Leaves replay for the live source (`r`). */
export async function leaveReplay($: EngineInterface): Promise<void> {
  resetReplay()
  await updateReplay($, () => null)
  await updateSummary($, () => null)
  mod.lastRaw = ''
  await poll($)
}

/** Pauses or resumes the replay clock (`p`). */
export async function pauseReplay($: EngineInterface): Promise<void> {
  replayed.lastMs = await clockMs($)
  await updateReplay($, r => (r ? { ...r, paused: !r.paused } : r))
}

/** Moves the replay clock by `by` seconds (`b`/`f`), within the log. */
export async function seekReplay($: EngineInterface, by: number): Promise<void> {
  replayed.lastMs = await clockMs($)
  const rp = await updateReplay($, r => (r ? { ...r, at: Math.max(replayed.started, Math.min(r.at + by, replayed.end ?? r.at + by)) } : r))
  if (rp) await replayAt($, rp.path, rp.at)
}

/** The next replay speed (`x`). */
export async function speedReplay($: EngineInterface): Promise<void> {
  await updateReplay($, r => (r ? { ...r, speed: nextSpeed(r.speed) } : r))
}

/** The dim row under the scene while replaying: `⏵ replay ×8 · 12m34s / 21m00s`. */
export function replayText(rp: Replay): string {
  if (replayed.error) return replayed.error
  const mark = replayed.ended ? '⏹ replay ended' : `${rp.paused ? '⏸' : '⏵'} replay ×${rp.speed}`
  return `${mark} · ${fmtDur(rp.at - replayed.started)}${replayed.total ? ` / ${fmtDur(replayed.total)}` : ''}`
}
