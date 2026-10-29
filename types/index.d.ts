// The Summary contract (v3, docs/DESIGN.md section 3): what the log reader (hooks/reader) gives for
// one stream-json log or session transcript, and the values the lookout pane keeps in $.state.

export type ToolClass = 'shell' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

export type WatchEvent = {
  t: number | null
  kind: 'think' | 'text' | 'tool'
  label: string
  tool?: string
  cls?: ToolClass
  status?: 'running' | 'ok' | 'error' | 'denied'
  dur?: number | null
  detail?: string
}

export type ServerStats = {
  adapter: 'mlx-serve' | 'llama.cpp' | 'ollama' | 'lmstudio' | 'vllm'
  /** false: the adapter was chosen but could not answer; `note` says why. */
  ok: boolean
  note?: string
  sampled_at: number
  model?: string | null
  ctx_limit?: number | null
  resident_gb?: number | null
  inflight?: { msgs?: number | null; prompt?: number | null; cached?: number } | null
  done?: { prompt: number; gen: number; prefill_tps: number; cached: number; decode_tps: number; stop: string; spec: number | null }[]
  rates?: { decode_tps?: number; prefill_tps?: number; kv_used?: number; running?: number } | null
  log_mtime?: number
}

export type Summary = {
  path: string
  exists: boolean
  size?: number
  mtime?: number
  error?: string
  source: { name: string; path: string }
  model?: string | null
  cwd?: string | null
  started?: number | null
  last_ts?: number | null
  turns?: number
  ctx?: number
  out_est?: number
  think_ms?: number
  tool_ms?: number
  thinking?: string
  text?: string
  errors?: number
  denials?: number
  result?: {
    subtype: string
    turns: number
    duration_ms: number
    api_ms: number
    input: number
    cache_read: number
    cache_write: number
    output: number
    cost: number | null
  } | null
  pending?:
    | { kind: 'done' }
    | { kind: 'model'; since: number | null }
    | { kind: 'tool'; tool: string; cls: ToolClass; label: string; since: number | null }
    /** A session transcript's turn ended (docs/DESIGN.md 36): the person's move, since `since`. */
    | { kind: 'user'; since: number | null }
  stalled?: boolean
  tool_counts?: [string, number][]
  files?: [string, number][]
  events?: WatchEvent[]
  last_diff?: { path: string; diff: string; t: number | null; lines?: number } | null
  last_bash?: { cmd: string; desc?: string | null; out: string[]; more: number; status: string; t: number | null } | null
  last_error?: { t: number | null; tool: string; detail: string } | null
  turn_secs?: number[]
  ctx_series?: number[]
  tests?: { t: number | null; failed: number; passed: number; total: number }[]
  tsc?: { t: number | null; errors: number }[]
  handoff?: { text: string; path: string; since: number } | null
  cost?: {
    compare: string
    usd: number
    priced_at: string
    prices: { in: number; out: number; cache_write: number; cache_read: number }
    basis: string
    at_all?: Record<string, number>
  } | null
  server?: ServerStats | null
  memory?: { at: number; free_gb?: number; total_gb?: number; server_gb?: number; server_model?: string } | null
  git?: {
    branch: string
    commits: { hash: string; t: number; subject: string; stat: string }[]
    dirty: string
    untracked: number
  } | null
  /** True for a Claude Code session transcript (docs/DESIGN.md 36); absent for a stream-json log. */
  transcript?: boolean
  /** A transcript's latest prompt the person typed (its task), cut to one line; null before the first. */
  prompt?: { text: string; t: number | null } | null
  /** Replay (docs/DESIGN.md 21): the epoch second the log is read as if it ended at; absent when live. */
  until?: number
}

/** The pane layout (docs/DESIGN.md 26, 38, 43.2): the scene over the story in plain words; detailed, the scene with the module grid (or, on a wide pane, the modules around a large scene) over the text blocks; or the scene alone filling the pane. */
export type PaneLayout = 'calm' | 'detailed' | 'ambient'

/** The replay atom (docs/DESIGN.md 21). */
export type Replay = { path: string; at: number; speed: number; paused: boolean }

/** Which sources the thinking is put in plain words for (docs/DESIGN.md 40.2): this session only, every source, or none. */
export type Explain = 'session' | 'all' | 'off'

/**
 * The plain-words atom (docs/DESIGN.md 40.2): the newest answer (the hash of the thinking it says
 * again, the model's marked reply, and the thinking's time in epoch seconds), and the hash of a
 * thinking text whose request failed ('' for none).
 */
export type Plain = { answer: { key: string; reply: string; t: number } | null; failed: string }

declare module 'claude-code' {
  /** The status tool this mod registers (docs/DESIGN.md 18), so its tool.call hook and tests type without a live connection. */
  interface McpToolInputs {
    mcp__lookout__status: {
      /** a named source or path; default the followed log */
      source?: string
      /** brief (default) or full: adds the timeline, the last edit and the last command output */
      detail?: 'brief' | 'full'
    }
  }
  interface PluginState {
    lookout: {
      /** The newest summary of the followed log; tagged 'summary-3'. */
      summary: Shaped<Summary | null>
      /** The log being followed, as given (`~` allowed), `demo`, or `session` (this session's transcript, found afresh each poll); '' until session.start resolves it. */
      logPath: string
      /** Which source it came from: a `sources` name, 'LOOKOUT_LOG', 'log', 'default', 'path', 'demo' or 'this session'. */
      sourceName: string
      /** Seconds since the epoch at the last poll. */
      now: number
      /** The animation frame counter. */
      frame: number
      /** The active scene's id (falls back to the first scene when unknown). */
      scene: string
      /** The scene size picked with /lookout compact|standard|large, kept across reloads; null: none (the `sceneSize` setting and the layout decide). Tagged 'scene-size-2'. */
      sceneSize: Shaped<'compact' | 'standard' | 'large' | null>
      /** The palette picked with /lookout night|paper|phosphor, kept across reloads; null: none (the `palette` setting decides). Tagged 'palette-1'. */
      palette: Shaped<'night' | 'paper' | 'phosphor' | null>
      /** The season picked with /lookout season <…>, kept across reloads; null: none (the `season` setting decides). Tagged 'season-1'. */
      season: Shaped<'auto' | 'winter' | 'spring' | 'summer' | 'autumn' | 'none' | null>
      /** The pane layout this session (the `layout` setting, `l`, or /lookout calm|detailed|ambient); a pick saved as classic, panel or wall reads as detailed (docs/DESIGN.md 43.2). */
      layout: PaneLayout
      /** The layout `/lookout ambient` switched away from, which the same command returns to. */
      beforeAmbient: PaneLayout
      /** Whether the detailed layout shows the last edit's diff, the last command's output and the long timeline (`d`, /lookout details; docs/DESIGN.md 38.2), kept across reloads. Tagged 'details-1'. */
      details: Shaped<boolean>
      /** The achievements earned (docs/DESIGN.md 24): each id, the run that earned it and when; mirrored from the plugin store at the last finished run seen, null until then. Tagged 'achievements-1'. */
      achievements: Shaped<Record<string, { run: string; t: number }> | null>
      /** The thinking in plain words for the followed source (docs/DESIGN.md 40.2): the newest answer and the text that failed; emptied when the source changes. Tagged 'plain-1'. */
      plain: Shaped<Plain>
      /** A replay of a finished log (docs/DESIGN.md 21): its path, the replay clock (epoch seconds), the speed and whether it is paused; null when following live. */
      replay: Replay | null
    }
  }
}
