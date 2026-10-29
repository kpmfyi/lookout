// The scene registry (docs/DESIGN.md section 5). A scene is a pure function of the summary, the
// activity, the frame counter and the clock, drawn into a Raster of `columns × rows` cells; the
// pane draws it at frame 0 and the tick repaints it in place with $.ui.blit.
import type { Summary } from '../../types'
import type { Activity } from '../activity.ts'
import type { You } from '../you.ts'
import type { Palette } from '../palette.ts'
import type { Fact } from '../facts.ts'
import type { Run } from '../thought.ts'
import { office } from './office.ts'
import { observatory } from './observatory.ts'
import { officeHd } from './office-hd.ts'

export { cable, cut, frameRect, hash, layout, rect } from '../canvas.ts'
export { fitRows } from './fit.ts'
export type { Layout, Rect } from '../canvas.ts'

/** How tall a scene is drawn (docs/DESIGN.md 14): from the `sceneSize` setting now, the layout later. */
export type SceneSize = 'compact' | 'standard' | 'large'
export const SCENE_SIZES: readonly SceneSize[] = ['compact', 'standard', 'large']

export function isSceneSize(v: unknown): v is SceneSize {
  return v === 'compact' || v === 'standard' || v === 'large'
}

export type SceneCtx = {
  s: Summary
  a: Activity
  frame: number
  t: number
  columns: number
  /** The height to draw, in cells; always honoured (any value >= the scene's `rows.compact`). */
  rows: number
  /** The orchestrator's model id (the session showing the pane), when it could be read. */
  orchestrator?: string
  /**
   * The worker desk's name (docs/DESIGN.md 36): `worker` when absent; `claude` when the pane follows
   * this session, where the pane also passes no `you` and no `orchestrator`.
   */
  worker?: string
  /**
   * Leave the background (walls, floors) as NONE so the terminal's own colour shows through.
   * Undefined counts as true; observatory ignores it (its sky is the picture).
   */
  transparent?: boolean
  /** The orchestrator's own activity (docs/DESIGN.md 17); undefined from an older pane and in tests. */
  you?: You
  /** The colours to paint with (docs/DESIGN.md 27); `paletteOf(ctx)` gives `night` when absent. */
  palette?: Palette
  /**
   * What the offices' window shows (docs/DESIGN.md 28): `auto` (follows the date), a fixed season,
   * or `none`; `seasonOf(t, ctx.season)` gives the date's season when absent.
   */
  season?: string
  /**
   * The facts something else in the pane already spells out (docs/DESIGN.md 31): the scene drops its
   * own text for these and keeps the picture. Undefined (tests, ambient): nothing claimed.
   */
  shown?: ReadonlySet<Fact>
  /**
   * The latest thinking in plain words (docs/DESIGN.md 40.2: a small model's rewrite, or the demo's
   * canned one), as highlighted runs; `t` when it was written, `stale` while a newer answer is on
   * its way (the old one is shown dimmed). Undefined: none; the showcase's thinking screen shows the
   * gist alone.
   */
  plain?: { runs: Run[]; t: number; stale: boolean }
  /**
   * The lofi layer (docs/DESIGN.md 42): slow decorative loops (the skyline's lights, rain on the
   * glass, steam, a breathing lamp, the cat's breath) that mean nothing. From the `ambience`
   * setting; undefined counts as on (`ambient(ctx)` in hooks/ambience.ts); false draws exactly what
   * the scene drew before them.
   */
  ambience?: boolean
}

export type Scene = {
  /** The config / command name. */
  id: string
  /** Shown in the scene button. */
  title: string
  /** The height for each size; a blit must match the mounted height. */
  rows: Record<SceneSize, number>
  /** Below this the scene draws a simpler layout, never nothing. */
  minColumns: number
  /** Encoded Raster cells, columns × ctx.rows. */
  draw(ctx: SceneCtx): string
}

/** The lineup (docs/DESIGN.md 37, 43.1); the first is the default, and what an unknown id draws. */
export const SCENES: readonly Scene[] = [office, officeHd, observatory]

/**
 * Scenes that were retired (docs/DESIGN.md 35, 37, 43.1): a setting or a saved pick naming one draws
 * its stand-in. controlroom's instrument wall is office-hd's showcase now, aurora's sky the observatory's.
 */
export const RETIRED: Record<string, string> = { factory: 'office', terrarium: 'office', network: 'office', controlroom: 'office-hd', aurora: 'observatory' }

/** `id`, or the scene that stands in for it when it was retired. */
function current(id: string | undefined | null): string | undefined | null {
  return id != null && Object.hasOwn(RETIRED, id) ? RETIRED[id] : id
}

export function sceneById(id: string | undefined | null): Scene {
  const want = current(id)
  return SCENES.find(sc => sc.id === want) ?? SCENES[0]!
}

/** The scene after `id`, wrapping round. */
export function nextScene(id: string | undefined | null): Scene {
  const want = current(id)
  const i = SCENES.findIndex(sc => sc.id === want)
  return SCENES[(i + 1) % SCENES.length]!
}

/** The height `sc` draws at for `size` (unknown sizes count as standard). */
export function rowsFor(sc: Scene, size: SceneSize | string | undefined | null): number {
  return sc.rows[isSceneSize(size) ? size : 'standard']
}
