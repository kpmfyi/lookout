// mcp__lookout__status (docs/DESIGN.md 18): the tool the orchestrating model calls to check on the
// worker, answered with the same Summary the pane draws (hooks/status.ts words it). Read-only.
import type { EngineInterface } from 'claude-code'

import { DEMO, demoSummary } from '../demo.ts'
import { statusText } from '../status.ts'
import type { StatusDetail } from '../status.ts'
import { runsText } from '../thought.ts'
import { THIS_SESSION } from './config.ts'
import type { PlainNow } from './config.ts'
import { plainFor } from './explain.ts'
import { fileOf, isDemoPath, isSessionPath, sessionTranscript, summarize } from './sources.ts'
import { mod, readLogPath, readPlain, readReplay, readSummary } from './state.ts'

const TOOL_NAME = 'status'
export const TOOL = 'mcp__lookout__status'
const TOOL_DESCRIPTION =
  "Checks on the headless worker this session handed work to, through lookout's summary of the worker's " +
  'stream-json log (the same one the lookout pane shows): what it is doing now and for how long, its turn and ' +
  'context use, the last test run and type-check, errors and denials, the last error, git, model-server speed, ' +
  'a cost estimate and the handed-off task. Call it after handing work to the worker, to check progress, tests ' +
  'and errors without reading the log, and before deciding the work is done. Read-only: it never starts, stops ' +
  "or steers the worker. When the pane follows this session instead (no worker), it describes this session's " +
  "own transcript the same way. detail 'full' adds the last 10 timeline rows, the last edit's diff header and " +
  "the last command's output tail. source: a named source, a log path or 'session'; default the source the pane follows."

/** Registers the tool for this session; a host without plugin tools goes without it. */
export async function registerStatusTool($: EngineInterface): Promise<void> {
  try {
    await $.tool.register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'a named source or path; default the followed log' },
          detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full: adds the timeline, the last edit and the last command output' },
        },
      },
    })
  } catch {
    // No tool this session (a host without plugin tools); the pane works the same.
  }
}

/**
 * The tool's answer: the followed log's summary, or one run of the log reader for another source
 * the call names (the pane keeps following its own).
 */
export async function statusFor($: EngineInterface, source: unknown, detail: unknown): Promise<string> {
  const level: StatusDetail = detail === 'full' ? 'full' : 'brief'
  const arg = typeof source === 'string' ? source.trim() : ''
  const followed = await readLogPath($)
  const named = arg ? mod.cfg.sources.find(x => x.name.toLowerCase() === arg.toLowerCase()) : undefined
  const want = named?.path ?? arg
  const t = Date.now() / 1000
  if (!want || want === followed || (isSessionPath(want) && isSessionPath(followed))) {
    // While replaying, the summary atom holds the replay: the followed log is read afresh.
    const session = isSessionPath(followed)
    const replaying = (await readReplay($)) != null
    let s = replaying ? null : await readSummary($)
    if (!s && followed && !isDemoPath(followed)) s = (await summarize($, await fileOf($, followed), { transcript: session })).summary
    return withPlain(statusText(s, t, level, { path: session ? THIS_SESSION : followed, session }), s && plainFor(s, await readPlain($), replaying))
  }
  if (isSessionPath(want)) {
    const s = (await summarize($, await sessionTranscript($), { transcript: true })).summary
    return statusText(s, t, level, { path: THIS_SESSION, session: true })
  }
  if (isDemoPath(want)) {
    const s = demoSummary(mod.demoStart ? t - mod.demoStart : 0, t)
    if (mod.cfg.compare === 'off') s.cost = null
    return withPlain(statusText(s, t, level, { path: DEMO }), plainFor(s, { answer: null, failed: '' }, false))
  }
  return statusText((await summarize($, want)).summary, t, level, { path: want })
}

/**
 * The status text with the thinking in plain words (docs/DESIGN.md 40.2) under its state line, when
 * they say the latest thinking (stale ones are left out: they describe an earlier thought).
 */
function withPlain(text: string, words: PlainNow | null | undefined): string {
  if (!words || words.stale) return text
  const lines = text.split('\n')
  lines.splice(2, 0, `thinking, in plain words: ${runsText(words.runs)}`)
  return lines.join('\n')
}
