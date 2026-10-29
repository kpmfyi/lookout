// ledmatrix (tools by class): one full-width stacked bar of tool calls in the class colours, the
// total as the title row's headline, and the class names with their counts in their colours under
// their segments (or as a plain run when a segment is too narrow for its label). The class of the
// running tool blinks. The id keeps its old name.
import { classCounts } from '../activity.ts'
import type { ToolClass } from '../../types'
import type { HiCanvas } from '../hicanvas.ts'
import { CLASSES, CLASS_NAME, lit, mix, panelFor, plate, stackBar, write, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

export const ledmatrix: Module = {
  id: 'ledmatrix',
  title: 'tools by class',
  minW: 20,
  minH: 5,
  wantsW: 2,
  hasData: ({ s }) => s.exists && (s.tool_counts?.length ?? 0) > 0,
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const { s, a, frame } = ctx
    const counts = classCounts(s)
    const done = a.state === 'done'
    const total = Object.values(counts).reduce((x, y) => x + y, 0)
    const cb = plate(c, box, 'tools by class', String(total), lit(done, undefined, P), P)
    if (cb.w <= 0 || cb.h <= 0) return
    const active = a.state === 'tool' && a.cls ? a.cls : null
    const blink = active != null && frame % 4 < 2
    const classes: ToolClass[] = counts.other > 0 ? [...CLASSES, 'other'] : CLASSES
    const ink = (cls: ToolClass): RGB => (cls === active && blink ? mix(P.classes[cls], P.ink, 0.5) : lit(done, P.classes[cls], P))
    const label = (cls: ToolClass, short = false) => `${CLASS_NAME[cls][short ? 1 : 0]} ${counts[cls]}`
    // A single row: the plain run only.
    const run = () => {
      const runs: [string, RGB][] = []
      for (const cls of classes) {
        if (cls === 'other' && counts.other === 0) continue
        runs.push([`${CLASS_NAME[cls][0]}${counts[cls]} `, counts[cls] > 0 ? ink(cls) : P.dim])
      }
      return runs
    }
    if (cb.h < 2) {
      writeRuns(c, cb.col, cb.row, cb.w, run(), P)
      return
    }
    const segs = stackBar(c, cb.col, cb.row, cb.w, classes.map(cls => ({ n: counts[cls], color: ink(cls) })))
    const lr = cb.row + 1
    const shown = classes.filter(cls => counts[cls] > 0)
    const fits = (short: boolean) =>
      shown.every(cls => {
        const seg = segs[classes.indexOf(cls)]!
        const last = cls === shown.at(-1)
        return label(cls, short).length <= seg.w - (last ? 0 : 1)
      })
    const short = fits(false) ? false : fits(true) ? true : null
    if (short == null) {
      writeRuns(c, cb.col, lr, cb.w, run(), P)
      return
    }
    for (const cls of shown) {
      const seg = segs[classes.indexOf(cls)]!
      write(c, seg.col, lr, seg.w, label(cls, short), ink(cls), undefined, P)
    }
  },
}
