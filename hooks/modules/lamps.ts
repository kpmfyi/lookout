// lamps (checks): a row of round lamps, newest on the right: the test runs (green / red), the tsc
// runs, an error lamp and a denial lamp. A lamp blinks only for a few seconds after its event (the
// pulse). The newest test result is the title row's headline; a spare row carries the rest in words.
import type { HiCanvas } from '../hicanvas.ts'
import { lit, mix, panelFor, plate, write } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

/** The lamps for a summary: tests (up to `n`), tsc (up to 2), errors, denials. */
export function lampsFor(ctx: ModuleCtx, n: number): { group: string; lamps: RGB[] }[] {
  const P = panelFor(ctx)
  const OFF = P.lampOff
  const { s, a, frame } = ctx
  const pulse = a.state === 'done' ? null : a.pulse
  const blink = frame % 2 === 0
  const dark = (col: RGB) => mix(col, P.screen, 0.65)
  const tests = (s.tests ?? []).slice(-n)
  const testLamps = tests.map((r, i) => {
    const col = r.failed > 0 ? P.red : P.green
    const newest = i === tests.length - 1
    if (newest && pulse && (pulse.kind === 'tests-fail' || pulse.kind === 'tests-pass') && !blink) return dark(col)
    return col
  })
  const tsc = (s.tsc ?? []).slice(-2).map(r => (r.errors > 0 ? P.red : P.green))
  const errs = s.errors ?? 0
  const errOn = pulse?.kind === 'error'
  const err = errOn ? (blink ? P.red : dark(P.red)) : errs > 0 ? dark(P.red) : OFF
  const den = s.denials ?? 0
  const denOn = pulse?.kind === 'denied'
  const deny = denOn ? (blink ? P.amber : dark(P.amber)) : den > 0 ? dark(P.amber) : OFF
  return [
    { group: 'tests', lamps: testLamps.length ? testLamps : [OFF] },
    { group: 'tsc', lamps: tsc.length ? tsc : [OFF] },
    { group: 'err', lamps: [err] },
    { group: 'deny', lamps: [deny] },
  ]
}

export const lamps: Module = {
  id: 'lamps',
  title: 'checks',
  minW: 18,
  minH: 4,
  wantsW: 1,
  hasData: ({ s }) => s.exists,
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const { s, a } = ctx
    const done = a.state === 'done'
    const t = s.tests?.at(-1)
    const head = t ? (t.failed > 0 ? `✖ ${t.failed} failing` : `✓ ${t.passed}/${t.total}`) : 'no tests'
    const cb = plate(c, box, 'checks', head, t ? lit(done, t.failed > 0 ? P.red : P.green, P) : P.phosphorDim, P)
    if (cb.w <= 0 || cb.h <= 0) return
    const iw = cb.w
    // Groups flow left to right and wrap to the next row; the test group takes up to 8 runs, as
    // many as fit on its row. A row left over carries the other results in words.
    const tight = iw < 22
    const groups = lampsFor(ctx, Math.max(1, Math.min(8, iw - 7)))
    const words = cb.h >= 2
    let rowsFree = cb.h - (words ? 1 : 0)
    let row = cb.row
    let x = 0
    for (const g of groups) {
      const label = tight && g.group === 'tests' ? 'test' : g.group
      let lamps = g.lamps
      const need = label.length + 1 + lamps.length
      if (x > 0 && x + need > iw) {
        if (rowsFree <= 1) break
        rowsFree--
        row++
        x = 0
      }
      if (x + need > iw) lamps = lamps.slice(-Math.max(1, iw - x - label.length - 1))
      write(c, cb.col + x, row, label.length, label, P.inkDim, undefined, P)
      x += label.length + 1
      for (const col of lamps) {
        if (x >= iw) break
        c.text(cb.col + x, row, '●', col)
        x++
      }
      x += 1
    }
    if (words) {
      const tsc = s.tsc?.at(-1)
      const parts = [
        t ? `tests ${t.passed}/${t.total}` : '',
        tsc ? (tsc.errors > 0 ? `tsc ✖${tsc.errors}` : 'tsc ✓') : '',
        (s.errors ?? 0) > 0 ? `${s.errors} err` : '',
        (s.denials ?? 0) > 0 ? `${s.denials} denied` : '',
      ].filter(Boolean)
      write(c, cb.col, row + 1, iw, parts.join(' · ') || 'nothing run yet', P.phosphorDim, undefined, P)
    }
  },
}
