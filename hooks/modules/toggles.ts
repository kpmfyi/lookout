// toggles (switches): the pane's current picks (view: the details fold, scene, size, palette, source), read-only.
// Each is a rocker (a lit half cell, ▀ amber) with its value beside it and its name under it; with
// a single row the names go inline (`view fold  scene office-hd …`).
import type { HiCanvas } from '../hicanvas.ts'
import { panelFor, plate, write, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

// The switches by priority: the palette (only when the pane passes it) is dropped first when the
// module is narrow; when there is room for it, it stands fourth (before the source).
const KEYS = ['view', 'scene', 'size', 'source', 'palette'] as const
const ORDER: readonly (typeof KEYS)[number][] = ['view', 'scene', 'size', 'palette', 'source']

export const toggles: Module = {
  id: 'toggles',
  title: 'switches',
  minW: 20,
  minH: 4,
  wantsW: 2,
  hasData: ({ ui }) => ui != null && KEYS.some(k => ui[k] != null),
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const cb = plate(c, box, 'switches', undefined, undefined, P)
    if (cb.w <= 0 || cb.h <= 0) return
    const ui = ctx.ui ?? {}
    const keys = ui.palette != null ? KEYS : KEYS.filter(key => key !== 'palette')
    if (cb.h < 2) {
      // One row: the palette only when the whole line fits with it.
      const line = (ks: readonly string[]) => ORDER.filter(key => ks.includes(key)).flatMap((key): [string, RGB][] => [[`${key} `, P.inkDim], [`${ui[key] ?? '–'}  `, P.ink]])
      let runs = line(keys)
      if (runs.reduce((n, [text]) => n + text.length, 0) > cb.w) runs = line(keys.filter(key => key !== 'palette'))
      writeRuns(c, cb.col, cb.row, cb.w, runs, P)
      return
    }
    // As many switches as get 9 cells each (at least one), the rest left off.
    const kept = new Set(keys.slice(0, Math.max(1, Math.min(keys.length, Math.floor(cb.w / 9)))))
    const shown = ORDER.filter(key => kept.has(key))
    const slot = Math.floor(cb.w / shown.length)
    shown.forEach((key, i) => {
      const col = cb.col + i * slot
      const value = ui[key] ?? '–'
      const room = slot - 1
      if (room < 1) return
      if (room >= 4) {
        c.rect(col * 2, cb.row * 4, 2, 2, ui[key] != null ? P.amber : P.lampOff)
        write(c, col + 2, cb.row, room - 2, value, P.ink, undefined, P)
      } else {
        write(c, col, cb.row, room, value, P.ink, undefined, P)
      }
      write(c, col, cb.row + 1, room, key, P.inkDim, undefined, P)
    })
  },
}
