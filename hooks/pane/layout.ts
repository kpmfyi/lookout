// What the layouts and the tick both work out (docs/DESIGN.md 14, 15, 31, 38): the scene size a
// layout draws, who sits at which desk, calm's story, the facts the pane spells out itself, and a
// module grid's cells. Pure, but for the settings and the orchestrator's activity it reads.
import type { Summary } from '../../types'
import { isSession } from '../activity.ts'
import type { Activity } from '../activity.ts'
import { factsOf } from '../facts.ts'
import type { Fact } from '../facts.ts'
import { drawGrid } from '../grid.ts'
import type { Packed } from '../grid.ts'
import { HiCanvas } from '../hicanvas.ts'
import { memoryOf } from '../memory.ts'
import { MODULES } from '../modules/index.ts'
import type { ModuleCtx } from '../modules/index.ts'
import { storyOf } from '../narrate.ts'
import type { Story } from '../narrate.ts'
import type { SceneCtx, SceneSize } from '../scenes/index.ts'
import { youNow } from '../session-watch.ts'
import type { Shape } from './config.ts'
import { mod } from './state.ts'

/**
 * The scene size a layout draws (docs/DESIGN.md 14, 15, 38): calm and classic the picked one (else
 * the setting); panel compact and wall large, unless the person picked a size (the setting, or the
 * command, kept in the `sceneSize` atom across reloads).
 */
export function sizeFor(shape: Shape, picked: SceneSize | null): SceneSize {
  if (shape === 'ambient') return 'large' // and taller where the scene lays itself out by height
  const size = picked ?? mod.cfg.sceneSize
  if (shape === 'calm' || shape === 'classic' || mod.cfg.sceneSizeSet || picked != null) return size
  return shape === 'panel' ? 'compact' : 'large'
}

/** The orchestrator's model id, when it could be read at session start. */
export function orchestratorModel(): string | undefined {
  return youNow().model
}

/**
 * Who sits where, as the scenes and modules are told: following this session (docs/DESIGN.md 36)
 * the desk is `claude` and there is no orchestrator (no `you`, no orchestrator model; the session
 * is still watched, just not drawn twice); otherwise the worker and the orchestrator beside it.
 */
export function deskOf(s: Summary): Pick<SceneCtx, 'worker' | 'you' | 'orchestrator'> {
  if (isSession(s)) return { worker: 'claude', you: undefined, orchestrator: undefined }
  return { worker: undefined, you: youNow(), orchestrator: orchestratorModel() }
}

/** Whether a module has its reading (the grid hides it otherwise); a throwing check counts as no. */
export function moduleShown(id: string, ctx: ModuleCtx): boolean {
  try {
    return MODULES[id]?.hasData(ctx) ?? false
  } catch {
    return false
  }
}

/**
 * The story calm tells (docs/DESIGN.md 38.1), as `Claude` for this session and `The worker` for a
 * worker. A narration that throws tells only the activity, so the pane still draws.
 */
export function storyNow(s: Summary, a: Activity, t: number): Story {
  try {
    return storyOf(s, a, memoryOf(s, t), t, isSession(s) ? 'Claude' : 'The worker')
  } catch {
    // No task line is drawn, so nothing is claimed, not even the hand-off.
    return { now: null, caption: a.text, task: null, soFar: [], heads: [], outcome: null, claims: [] }
  }
}

/** The activity a calm scene is handed: its caption is the story's (one home for Now). */
export function narrated(a: Activity, story: Story): Activity {
  return { ...a, text: story.caption }
}

/**
 * The facts the pane spells out itself on the terminal (docs/DESIGN.md 31), from what the draw
 * renders: in calm what its story lines say (`told`); in panel and wall the visible modules' facts
 * and the Timeline block; ambient nothing. (classic draws off the terminal only, with no scene to tell.)
 */
export function paneFacts(shape: Shape, visible: readonly string[], told: Set<Fact>): Set<Fact> | undefined {
  if (shape === 'ambient') return undefined
  if (shape === 'calm') return told
  return new Set<Fact>([...factsOf(visible), 'timeline'])
}

/** A packed module grid drawn `columns` wide, as Raster cells. */
export function gridCells(packed: Packed, columns: number, ctx: ModuleCtx): string {
  const c = new HiCanvas(columns, packed.rows)
  drawGrid(c, packed, ctx)
  return c.encode()
}
