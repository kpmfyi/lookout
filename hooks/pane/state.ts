// The pane's state, in one place (docs/DESIGN.md 43.3): the `$.state` atoms (declared in
// types/index.d.ts, kept across a reload), each read and written through its own function below,
// and the module's own variables (lost on a reload, which re-reads the settings), grouped by what
// they serve: `mod`, `mounted`, `replayed` and `asked`. The other files set those objects' fields;
// nothing else at module level is mutable.
import { atom, read, update } from 'claude-code'
import type { Atom, EngineInterface } from 'claude-code'

import type { PaneLayout, Plain, Replay } from '../../types'
import type { Earned } from '../achievements.ts'
import type { Fact } from '../facts.ts'
import type { Packed } from '../grid.ts'
import type { PaneUi } from '../modules/index.ts'
import { PALETTES } from '../palette.ts'
import type { Palette, PaletteId } from '../palette.ts'
import type { SeasonSetting } from '../seasons.ts'
import { SCENES } from '../scenes/index.ts'
import type { SceneSize } from '../scenes/index.ts'
import { readConfig } from './config.ts'
import type { PlainNow, RunLine } from './config.ts'

// ── The atoms

// Change the tag when Summary's fields change: it declines what an earlier version stored.
const summary = atom({ plugin: 'lookout', key: 'summary' } as const, null, { shape: 'summary-3' })
const logPath = atom({ plugin: 'lookout', key: 'logPath' } as const, '')
const sourceName = atom({ plugin: 'lookout', key: 'sourceName' } as const, '')
const now = atom({ plugin: 'lookout', key: 'now' } as const, 0)
const frame = atom({ plugin: 'lookout', key: 'frame' } as const, 0)
const scene = atom({ plugin: 'lookout', key: 'scene' } as const, SCENES[0]!.id)
// The size the person picked with /lookout compact|standard|large (null: none, the setting and the
// layout decide). An atom, so a reload keeps the pick even when it equals the setting.
const sceneSize = atom({ plugin: 'lookout', key: 'sceneSize' } as const, null as SceneSize | null, { shape: 'scene-size-2' })
// The palette the person picked with /lookout night|paper|phosphor (null: none, the setting
// decides); an atom so a reload keeps the pick.
const palette = atom({ plugin: 'lookout', key: 'palette' } as const, null as PaletteId | null, { shape: 'palette-1' })
// The season the person picked with /lookout season <…> (null: none, the setting decides); an
// atom so a reload keeps the pick.
const season = atom({ plugin: 'lookout', key: 'season' } as const, null as SeasonSetting | null, { shape: 'season-1' })
const replay = atom({ plugin: 'lookout', key: 'replay' } as const, null as Replay | null)
const layout = atom({ plugin: 'lookout', key: 'layout' } as const, 'calm' as PaneLayout)
// The layout `/lookout ambient` left, so the same command goes back to it.
const beforeAmbient = atom({ plugin: 'lookout', key: 'beforeAmbient' } as const, 'calm' as PaneLayout)
// Whether the detailed layout unfolds the last edit, the last command and the timeline (`d`,
// docs/DESIGN.md 38.2); an atom so a reload keeps the pick.
const details = atom({ plugin: 'lookout', key: 'details' } as const, false, { shape: 'details-1' })
// The thinking in plain words (docs/DESIGN.md 40.2). An atom, not module memory alone: the draw
// subscribes to it, so an answer redraws the pane, and a reload keeps the newest answer on screen
// without paying for it again.
const plain = atom({ plugin: 'lookout', key: 'plain' } as const, { answer: null, failed: '' } as Plain, { shape: 'plain-1' })
// The achievements earned so far (docs/DESIGN.md 24), as the plugin store held them at the last
// finished run this session saw; null until then (or with no store).
const achieved = atom({ plugin: 'lookout', key: 'achievements' } as const, null as Earned | null, { shape: 'achievements-1' })

/** A change to the value an atom holds. */
type Change<A> = A extends Atom<infer T> ? (v: T) => T : never

/**
 * Each atom's `read` (which subscribes a draw to it) and `update` (read, change, write with
 * `ifVersion`, again on a miss). The pane's other files reach the atoms only through these:
 * `claude plugin validate` lists what a module reads and writes from `read` and `update` calls whose
 * atom is a const of the same file, and follows `$` past an import only into a function
 * declaration, so they are declared functions beside the atoms.
 */
export function readSummary($: EngineInterface) {
  return read($, summary)
}
export function updateSummary($: EngineInterface, change: Change<typeof summary>) {
  return update($, summary, change)
}
export function readLogPath($: EngineInterface) {
  return read($, logPath)
}
export function updateLogPath($: EngineInterface, change: Change<typeof logPath>) {
  return update($, logPath, change)
}
export function readSourceName($: EngineInterface) {
  return read($, sourceName)
}
export function updateSourceName($: EngineInterface, change: Change<typeof sourceName>) {
  return update($, sourceName, change)
}
export function readNow($: EngineInterface) {
  return read($, now)
}
export function updateNow($: EngineInterface, change: Change<typeof now>) {
  return update($, now, change)
}
export function readFrame($: EngineInterface) {
  return read($, frame)
}
export function updateFrame($: EngineInterface, change: Change<typeof frame>) {
  return update($, frame, change)
}
export function readScene($: EngineInterface) {
  return read($, scene)
}
export function updateScene($: EngineInterface, change: Change<typeof scene>) {
  return update($, scene, change)
}
export function readSceneSize($: EngineInterface) {
  return read($, sceneSize)
}
export function updateSceneSize($: EngineInterface, change: Change<typeof sceneSize>) {
  return update($, sceneSize, change)
}
export function updatePalette($: EngineInterface, change: Change<typeof palette>) {
  return update($, palette, change)
}
export function updateSeason($: EngineInterface, change: Change<typeof season>) {
  return update($, season, change)
}
export function readReplay($: EngineInterface) {
  return read($, replay)
}
export function updateReplay($: EngineInterface, change: Change<typeof replay>) {
  return update($, replay, change)
}
export function readLayout($: EngineInterface) {
  return read($, layout)
}
export function updateLayout($: EngineInterface, change: Change<typeof layout>) {
  return update($, layout, change)
}
export function readBeforeAmbient($: EngineInterface) {
  return read($, beforeAmbient)
}
export function updateBeforeAmbient($: EngineInterface, change: Change<typeof beforeAmbient>) {
  return update($, beforeAmbient, change)
}
export function readDetails($: EngineInterface) {
  return read($, details)
}
export function updateDetails($: EngineInterface, change: Change<typeof details>) {
  return update($, details, change)
}
export function readPlain($: EngineInterface) {
  return read($, plain)
}
export function updatePlain($: EngineInterface, change: Change<typeof plain>) {
  return update($, plain, change)
}
export function readAchieved($: EngineInterface) {
  return read($, achieved)
}
export function updateAchieved($: EngineInterface, change: Change<typeof achieved>) {
  return update($, achieved, change)
}

// ── The module's own variables

/**
 * The settings (a change reloads the module), the session's directory, and what the polls keep
 * between them.
 */
export const mod = {
  cfg: readConfig({}),
  sessionCwd: '',
  // This session's transcript as the engine named it (a SessionStart or UserPromptSubmit hook's
  // `transcript_path`), with the session id it came with; and the projects folder, read once a session.
  toldTranscript: null as { id: string; path: string } | null,
  projectsRead: null as Promise<string> | null,
  // The last Summary's JSON, so an unchanged poll writes nothing.
  lastRaw: '',
  idleTicks: 0,
  // When the demo was entered (seconds since the epoch); 0 until its first poll. A reload restarts it.
  demoStart: 0,
  // The status line this module last set (undefined: none), so an unchanged line is not sent again.
  lastStatus: undefined as string | undefined,
  // runs.jsonl as last read (docs/DESIGN.md 22): for which log, when, and its newest lines (null: none).
  runsCache: null as { path: string; at: number; real: string; lines: RunLine[] | null } | null,
}

/** What the last terminal draw mounted, for the tick's blits (docs/DESIGN.md 30). */
export const mounted = {
  columns: 0,
  rows: 0,
  scene: '',
  // The Raster keys the last terminal draw mounted: a blit never targets any other.
  keys: new Set<string>(),
  // The module grids the last terminal draw mounted (panel: `modules`; wall: `modules-top` and
  // `modules-bottom`), as packed then, and the pane's picks the toggles module shows.
  grids: [] as { key: string; packed: Packed }[],
  ui: {} as PaneUi,
  // The facts the last terminal draw spelled out in its own rows and modules (docs/DESIGN.md 31),
  // passed to the tick's scene and grids as `shown` so a blit drops the same text the draw did.
  shown: undefined as ReadonlySet<Fact> | undefined,
  // Whether the last terminal draw was calm or ambient, whose scene takes the story's caption (docs/DESIGN.md 38.1).
  narrated: false,
  // The plain words the last terminal draw handed its scene, for the tick's frames.
  plain: undefined as PlainNow | undefined,
  // The hash of the cells the tick last blitted to each key (docs/DESIGN.md 30): a frame whose cells
  // hash the same is not sent again. Every pane draw forgets them (it mounts its own cells).
  blitted: new Map<string, number>(),
}

/**
 * Replay (docs/DESIGN.md 21): the replayed log's first row and end (epoch seconds), its wall time
 * once a result row was seen (0 until then), whether the clock reached the end, what went wrong,
 * and the engine clock at the last replay poll (null: none yet).
 */
export const replayed = {
  started: 0,
  end: null as number | null,
  total: 0,
  ended: false,
  error: '',
  lastMs: null as number | null,
}

/**
 * In plain words (docs/DESIGN.md 40.2): the answers by the thinking's hash (oldest first, at most
 * EXPLAIN_KEPT), the request in flight and its abort, when the last request was made and when
 * asking may resume after an API error (the engine clock, ms), and the hash of the thinking the last
 * draw showed in a thinking block or screen ('' for none): a closed pane draws nothing, so asks nothing.
 */
export const asked = {
  explained: new Map<string, string>(),
  explaining: null as { key: string; stop: AbortController } | null,
  at: Number.NEGATIVE_INFINITY,
  resume: 0,
  drawnThinking: '',
}

/** The palette drawn: the person's pick (the `palette` atom), else the setting. */
export async function paletteNow($: EngineInterface): Promise<Palette> {
  return PALETTES[(await read($, palette)) ?? mod.cfg.palette]
}

/** The season drawn: the person's pick (the `season` atom), else the setting. */
export async function seasonNow($: EngineInterface): Promise<SeasonSetting> {
  return (await read($, season)) ?? mod.cfg.season
}
