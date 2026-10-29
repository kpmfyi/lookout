// The explain policy (docs/DESIGN.md 40.2): when the thinking is put in plain words by a small
// model, at what pace, what is kept, and what a draw is handed. Only the `explain` setting turns
// it on; the demo has canned words, and replay none.
import type { EngineInterface } from 'claude-code'

import type { Plain, Summary } from '../../types'
import { isDemo, isSession } from '../activity.ts'
import { demoPlain } from '../demo.ts'
import { newestAt } from '../scenes/screens.ts'
import { EXPLAIN_SYSTEM, explainPrompt, parseExplained, thoughtKey } from '../thought.ts'
import type { PlainNow } from './config.ts'
import { clockMs } from './sources.ts'
import { asked, mod, readPlain, updatePlain } from './state.ts'

// The model asked, at most one request per 15 s, its reply's cap and time limit, the wait after an
// API error, and how many answers the module keeps.
const EXPLAIN_MODEL = 'haiku'
const EXPLAIN_EVERY_MS = 15_000
const EXPLAIN_TOKENS = 200
const EXPLAIN_TIMEOUT_MS = 20_000
const EXPLAIN_BACKOFF_MS = 60_000
const EXPLAIN_KEPT = 50

/** Whether the `explain` setting asks for this summary's source: this session under `session`, any but the demo under `all`. */
function explains(s: Summary): boolean {
  if (isDemo(s)) return false
  const explain = mod.cfg.explain
  return explain === 'all' || (explain === 'session' && isSession(s))
}

/**
 * The plain words for the thinking `s` carries, as drawn: the demo's canned ones; otherwise, where
 * `explains` allows, the newest answer, fresh when it says this very text, else stale (dimmed:
 * a newer one is on its way) unless the request for this text failed. None in replay.
 */
export function plainFor(s: Summary, st: Plain, replaying: boolean): PlainNow | undefined {
  const thinking = (s.thinking ?? '').trim()
  if (!thinking || replaying) return undefined
  if (isDemo(s)) {
    const canned = demoPlain(thinking)
    return canned ? { runs: parseExplained(canned), t: newestAt(s, 'think') ?? 0, stale: false } : undefined
  }
  if (!explains(s) || !st.answer) return undefined
  const key = thoughtKey(thinking)
  if (st.answer.key !== key && st.failed === key) return undefined
  const runs = parseExplained(st.answer.reply)
  return runs.length ? { runs, t: st.answer.t, stale: st.answer.key !== key } : undefined
}

/** Keeps an answer, the oldest forgotten past EXPLAIN_KEPT. */
function remember(key: string, reply: string): void {
  const explained = asked.explained
  explained.delete(key)
  explained.set(key, reply)
  while (explained.size > EXPLAIN_KEPT) explained.delete(explained.keys().next().value!)
}

/** Cuts the request in flight short (a source switch, a replay): its answer is never kept. */
export function stopExplaining(): void {
  asked.explaining?.stop.abort()
  asked.explaining = null
}

/**
 * After a live poll: asks the small model for the thinking in plain words when the thinking text is
 * new, `explains` allows the source, the last draw showed this very text in a thinking block or
 * screen, no request is in flight, 15 s have passed since the last one and no API error asked to
 * wait. Text that changed in between is skipped: the newest wins. An answer already known (this
 * module's, or the atom's after a reload) is shown without asking.
 */
export async function explainNow($: EngineInterface, s: Summary): Promise<void> {
  if (!explains(s)) return
  const thinking = (s.thinking ?? '').trim()
  if (!thinking) return
  const key = thoughtKey(thinking)
  const st = await readPlain($)
  if (st.answer?.key === key) {
    if (!asked.explained.has(key)) remember(key, st.answer.reply)
    return
  }
  if (st.failed === key) return
  const at = newestAt(s, 'think') ?? s.mtime ?? Date.now() / 1000
  const known = asked.explained.get(key)
  if (known != null) {
    await updatePlain($, p => ({ ...p, answer: { key, reply: known, t: at } }))
    return
  }
  if (asked.drawnThinking !== key) return
  const ms = await clockMs($)
  if (ms - asked.at < EXPLAIN_EVERY_MS || ms < asked.resume) return
  // No await between the check and the claim: one request in flight.
  if (asked.explaining) return
  const stop = new AbortController()
  asked.explaining = { key, stop }
  asked.at = ms
  void ask($, key, thinking, isSession(s) ? 'Claude' : 'The worker', at, stop)
}

/** One plain-words request: the answer kept and shown, or the text marked failed (and, after an API error, a pause). */
async function ask($: EngineInterface, key: string, thinking: string, who: string, at: number, stop: AbortController): Promise<void> {
  let reply = ''
  let apiError = false
  try {
    const r = await $.model.complete(
      { model: EXPLAIN_MODEL, system: EXPLAIN_SYSTEM, prompt: explainPrompt(thinking, who), maxTokens: EXPLAIN_TOKENS, effort: 'low', timeoutMs: EXPLAIN_TIMEOUT_MS },
      { signal: stop.signal },
    )
    if (r.isAnswered) reply = r.text.trim()
    else apiError = r.reason === 'api-error'
  } catch {
    // Refused (a blocked model, no API client): treated as an API error, so it is not asked again at once.
    apiError = true
  }
  if (asked.explaining?.stop === stop) asked.explaining = null
  if (stop.signal.aborted) return
  try {
    if (reply && parseExplained(reply).length > 0) {
      remember(key, reply)
      await updatePlain($, p => ({ answer: { key, reply, t: at }, failed: p.failed === key ? '' : p.failed }))
      return
    }
    if (apiError) asked.resume = (await clockMs($)) + EXPLAIN_BACKOFF_MS
    await updatePlain($, p => ({ ...p, failed: key }))
  } catch {
    // The write lost: the next poll finds the answer kept here, or asks again.
  }
}
