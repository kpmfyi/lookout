// dial: a gauge (context used of the window, or unified memory used) as a linear meter. The share is
// the title row's headline; under it a thin meter (phosphor, amber past 80 %, red past 95 %) with
// scale ticks at the quarters, and the counts in dim text, less what the headline already says
// (memory's headline is the used GB, so its row is only the total). The ids keep their old name.
import { ctxLimitOf, k } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { shareGlyph, titled } from '../glyphs.ts'
import { lit, meter, panelFor, panelOf, plate, write } from '../panel.ts'
import type { PanelTones } from '../panel.ts'
import { PALETTES } from '../palette.ts'
import type { CellBox } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

type Kind = 'ctx' | 'memory'
type Reading = { frac: number; head: string; detail: string }

function reading(kind: Kind, ctx: ModuleCtx): Reading | null {
  const { s } = ctx
  if (!s.exists) return null
  if (kind === 'ctx') {
    const limit = ctxLimitOf(s)
    if (s.ctx == null || !limit) return null
    const frac = s.ctx / limit
    return { frac, head: `${Math.round(frac * 100)}%`, detail: `${k(s.ctx)} of ${k(limit)}` }
  }
  const m = s.memory
  if (!m?.total_gb) return null
  const used = m.total_gb - (m.free_gb ?? 0)
  return { frac: used / m.total_gb, head: `${Math.round(used)} GB`, detail: `of ${Math.round(m.total_gb)} GB` }
}

const TITLE: Record<Kind, string> = { ctx: 'context', memory: 'memory' }

/** The meter's colour at `frac`: phosphor, amber past 80 %, red past 95 %. */
export function zone(frac: number, P: PanelTones = panelOf(PALETTES.night)): number {
  return frac >= 0.95 ? P.red : frac >= 0.8 ? P.amber : P.phosphor
}

export function dial(kind: Kind): Module {
  return {
    id: `dial:${kind}`,
    title: TITLE[kind],
    minW: 14,
    minH: 5,
    wantsW: 1,
    hasData: ctx => reading(kind, ctx) != null,
    draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
      const P = panelFor(ctx)
      const r = reading(kind, ctx)
      const done = ctx.a.state === 'done'
      const ink = r ? lit(done, zone(r.frac, P), P) : P.phosphorDim
      // The context's glyph, filled by its share, beside its word where both fit (docs/DESIGN.md 41).
      const head = r?.head ?? '–'
      const title = kind === 'ctx' && r ? titled(shareGlyph(r.frac), TITLE[kind], box.w - 3 - [...head].length) : TITLE[kind]
      const cb = plate(c, box, title, head, ink, P)
      if (!r || cb.w <= 0 || cb.h <= 0) return
      if (cb.h >= 2) meter(c, cb.col, cb.row, cb.w, r.frac, { tones: P, fill: ink, ticks: [0.25, 0.5, 0.75] })
      write(c, cb.col, cb.row + (cb.h >= 2 ? 1 : 0), cb.w, r.detail, P.phosphorDim, undefined, P)
    },
  }
}
