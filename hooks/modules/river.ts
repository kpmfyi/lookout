// river (time): the run's split between thinking, tools and the model. The largest share is the title
// row's headline (`model 71%`; the elapsed is the clock's, docs/DESIGN.md 31); under it one
// proportion bar of quiet segment fills with each segment's name in its full colour on top (the
// name when the segment has 6 cells, its first letter from 2), and a legend of the other shares in
// the same colours (the headline's is not said twice).
import { elapsedOf } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { lit, mix, panelFor, plate, stackBar, write, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

export function split(ctx: ModuleCtx): { think: number; tools: number; model: number; total: number } {
  const { s, t } = ctx
  const total = Math.max(1, elapsedOf(s, t))
  const think = (s.think_ms ?? 0) / 1000
  const tools = (s.tool_ms ?? 0) / 1000
  return { think, tools, model: Math.max(0, total - think - tools), total }
}

export const river: Module = {
  id: 'river',
  title: 'time',
  minW: 20,
  minH: 5,
  wantsW: 2,
  hasData: ({ s }) => s.exists && (s.started != null || s.result != null),
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const done = ctx.a.state === 'done'
    const { think, tools, model } = split(ctx)
    const sum = think + tools + model || 1
    const parts: { v: number; col: RGB; name: string }[] = [
      { v: think, col: lit(done, P.think, P), name: 'think' },
      { v: tools, col: lit(done, P.tools, P), name: 'tools' },
      { v: model, col: lit(done, P.model, P), name: 'model' },
    ]
    const pct = (v: number) => `${Math.round((v / sum) * 100)}%`
    const top = parts.reduce((a, b) => (b.v > a.v ? b : a))
    const cb = plate(c, box, 'time', `${top.name} ${pct(top.v)}`, top.col, P)
    if (cb.w <= 0 || cb.h <= 0) return
    const rest = parts.filter(p => p !== top)
    const legend = (): [string, RGB][] => {
      const forms: [(p: { name: string; v: number }) => string, string][] = [
        [p => `${p.name} ${pct(p.v)}`, ' · '],
        [p => `${p.name} ${pct(p.v)}`, '  '],
        [p => `${p.name} ${pct(p.v)}`, ' '],
        [p => `${p.name[0]}${pct(p.v)}`, ' '],
      ]
      for (const [f, sep] of forms) {
        const runs = rest.map((p, i) => [`${i ? sep : ''}${f(p)}`, p.col] as [string, RGB])
        if (runs.reduce((a, [t]) => a + t.length, 0) <= cb.w) return runs
      }
      return rest.map((p, i) => [`${i ? ' ' : ''}${p.name[0]}${pct(p.v)}`, p.col] as [string, RGB])
    }
    if (cb.h < 2) {
      writeRuns(c, cb.col, cb.row, cb.w, legend(), P)
      return
    }
    const fills = parts.map(p => ({ n: p.v, color: mix(P.screen, p.col, 0.35) }))
    const segs = stackBar(c, cb.col, cb.row, cb.w, fills, true)
    parts.forEach((p, i) => {
      const seg = segs[i]!
      if (seg.w < 2) return
      const label = seg.w >= 6 ? p.name : p.name[0]!
      const pad = seg.w >= 7 ? 1 : 0
      write(c, seg.col + pad, cb.row, seg.w - pad, label, p.col, undefined, P)
    })
    // The legend; when it is too long for the row, the shares under their segments instead.
    const lg = legend()
    const under = parts.every((p, i) => p === top || p.v <= 0 || pct(p.v).length + (i < parts.length - 1 ? 1 : 0) <= segs[i]!.w)
    if (lg[0]![0].includes(' ') || !under) {
      writeRuns(c, cb.col, cb.row + 1, cb.w, lg, P)
      return
    }
    parts.forEach((p, i) => {
      const seg = segs[i]!
      const pad = seg.w >= 7 ? 1 : 0
      if (p.v > 0 && p !== top) write(c, seg.col + pad, cb.row + 1, seg.w - pad, pct(p.v), p.col, undefined, P)
    })
  },
}
