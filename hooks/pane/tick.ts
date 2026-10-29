// The tick (docs/DESIGN.md 30): every FRAME_MS the frame moves on, and on the terminal the mounted
// scene and module grids are repainted in place with blits, each sent only when its cells changed.
// A pane draw mounts its own cells, so it forgets what was blitted (`forgetBlits`).
import type { EngineInterface } from 'claude-code'

import { activity } from '../activity.ts'
import type { ModuleCtx } from '../modules/index.ts'
import { sceneById } from '../scenes/index.ts'
import type { Scene, SceneCtx } from '../scenes/index.ts'
import { AMBIENT_EVERY, IDLE_EVERY, PANE } from './config.ts'
import { deskOf, gridCells, narrated, storyNow } from './layout.ts'
import { mod, mounted, paletteNow, readReplay, readSummary, seasonNow, updateFrame } from './state.ts'

/** 32-bit FNV-1a over every UTF-16 unit of `s` (an encoded Raster: a few hundred KB at most). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Blits `cells` to the Raster `key` unless the last blit there sent the same cells (by hash and
 * length). A blit that throws (not mounted) is not remembered.
 */
async function blitCells($: EngineInterface, key: string, rows: number, cells: string): Promise<void> {
  const h = fnv1a(cells) ^ cells.length
  if (mounted.blitted.get(key) === h) return
  await $.ui.blit({ requestId: PANE, key, columns: mounted.columns, rows, cells })
  mounted.blitted.set(key, h)
}

/**
 * The pane draw's tree, the blitted hashes forgotten: the draw mounts its own cells, so every key
 * is blitted afresh after it, also when a tick ran while it was drawing.
 */
export function forgetBlits<T>(tree: T): T {
  mounted.blitted.clear()
  return tree
}

/** One frame of the mounted scene. */
async function blitScene($: EngineInterface, sc: Scene, ctx: SceneCtx): Promise<void> {
  try {
    await blitCells($, sc.id, mounted.rows, sc.draw(ctx))
  } catch {
    // Not mounted (pane closed or another surface): the next draw mounts it again.
  }
}

export async function tick($: EngineInterface): Promise<void> {
  // The scene animates while the worker is live; a finished run moves once a second or so, or
  // about four times a second with ambience on (docs/DESIGN.md 42.1).
  // The terminal's scene is repainted in place with a blit; other surfaces redraw the spinner.
  const s = await readSummary($)
  if (!s) return
  const rp = await readReplay($)
  const t = rp ? rp.at : Date.now() / 1000
  const cfg = mod.cfg
  const a = activity(s, t, cfg.stallSecs)
  if (a.state === 'nolog') return
  if (a.state === 'done') {
    mod.idleTicks = (mod.idleTicks + 1) % (cfg.ambience ? AMBIENT_EVERY : IDLE_EVERY)
    if (mod.idleTicks !== 0) return
  }
  const f = await updateFrame($, n => (n + 1) % 1_000_000)
  if (!mounted.columns) return
  const desk = deskOf(s)
  const pal = await paletteNow($)
  if (mounted.rows && mounted.scene && mounted.keys.has(mounted.scene)) {
    const sc = sceneById(mounted.scene)
    const sea = await seasonNow($)
    const sa = mounted.narrated ? narrated(a, storyNow(s, a, t)) : a
    await blitScene($, sc, { s, a: sa, frame: f, t, columns: mounted.columns, rows: mounted.rows, ...desk, transparent: cfg.background !== 'scene', palette: pal, season: sea, shown: mounted.shown, plain: mounted.plain, ambience: cfg.ambience })
  }
  // The module grids move with the scene (reels, lamps, the clock); about 0.6 ms a frame at 144
  // columns, so every tick.
  if (mounted.grids.length === 0) return
  const mctx: ModuleCtx = { s, a, you: desk.you, worker: desk.worker, frame: f, t, compare: cfg.compare, ui: mounted.ui, palette: pal, shown: mounted.shown }
  for (const g of mounted.grids) {
    if (!mounted.keys.has(g.key)) continue
    try {
      await blitCells($, g.key, g.packed.rows, gridCells(g.packed, mounted.columns, mctx))
    } catch {
      // Not mounted (pane closed or another surface): the next draw mounts it again.
    }
  }
}
