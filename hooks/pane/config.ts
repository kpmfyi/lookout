// lookout's settings and the pane's fixed numbers (docs/DESIGN.md 2): what `readConfig` makes of
// the plugin options, the layouts and how their names read (docs/DESIGN.md 38, 43.2), and the
// shapes the pane's other modules share. Pure: nothing here touches `$` or the module's state.
import type { PluginOptions } from 'claude-code'

import type { Explain, PaneLayout } from '../../types'
import { DEFAULT_ORDER, MODULES } from '../modules/index.ts'
import { isPaletteId } from '../palette.ts'
import type { PaletteId } from '../palette.ts'
import { isSeasonSetting } from '../seasons.ts'
import type { SeasonSetting } from '../seasons.ts'
import { SCENES, isSceneSize } from '../scenes/index.ts'
import type { SceneSize } from '../scenes/index.ts'
import type { Run } from '../thought.ts'

export const PANE = 'lookout'
export const TITLE = 'Lookout'
export const POLL_MS = 1500
export const FRAME_MS = 120
export const IDLE_EVERY = 8 // a finished run's scene moves once per ~1 s
export const AMBIENT_EVERY = 2 // with ambience on, about four a second so its loops do not stutter (docs/DESIGN.md 42.1)
export const DEFAULT_LOG = 'logs/worker-current.jsonl'
// This session as a source (docs/DESIGN.md 36): the word the command, `log` and LOOKOUT_LOG take,
// kept as the `logPath` (the transcript is found afresh each poll, as /clear changes the session
// id), and the name the pane gives it.
export const SESSION = 'session'
export const THIS_SESSION = 'this session'

// The pane layouts (docs/DESIGN.md 26, 38, 43.2) in the order `l` cycles them. The layouts retired
// in 43.2 (and a saved pick naming one) read as detailed.
export const LAYOUTS: readonly PaneLayout[] = ['calm', 'detailed', 'ambient']
export const AS_DETAILED: readonly string[] = ['classic', 'panel', 'wall']
// What the pane draws (docs/DESIGN.md 15, 43.2): calm and ambient as themselves; detailed as the
// panel (the module grid under the scene), or from WALL_MIN_COLUMNS as the wall (the modules split
// around a large scene); off the terminal detailed and ambient draw as classic (the text blocks).
export type Shape = 'calm' | 'classic' | 'panel' | 'wall' | 'ambient'
export const WALL_MIN_COLUMNS = 70

export type Notify = 'off' | 'status' | 'toasts' | 'both'
const NOTIFY: readonly Notify[] = ['off', 'status', 'toasts', 'both']
// Replay (docs/DESIGN.md 21): the speeds `x` cycles and the step `b`/`f` seek by.
export const SPEEDS = [1, 4, 8, 32] as const
export const SEEK_SECS = 30
// Which sources the thinking is put in plain words for (docs/DESIGN.md 40.2).
const EXPLAIN: readonly Explain[] = ['session', 'all', 'off']

/** One line of runs.jsonl, as far as the pane reads it. */
export type RunLine = { t?: number; path?: string; model?: string | null; subtype?: string | null; turns?: number | null; duration_ms?: number | null; cost_at?: Record<string, number> }

/** The plain words drawn for the thinking (docs/DESIGN.md 40.2): the runs, the thinking's time, and whether a newer answer is on its way. */
export type PlainNow = { runs: Run[]; t: number; stale: boolean }

export type Source = { name: string; path: string }
export type Config = {
  log: string
  sources: Source[]
  scene: string
  /** How tall the scene is drawn (docs/DESIGN.md 14). */
  sceneSize: SceneSize
  /** Whether `sceneSize` was set to something other than its default (a layout then keeps it). */
  sceneSizeSet: boolean
  /** The pane layout a fresh session starts in (docs/DESIGN.md 38, 43.2). */
  layout: PaneLayout
  /** Module ids for the detailed layout, known ones only, in order; DEFAULT_ORDER when none. */
  modules: string[]
  server: string
  serverUrl: string
  serverLog: string
  compare: string
  customPrices: string
  stallSecs: number
  handoffFile: string
  /** 'terminal' leaves scene backgrounds unpainted (the terminal's colour shows); 'scene' paints them. */
  background: 'terminal' | 'scene'
  /** Whether mcp__lookout__status is registered (docs/DESIGN.md 18). */
  tool: boolean
  /** Toasts and/or the status line for failing tests, stalls and the finish (docs/DESIGN.md 20). */
  notify: Notify
  /** The colours the scenes and modules paint with (docs/DESIGN.md 27). */
  palette: PaletteId
  /** What the offices' window shows (docs/DESIGN.md 28): auto (the date), a fixed season, or none. */
  season: SeasonSetting
  /** Which sources the thinking is put in plain words for (docs/DESIGN.md 40.2). */
  explain: Explain
  /** The scenes' lofi layer of slow decorative loops (docs/DESIGN.md 42): on unless the setting is `off`. */
  ambience: boolean
}

export function readConfig(o: PluginOptions): Config {
  const str = (key: string, d: string): string => {
    const v = o[key]
    return typeof v === 'string' ? v.trim() : d
  }
  const raw = o.sources
  const items = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : []) as readonly string[]
  const sources: Source[] = []
  for (const item of items) {
    const one = item.trim()
    if (!one) continue
    const eq = one.indexOf('=')
    if (eq > 0) sources.push({ name: one.slice(0, eq).trim(), path: one.slice(eq + 1).trim() })
    else sources.push({ name: (one.split('/').at(-1) ?? one).replace(/(-current)?\.jsonl?$/, ''), path: one })
  }
  const stall = typeof o.stallSecs === 'number' && o.stallSecs > 0 ? o.stallSecs : 180
  const size = str('sceneSize', 'standard').toLowerCase()
  const pal = str('palette', 'night').toLowerCase()
  const sea = str('season', 'auto').toLowerCase()
  const rawMods = o.modules
  const modItems = (Array.isArray(rawMods) ? rawMods : typeof rawMods === 'string' ? rawMods.split(/[,\s]+/) : []) as readonly unknown[]
  const modules = modItems.map(x => String(x).trim().toLowerCase()).filter(id => id !== '' && Object.hasOwn(MODULES, id))
  return {
    log: str('log', ''),
    sources,
    scene: str('scene', SCENES[0]!.id),
    sceneSize: isSceneSize(size) ? size : 'standard',
    sceneSizeSet: isSceneSize(size) && size !== 'standard',
    layout: layoutOf(str('layout', 'calm')),
    modules: modules.length ? modules : [...DEFAULT_ORDER],
    server: str('server', 'auto') || 'auto',
    serverUrl: str('serverUrl', ''),
    serverLog: str('serverLog', ''),
    compare: str('compare', 'claude-sonnet-5-5') || 'claude-sonnet-5-5',
    customPrices: str('customPrices', ''),
    stallSecs: stall,
    handoffFile: str('handoffFile', ''),
    background: str('background', 'terminal') === 'scene' ? 'scene' : 'terminal',
    tool: o.tool !== false,
    notify: (NOTIFY as readonly string[]).includes(str('notify', 'toasts').toLowerCase()) ? (str('notify', 'toasts').toLowerCase() as Notify) : 'toasts',
    palette: isPaletteId(pal) ? pal : 'night',
    season: isSeasonSetting(sea) ? sea : 'auto',
    explain: (EXPLAIN as readonly string[]).includes(str('explain', 'off').toLowerCase()) ? (str('explain', 'off').toLowerCase() as Explain) : 'off',
    ambience: str('ambience', 'on').toLowerCase() !== 'off',
  }
}

/**
 * A layout as a setting, a saved pick or the command names it (docs/DESIGN.md 43.2): classic, panel
 * and wall read as detailed; anything unknown as calm.
 */
export function layoutOf(v: unknown): PaneLayout {
  const id = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (AS_DETAILED.includes(id)) return 'detailed'
  return (LAYOUTS as readonly string[]).includes(id) ? (id as PaneLayout) : 'calm'
}

/** The layout after `id` in the order `l` cycles. */
export function nextLayout(id: PaneLayout): PaneLayout {
  return LAYOUTS[(LAYOUTS.indexOf(layoutOf(id)) + 1) % LAYOUTS.length]!
}

/** The replay speed after `speed` in the order `x` cycles (docs/DESIGN.md 21). */
export function nextSpeed(speed: number): number {
  const i = SPEEDS.findIndex(x => x === speed)
  return SPEEDS[(i + 1) % SPEEDS.length]!
}
