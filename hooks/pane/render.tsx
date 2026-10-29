// The pane draw (docs/DESIGN.md 15, 26, 38, 43.2): reads the atoms, works out the shape the pane
// draws as (calm, classic, panel, wall or ambient) and the scene's size, notes what the terminal
// mounts for the tick, then draws ambient and the waiting pane itself and hands the rest to calm
// (calm.tsx) or the detailed layouts (detailed.tsx).
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { activity, isSession } from '../activity.ts'
import type { ModuleCtx, PaneUi } from '../modules/index.ts'
import { rowsFor, sceneById } from '../scenes/index.ts'
import type { SceneCtx } from '../scenes/index.ts'
import { thoughtKey } from '../thought.ts'
import { THIS_SESSION, WALL_MIN_COLUMNS, layoutOf } from './config.ts'
import type { Shape } from './config.ts'
import { calmPane } from './calm.tsx'
import { controlsRow, replayControlsRow } from './commands.tsx'
import { detailedPane } from './detailed.tsx'
import { plainFor } from './explain.ts'
import { deskOf, moduleShown, narrated, paneFacts, sizeFor, storyNow } from './layout.ts'
import { replayText } from './poll.ts'
import { asked, mod, mounted, paletteNow, readAchieved, readDetails, readFrame, readLayout, readNow, readPlain, readReplay, readScene, readSceneSize, readSourceName, readSummary, replayed, seasonNow } from './state.ts'
import { PULSE, SPIN } from './text.ts'
import { forgetBlits } from './tick.ts'

// The scenes whose tall room hangs a thinking screen on the wall (docs/DESIGN.md 39).
const SHOWCASE = new Set(['office-hd'])

export async function draw($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Raster = 'Raster' in ui ? ui.Raster : null
  const isTerm = e.surface === 'terminal' && Raster != null
  const cfg = mod.cfg
  const unfolded = await readDetails($)
  const sc = sceneById(await readScene($))
  const picked = await readSceneSize($)
  const pal = await paletteNow($)
  const sea = await seasonNow($)
  const pickedLayout = layoutOf(await readLayout($))
  const s = await readSummary($)
  const src = await readSourceName($)
  const rp = await readReplay($)
  const earned = await readAchieved($)
  const pst = await readPlain($)
  // Reading the frame subscribes the draw to it: only off the terminal, where the text spinner
  // is the animation. On the terminal the tick blits the scene instead.
  const f = isTerm ? 0 : await readFrame($)
  // While replaying, the pane's clock is the replay's (docs/DESIGN.md 21).
  const t = rp ? rp.at : (await readNow($)) || Date.now() / 1000
  const cols = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 60)
  const rows = Math.max(24, e.viewport?.rows ?? 40)
  // The layout drawn (docs/DESIGN.md 38.3, 43.2): off the terminal calm as itself and the rest as
  // classic (no Rasters there); detailed as the wall where the pane is wide enough, else the panel.
  const shape: Shape = !isTerm ? (pickedLayout === 'calm' ? 'calm' : 'classic') : pickedLayout === 'detailed' ? (cols >= WALL_MIN_COLUMNS ? 'wall' : 'panel') : pickedLayout
  const size = sizeFor(shape, picked)
  // Ambient (docs/DESIGN.md 26): the scene fills the pane's rows less the hotkey row (and the
  // replay rows). A scene that lays itself out by height (its large size taller than its
  // standard) is drawn that tall; a fixed-height one at its large size, centred on the
  // terminal's background.
  const ambient = shape === 'ambient'
  const bodyRows = (e.props as { scroll?: { bodyRows?: number } }).scroll?.bodyRows ?? rows
  const ambientRoom = Math.max(rowsFor(sc, 'large'), Math.floor(bodyRows) - 1 - (rp ? 2 : 0))
  const stretches = sc.rows.large > sc.rows.standard
  const sceneRows = ambient && stretches ? ambientRoom : rowsFor(sc, size)
  const ambientPad = ambient ? Math.floor((ambientRoom - sceneRows) / 2) : 0
  if (isTerm) {
    mounted.keys = new Set()
    mounted.grids = []
    mounted.shown = undefined
    mounted.narrated = false
  }
  const spin = SPIN[f % SPIN.length]!
  // The thinking this draw shows in a block or screen, by key (set below where one is drawn): only
  // that text is put in plain words (docs/DESIGN.md 40.2).
  asked.drawnThinking = ''

  if (!s) return forgetBlits(<Text dimColor>{rp && replayed.error ? replayed.error : `${spin} reading log…`}</Text>)

  const a = activity(s, t, cfg.stallSecs)
  // calm tells the run in words (docs/DESIGN.md 38.1) and its scene's caption is the story's; the
  // ambient scene, the showcase, speaks the same plain caption (and draws no text, so claims nothing).
  const story = shape === 'calm' || shape === 'ambient' ? storyNow(s, a, t) : null
  if (isTerm) {
    mounted.columns = cols
    mounted.rows = sceneRows
    mounted.scene = sc.id
    mounted.keys.add(sc.id)
    mounted.narrated = story != null
  }
  // The modules' context and the facts the pane spells out (docs/DESIGN.md 31), worked out before
  // the scene so it drops its own text for them. Only on the terminal: elsewhere there are no
  // scenes or modules to tell.
  const picks: PaneUi = { view: unfolded ? 'full' : 'fold', scene: sc.id, size, palette: pal.id, source: src || undefined }
  const desk = deskOf(s)
  const base: ModuleCtx = { s, a, you: desk.you, worker: desk.worker, frame: 0, t, compare: cfg.compare, ui: picks, palette: pal }
  const visible = shape === 'panel' || shape === 'wall' ? cfg.modules.filter(id => moduleShown(id, base)) : []
  const shown = isTerm && s.exists ? paneFacts(shape, visible, new Set(story?.claims ?? [])) : undefined
  const mctx: ModuleCtx = { ...base, shown }
  if (isTerm) mounted.shown = shown
  const sceneA = story ? narrated(a, story) : a
  // The thinking (docs/DESIGN.md 40): its key, and its plain words where they are known.
  const thinking = (s.thinking ?? '').trim()
  const thinkingKey = thinking ? thoughtKey(thinking) : ''
  const plainNow = s.exists ? plainFor(s, pst, rp != null) : undefined
  if (isTerm) mounted.plain = plainNow
  const sceneCtx: SceneCtx = { s, a: sceneA, frame: 0, t, columns: cols, rows: sceneRows, ...desk, transparent: cfg.background !== 'scene', palette: pal, season: sea, shown, plain: plainNow, ambience: cfg.ambience }
  const sceneRaster = Raster ? <Raster key={sc.id} columns={cols} rows={sceneRows} cells={sc.draw(sceneCtx)} /> : null
  const controls = isTerm ? controlsRow($, ui, { shape, unfolded, sceneId: sc.id, picked: pickedLayout, src }) : null
  // Replay's own row and hotkeys (docs/DESIGN.md 21), on every surface while replaying.
  const replayRow = rp ? (
    <Text dimColor wrap="truncate-end">
      {replayText(rp)}
    </Text>
  ) : null
  const replayControls = rp ? replayControlsRow($, ui, rp) : null

  if (ambient) {
    // The showcase's thinking screen (docs/DESIGN.md 39) is drawn in a tall room only.
    if (isTerm && s.exists && SHOWCASE.has(sc.id) && sceneRows > sc.rows.large) asked.drawnThinking = thinkingKey
    return forgetBlits(
      <Box flexDirection="column" width={cols}>
        {ambientPad > 0 ? <Box marginTop={ambientPad}>{sceneRaster}</Box> : sceneRaster}
        {ambientPad > 0 ? <Box height={ambientRoom - sceneRows - ambientPad} /> : null}
        {replayRow}
        {controls}
        {replayControls}
      </Box>
    )
  }

  if (!s.exists) {
    // This session's transcript starts with its first prompt; a worker log that is not there yet
    // may never come, so the other two ways in are named (docs/DESIGN.md 36).
    const session = isSession(s)
    return forgetBlits(
      <Box flexDirection="column" width={cols}>
        {isTerm ? sceneRaster : null}
        {replayRow}
        {controls}
        {replayControls}
        <Text color={session ? 'subtle' : 'warning'} wrap="truncate-end">
          {PULSE[f % PULSE.length]} {session ? `${THIS_SESSION}: waiting for your first prompt` : `waiting for ${s.path}`}
        </Text>
        <Text dimColor wrap="truncate-end">
          {session
            ? '/lookout <source> | <path> to follow a worker log · /lookout demo for a scripted run'
            : '/lookout session to follow this session · /lookout demo for a scripted run · /lookout <source> | <path> · set `log` or `sources` in the plugin settings, or LOOKOUT_LOG'}
        </Text>
      </Box>
    )
  }

  const live = a.state !== 'done' && a.state !== 'nolog'
  const statusMark = a.state === 'done' ? (a.ok ? '✓' : '✖') : live ? spin : '○'
  asked.drawnThinking = thinkingKey // calm and the detailed layouts draw a thinking block
  const d = { ui, Raster, isTerm, shape, s, a, t, f, cols, rows, spin, statusMark, unfolded, rp, earned, story, visible, shown, mctx, picks, plainNow, thinking, sceneRaster, replayRow, controls, replayControls }
  if (story && shape === 'calm') return forgetBlits(calmPane({ ...d, story }))
  return forgetBlits(await detailedPane($, d))
}
