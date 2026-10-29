// reels (recent): a text tape of the run's last tool calls in their class colours (`$ read edit edit
// $`), newest on the right, and under it the newest finished call and its target (`✓ edit
// src/todo.ts`). The worker's model is the headline unless the hand-off strip shows it. No state
// line: the current tool and its seconds are the scene caption's (docs/DESIGN.md 31). While the
// run is live and the tape is longer than its window it runs right to left as a loop, one cell
// every 4 frames; otherwise it stands still with the newest call at the right edge. The id keeps
// its old name.
import { claimed } from '../facts.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { CLASS_NAME, lit, panelFor, plate, shortModel, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'

/** The tape's cells, oldest first: each tool call's short name in its class colour, one space apart. */
export function tapeCells(ctx: ModuleCtx, done: boolean): [string, RGB][] {
  const P = panelFor(ctx)
  const out: [string, RGB][] = []
  for (const ev of ctx.s.events ?? []) {
    if (ev.kind !== 'tool') continue
    const cls = ev.cls ?? 'other'
    const bad = ev.status === 'error' || ev.status === 'denied'
    const ink = lit(done, bad ? P.red : P.classes[cls], P)
    if (out.length) out.push([' ', ink])
    for (const ch of CLASS_NAME[cls][0]) out.push([ch, ink])
  }
  return out
}

/** Whether the tape runs: the run is under way (the model writing, reading, or a tool running). */
export function tapeLive(ctx: ModuleCtx): boolean {
  const st = ctx.a.state
  return st === 'thinking' || st === 'prefill' || st === 'tool'
}

/** The newest tool call that has finished: `✓ edit src/todo.ts` (the running one is the caption's). */
export function lastCall(ctx: ModuleCtx, done: boolean): [string, RGB][] {
  const P = panelFor(ctx)
  const ev = [...(ctx.s.events ?? [])].reverse().find(e => e.kind === 'tool' && e.status !== 'running')
  if (!ev || ev.kind !== 'tool') return []
  const bad = ev.status === 'error' || ev.status === 'denied'
  const cls = ev.cls ?? 'other'
  return [
    [bad ? '✖ ' : '✓ ', lit(done, bad ? P.red : P.green, P)],
    [CLASS_NAME[cls][0], lit(done, bad ? P.red : P.classes[cls], P)],
    [ev.label ? ` ${ev.label}` : '', P.phosphorDim],
  ]
}

export const reels: Module = {
  id: 'reels',
  title: 'recent',
  minW: 16,
  minH: 5,
  wantsW: 1,
  hasData: ({ s }) => s.exists,
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const { s, frame } = ctx
    const done = ctx.a.state === 'done'
    const head = claimed(ctx.shown, 'handoff') ? undefined : shortModel(s.model) || (ctx.worker ?? 'worker')
    const cb = plate(c, box, 'recent', head, lit(done, undefined, P), P)
    if (cb.w <= 0 || cb.h <= 0) return
    const cells = tapeCells(ctx, done)
    if (!cells.length) return
    const row = cb.row
    if (cb.h >= 2) writeRuns(c, cb.col, row + 1, cb.w, lastCall(ctx, done), P)
    // Static with the newest call at the right edge while it all fits (or the run is not live);
    // a longer tape runs as a loop through the whole history, a dim dot between the ends.
    if (!tapeLive(ctx) || cells.length <= cb.w) {
      const shown = cells.slice(-cb.w)
      shown.forEach(([ch, ink], i) => {
        if (ch !== ' ') c.text(cb.col + cb.w - shown.length + i, row, ch, ink)
      })
      return
    }
    const gap: [string, RGB][] = [[' ', 0], [' ', 0], ['·', P.phosphorDim], [' ', 0], [' ', 0]]
    const loop = [...gap, ...cells]
    const L = loop.length
    const off = Math.floor(frame / 4) % L
    for (let i = 0; i < cb.w; i++) {
      const [ch, ink] = loop[(((L - cb.w + i - off) % L) + L) % L]!
      if (ch !== ' ') c.text(cb.col + i, row, ch, ink)
    }
  },
}
