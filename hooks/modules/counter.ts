// counter: one number as the title row's headline (turns, tool calls, errors, ≈ cost, output tokens),
// then one graphic row (a turn tick strip, a stacked class bar, error lamps, a cost or output meter)
// and one dim detail row. With a single content row only the detail is kept; rows past the third
// stay screen-dark. A detail another module claims is left out (docs/DESIGN.md 31): turns drops
// `last` beside the pace scope, output drops `ctx` beside a context module.
import { classCounts, fmtDur, k } from '../activity.ts'
import { claimed } from '../facts.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { G, titled } from '../glyphs.ts'
import { CLASSES, CLASS_NAME, lampRow, lit, meter, mix, panelFor, plate, quad, shortModel, stackBar, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

export const COUNTER_KINDS = ['turns', 'tools', 'errors', 'cost', 'out'] as const
export type CounterKind = (typeof COUNTER_KINDS)[number]

type Reading = { value: string; hot?: RGB }

const TITLES: Record<CounterKind, string> = { turns: 'turns', tools: 'tool calls', errors: 'errors', cost: '≈ cost', out: 'output' }

function money(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`
}

function secs(v: number): string {
  return v < 60 ? `${v.toFixed(1)}s` : fmtDur(v)
}

function reading(kind: CounterKind, ctx: ModuleCtx): Reading | null {
  const P = panelFor(ctx)
  const { s } = ctx
  if (!s.exists) return null
  switch (kind) {
    case 'turns': {
      const n = s.turns ?? s.result?.turns
      return n == null ? null : { value: String(n) }
    }
    case 'tools': {
      if (!s.tool_counts) return null
      return { value: String(s.tool_counts.reduce((a, [, v]) => a + v, 0)) }
    }
    case 'errors':
      if (s.errors == null) return null
      return { value: String(s.errors), hot: s.errors > 0 ? P.red : undefined }
    case 'cost':
      return s.cost ? { value: money(s.cost.usd) } : null
    case 'out':
      return s.out_est == null ? null : { value: k(s.out_est) }
  }
}

type Run = [string, RGB]

/** The dim detail row's pieces. */
function detail(kind: CounterKind, ctx: ModuleCtx, done: boolean): Run[] {
  const P = panelFor(ctx)
  const { s, t } = ctx
  const dim = P.phosphorDim
  switch (kind) {
    case 'turns': {
      const ts = s.turn_secs ?? []
      if (!ts.length) return []
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length
      return [[claimed(ctx.shown, 'pace') ? `avg ${secs(avg)}` : `avg ${secs(avg)} · last ${secs(ts.at(-1)!)}`, dim]]
    }
    case 'tools': {
      const cc = classCounts(s)
      const top = [...CLASSES].filter(cls => cc[cls] > 0).sort((a, b) => cc[b] - cc[a]).slice(0, 3)
      const out: Run[] = []
      top.forEach((cls, i) => {
        if (i > 0) out.push([' · ', dim])
        out.push([CLASS_NAME[cls][0], lit(done, P.classes[cls], P)], [` ${cc[cls]}`, dim])
      })
      return out
    }
    case 'errors': {
      const e = s.last_error
      if (!e) return (s.errors ?? 0) > 0 ? [] : [['none', dim]]
      const when = e.t != null ? ` · ${fmtDur(Math.max(0, t - e.t))} ago` : ''
      return [[e.tool, lit(done, P.red, P)], [when, dim]]
    }
    case 'cost': {
      const model = shortModel(ctx.compare ?? s.cost?.compare)
      const real = s.result?.cost
      const out: Run[] = []
      if (model) out.push([model, dim])
      if (real != null) out.push([`${model ? ' · ' : ''}real ${money(real)}`, dim])
      return out
    }
    case 'out':
      return s.ctx != null && !claimed(ctx.shown, 'ctx') ? [[`ctx ${k(s.ctx)}`, dim]] : []
  }
}

/** The graphic row; false when there is nothing to draw for this reading. */
function graphic(kind: CounterKind, c: HiCanvas, col: number, row: number, w: number, ctx: ModuleCtx, done: boolean): boolean {
  const P = panelFor(ctx)
  const { s, a, frame } = ctx
  const live = !done && a.state !== 'nolog' && a.state !== 'stalled'
  switch (kind) {
    case 'turns': {
      // One tick per turn, newest on the right: a short tick (▖) under the median, a full one (▌)
      // over it, amber past twice the median; the newest blinks while a turn is under way.
      const ts = s.turn_secs ?? []
      const shown = ts.slice(-w)
      const sorted = [...ts].sort((x, y) => x - y)
      const med = sorted[Math.floor(sorted.length / 2)] ?? 0
      const x0 = col + w - shown.length
      shown.forEach((v, i) => {
        const last = i === shown.length - 1
        if (last && live && frame % 4 >= 2) return
        const ink = lit(done, v > 2 * med ? P.amber : P.phosphor, P)
        const x = (x0 + i) * 2
        quad(c, x, row * 2 + 1, ink)
        if (v > med) quad(c, x, row * 2, ink)
      })
      return shown.length > 0
    }
    case 'tools': {
      const cc = classCounts(s)
      const parts = [...CLASSES, 'other' as const].map(cls => ({ n: cc[cls], color: lit(done, P.classes[cls], P) }))
      stackBar(c, col, row, w, parts)
      return true
    }
    case 'errors': {
      const blink = frame % 2 === 0
      const pulse = done ? null : a.pulse
      const errs = s.errors ?? 0
      const den = s.denials ?? 0
      const on = (n: number, col: RGB, kind: string) =>
        n <= 0 ? P.lampOff : pulse?.kind === kind && !blink ? mix(col, P.screen, 0.6) : lit(done, col, P)
      lampRow(c, col, row, w, [
        { label: 'err', color: on(errs, P.red, 'error') },
        { label: 'deny', color: on(den, P.amber, 'denied') },
      ], undefined, P)
      return true
    }
    case 'cost': {
      // The estimate against the dearest model the run is priced at, so its scale shows.
      const all = Object.values(s.cost?.at_all ?? {}).filter(v => Number.isFinite(v))
      const top = Math.max(0, ...all)
      if (!s.cost || top <= 0) return false
      meter(c, col, row, w, s.cost.usd / top, { tones: P, fill: lit(done, undefined, P), ticks: [0.25, 0.5, 0.75] })
      return true
    }
    case 'out': {
      if (s.out_est == null || !s.ctx) return false
      meter(c, col, row, w, s.out_est / Math.max(s.ctx, s.out_est), { tones: P, fill: lit(done, undefined, P), ticks: [0.25, 0.5, 0.75] })
      return true
    }
  }
}

export function counter(kind: CounterKind): Module {
  return {
    id: `counter:${kind}`,
    title: TITLES[kind],
    minW: 12,
    minH: 5,
    wantsW: 1,
    hasData: ctx => reading(kind, ctx) != null,
    draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
      const P = panelFor(ctx)
      const r = reading(kind, ctx)
      const done = ctx.a.state === 'done'
      const head = r ? r.value : '–'
      // The turns' glyph beside its word where both fit (docs/DESIGN.md 41).
      const title = kind === 'turns' ? titled(G.turns, TITLES[kind], box.w - 3 - [...head].length) : TITLES[kind]
      const cb = plate(c, box, title, head, r ? lit(done, r.hot, P) : P.phosphorDim, P)
      if (!r || cb.w <= 0 || cb.h <= 0) return
      const drawn = cb.h >= 2 && graphic(kind, c, cb.col, cb.row, cb.w, ctx, done)
      writeRuns(c, cb.col, cb.row + (drawn ? 1 : 0), cb.w, detail(kind, ctx, done), P)
      // No graphic (a cost with no other model priced): the prices it is estimated at instead.
      const p = ctx.s.cost?.prices
      if (!drawn && kind === 'cost' && p && cb.h >= 2) writeRuns(c, cb.col, cb.row + 1, cb.w, [[`in $${p.in} · out $${p.out} /M`, P.phosphorDim]], P)
    },
  }
}
