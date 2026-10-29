// scope: an oscilloscope trace on a dotted graticule, newest on the right: seconds per turn (pace)
// or context per turn (ctx, with the 80 % line of the window in dim red). The newest value is the
// title row's headline; the trace fills every row under it (a taller box gives a taller trace). The
// trace is drawn on quads, so it stays solid; the newest point blinks while the run is live.
import { ctxLimitOf, fmtDur, k } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { clamp, lit, panelFor, plate, qline, quad, screen } from '../panel.ts'
import type { CellBox } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

type Kind = 'pace' | 'ctx'
type Reading = { series: number[]; max: number; last: string; warn: number | null }

function reading(kind: Kind, ctx: ModuleCtx): Reading | null {
  const { s } = ctx
  if (!s.exists) return null
  if (kind === 'pace') {
    const series = s.turn_secs ?? []
    if (series.length < 2) return null
    const sorted = [...series].sort((a, b) => a - b)
    const max = Math.max(5, sorted[Math.floor(sorted.length * 0.95)] ?? 5) * 1.1
    const last = series.at(-1)!
    return { series, max, last: last < 60 ? `${last.toFixed(1)}s` : fmtDur(last), warn: null }
  }
  const series = s.ctx_series ?? []
  if (series.length < 2) return null
  const limit = ctxLimitOf(s)
  const max = limit ?? Math.max(...series) * 1.15
  return { series, max, last: k(series.at(-1)), warn: limit ? 0.8 : null }
}

const TITLE: Record<Kind, string> = { pace: 'pace', ctx: 'context' }

export function scope(kind: Kind): Module {
  return {
    id: `scope:${kind}`,
    title: TITLE[kind],
    minW: 14,
    minH: 5,
    wantsW: 1,
    hasData: ctx => reading(kind, ctx) != null,
    draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
      const P = panelFor(ctx)
      const r = reading(kind, ctx)
      const { a, frame } = ctx
      const done = a.state === 'done'
      const cb = plate(c, box, TITLE[kind], r?.last ?? '–', r ? lit(done, undefined, P) : P.phosphorDim, P)
      if (cb.w <= 0 || cb.h <= 0) return
      screen(c, cb, true, 3, P)
      if (!r) return
      const live = !done && a.state !== 'nolog' && a.state !== 'stalled'
      const X0 = cb.col * 2
      const X1 = (cb.col + cb.w) * 2 - 1
      const qTop = cb.row * 2
      const qBot = (cb.row + cb.h) * 2 - 1
      const span = qBot - qTop
      const yOf = (v: number) => (qBot - Math.round(clamp(v / r.max, 0, 1) * span)) * 2
      if (r.warn != null) {
        const wy = Math.floor(yOf(r.max * r.warn) / 2)
        for (let x = X0 + 1; x <= X1; x += 3) quad(c, x, wy, P.redDim)
      }
      const width = X1 - X0 + 1
      const n = Math.min(r.series.length, width)
      const pts = r.series.slice(-n)
      const step = n > 1 ? (width - 1) / (n - 1) : 0
      const trace = lit(done, undefined, P)
      let px = X0
      let py = yOf(pts[0]!)
      for (let i = 1; i < n; i++) {
        const x = X0 + Math.round(i * step)
        const y = yOf(pts[i]!)
        qline(c, px, py, x, y, trace)
        px = x
        py = y
      }
      if (live && frame % 4 < 2) quad(c, px, Math.floor(py / 2), P.phosphorGlow)
    },
  }
}
