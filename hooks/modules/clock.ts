// clock (elapsed): the run's elapsed time as the title row's headline (h:mm:ss, or m:ss under an
// hour), a minute ribbon under it (one quad per minute, every tenth brighter, the current minute
// blinking while live), and the current turn and the hand-off's age, each only while no other
// module claims it (docs/DESIGN.md 31), else the run's start as a time of day.
import { elapsedOf, fmtDur } from '../activity.ts'
import { claimed } from '../facts.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { G, titled } from '../glyphs.ts'
import { lit, mix, panelFor, plate, quad, write } from '../panel.ts'
import type { CellBox } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

/** `h:mm:ss` (or `m:ss` under an hour) for `secs`. */
export function hms(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const clock: Module = {
  id: 'clock',
  title: 'elapsed',
  minW: 12,
  minH: 5,
  wantsW: 1,
  hasData: ({ s }) => s.exists && (s.started != null || s.result != null),
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const { s, a, t, frame } = ctx
    const known = s.exists && (s.started != null || s.result != null)
    const done = a.state === 'done'
    const secs = known ? elapsedOf(s, t) : 0
    const head = known ? hms(secs) : '--:--'
    // The clock's glyph beside its word where both fit (docs/DESIGN.md 41): the board's corner uses it alone.
    const cb = plate(c, box, titled(G.time, 'elapsed', box.w - 3 - head.length), head, known ? lit(done, done && !a.ok ? P.amber : P.phosphor, P) : P.phosphorDim, P)
    if (!known || cb.w <= 0 || cb.h <= 0) return
    const live = !done && a.state !== 'nolog' && a.state !== 'stalled'
    if (cb.h >= 2) {
      // The minute ribbon: a quad per minute, one per cell (or a span of minutes per cell when the
      // run is longer than the row); the newest (current) minute on the right end.
      const mins = Math.max(1, Math.ceil(secs / 60))
      const per = Math.ceil(mins / cb.w)
      const n = Math.ceil(mins / per)
      const minute = mix(P.screen, P.phosphor, 0.28)
      for (let i = 0; i < n; i++) {
        const tenth = Math.floor(((i + 1) * per) / 10) > Math.floor((i * per) / 10)
        let ink = tenth ? P.phosphorDim : minute
        if (i === n - 1) {
          if (live && frame % 4 >= 2) continue
          ink = lit(done, undefined, P)
        }
        quad(c, (cb.col + i) * 2, cb.row * 2, ink)
      }
    }
    const turnLine = live && s.turns != null && !claimed(ctx.shown, 'turns') ? `turn ${s.turns}` : ''
    const hand = s.handoff && !claimed(ctx.shown, 'handoff') ? `handoff ${fmtDur(t - s.handoff.since)}` : ''
    const parts = [turnLine, hand].filter(Boolean)
    let text = parts.join(' · ')
    if (text.length > cb.w) text = turnLine || hand
    if (!text && done) text = a.ok ? '✓ finished' : '✖ stopped'
    if (!text && s.started != null) text = `started ${new Date(s.started * 1000).toTimeString().slice(0, 5)}`
    write(c, cb.col, cb.row + (cb.h >= 2 ? 1 : 0), cb.w, text, P.phosphorDim, undefined, P)
  },
}
