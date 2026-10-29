// vu: decode or prefill tok/s as a linear meter. The rate is the title row's headline; under it a
// thin meter against the scale's top with a peak-hold mark at the best request so far, and the
// peak and the scale in dim text. The bar flutters a little only while that rate is live (decoding
// while thinking, prefill while reading the prompt); otherwise it holds still.
import { DECODE_CAP, decodeTps } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { lit, meter, panelFor, plate, write } from '../panel.ts'
import type { CellBox } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

type Kind = 'decode' | 'prefill'
type Reading = { v: number; peak: number; max: number }

function reading(kind: Kind, ctx: ModuleCtx): Reading | null {
  const { s } = ctx
  const srv = s.server
  if (!s.exists || !srv?.ok) return null
  const done = srv.done ?? []
  if (kind === 'decode') {
    const v = decodeTps(s)
    if (v == null) return null
    const peak = Math.max(v, ...done.map(d => d.decode_tps))
    return { v, peak, max: Math.max(DECODE_CAP, Math.ceil((peak * 1.25) / 10) * 10) }
  }
  const v = done.at(-1)?.prefill_tps ?? srv.rates?.prefill_tps ?? null
  if (v == null) return null
  const peak = Math.max(v, ...done.map(d => d.prefill_tps))
  return { v, peak, max: Math.max(1000, Math.ceil((peak * 1.25) / 250) * 250) }
}

const TITLE: Record<Kind, string> = { decode: 'decode tok/s', prefill: 'prefill tok/s' }

export function fmt(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0)
}

export function vu(kind: Kind): Module {
  return {
    id: `vu:${kind}`,
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
      const cb = plate(c, box, TITLE[kind], r ? fmt(r.v) : '–', r ? lit(done, undefined, P) : P.phosphorDim, P)
      if (!r || cb.w <= 0 || cb.h <= 0) return
      const live = kind === 'decode' ? a.state === 'thinking' : a.state === 'prefill'
      let f = r.v / r.max
      if (live) f *= 1 + 0.05 * Math.sin(frame * 1.7) + 0.03 * Math.sin(frame * 0.6 + 1)
      if (cb.h >= 2) meter(c, cb.col, cb.row, cb.w, f, { tones: P, fill: lit(done, undefined, P), ticks: [0.25, 0.5, 0.75], peak: r.peak / r.max, peakInk: lit(done, P.phosphorGlow, P) })
      write(c, cb.col, cb.row + (cb.h >= 2 ? 1 : 0), cb.w, `peak ${fmt(r.peak)} · 0 … ${fmt(r.max)}`, P.phosphorDim, undefined, P)
    },
  }
}
