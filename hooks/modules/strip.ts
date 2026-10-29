// strip (hand-off): who hands what to whom. The hand-off's local clock time is the title row's
// headline (`since 14:02`: a time of day, never a duration, so it can't be read as the elapsed,
// docs/DESIGN.md 31); under it `you · opus 5 → qwen coder · <task>`, the task wrapping onto the
// rows below when there are any. Nothing about what either side is doing: the orchestrator's
// activity is the scene's (your monitor, the console), the worker's is the caption. Following this
// session (docs/DESIGN.md 36) it is the prompt: `claude · opus 5 · <the latest prompt>`, since the
// prompt's clock time.
import type { Summary } from '../../types'
import { isSession } from '../activity.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { cut, lit, panelFor, plate, shortModel, writeRuns } from '../panel.ts'
import type { CellBox, RGB } from '../panel.ts'
import type { Module } from './index.ts'

/** `since hh:mm`, local, for an epoch time. */
export function sinceClock(t: number): string {
  return `since ${new Date(t * 1000).toTimeString().slice(0, 5)}`
}

/**
 * `text` broken at spaces into lines of the given widths (the last width repeats), at most
 * `widths.length` lines; the last line is cut with `…` when the text runs on. A line may be empty
 * when its width is too small for the next word.
 */
export function wrap(text: string, widths: number[]): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let i = 0
  for (let n = 0; n < widths.length && i < words.length; n++) {
    const w = widths[n]!
    const last = n === widths.length - 1
    let line = ''
    while (i < words.length) {
      const next = line ? `${line} ${words[i]}` : words[i]!
      if ([...next].length > w) break
      line = next
      i++
    }
    // A word longer than a whole line is cut there rather than never placed.
    if (!line && w >= 6 && (last || [...words[i]!].length > w)) line = words[i++]!
    if (last && i < words.length) line = `${line} ${words.slice(i).join(' ')}`.trim()
    lines.push(last ? cut(line, w) : line)
  }
  return lines
}

/** The task the strip shows: the hand-off, or in a session its latest prompt. */
function taskOf(s: Summary): { text: string; since: number | null } | null {
  if (s.handoff) return s.handoff
  return isSession(s) && s.prompt ? { text: s.prompt.text, since: s.prompt.t } : null
}

export const strip: Module = {
  id: 'strip',
  title: 'hand-off',
  minW: 20,
  minH: 4,
  wantsW: 2,
  hasData: ({ s, you }) => s.exists && (you != null || taskOf(s) != null),
  draw(c: HiCanvas, box: CellBox, ctx) {
    const P = panelFor(ctx)
    const { s, a, you } = ctx
    const done = a.state === 'done'
    const task = taskOf(s)
    const session = isSession(s)
    const head = task?.since != null ? sinceClock(task.since) : undefined
    const cb = plate(c, box, session ? 'prompt' : 'hand-off', head, lit(done, undefined, P), P)
    if (cb.w <= 0 || cb.h <= 0) return
    const dim = P.phosphorDim
    const first: [string, RGB][] = session
      ? [
          [ctx.worker ?? 'claude', P.ink],
          [' · ', dim],
          [shortModel(s.model) || '?', lit(done, undefined, P)],
        ]
      : [
          [you?.model ? `you · ${shortModel(you.model)}` : 'you', P.ink],
          [' → ', dim],
          [shortModel(s.model) || (ctx.worker ?? 'worker'), lit(done, undefined, P)],
        ]
    const used = first.reduce((n, [t]) => n + [...t].length, 0)
    if (!task) {
      writeRuns(c, cb.col, cb.row, cb.w, first, P)
      return
    }
    // The task after ` · ` on the first row when a few cells are left there, then on the rows
    // under it; with no room on the first row it starts on the second.
    const room = cb.w - used - 3
    const onFirst = room >= 6
    const widths = [...(onFirst ? [room] : []), ...Array.from({ length: cb.h - 1 }, () => cb.w)]
    const lines = widths.length ? wrap(task.text, widths) : []
    const ink = lit(done, P.phosphorGlow, P)
    if (onFirst && lines[0]) first.push([' · ', dim], [lines[0], ink])
    writeRuns(c, cb.col, cb.row, cb.w, first, P)
    lines.slice(onFirst ? 1 : 0).forEach((line, i) => writeRuns(c, cb.col, cb.row + 1 + i, cb.w, [[line, ink]], P))
  },
}
