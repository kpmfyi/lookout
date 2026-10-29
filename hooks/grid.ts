// The module grid (docs/DESIGN.md 15, the panel and wall layouts): pack instrument modules row by
// row into a grid whose column count follows the pane's width, then draw them all on one HiCanvas.
// - Grid columns: 2 under 70 cells, 3 under 100, 4 under 130, 5 beyond (or `opts.gridCols`).
// - A module spans its `wantsW` grid cells (1 on a 2-wide grid; 2 when its `minW` needs it).
// - Row-major, first fit: a row takes the next modules that fit; one too wide waits for the next
//   row, and a later narrow module fills the hole. A row that cannot be filled widens its 1-wide
//   modules to 2 while cells are left (on grids of 3 or more).
// - A row is as tall as its tallest module's `minH`; modules in it get that height.
// - One cell of gutter between modules across; rows touch (each module's slate frame, highlight on
//   top and slate at the bottom, parts it from the next on the screen colour).
// - Unknown ids are skipped; modules whose reading is absent (`hasData` false) are hidden.
import type { HiCanvas } from './hicanvas.ts'
import { MODULES } from './modules/index.ts'
import type { Module, ModuleCtx } from './modules/index.ts'
import { clipped } from './panel.ts'
import type { CellBox } from './panel.ts'

export type Packed = { boxes: { id: string; box: CellBox }[]; rows: number; gridCols: number }

/** Gutter between modules, in cells across and rows down. */
export const GUTTER = 1
export const ROW_GAP = 0

/** Grid columns for a pane `columns` cells wide. */
export function gridColsFor(columns: number): number {
  return columns < 70 ? 2 : columns < 100 ? 3 : columns < 130 ? 4 : 5
}

export function packModules(ids: string[], columns: number, ctx: ModuleCtx, opts?: { gridCols?: number }): Packed {
  const cols = Math.max(1, Math.floor(columns))
  const G = Math.max(1, Math.floor(opts?.gridCols ?? gridColsFor(cols)))
  // Cell widths: the room after the gutters, split evenly, the remainder to the first cells.
  const room = Math.max(G, cols - (G - 1) * GUTTER)
  const base = Math.floor(room / G)
  const extra = room - base * G
  const width = (i: number) => base + (i < extra ? 1 : 0)
  const left = (i: number) => {
    let x = 0
    for (let j = 0; j < i; j++) x += width(j) + GUTTER
    return x
  }
  const spanW = (start: number, span: number) => left(start + span - 1) + width(start + span - 1) - left(start)

  const queue: { id: string; m: Module; span: number }[] = []
  for (const id of ids) {
    const m = MODULES[id]
    if (!m) continue
    let visible = false
    try {
      visible = m.hasData(ctx)
    } catch {
      visible = false
    }
    if (!visible) continue
    let span: number = G <= 2 ? 1 : m.wantsW
    if (span === 1 && G > 2 && m.minW > base) span = 2
    queue.push({ id, m, span: Math.min(span, G) })
  }

  const boxes: Packed['boxes'] = []
  let y = 0
  while (queue.length) {
    const row: { id: string; m: Module; span: number }[] = []
    let free = G
    for (let i = 0; i < queue.length && free > 0; ) {
      const q = queue[i]!
      if (q.span <= free) {
        row.push(q)
        queue.splice(i, 1)
        free -= q.span
      } else {
        i++
      }
    }
    if (row.length === 0) {
      // Nothing fits (cannot happen with span <= G, but never loop forever).
      const q = queue.shift()!
      row.push({ ...q, span: G })
      free = 0
    }
    // Leftover cells: widen 1-wide modules to 2, from the last one back (not on a 2-wide grid,
    // where 2 cells is the whole pane and modules stay 1 wide).
    for (let i = row.length - 1; i >= 0 && free > 0; i--) {
      if (row[i]!.span === 1 && G > 2) {
        row[i]!.span = 2
        free--
      }
    }
    const h = Math.max(...row.map(r => r.m.minH))
    let g = 0
    for (const r of row) {
      boxes.push({ id: r.id, box: { col: left(g), row: y, w: spanW(g, r.span), h } })
      g += r.span
    }
    y += h + ROW_GAP
  }
  const rows = boxes.length ? y - ROW_GAP : 0
  return { boxes, rows, gridCols: G }
}

/**
 * Draw every packed module on `c` (sized `columns × packed.rows`), each clipped to its box. A module
 * that throws is left as far as it got.
 */
export function drawGrid(c: HiCanvas, packed: Packed, ctx: ModuleCtx): void {
  for (const { id, box } of packed.boxes) {
    const m = MODULES[id]
    if (!m) continue
    try {
      m.draw(clipped(c, box), box, ctx)
    } catch {
      // A module bug must not take the pane down; its box stays as drawn so far.
    }
  }
}
