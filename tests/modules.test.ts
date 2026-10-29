import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { DEFAULT_ORDER, MODULES } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import { CLASS_COLOR, PANEL, meter, plate, shares, shortModel, stackBar } from '../hooks/panel.ts'
import type { CellBox } from '../hooks/panel.ts'
import type { You } from '../hooks/you.ts'
import { factsOf } from '../hooks/facts.ts'
import { wrap } from '../hooks/modules/strip.ts'
import type { Fact } from '../hooks/facts.ts'
import { ALL, FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING, YOU_TOOL } from './fixtures.ts'
import { SESSION_WAITING } from './session-fixture.ts'

const UI = { view: 'fold', scene: 'office-hd', size: 'compact', source: 'worker' }

function ctxFor(s: Summary, frame = 12, you?: You, ui: ModuleCtx['ui'] = UI): ModuleCtx {
  return { s, a: activity(s, T), you, frame, t: T, ui }
}

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

function printableBmp(cp: number): boolean {
  return cp >= 0x20 && cp <= 0xffff && !(cp >= 0x7f && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff)
}

/** Draw one module into a canvas exactly its box's size (plus a margin), return the decoded cells. */
function drawOne(id: string, ctx: ModuleCtx, w: number, h: number, margin = 1): { words: Uint32Array; columns: number; box: CellBox } {
  const columns = w + margin * 2
  const c = new HiCanvas(columns, h + margin * 2)
  const box = { col: margin, row: margin, w, h }
  MODULES[id]!.draw(c, box, ctx)
  return { words: decode(c.encode()), columns, box }
}

/** The text of the cells in `box`, row by row. */
function boxText(words: Uint32Array, columns: number, box: CellBox): string {
  const lines: string[] = []
  for (let r = box.row; r < box.row + box.h; r++) {
    let line = ''
    // A cell of one colour encodes as █; it reads as an empty cell here.
    for (let col = box.col; col < box.col + box.w; col++) {
      const cp = words[(r * columns + col) * 3]!
      line += cp === 0x2588 ? ' ' : String.fromCodePoint(cp)
    }
    lines.push(line)
  }
  return lines.join('\n')
}

const DATA_MODULES = Object.keys(MODULES).filter(id => id !== 'toggles')

test('modules: the catalogue is complete and DEFAULT_ORDER names only known modules', () => {
  for (const id of [
    'counter:turns', 'counter:tools', 'counter:errors', 'counter:cost', 'counter:out',
    'dial:ctx', 'dial:memory', 'vu:decode', 'vu:prefill', 'scope:pace', 'scope:ctx',
    'ledmatrix', 'reels', 'patchbay', 'clock', 'lamps', 'toggles', 'river', 'strip',
  ]) {
    const m = MODULES[id]
    if (!m) throw new Error(`no module ${id}`)
    expect(m.id).toBe(id)
    expect(m.minH >= 4 && m.minH <= 6).toBe(true)
    expect(m.wantsW === 1 || m.wantsW === 2).toBe(true)
  }
  for (const id of DEFAULT_ORDER) expect(MODULES[id] != null).toBe(true)
  // The ledmatrix shows the tool counts by class: no tools counter beside it (docs/DESIGN.md 31).
  expect(DEFAULT_ORDER).not.toContain('counter:tools')
  expect(DEFAULT_ORDER).toContain('ledmatrix')
})

test('modules: every module draws at its minimum box and at 2× for every fixture, printable BMP only', () => {
  const yous: (You | undefined)[] = [undefined, YOU_THINKING, YOU_TOOL]
  for (const [id, m] of Object.entries(MODULES)) {
    for (const [w, h] of [[m.minW, m.minH], [m.minW * 2, m.minH * 2], [m.minW + 3, m.minH + 1], [3, 2], [1, 1]] as const) {
      for (const [name, s] of Object.entries(ALL)) {
        for (const you of yous) {
          for (const frame of [0, 1, 7]) {
            let words: Uint32Array
            try {
              words = drawOne(id, ctxFor(s, frame, you), w, h).words
            } catch (err) {
              throw new Error(`${id} at ${w}×${h} on ${name}: ${String(err)}`)
            }
            for (let i = 0; i < words.length; i += 3) {
              if (!printableBmp(words[i]!)) throw new Error(`${id} at ${w}×${h} on ${name}: code point 0x${words[i]!.toString(16)}`)
            }
          }
        }
      }
    }
  }
})

test('modules: no module paints outside its box, at every size it can get and on every fixture', () => {
  const NONE = 0x01000000
  for (const [id, m] of Object.entries(MODULES)) {
    for (const [w, h] of [[m.minW, m.minH], [m.minW + 4, m.minH + 1], [m.minW * 2, m.minH + 2], [m.minW - 3, m.minH - 1]] as const) {
      for (const [name, s] of Object.entries(ALL)) {
        const { words, columns, box } = drawOne(id, ctxFor(s, 3, YOU_TOOL), w, h, 2)
        const rows = words.length / 3 / columns
        for (let r = 0; r < rows; r++) {
          for (let col = 0; col < columns; col++) {
            const inside = col >= box.col && col < box.col + box.w && r >= box.row && r < box.row + box.h
            if (inside) continue
            const i = (r * columns + col) * 3
            if (words[i] !== 0x20 || words[i + 1] !== NONE || words[i + 2] !== NONE) throw new Error(`${id} at ${w}×${h} on ${name} painted cell (${col}, ${r}) outside its box`)
          }
        }
      }
    }
  }
})

test('modules: hasData is false for NOLOG on the data modules and true for RUNNING', () => {
  for (const id of DATA_MODULES) {
    expect([id, MODULES[id]!.hasData(ctxFor(NOLOG))]).toEqual([id, false])
    expect([id, MODULES[id]!.hasData(ctxFor(RUNNING, 12, YOU_THINKING))]).toEqual([id, true])
  }
  // toggles reads the pane's picks, not the log.
  expect(MODULES.toggles!.hasData(ctxFor(NOLOG))).toBe(true)
  expect(MODULES.toggles!.hasData({ ...ctxFor(RUNNING), ui: undefined })).toBe(false)
})

test('modules: readings that are absent hide their module', () => {
  // No server: no decode or prefill meter; no context window known: no ctx dial.
  expect(MODULES['vu:decode']!.hasData(ctxFor(THINKING))).toBe(false)
  expect(MODULES['vu:prefill']!.hasData(ctxFor(THINKING))).toBe(false)
  expect(MODULES['dial:ctx']!.hasData(ctxFor(THINKING))).toBe(false)
  expect(MODULES['dial:memory']!.hasData(ctxFor(THINKING))).toBe(false)
  expect(MODULES['counter:cost']!.hasData(ctxFor(FAILED))).toBe(false)
  // A server that does not answer is no reading either.
  expect(MODULES['vu:decode']!.hasData(ctxFor(FAILED))).toBe(false)
  // No orchestrator and no hand-off: no strip.
  expect(MODULES.strip!.hasData(ctxFor(FAILED))).toBe(false)
  expect(MODULES.strip!.hasData(ctxFor(FAILED, 0, YOU_THINKING))).toBe(true)
})

test('modules: the reels tape runs while the run is live and the tape is longer than its window, else stands still', () => {
  const thinking = ctxFor(THINKING)
  expect(thinking.a.state).toBe('thinking')
  const long: Summary = { ...THINKING, events: [...(RUNNING.events ?? []), ...(RUNNING.events ?? []), ...(RUNNING.events ?? [])] }
  for (const [w, h] of [[16, 5], [32, 6], [26, 5]] as const) {
    const a = drawOne('reels', { ...ctxFor(long), frame: 1 }, w, h).words.join(',')
    const b = drawOne('reels', { ...ctxFor(long), frame: 4 }, w, h).words.join(',')
    if (a === b) throw new Error(`reels at ${w}×${h}: frames 1 and 4 match while thinking`)
    for (const s of [FINISHED, FAILED, { ...long, result: FINISHED.result, pending: { kind: 'done' } } as Summary]) {
      const d0 = drawOne('reels', ctxFor(s, 1), w, h).words.join(',')
      const d1 = drawOne('reels', ctxFor(s, 4), w, h).words.join(',')
      expect(d0 === d1).toBe(true)
    }
  }
  // A tape that fits stands still with its newest call at the right edge.
  const fit = drawOne('reels', ctxFor(THINKING, 1), 40, 5)
  expect(fit.words.join(',')).toBe(drawOne('reels', ctxFor(THINKING, 4), 40, 5).words.join(','))
  // The tape is text: the class short names, and no reel is drawn.
  const r = drawOne('reels', ctxFor(RUNNING, 0), 60, 5)
  const text = boxText(r.words, r.columns, r.box)
  expect(text).toContain('read')
  expect(text).toContain('edit')
  expect(text).toContain('qwen coder')
  expect(text).toContain('recent')
})

test('modules: the ctx meter fills with the reading (10k vs 100k), and its headline is the share as text', () => {
  const at = (ctx: number, w: number, h: number) => drawOne('dial:ctx', ctxFor({ ...RUNNING, ctx }), w, h)
  for (const [w, h] of [[14, 5], [28, 6], [26, 5]] as const) {
    const lo = at(10_000, w, h)
    const hi = at(100_000, w, h)
    // The meter row is the second inner row (the first under the title), row 3 with the margin.
    const lit = (words: Uint32Array) => {
      let n = 0
      for (let col = 2; col < w; col++) {
        const i = (3 * (w + 2) + col) * 3
        if (words[i + 1] === PANEL.phosphor || words[i + 2] === PANEL.phosphor) n++
      }
      return n
    }
    if (!(lit(hi.words) > lit(lo.words))) throw new Error(`dial:ctx at ${w}×${h}: meter did not grow from 10k to 100k`)
    expect(boxText(hi.words, hi.columns, hi.box)).toContain(`${Math.round((100_000 / 131_072) * 100)}%`)
  }
})

test('modules: lamps light BAD for a failed test run and GOOD for a passing one', () => {
  const inks = (s: Summary) => {
    const { words } = drawOne('lamps', ctxFor(s, 1), 26, 4)
    const out = new Set<number>()
    for (let i = 0; i < words.length; i += 3) if (words[i] === 0x25cf) out.add(words[i + 1]!)
    return out
  }
  expect(inks(FAILED).has(PANEL.red)).toBe(true)
  expect(inks(FINISHED).has(PANEL.green)).toBe(true)
  const pass: Summary = { ...THINKING, tests: [{ t: T - 600, failed: 0, passed: 11, total: 11 }] }
  expect(inks(pass).has(PANEL.red)).toBe(false)
})

test('modules: counter:cost draws nothing money-like when s.cost is null', () => {
  for (const s of [FAILED, NOLOG, { ...RUNNING, cost: null }] as Summary[]) {
    for (const [w, h] of [[12, 3], [24, 6], [26, 5]] as const) {
      const { words, columns, box } = drawOne('counter:cost', ctxFor(s), w, h)
      const text = boxText(words, columns, box)
      if (/\$|\d/.test(text)) throw new Error(`counter:cost at ${w}×${h} shows a figure with no cost:\n${text}`)
    }
  }
  const { words, columns, box } = drawOne('counter:cost', ctxFor(RUNNING), 26, 3)
  expect(boxText(words, columns, box)).toContain('$0.47')
})

test('modules: counters print their reading as text on the title row; the done state dims it', () => {
  for (const [w, h] of [[12, 5], [26, 6], [12, 4]] as const) {
    const { words, columns, box } = drawOne('counter:turns', ctxFor(RUNNING), w, h)
    const lines = boxText(words, columns, box).split('\n')
    expect(lines[1]).toContain('turns')
    expect(lines[1]!.slice(1, -1).trimEnd().endsWith('18')).toBe(true)
  }
  const { words, columns, box } = drawOne('counter:tools', ctxFor(RUNNING), 30, 5)
  const lines = boxText(words, columns, box).split('\n')
  expect(lines[1]).toContain('34')
  expect(lines[3]).toContain('read 14')
  // The headline's ink: phosphor while live, phosphor dim once the run is done.
  const inkOf = (s: Summary, ch: string) => {
    const d = drawOne('counter:turns', ctxFor(s), 20, 5)
    for (let i = 0; i < d.words.length; i += 3) if (d.words[i] === ch.codePointAt(0)) return d.words[i + 1]
    return null
  }
  expect(inkOf(RUNNING, '8')).toBe(PANEL.phosphor)
  expect(inkOf(FINISHED, '4')).toBe(PANEL.phosphorDim)
})

test('panel: the frame is one cell, half slate, with the title left and the headline right on the first inner row', () => {
  const c = new HiCanvas(22, 7)
  const box = { col: 1, row: 1, w: 20, h: 5 }
  const content = plate(c, box, 'context', '41%')
  expect(content).toEqual({ col: 2, row: 3, w: 18, h: 2 })
  const words = decode(c.encode())
  const cell = (col: number, row: number) => [...words.slice((row * 22 + col) * 3, (row * 22 + col) * 3 + 3)]
  // Top edge: ▀ highlight over the screen; bottom: ▄ slate; left ▌ highlight; right ▐ slate.
  expect(cell(5, 1)).toEqual([0x2580, PANEL.bevel, PANEL.screen])
  expect(cell(5, 5)).toEqual([0x2584, PANEL.mon, PANEL.screen])
  expect(cell(1, 3)).toEqual([0x258c, PANEL.bevel, PANEL.screen])
  expect(cell(20, 3)).toEqual([0x2590, PANEL.mon, PANEL.screen])
  const text = boxText(words, 22, box).split('\n')
  expect(text[1]).toBe('▌context        41%▐')
  expect(cell(2, 2)[1]).toBe(PANEL.inkDim)
  expect(cell(19, 2)[1]).toBe(PANEL.phosphor)
})

test('panel: meters and bars are quadrant blocks only, never braille', () => {
  const braille = (words: Uint32Array, label: string) => {
    for (let i = 0; i < words.length; i += 3) {
      const cp = words[i]!
      if (cp >= 0x2800 && cp <= 0x28ff) throw new Error(`${label}: braille 0x${cp.toString(16)} at cell ${i / 3}`)
    }
  }
  for (const w of [1, 2, 5, 12, 27]) {
    for (const f of [0, 0.01, 0.13, 0.25, 0.5, 0.51, 0.77, 0.99, 1, 1.4]) {
      const c = new HiCanvas(w + 2, 3)
      meter(c, 1, 1, w, f, { ticks: [0.25, 0.5, 0.75], peak: Math.min(1, f + 0.1) })
      braille(decode(c.encode()), `meter ${w} at ${f}`)
    }
    for (const ns of [[1, 2, 3], [14, 9, 6, 4, 0, 1], [0, 0, 5], [100, 1, 1, 1, 1, 1, 1]]) {
      const c = new HiCanvas(w + 2, 3)
      stackBar(c, 1, 1, w, ns.map((n, i) => ({ n, color: Object.values(CLASS_COLOR)[i % 7]! })))
      braille(decode(c.encode()), `stackBar ${w} ${ns}`)
    }
  }
  // No module draws a braille cell from pixels except a scope's trace graticule (the strip's
  // spinner is a text glyph).
  for (const [id, m] of Object.entries(MODULES)) {
    if (id.startsWith('scope:') || id === 'strip') continue
    for (const [w, h] of [[m.minW, m.minH], [m.minW + 9, m.minH + 1]] as const) {
      for (const [name, s] of Object.entries(ALL)) {
        for (const frame of [0, 2, 5]) braille(drawOne(id, ctxFor(s, frame, YOU_TOOL), w, h).words, `${id} at ${w}×${h} on ${name}`)
      }
    }
  }
})

test('panel: shares split a width cell-aligned, at least one cell per non-zero value', () => {
  for (const [vals, w] of [[[14, 9, 6, 4, 0, 1], 20], [[1, 1, 1], 3], [[100, 1], 10], [[3, 0, 0], 7], [[5, 5, 5, 5], 2]] as const) {
    const out = shares([...vals], w)
    const nz = vals.filter(v => v > 0).length
    expect(out.reduce((a, b) => a + b, 0)).toBe(w)
    vals.forEach((v, i) => {
      if (v === 0) expect(out[i]).toBe(0)
      else if (nz <= w) expect(out[i]! >= 1).toBe(true)
    })
  }
  expect(shares([0, 0], 10)).toEqual([0, 0])
})

test('modules: toggles show the pane picks; the strip shows who hands what to whom', () => {
  const t = drawOne('toggles', ctxFor(RUNNING), 44, 5)
  const tt = boxText(t.words, t.columns, t.box)
  expect(tt).toContain('fold')
  expect(tt).toContain('worker')
  // The palette pick: a fourth rocker (before the source) when there is room, dropped first when not.
  const wide = drawOne('toggles', ctxFor(RUNNING, 12, undefined, { ...UI, palette: 'paper' }), 60, 5)
  const wt = boxText(wide.words, wide.columns, wide.box)
  expect(wt).toContain('paper')
  expect(wt).toContain('worker')
  expect(wt.indexOf('palette')).toBeGreaterThan(wt.indexOf('size'))
  expect(wt.indexOf('palette')).toBeLessThan(wt.indexOf('source'))
  const n = drawOne('toggles', ctxFor(RUNNING, 12, undefined, { ...UI, palette: 'paper' }), 44, 5)
  const narrow = boxText(n.words, n.columns, n.box)
  expect(narrow).not.toContain('paper')
  expect(narrow).toContain('worker')
  const s = drawOne('strip', ctxFor(RUNNING, 3, YOU_THINKING), 70, 4)
  const st = boxText(s.words, s.columns, s.box)
  expect(st).toContain('you')
  expect(st).toContain('Fix empty-title')
})

// ── One home per fact (docs/DESIGN.md 31)

const claiming = (s: Summary, ids: string[], you?: You): ModuleCtx => ({ ...ctxFor(s, 12, you), shown: factsOf(ids) as ReadonlySet<Fact> })
const textOfBox = (id: string, ctx: ModuleCtx, w: number, h: number) => {
  const d = drawOne(id, ctx, w, h)
  return boxText(d.words, d.columns, d.box)
}

test('modules: counter:turns drops `last` when the pace scope is visible, and keeps its average', () => {
  expect(textOfBox('counter:turns', ctxFor(RUNNING), 30, 5)).toMatch(/avg [\d.]+s · last [\d.]+s/)
  const t = textOfBox('counter:turns', claiming(RUNNING, ['scope:pace']), 30, 5)
  expect(t).toContain('avg ')
  expect(t).not.toContain('last')
  // Output drops its `ctx` beside a context module.
  expect(textOfBox('counter:out', ctxFor(RUNNING), 30, 5)).toContain('ctx 54.2k')
  expect(textOfBox('counter:out', claiming(RUNNING, ['dial:ctx']), 30, 5)).not.toContain('ctx')
})

test("modules: river's headline is the largest share, not the elapsed", () => {
  // RUNNING at T: 21 min in, 2.5 min thinking and 6 min of tools, the rest the model's.
  const t = textOfBox('river', ctxFor(RUNNING), 44, 5)
  const head = t.split('\n')[1]!
  expect(head).toMatch(/model \d+%/)
  expect(head).not.toMatch(/\d+m\d\ds/)
  // Thinking the most: its share leads.
  const thinker = { ...RUNNING, think_ms: 1_000_000, tool_ms: 60_000 }
  expect(textOfBox('river', ctxFor(thinker), 44, 5).split('\n')[1]).toMatch(/think \d+%/)
})

test('modules: no headline reading is said again in its own sub-rows', () => {
  // river: the largest share heads the plate; the legend gives only the other two.
  for (const [s, w] of [[RUNNING, 44], [RUNNING, 30], [FINISHED, 60], [{ ...RUNNING, think_ms: 1_000_000, tool_ms: 60_000 }, 44]] as const) {
    const lines = textOfBox('river', ctxFor(s), w, 5).split('\n')
    const head = lines[1]!.match(/(think|tools|model) (\d+%)/)!
    const below = lines.slice(2).join('\n')
    expect(below).not.toContain(head[0]!)
    expect(below).not.toMatch(new RegExp(`(^|[^\\d])${head[2]!}`))
    for (const other of ['think', 'tools', 'model'].filter(n => n !== head[1])) expect(below).toMatch(new RegExp(`${other[0]}\\w* ?\\d+%`))
  }
  // dial:memory: the used GB heads the plate; the row under the meter is the total alone.
  const mem = textOfBox('dial:memory', ctxFor(RUNNING), 30, 5).split('\n')
  const used = mem[1]!.match(/(\d+) GB/)![1]!
  expect(mem.slice(2).join('\n')).not.toMatch(new RegExp(`\\b${used}\\b`))
  expect(mem[3]).toMatch(/of \d+ GB/)
})

test("modules: the strip's headline is the hand-off's time of day; it prints nobody's activity", () => {
  const t = textOfBox('strip', ctxFor(RUNNING, 3, YOU_TOOL), 70, 5)
  const lines = t.split('\n')
  const at = new Date(RUNNING.handoff!.since * 1000).toTimeString().slice(0, 5)
  expect(lines[1]).toContain(`since ${at}`)
  expect(lines[1]).not.toMatch(/\d+m\d\ds/)
  // Who hands what to whom, the task running on into the second row instead of leaving it blank.
  expect(lines[2]).toMatch(/^▌you · opus 5 → qwen coder · Fix empty-title/)
  expect(lines[3]).toMatch(/^▌\S/)
  expect(`${lines[2]} ${lines[3]}`.replace(/[▌▐]/g, '').replace(/\s+/g, ' ')).toContain('Fix empty-title validation in the todo store')
  // The orchestrator's activity is the scene's, the worker's the caption's.
  for (const gone of ['worker on a tool', 'you tool', 'Bash', 'npm test', 'thinking']) expect(t).not.toContain(gone)
  // A one-row strip cuts the task on its only row.
  const one = textOfBox('strip', ctxFor(RUNNING, 3, YOU_TOOL), 50, 4).split('\n')
  expect(one[2]).toContain('…')
  // A narrow strip starts the task on the second row.
  const narrow = textOfBox('strip', ctxFor(RUNNING, 3, YOU_TOOL), 30, 5).split('\n')
  expect(narrow[2]).not.toContain('Fix')
  expect(narrow[3]).toContain('Fix empty-title')
  // No hand-off: no headline and no task.
  const none = textOfBox('strip', ctxFor(THINKING, 3, YOU_THINKING), 70, 5).split('\n')
  expect(none[1]).not.toContain('since')
  expect(none[3]!.replace(/[▌▐ ]/g, '')).toBe('')
})

test('modules: wrap breaks at spaces into the given widths and cuts the last line', () => {
  expect(wrap('fix the empty title check', [8, 10])).toEqual(['fix the', 'empty tit…'])
  expect(wrap('short', [8, 10])).toEqual(['short'])
  expect(wrap('averyveryverylongword and more', [4, 12])).toEqual(['', 'averyveryve…'])
})

test('modules: reels shows the tape and the newest finished call, the model only while no strip shows it', () => {
  for (const s of [RUNNING, THINKING, FINISHED]) {
    const t = textOfBox('reels', ctxFor(s), 40, 5)
    expect(t.split('\n')[1]).toContain('recent')
    expect(t.split('\n')[1]).toContain(shortModel(s.model))
    for (const gone of ['tool ·', 'thinking', 'finished', 'stopped', 'reading']) expect(t).not.toContain(gone)
  }
  // The tape takes the first row under the title; the newest finished call (not the running one,
  // which is the caption's) the second.
  const lines = textOfBox('reels', ctxFor(RUNNING), 40, 5).split('\n')
  expect(lines[2]).toMatch(/read|edit|\$/)
  expect(lines[3]).toContain('✓ edit tests/todo.test.ts')
  expect(lines.join('\n')).not.toContain('npm test -- todo')
  // With the hand-off strip visible the model is the strip's.
  const claimedHead = textOfBox('reels', claiming(RUNNING, ['strip']), 40, 5).split('\n')[1]!
  expect(claimedHead).toContain('recent')
  expect(claimedHead).not.toContain('qwen coder')
})

test('modules: the clock drops the turn and the hand-off age when other modules claim them', () => {
  const free = textOfBox('clock', ctxFor(RUNNING), 30, 5)
  expect(free).toContain(`turn ${RUNNING.turns}`)
  expect(free).toContain('handoff ')
  const t = textOfBox('clock', claiming(RUNNING, ['counter:turns', 'strip']), 30, 5)
  expect(t).not.toContain('turn ')
  expect(t).not.toContain('handoff')
  expect(t).toMatch(/started \d\d:\d\d/)
})

test('modules: undefined claims draw exactly as an empty set', () => {
  for (const id of Object.keys(MODULES)) {
    for (const s of [RUNNING, FINISHED]) {
      const a = drawOne(id, ctxFor(s, 12, YOU_THINKING), 40, 6).words.join(',')
      const b = drawOne(id, { ...ctxFor(s, 12, YOU_THINKING), shown: new Set() }, 40, 6).words.join(',')
      if (a !== b) throw new Error(`${id} draws differently with an empty claim set`)
    }
  }
})

test("modules: following this session the strip is the latest prompt, claude's, since the prompt's time", () => {
  const ctx: ModuleCtx = { ...ctxFor(SESSION_WAITING, 3), worker: 'claude' }
  expect(MODULES.strip!.hasData(ctx)).toBe(true)
  const t = textOfBox('strip', ctx, 70, 5)
  const lines = t.split('\n')
  const at = new Date(SESSION_WAITING.prompt!.t! * 1000).toTimeString().slice(0, 5)
  expect(lines[1]).toContain('prompt')
  expect(lines[1]).toContain(`since ${at}`)
  expect(lines[2]).toMatch(/^▌claude · opus 5 · Now add a --due flag/)
  for (const gone of ['you', '→', 'worker', 'hand-off']) expect(t).not.toContain(gone)
  // Before the first prompt there is no task, and no orchestrator to name.
  expect(MODULES.strip!.hasData({ ...ctx, s: { ...SESSION_WAITING, prompt: null } })).toBe(false)
})

test('modules: the patch bay and the reels name the desk claude following this session', () => {
  const ctx: ModuleCtx = { ...ctxFor(SESSION_WAITING, 3), worker: 'claude' }
  const bay = textOfBox('patchbay', ctx, 60, 5)
  expect(bay).toContain('claude')
  expect(bay).not.toContain('worker')
  expect(textOfBox('reels', { ...ctx, s: { ...SESSION_WAITING, model: null } }, 40, 5).split('\n')[1]).toContain('claude')
  // Worker mode is unchanged.
  expect(textOfBox('patchbay', ctxFor(RUNNING, 3), 60, 5)).toContain('worker')
})
