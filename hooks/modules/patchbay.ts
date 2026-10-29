// patchbay: who is wired to whom, under a title row. A top row of jacks (you, worker, server) and a bottom row (the six
// tool classes); cables on quads between them: you → worker, worker → server when a server answers,
// worker → the busy class's jack while a tool runs. Packets ride a cable only while it carries
// something (the model generating, a tool running, the orchestrator busy).
import type { ToolClass } from '../../types'
import type { HiCanvas } from '../hicanvas.ts'
import { CLASSES, CLASS_NAME, mix, panelFor, plate, quad, write } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module, ModuleCtx } from './index.ts'
import { youActivity } from '../you.ts'

type Jack = { col: number; row: number; label: string; color: RGB; on: boolean }

/** Quad points of a sagging cable from jack a to jack b (sub-pixel x, quad y). */
function cablePath(x0: number, q0: number, x1: number, q1: number, sag: number): [number, number][] {
  const out: [number, number][] = []
  const n = Math.max(2, Math.abs(x1 - x0) + Math.abs(q1 - q0) * 2)
  let last = ''
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = Math.round(x0 + (x1 - x0) * t)
    const q = Math.round(q0 + (q1 - q0) * t + sag * 4 * t * (1 - t))
    const key = `${x},${q}`
    if (key !== last) out.push([x, q])
    last = key
  }
  return out
}

export const patchbay: Module = {
  id: 'patchbay',
  title: 'patch bay',
  minW: 24,
  minH: 6,
  wantsW: 2,
  hasData: ({ s }) => s.exists,
  draw(c: HiCanvas, box: CellBox, ctx: ModuleCtx) {
    const P = panelFor(ctx)
    const { s, a, you, frame, t } = ctx
    const done = a.state === 'done'
    const busy = a.state === 'tool' ? (a.tool ?? '') : a.state === 'thinking' ? 'model' : a.state === 'prefill' ? 'prompt' : ''
    const inner = plate(c, box, 'patch bay', busy || undefined, a.state === 'tool' && a.cls ? P.classes[a.cls] : P.phosphor, P)
    if (inner.w <= 0 || inner.h <= 0) return
    const live = !done && a.state !== 'nolog'
    const srv = s.server
    const ya = you ? youActivity(you, t) : null
    const top = inner.row
    const bottom = inner.row + inner.h - 1
    // Jacks are a ● glyph followed by a label; top row spread across, bottom row the classes.
    const tops: Jack[] = [
      { col: 0, row: top, label: 'you', color: P.ink, on: you != null },
      { col: 0, row: top, label: ctx.worker ?? 'worker', color: P.phosphor, on: s.exists },
      { col: 0, row: top, label: srv ? (srv.ok ? 'server' : 'srv off') : 'server', color: srv?.ok ? P.amber : P.mon, on: srv?.ok === true },
    ]
    const slot = Math.floor(inner.w / 3)
    tops.forEach((j, i) => (j.col = inner.col + i * slot))
    const cslot = Math.floor(inner.w / 6)
    const bots: Record<ToolClass, Jack> = {} as Record<ToolClass, Jack>
    CLASSES.forEach((cls, i) => {
      const [full, short, tiny] = CLASS_NAME[cls]
      const room = cslot - 2
      const label = full.length <= room ? full : short.length <= room ? short : room >= 1 ? tiny : ''
      bots[cls] = { col: inner.col + i * cslot, row: bottom, label, color: P.classes[cls], on: a.state === 'tool' && a.cls === cls }
    })
    const jackX = (j: Jack) => j.col * 2 + 1
    const jackQ = (j: Jack) => j.row * 2 + 1
    const cables: { path: [number, number][]; color: RGB; flow: boolean; reverse?: boolean }[] = []
    const W = tops[1]!
    const sag = Math.max(0, inner.h - 2)
    // you → worker: a short cable hanging under the top row.
    if (you) {
      const busy = ya?.state === 'thinking' || ya?.state === 'tool'
      cables.push({ path: cablePath(jackX(tops[0]!), jackQ(tops[0]!) + 1, jackX(W), jackQ(W) + 1, Math.min(2, sag)), color: busy ? mix(P.ink, P.screen, 0.2) : P.mon, flow: busy })
    }
    if (srv?.ok) {
      const flow = a.state === 'thinking' || a.state === 'prefill'
      cables.push({ path: cablePath(jackX(W), jackQ(W) + 1, jackX(tops[2]!), jackQ(tops[2]!) + 1, Math.min(2, sag)), color: flow ? P.amber : mix(P.amber, P.screen, 0.55), flow, reverse: a.state === 'prefill' })
    }
    if (a.state === 'tool' && a.cls && a.cls !== 'other' && inner.h >= 3) {
      const j = bots[a.cls]
      cables.push({ path: cablePath(jackX(W), jackQ(W) + 1, jackX(j), jackQ(j) - 1, 0), color: P.classes[a.cls], flow: true })
    }
    for (const cb of cables) {
      const base = cb.flow ? mix(cb.color, P.screen, 0.45) : cb.color
      for (const [x, q] of cb.path) quad(c, x, q, base)
      if (cb.flow && live) {
        const n = cb.path.length
        const speed = 0.5 + a.intensity * 0.5
        for (let p = 0; p < n; p += 6) {
          const i = Math.floor((p + frame * speed * 1.5) % n)
          const at = cb.reverse ? n - 1 - i : i
          const [x, q] = cb.path[at]!
          quad(c, x, q, cb.color)
        }
      }
    }
    const jack = (j: Jack, room: number) => {
      c.text(j.col, j.row, j.on ? '●' : '○', j.on ? j.color : P.phosphorDim)
      if (j.label && room > 0) write(c, j.col + 1, j.row, room, j.label, j.on ? mix(j.color, P.ink, 0.3) : P.phosphorDim, P.screen, P)
    }
    tops.forEach(j => jack(j, slot - 2))
    if (inner.h >= 2) CLASSES.forEach(cls => jack(bots[cls], cslot - 2))
  },
}
