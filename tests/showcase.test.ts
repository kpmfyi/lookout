// The showcase (docs/DESIGN.md 39): a scene drawn taller than its large size keeps its large room at
// the bottom and fills the wall above with screens: the thinking screen (40: the plain words over
// the highlighted gist), the instrument row, the departures board, the details and the files.
import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import type { Activity } from '../hooks/activity.ts'
import { DEMO_LOOP_SECS, demoSummary } from '../hooks/demo.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { PALETTES } from '../hooks/palette.ts'
import { panelOf } from '../hooks/panel.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import { boardOf, catBox, geometry, officeHd, showcaseModules, showcaseOf } from '../hooks/scenes/office-hd.ts'
import { memoryOf } from '../hooks/memory.ts'
import type { Box } from '../hooks/scenes/office-hd.ts'
import { callDur, departures, drawDepartures, historyOf, instrumentRow, prose, thinkingScreen } from '../hooks/scenes/screens.ts'
import type { Plain } from '../hooks/scenes/screens.ts'
import type { You } from '../hooks/you.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING, YOU_WAITING } from './fixtures.ts'

const LARGE = officeHd.rows.large
const TALL = [25, 26, 30, 34, 35, 36, 40, 41, 47, 48, 52, 60, 70]
const WIDTHS = [60, 80, 100, 120, 144, 160]
/** RUNNING as the pane following this session has it (docs/DESIGN.md 36). */
const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
/** The caption ambient hands its scene: the calm story's plain words (docs/DESIGN.md 38.1, 39). */
const AMBIENT = (s: Summary): Activity => ({ ...activity(s, T), text: 'running the tests' })

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}
function boxText(w: Uint32Array, columns: number, b: Box): string {
  const lines: string[] = []
  for (let r = b.row; r < b.row + b.h; r++) {
    let line = ''
    for (let col = b.col; col < b.col + b.w; col++) line += String.fromCodePoint(w[(r * columns + col) * 3]!)
    lines.push(line)
  }
  return lines.join('\n')
}
const allText = (w: Uint32Array, columns: number) => boxText(w, columns, { col: 0, row: 0, w: columns, h: w.length / 3 / columns })
const fgAt = (w: Uint32Array, columns: number, col: number, row: number) => w[(row * columns + col) * 3 + 1]!

function hd(o: { s?: Summary; columns?: number; rows?: number; you?: You; a?: Activity; frame?: number; worker?: string; plain?: Plain; t?: number }): string {
  const s = o.s ?? RUNNING
  const t = o.t ?? T
  return officeHd.draw({ s, a: o.a ?? activity(s, t), frame: o.frame ?? 12, t, columns: o.columns ?? 100, rows: o.rows ?? 48, you: o.you, worker: o.worker, season: 'none', plain: o.plain } as SceneCtx)
}

const boxes = (sc: ReturnType<typeof showcaseOf>): [string, Box][] =>
  [...sc.instruments.map(x => [x.id, x.box] as [string, Box]), ['thinking', sc.thinking], ['departures', sc.departures], ['details', sc.details], ['files', sc.files]].filter((x): x is [string, Box] => x[1] != null)
const overlap = (a: Box, b: Box) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h

test('showcase: at the large size and under, office-hd lays out as before; taller, the large room sits at the bottom', () => {
  for (const withYou of [true, false]) {
    for (const columns of WIDTHS) {
      for (const rows of [10, 15, 24]) {
        expect(geometry(columns, rows, withYou).top).toBe(0)
        expect(boxes(showcaseOf(geometry(columns, rows, withYou))).length).toBe(0)
      }
      const L = geometry(columns, LARGE, withYou)
      for (const rows of TALL) {
        const g = geometry(columns, rows, withYou)
        const d = rows - LARGE
        expect(g.top).toBe(d)
        // Every row of the room is the large room's, moved down by the rows above its ceiling.
        expect([g.size, g.F, g.D, g.pt, g.PS, g.PH, g.rack.col, g.rack.lines]).toEqual(['large', L.F + d, L.D + d, L.pt + d, L.PS, L.PH, L.rack.col, L.rack.lines])
        expect([g.worker.top, g.worker.screen.row, g.orch.top]).toEqual([L.worker.top + d, L.worker.screen.row + d, L.orch.top + d])
        // The figures and chairs stand where they did; the monitors only widen into the gap by the stations.
        expect([g.worker.rel0, g.worker.head.x, g.orch.rel0, g.orch.head.x]).toEqual([L.worker.rel0, L.worker.head.x, L.orch.rel0, L.orch.head.x])
        expect(g.worker.screen.w >= L.worker.screen.w && g.orch.screen.w >= L.orch.screen.w).toBe(true)
        expect(g.lanes).toEqual({ left: g.panelL - 1, right: g.panelR + g.P })
        // Into the gap, clear of the lane: as far as it goes, or to the widest a monitor grows.
        expect(g.worker.zone[0]).toBe(Math.max(g.lanes!.right + 1, L.worker.zone[0] - (34 - L.worker.screen.w)))
        if (withYou) expect(g.orch.zone[1]).toBe(Math.max(L.orch.zone[1], Math.min(g.lanes!.left - 1, L.orch.zone[1] + 34 - L.orch.screen.w)))
        // Each station's cable still ends at its station, a cell down per row above the room.
        const [ec, er] = g.paths.station.shell.at(-1)!
        expect([ec, er - d]).toEqual(L.paths.station.shell.at(-1)!)
        // Every path steps one cell at a time.
        for (const path of [g.paths.orch, ...Object.values(g.paths.station)]) {
          for (let i = 1; i < path.length; i++) expect(Math.abs(path[i]![0] - path[i - 1]![0]) + Math.abs(path[i]![1] - path[i - 1]![1])).toBe(1)
        }
        const cat = catBox(g, columns)
        const big = catBox(L, columns)
        if (big) expect(cat).toEqual({ ...big, y: big.y + d * 4 })
        // Your window and the board stay in the top corners; the solo window stands in the room.
        if (withYou) expect(g.window).toEqual(L.window)
        else expect(g.window).toEqual({ ...L.window!, top: d })
      }
    }
  }
})

test('showcase: the wall screens fit whole, inside the wall, clear of each other, the cables and the room', () => {
  for (const withYou of [true, false]) {
    for (const columns of WIDTHS) {
      for (const rows of TALL) {
        const g = geometry(columns, rows, withYou)
        const all = boxes(showcaseOf(g))
        const where = `${columns}×${rows}${withYou ? '' : ' solo'}`
        if (!all.length) throw new Error(`${where}: no screens`)
        for (const [name, b] of all) {
          if (b.col < 1 || b.col + b.w > columns - 1 || b.row < 0) throw new Error(`${where}: ${name} ${JSON.stringify(b)} leaves the canvas`)
          // Over the room's ceiling across the middle; in a pocket, outside the risers and a row over the monitors.
          // The pockets end a cell short of the cable lanes beside the stations.
          const left = b.col + b.w <= g.lanes!.left
          const right = b.col > g.lanes!.right
          if (!left && !right && b.row + b.h > g.top) throw new Error(`${where}: ${name} ${JSON.stringify(b)} reaches the tray at row ${g.top}`)
          const monitor = left ? g.orch.top : g.worker.top
          if ((left || right) && b.row + b.h > monitor - 1) throw new Error(`${where}: ${name} reaches the monitors`)
          // Clear of the window (and its sill) and of the board's widest face and its shelf.
          if (g.window && !g.solo && overlap(b, { col: g.window.c0 - 1, row: 0, w: g.window.c1 - g.window.c0 + 3, h: g.window.sky + 2 })) throw new Error(`${where}: ${name} covers the window`)
          if (overlap(b, { col: g.boardMin, row: 0, w: columns, h: 6 })) throw new Error(`${where}: ${name} covers the board`)
        }
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i]![1], all[j]![1])) throw new Error(`${where}: ${all[i]![0]} overlaps ${all[j]![0]}`)
      }
    }
  }
})

test('showcase: the screens come in the order of what they are worth, and the wall over the room is never bare', () => {
  for (const withYou of [true, false]) {
    for (const columns of [80, 100, 144, 160]) {
      for (const rows of TALL) {
        const sc = showcaseOf(geometry(columns, rows, withYou))
        const where = `${columns}×${rows}${withYou ? '' : ' solo'}`
        // The thinking screen first: on every showcase; the instruments from six rows; then the departures and the details.
        if (!sc.thinking) throw new Error(`${where}: no thinking screen`)
        const off = rows - LARGE
        expect(sc.instruments.length > 0).toBe(off >= 6)
        if (sc.details && !sc.departures && withYou) throw new Error(`${where}: details without departures`)
        if (withYou && !sc.departures) throw new Error(`${where}: no departures board`)
        // Every row over the ceiling is a screen's: the top row's modules, then the band under it.
        if (off >= 11) {
          for (let r = 0; r < off; r++) {
            if (r === 5) continue // the gutter under the window's sill and the board's shelf
            const covered = boxes(sc).some(([, b]) => r >= b.row && r < b.row + b.h && b.col <= 1 + (withYou ? 16 : 0) + 1 && b.col + b.w >= Math.min(columns - 2, geometry(columns, rows, withYou).boardMin - 1))
            const top = sc.instruments.some(x => r >= x.box.row && r < x.box.row + x.box.h)
            if (!covered && !top) throw new Error(`${where}: row ${r} over the room is bare`)
          }
        }
      }
    }
  }
  // The modules: the readings the room does not draw, in order, first fit, and their slots hold.
  expect(showcaseModules()).toEqual(['counter:turns', 'dial:ctx', 'scope:pace', 'river', 'counter:cost', 'counter:out', 'counter:errors'])
  expect(showcaseModules(new Set(['turns', 'ctx']))).toEqual(['scope:pace', 'river', 'counter:cost', 'counter:out', 'counter:errors'])
  expect(showcaseOf(geometry(144, 52)).instruments.map(x => x.id)).toEqual(['counter:turns', 'dial:ctx', 'scope:pace', 'river', 'counter:cost', 'counter:out'])
  expect(showcaseOf(geometry(100, 52)).instruments.map(x => x.id)).toEqual(['counter:turns', 'dial:ctx', 'scope:pace'])
  expect(showcaseOf(geometry(100, 52, false)).instruments.map(x => x.id)).toEqual(['counter:turns', 'dial:ctx', 'scope:pace', 'river'])
  const row = instrumentRow(['counter:turns', 'dial:ctx', 'nope'], { col: 3, row: 0, w: 40, h: 5 })
  expect(row.map(x => x.id)).toEqual(['counter:turns', 'dial:ctx'])
  expect(row[1]!.box.col + row[1]!.box.w).toBe(43)
  expect(row[1]!.box.col).toBe(row[0]!.box.col + row[0]!.box.w + 1)
  // The top row runs from after the window to the board's face, which keeps its widest width there: no gap.
  for (const columns of [100, 120, 144]) {
    const g = geometry(columns, 48)
    const top = showcaseOf(g).instruments
    expect(top.at(-1)!.box.col + top.at(-1)!.box.w).toBe(g.boardMin)
    expect(boardOf(g, RUNNING, memoryOf(RUNNING, T), T).face!.col).toBe(g.boardMin)
  }
  // Very tall: the details screen and the files list join; solo the details take the band's lower third.
  const tall = showcaseOf(geometry(100, 52))
  expect([tall.thinking != null, tall.departures != null, tall.details != null, tall.files != null]).toEqual([true, true, true, true])
  expect(tall.details!.row).toBe(tall.thinking!.row + tall.thinking!.h)
  const mid = showcaseOf(geometry(100, 40))
  expect([mid.details != null, mid.files]).toEqual([true, null])
})

test('showcase: every fixture draws columns × rows printable cells at every tall height and width, and moves while live', () => {
  for (const rows of [25, 30, 40, 52, 70]) {
    for (const columns of [40, 60, 80, 100, 144, 200]) {
      for (const s of [RUNNING, THINKING, FINISHED, FAILED, NOLOG, SESSION]) {
        for (const you of [undefined, YOU_THINKING]) {
          const w = decode(hd({ s, columns, rows, you }))
          expect(w.length).toBe(columns * rows * 3)
          for (let i = 0; i < w.length; i += 3) if (w[i]! < 0x20 || (w[i]! >= 0x7f && w[i]! <= 0x9f)) throw new Error(`${columns}×${rows}: code point ${w[i]}`)
        }
      }
      if (hd({ s: THINKING, columns, rows, frame: 1 }) === hd({ s: THINKING, columns, rows, frame: 2 })) throw new Error(`${columns}×${rows}: frames 1 and 2 match`)
    }
  }
  // Across the demo loop, with you and solo, the scene draws.
  for (let e = 0; e < DEMO_LOOP_SECS; e += 3) {
    const s = demoSummary(e, T + e)
    expect(decode(hd({ s, t: T + e, you: YOU_WAITING })).length).toBe(100 * 48 * 3)
    expect(decode(hd({ s, t: T + e, worker: 'claude', columns: 144, rows: 60 })).length).toBe(144 * 60 * 3)
  }
})

test('showcase: the screens say the run: the thinking with its age, the calls, the output, the files, the readings', () => {
  const g = geometry(100, 52)
  const sc = showcaseOf(g)
  const w = decode(hd({ rows: 52, you: YOU_THINKING, a: AMBIENT(RUNNING) }))
  const think = boxText(w, 100, sc.thinking!)
  expect(think.includes('thinking · 4m30s ago')).toBe(true)
  expect(think.includes('The failing case is the empty title.')).toBe(true)
  // The earlier thoughts and replies fill the rows the latest leaves, a line each.
  expect(think.includes('· The trim happens after the length check.')).toBe(true)
  expect(think.includes('» Reading the todo module')).toBe(true)
  const calls = boxText(w, 100, sc.departures!)
  expect(calls.includes('tool calls')).toBe(true)
  expect(calls.includes('npx tsc')).toBe(true)
  expect(calls.includes('6.2s')).toBe(true)
  expect(calls.split('\n')[2]!.includes('npm test')).toBe(true) // newest at the top, the running call first
  const details = boxText(w, 100, sc.details!)
  expect(details.includes('tests/todo.test.ts (11 tests)')).toBe(true)
  expect(boxText(w, 100, sc.files!).includes('src/todo.ts')).toBe(true)
  // The modules spell their readings: turns, context, pace.
  const top = allText(w, 100).split('\n').slice(0, 5).join('\n')
  for (const bit of ['turns', '18', 'context', '41%', 'pace']) expect(top.includes(bit)).toBe(true)
  // With the details on the wall the worker's monitor keeps the diff.
  expect(boxText(w, 100, g.worker.screen).includes('+ const t')).toBe(true)
  expect(boxText(w, 100, g.worker.screen).includes('tests/todo')).toBe(false)
})

test('showcase: one home per fact: the running call, the context and the turns are each spelled once', () => {
  const once = (all: string, needle: RegExp, where: string) => {
    const n = all.match(needle)?.length ?? 0
    if (n > 1) throw new Error(`${where}: ${needle} ${n} times`)
  }
  const BARE: Summary = { ...RUNNING, last_diff: null, last_bash: null }
  for (const rows of [30, 40, 52, 60]) {
    for (const columns of [80, 100, 144]) {
      for (const [name, s, you, worker] of [['running', RUNNING, YOU_THINKING], ['solo', SESSION, undefined, 'claude'], ['bare', BARE, undefined]] as [string, Summary, You | undefined, string | undefined][]) {
        const all = allText(decode(officeHd.draw({ s, a: activity(s, T), frame: 12, t: T, columns, rows, you, worker })), columns)
        const where = `${columns}×${rows} ${name}`
        once(all, /npm test -- todo/g, where)
        once(all, /54\.2k/g, where)
        once(all, /\b41%/g, where)
        once(all, /tok\/s/g, where)
      }
    }
  }
  // The running call joins the board only when the caption does not spell it out.
  expect(departures(RUNNING, activity(RUNNING, T), 10).some(e => e.status === 'running')).toBe(false)
  expect(departures(RUNNING, AMBIENT(RUNNING), 10)[0]!.status).toBe('running')
  expect(departures(FINISHED, activity(FINISHED, T), 10).every(e => e.status !== 'running')).toBe(true)
  expect([callDur(0.14), callDur(9.8), callDur(42), callDur(100)]).toEqual(['0.1s', '9.8s', '42s', '1m40s'])
})

test('showcase: the thinking screen: the plain words first, then the gist; stale plain words dim; the reply with no thinking', () => {
  const runs = [{ text: 'It found why blank titles get through, and will fix the check.', role: 'plain' as const }]
  const fresh: Plain = { runs, t: T - 20, stale: false }
  const with_ = thinkingScreen(RUNNING, T, 60, 12, fresh)!
  expect(with_.title).toBe('in plain words · 20s ago')
  expect(with_.rows[0]!.layer).toBe('plain')
  const firstGist = with_.rows.findIndex(r => r.layer === 'gist')
  const lastPlain = with_.rows.findLastIndex(r => r.layer === 'plain')
  expect(firstGist > lastPlain).toBe(true)
  expect(with_.rows[lastPlain + 1]!.layer).toBe('gap')
  expect(with_.stale).toBe(false)
  expect(thinkingScreen(RUNNING, T, 60, 12, { ...fresh, stale: true })!.stale).toBe(true)
  expect(with_.rows.length <= 12).toBe(true)
  // Without plain words: the gist alone, titled with the newest thought's age; empty plain words count as none.
  const bare = thinkingScreen(RUNNING, T, 60, 12)!
  expect(bare.title).toBe('thinking · 4m30s ago')
  expect(bare.rows.some(r => r.layer === 'plain')).toBe(false)
  expect(thinkingScreen(RUNNING, T, 60, 12, { runs: [{ text: ' ', role: 'plain' }], t: T, stale: false })!.title.startsWith('thinking')).toBe(true)
  // With no thinking text, the latest reply; with neither, nothing.
  const reply = thinkingScreen({ ...RUNNING, thinking: '' }, T, 60, 12)!
  expect(reply.title).toBe('latest reply · 5m00s ago')
  expect(thinkingScreen({ ...RUNNING, thinking: '', text: '' }, T, 60, 12)).toBe(null)
  // A screen too short for the gist and the earlier lines keeps the gist.
  expect(thinkingScreen(RUNNING, T, 60, 2)!.rows.every(r => r.layer === 'gist')).toBe(true)
  // Drawn: the title, the plain words on the first row under it, dimmer while stale.
  const box = showcaseOf(geometry(100, 48)).thinking!
  const at = (p: Plain) => decode(hd({ plain: p, you: YOU_THINKING }))
  const a = at(fresh)
  expect(boxText(a, 100, box).includes('in plain words · 20s ago')).toBe(true)
  expect(boxText(a, 100, { ...box, row: box.row + 2, h: 1 }).includes('It found why blank titles')).toBe(true)
  const col = box.col + 1
  expect(fgAt(at({ ...fresh, stale: true }), 100, col, box.row + 2)).not.toBe(fgAt(a, 100, col, box.row + 2))
  // Roles take the palette's meaning colours.
  const hot = at({ runs: [{ text: 'tests ', role: 'plain' }, { text: 'fail', role: 'problem' }], t: T, stale: false })
  expect(fgAt(hot, 100, col + 6, box.row + 2)).toBe(panelOf(PALETTES.night).red)
})

test('showcase: prose drops control characters, escapes and light markdown; the history leaves out the thought on show', () => {
  expect(prose('## Plan\n\n* **Fix** the `trim`\x07 check\x1b[31m now\x1b[0m\n- next *step*')).toEqual(['Plan', '- Fix the trim check now', '- next step'])
  const h = historyOf(RUNNING, RUNNING.thinking!)
  expect(h).toEqual(['» Reading the todo module and its tests first.', '· The trim happens after the length check.'])
  expect(historyOf(RUNNING, 'The trim happens after the length check. And more.')).toEqual(['» Reading the todo module and its tests first.'])
})

test('showcase: the departures board names the class by its glyph, and drops that column before the label would be cut short', () => {
  const P = panelOf(PALETTES.night)
  // The box with its frame; a blank screen cell reads as █.
  const board = (w: number) => {
    const c = new HiCanvas(w + 2, 12)
    drawDepartures(c, { col: 1, row: 0, w, h: 12 }, RUNNING, activity(RUNNING, T), 12, P)
    const words = decode(c.encode())
    const rows = boxText(words, w + 2, { col: 2, row: 2, w: w - 2, h: 6 }).replace(/█/g, ' ').split('\n')
    return { words, rows }
  }
  // Wide: the glyph beside the label, as office-hd's stations show it, in the class's colour.
  const wide = board(32)
  expect(wide.rows[0]!.includes('✓ ✎ todo.test.ts')).toBe(true)
  expect(wide.rows.some(r => r.includes('✓ ⌕ validateTitle'))).toBe(true)
  expect(wide.rows.some(r => r.includes('✓ ◇ todo.ts'))).toBe(true)
  expect(fgAt(wide.words, 34, 2 + [...wide.rows[0]!].indexOf('✎'), 2)).toBe(P.classes.edit)
  // Narrow (the left pocket at 80 columns): no class column; the label carries the class's colour.
  expect(board(19).rows[0]!.startsWith('✓ ✎ todo.te…')).toBe(true)
  const narrow = board(18)
  expect(narrow.rows[0]!.startsWith('✓ todo.tes…')).toBe(true)
  expect(narrow.rows.join('\n').includes('✎')).toBe(false)
  expect(fgAt(narrow.words, 20, 4, 2)).toBe(P.classes.edit)
})

test('showcase: on a screen too small for both, the plain words win, cut with …', () => {
  const long: Plain = { runs: [{ text: 'The worker found why blank titles get through the check, and it will move the trim before the length test next.', role: 'plain' }], t: T, stale: false }
  const small = thinkingScreen(RUNNING, T, 20, 4, long)!
  expect(small.rows.every(r => r.layer === 'plain')).toBe(true)
  expect(small.rows.length).toBe(4)
  expect(small.rows[3]!.runs.map(r => r.text).join('').endsWith('…')).toBe(true)
  // With room the gist follows them after a blank row.
  const roomy = thinkingScreen(RUNNING, T, 40, 9, long)!
  expect(roomy.rows[0]!.layer).toBe('plain')
  expect(roomy.rows.findIndex(r => r.layer === 'gap')).toBe(roomy.rows.findLastIndex(r => r.layer === 'plain') + 1)
  expect(roomy.rows.at(-1)!.layer).toBe('gist')
})
