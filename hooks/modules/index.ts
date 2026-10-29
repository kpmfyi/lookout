// The instrument modules (docs/DESIGN.md 15 and 23): small HiCanvas instruments with one reading
// each, tiled by hooks/grid.ts. Every module paints its own slate frame (hooks/panel.ts `plate`)
// with its title and headline reading on the first inner row and its graphic and detail rows under
// it; motion only when the reading moves; `hasData` is false when the reading is absent, and the
// layout then hides the module.
import type { Summary } from '../../types'
import type { Activity } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import type { CellBox } from '../panel.ts'
import type { You } from '../you.ts'
import type { Palette } from '../palette.ts'
import type { Fact } from '../facts.ts'
import { clock } from './clock.ts'
import { COUNTER_KINDS, counter } from './counter.ts'
import { dial } from './dial.ts'
import { lamps } from './lamps.ts'
import { ledmatrix } from './ledmatrix.ts'
import { patchbay } from './patchbay.ts'
import { reels } from './reels.ts'
import { river } from './river.ts'
import { scope } from './scope.ts'
import { strip } from './strip.ts'
import { toggles } from './toggles.ts'
import { vu } from './vu.ts'

export type { CellBox }

/**
 * The pane's picks, shown read-only by the `toggles` module. `view` is the details fold (docs/DESIGN.md
 * 38.2): `fold` or `full` (`d`); the retired dash/scene view is gone.
 */
export type PaneUi = { view?: string; scene?: string; size?: string; palette?: string; source?: string }

export type ModuleCtx = {
  s: Summary
  a: Activity
  you?: You
  /** The worker desk's name (docs/DESIGN.md 36): `worker` when absent, `claude` following this session (no `you` then). */
  worker?: string
  frame: number
  t: number
  /** The model the cost estimate is priced against, when the pane knows it. */
  compare?: string
  ui?: PaneUi
  /** The colours to paint with (docs/DESIGN.md 27); `paletteOf(ctx)` gives `night` when absent. */
  palette?: Palette
  /** The facts other modules or blocks in the pane claim (docs/DESIGN.md 31); undefined: none. */
  shown?: ReadonlySet<Fact>
}

export type Module = {
  id: string
  title: string
  /** The smallest box it draws legibly, in cells and rows (the frame's ring included). */
  minW: number
  minH: number
  /** Grid cells it wants across (shrunk to 1 on a 2-wide grid). */
  wantsW: 1 | 2
  hasData(ctx: ModuleCtx): boolean
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx): void
}

const LIST: Module[] = [
  strip,
  ...COUNTER_KINDS.map(counter),
  dial('ctx'),
  dial('memory'),
  vu('decode'),
  vu('prefill'),
  scope('pace'),
  scope('ctx'),
  ledmatrix,
  reels,
  patchbay,
  clock,
  lamps,
  toggles,
  river,
]

export const MODULES: Record<string, Module> = Object.fromEntries(LIST.map(m => [m.id, m]))

/**
 * The `modules` setting's default (docs/DESIGN.md 15, the panel layout). No `counter:tools`: the
 * ledmatrix shows the same counts by class (docs/DESIGN.md 31).
 */
export const DEFAULT_ORDER: string[] = [
  'strip',
  'counter:turns',
  'counter:cost',
  'dial:ctx',
  'vu:decode',
  'scope:pace',
  'ledmatrix',
  'lamps',
  'clock',
  'reels',
  'river',
]
