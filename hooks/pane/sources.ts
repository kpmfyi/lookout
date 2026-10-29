// Where the pane reads from (docs/DESIGN.md 2, 36, 43.5): the source a session starts on, this
// session's own transcript, the log reader's Summary of a path, runs.jsonl beside it, and the
// engine's clock. Reads only: following, polling and replay are poll.ts's.
import type { EngineInterface } from 'claude-code'

import type { Summary } from '../../types'
import { DEMO } from '../demo.ts'
import { modIo, summarize as readLog } from '../reader/index.ts'
import type { ReaderOptions } from '../reader/index.ts'
import { DEFAULT_LOG, SESSION, THIS_SESSION } from './config.ts'
import type { RunLine, Source } from './config.ts'
import { mod, readLogPath } from './state.ts'

// runs.jsonl beside the log (docs/DESIGN.md 22): how many lines are shown and how often it is read.
const RUNS_SHOWN = 8
const RUNS_EVERY_MS = 10_000

export function joinPath(dir: string, rel: string): string {
  return dir ? `${dir.replace(/\/+$/, '')}/${rel}` : rel
}

/** `session` as a log path (the command, the `log` setting or LOOKOUT_LOG) follows this session. */
export function isSessionPath(path: string): boolean {
  return path.trim().toLowerCase() === SESSION
}

/** `demo` as a log path (the command, the `log` setting or LOOKOUT_LOG) plays the scripted run. */
export function isDemoPath(path: string): boolean {
  return path.trim().toLowerCase() === DEMO
}

/** `demo` or `session` as a log path stand for the scripted run and this session; anything else is a path. */
function given(path: string, name: string): Source {
  if (isDemoPath(path)) return { name: DEMO, path: DEMO }
  if (isSessionPath(path)) return { name: THIS_SESSION, path: SESSION }
  return { name, path }
}

/**
 * The source to follow when no command picked one (docs/DESIGN.md 2, 36): LOOKOUT_LOG, the `log`
 * setting, the first named source, `./logs/worker-current.jsonl` under the session's directory
 * when that file exists, else this session.
 */
export async function defaultSource($: EngineInterface): Promise<Source> {
  let env: string | undefined
  try {
    env = (await $.env.get('LOOKOUT_LOG'))?.trim()
  } catch {
    env = undefined
  }
  if (env) return given(env, 'LOOKOUT_LOG')
  const cfg = mod.cfg
  if (cfg.log) return given(cfg.log, 'log')
  const first = cfg.sources[0]
  if (first) return first
  const convention = joinPath(mod.sessionCwd, DEFAULT_LOG)
  let exists = false
  try {
    exists = await $.fs.exists(convention)
  } catch {
    exists = false
  }
  return exists ? { name: 'default', path: convention } : { name: THIS_SESSION, path: SESSION }
}

/** A Claude Code project folder's name for a directory: every character but letters and digits a dash. */
function projectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/** `<config dir>/projects`: CLAUDE_CONFIG_DIR, else `~/.claude`; read once a session. */
function projectsDir($: EngineInterface): Promise<string> {
  const get = async (p: Promise<string | undefined>): Promise<string | undefined> => {
    try {
      return (await p)?.trim() || undefined
    } catch {
      return undefined
    }
  }
  mod.projectsRead ??= (async () => {
    const config = (await get($.env.get('CLAUDE_CONFIG_DIR'))) ?? joinPath((await get($.env.get('HOME'))) ?? '~', '.claude')
    return joinPath(config, 'projects')
  })()
  return mod.projectsRead
}

/**
 * This session's transcript (docs/DESIGN.md 36), found afresh on every poll: /clear goes on under a
 * new session id, and no session.start fires for it. The path the engine named with the current
 * id; else `<projects>/<project slug of the session's directory>/<id>.jsonl`. That file is written
 * at the first prompt, so a missing one is waited for rather than swapped for the newest file in
 * the folder, which in a project with sessions side by side is another session's; only when the id
 * cannot be read is the newest transcript in the folder taken.
 */
export async function sessionTranscript($: EngineInterface): Promise<string> {
  let id = ''
  try {
    id = (await $.session.id()).trim()
  } catch {
    id = ''
  }
  const told = mod.toldTranscript
  if (told && (!id || told.id === id)) return told.path
  let cwd = mod.sessionCwd
  if (!cwd) {
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = ''
    }
  }
  const dir = joinPath(await projectsDir($), projectSlug(cwd))
  if (id) return joinPath(dir, `${id}.jsonl`)
  try {
    const newest = (await $.fs.list(dir)).filter(x => x.kind === 'file' && x.name.endsWith('.jsonl')).sort((x, y) => y.mtimeMs - x.mtimeMs)[0]
    if (newest) return joinPath(dir, newest.name)
  } catch {
    // No such folder yet: the session has written nothing.
  }
  return joinPath(dir, 'session.jsonl')
}

/** Notes the transcript a classic hook's envelope names, when it is the main loop's. */
export function noteTranscript(e: { session_id?: string; transcript_path?: string; agent_id?: string }): void {
  if (e.agent_id === undefined && e.session_id && e.transcript_path) mod.toldTranscript = { id: e.session_id, path: e.transcript_path }
}

/** The file a followed path is read from: this session's transcript for `session`, else the path itself. */
export async function fileOf($: EngineInterface, path: string): Promise<string> {
  return isSessionPath(path) ? sessionTranscript($) : path
}

/** What the pane follows, as the command answers: `this session (<its transcript>)`, or the path. */
export async function followedText($: EngineInterface): Promise<string> {
  const path = await readLogPath($)
  return isSessionPath(path) ? `${THIS_SESSION} (${await sessionTranscript($)})` : path
}

/** The log reader's options from the settings (docs/DESIGN.md 3, 43.5); an empty setting is unset. */
function readerOptions(): Omit<ReaderOptions, 'log'> {
  const cfg = mod.cfg
  return {
    server: cfg.server,
    serverUrl: cfg.serverUrl || undefined,
    serverLog: cfg.serverLog || undefined,
    compare: cfg.compare,
    customPrices: cfg.customPrices || undefined,
    handoff: cfg.handoffFile || undefined,
    stallSecs: cfg.stallSecs,
  }
}

/**
 * The log reader's Summary of `path` (docs/DESIGN.md 3, 43.5), as JSON (`raw`, what a poll
 * compares with the last one) and parsed back with its strings cleaned. Never throws for the
 * log's sake: a failure is the Summary's `error`. With `until` (replay, docs/DESIGN.md 21) it
 * reads the log as if it ended then; with `transcript` it reads the file as a session transcript
 * even before the file exists (docs/DESIGN.md 36). The module's one Reader keeps each log's parse
 * between polls, so a poll reads only what was appended.
 */
export async function summarize($: EngineInterface, path: string, opts: { until?: number; transcript?: boolean } = {}): Promise<{ raw: string; summary: Summary }> {
  const s = await readLog(modIo($), {
    ...readerOptions(),
    log: path,
    until: opts.until != null ? Math.round(opts.until) : undefined,
    transcript: opts.transcript,
  })
  const raw = JSON.stringify(s)
  return { raw, summary: JSON.parse(raw, stripControls) as Summary }
}

// Worker logs carry terminal output (ANSI colour codes, carriage returns), and Text refuses
// control characters, so every string from the log reader loses them before it reaches a tree.
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g
function stripControls(_key: string, value: unknown): unknown {
  return typeof value === 'string' ? value.replace(ANSI, '').replace(CONTROLS, '') : value
}

/** The engine's clock in milliseconds (the test kit's mock answers it), else the wall clock. */
export async function clockMs($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

/** `~/…` with the home directory, the way the log reader reads it. */
async function expandHome($: EngineInterface, path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) return path
  let home: string | undefined
  try {
    home = (await $.env.get('HOME'))?.trim()
  } catch {
    home = undefined
  }
  return home ? `${home.replace(/\/+$/, '')}${path.slice(1)}` : path
}

/**
 * The newest lines of runs.jsonl beside the log's real path (the log reader writes it there,
 * docs/DESIGN.md 22), newest first; null when there is none. Read at most every 10 s.
 */
export async function readRuns($: EngineInterface, logFile: string): Promise<{ real: string; lines: RunLine[] | null }> {
  const at = Date.now()
  const cached = mod.runsCache
  if (cached && cached.path === logFile && at - cached.at < RUNS_EVERY_MS) return cached
  const given = await expandHome($, logFile)
  let real = given
  try {
    real = (await $.fs.stat(given, { resolve: true })).realPath ?? given
  } catch {
    real = given
  }
  const slash = real.lastIndexOf('/')
  const file = joinPath(slash > 0 ? real.slice(0, slash) : slash === 0 ? '/' : '', 'runs.jsonl')
  let lines: RunLine[] | null = null
  try {
    const text = await $.fs.read(file)
    lines = []
    for (const line of text.split('\n').filter(x => x.trim()).slice(-RUNS_SHOWN)) {
      try {
        const row = JSON.parse(line) as unknown
        if (row && typeof row === 'object' && !Array.isArray(row)) lines.push(row as RunLine)
      } catch {
        // A torn or foreign line: skipped.
      }
    }
    lines.reverse()
  } catch {
    lines = null
  }
  mod.runsCache = { path: logFile, at, real, lines }
  return mod.runsCache
}
