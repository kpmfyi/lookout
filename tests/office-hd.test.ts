import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity, elapsedOf, fmtDur } from '../hooks/activity.ts'
import type { Fact } from '../hooks/facts.ts'
import { memoryOf } from '../hooks/memory.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { Palette } from '../hooks/palette.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import { MAX_NOTES, MAX_PARCELS, SLIP_SECS, boardOf, catBox, checksLine, diffLines, geometry, officeHd, outputLines, props, pumpkinCells, slipBox, workOf, wrap } from '../hooks/scenes/office-hd.ts'
import type { Box, Geometry, Px } from '../hooks/scenes/office-hd.ts'
import { CLASS_GLYPH } from '../hooks/glyphs.ts'
import { seasonTones } from '../hooks/seasons.ts'
import type { You } from '../hooks/you.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING, YOU_THINKING, YOU_TOOL, YOU_WAITING } from './fixtures.ts'

const NONE = 0x01000000
const NIGHT = PALETTES.night
const CLASS_COLOR = NIGHT.classes
const SIZES = [officeHd.rows.compact, officeHd.rows.standard, officeHd.rows.large]
const HEIGHTS = [...SIZES, 11, 17, 30]
const WIDTHS = [40, 60, 80, 144, 200]
const FIXTURES: [string, Summary][] = [
  ['running', RUNNING],
  ['thinking', THINKING],
  ['finished', FINISHED],
  ['failed', FAILED],
  ['nolog', NOLOG],
  ['stalled', { ...THINKING, mtime: T - 600, stalled: true }],
  ['prefill', { ...RUNNING, pending: { kind: 'model', since: T - 1 }, server: { ...RUNNING.server!, inflight: { msgs: 40, prompt: 80_000, cached: 10_000 } } }],
  ['tests-pass', { ...RUNNING, tests: [{ t: T - 2, failed: 0, passed: 11, total: 11 }] }],
  ['tests-fail', { ...THINKING, tests: [{ t: T - 2, failed: 3, passed: 8, total: 11 }] }],
  ['error', { ...RUNNING, last_error: { t: T - 1, tool: 'Bash', detail: 'exit 1' } }],
]
const YOUS: (You | undefined)[] = [undefined, YOU_THINKING, YOU_TOOL, YOU_WAITING, { ...YOU_WAITING, lastHandoff: T - 1 }]

// Run memory fixtures (docs/DESIGN.md 32). CELEB: red, redder, then green a second before T, with
// 47 turns, 20 edits, 5 crumples and 4 commits. BUSY: everything at its most (14 runs, 5 failing
// now, 8 commits, 9 crumples, 64 turns, 40 edits), thinking.
const commits = (n: number) => Array.from({ length: n }, (_, i) => ({ hash: `c${i}`, t: T - 900 + i, subject: 's', stat: '' }))
const CELEB: Summary = {
  ...RUNNING,
  turns: 47,
  errors: 3,
  denials: 2,
  tests: [{ t: T - 600, failed: 3, passed: 8, total: 11 }, { t: T - 300, failed: 4, passed: 7, total: 11 }, { t: T - 1, failed: 0, passed: 11, total: 11 }],
  tool_counts: [['Read', 14], ['Edit', 20], ['Bash', 12], ['Grep', 4]],
  git: { ...RUNNING.git!, commits: commits(4) },
}
const BUSY: Summary = {
  ...THINKING,
  turns: 64,
  errors: 7,
  denials: 2,
  server: RUNNING.server,
  memory: RUNNING.memory,
  tests: Array.from({ length: 14 }, (_, i) => ({ t: T - 1000 + i * 50, failed: i % 3 === 0 ? 2 : i > 11 ? 5 : 0, passed: 8, total: 11 })),
  tool_counts: [['Read', 14], ['Edit', 40], ['Bash', 12], ['Grep', 4]],
  git: { ...RUNNING.git!, commits: commits(8) },
}
/** RUNNING with the diff newer than the command, the worker in an Edit. */
const EDITING: Summary = { ...RUNNING, last_diff: { ...RUNNING.last_diff!, t: T - 1 }, pending: { kind: 'tool', tool: 'Edit', cls: 'edit', label: 'src/todo.ts', since: T - 1 } }
/** RUNNING with neither a diff nor a command yet: the worker's monitor falls back to ctx and checks. */
const BARE: Summary = { ...RUNNING, last_diff: null, last_bash: null }
/** What the wall claims with every default module visible (docs/DESIGN.md 31). */
const WALL: Fact[] = ['handoff', 'turns', 'tools', 'errors', 'cost', 'output', 'ctx', 'memory', 'decode', 'prefill', 'pace', 'elapsed', 'checks', 'time', 'recent', 'timeline']

function draw(s: Summary, frame: number, columns: number, rows: number, you?: You, transparent?: boolean): string {
  return officeHd.draw({ s, a: activity(s, T), frame, t: T, columns, rows, you, transparent })
}

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

/** The glyphs of a screen's cells, row by row, joined with newlines. */
function screenText(words: Uint32Array, columns: number, box: Box): string {
  const lines: string[] = []
  for (let r = box.row; r < box.row + box.h; r++) {
    let line = ''
    for (let col = box.col; col < box.col + box.w; col++) line += String.fromCodePoint(words[(r * columns + col) * 3]!)
    lines.push(line)
  }
  return lines.join('\n')
}

/** Every glyph of the canvas, row by row. */
function allText(words: Uint32Array, columns: number): string {
  return screenText(words, columns, { col: 0, row: 0, w: columns, h: words.length / 3 / columns })
}

function drawCtx(o: { s?: Summary; columns?: number; rows?: number; frame?: number; you?: You; t?: number; season?: string; palette?: Palette; transparent?: boolean; shown?: Fact[] }): string {
  const s = o.s ?? RUNNING
  const t = o.t ?? T
  return officeHd.draw({ s, a: activity(s, t), frame: o.frame ?? 12, t, columns: o.columns ?? 80, rows: o.rows ?? officeHd.rows.standard, you: o.you, transparent: o.transparent, palette: o.palette, season: 'season' in o ? o.season : 'none', shown: o.shown ? new Set(o.shown) : undefined } as SceneCtx)
}

/** The colours (fg and bg) of the cells in a box. */
function boxColours(cells: string, columns: number, b: Box): Set<number> {
  const w = decode(cells)
  const out = new Set<number>()
  for (let r = b.row; r < b.row + b.h; r++) for (let c = b.col; c < b.col + b.w; c++) out.add(w[(r * columns + c) * 3 + 1]!).add(w[(r * columns + c) * 3 + 2]!)
  return out
}

/** The cells a sub-pixel box touches. */
function pxCells(b: Px): Box {
  return { col: b.x >> 1, row: b.y >> 2, w: ((b.x + b.w - 1) >> 1) - (b.x >> 1) + 1, h: ((b.y + b.h - 1) >> 2) - (b.y >> 2) + 1 }
}
const overlap = (a: Px, b: Px) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('office-hd: every fixture draws columns × rows printable cells at every size, in-between height and width', () => {
  for (const rows of HEIGHTS) {
    for (const columns of WIDTHS) {
      for (const [name, s] of [...FIXTURES, ['celebrating', CELEB], ['busy', BUSY], ['editing', EDITING]] as [string, Summary][]) {
        for (const you of YOUS) {
          for (const frame of [0, 1, 57]) {
            let words: Uint32Array
            try {
              words = decode(draw(s, frame, columns, rows, you, frame === 57 ? false : undefined))
            } catch (err) {
              throw new Error(`${name} (${you?.state ?? 'no you'}) at ${columns}×${rows}: ${String(err)}`)
            }
            if (words.length !== columns * rows * 3) throw new Error(`${name} at ${columns}×${rows}: ${words.length / 3} cells`)
            for (let i = 0; i < words.length; i += 3) {
              const cp = words[i]!
              if (cp < 0x20 || cp > 0xffff || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff)) {
                throw new Error(`${name} at ${columns}×${rows}: code point 0x${cp.toString(16)}`)
              }
            }
          }
        }
      }
    }
  }
})

test('office-hd: frames differ while live; a finished run keeps a slow idle motion', () => {
  for (const rows of HEIGHTS) {
    for (const [name, s] of FIXTURES) {
      if (activity(s, T).state === 'done') continue
      for (const columns of [40, 80, 144]) {
        if (draw(s, 1, columns, rows, YOU_WAITING) === draw(s, 2, columns, rows, YOU_WAITING)) throw new Error(`${name} at ${columns}×${rows}: frames 1 and 2 match`)
      }
    }
    for (const s of [FINISHED, FAILED]) expect(draw(s, 0, 80, rows)).not.toBe(draw(s, 8, 80, rows))
  }
})

test("office-hd: the worker's monitor shows the work: the command's output or the diff, never the activity", () => {
  expect(workOf(RUNNING)).toBe('bash')
  expect(workOf(EDITING)).toBe('diff')
  expect(workOf(BARE)).toBe(null)
  for (const [columns, rows] of [[80, 10], [80, 15], [144, 15], [80, 24], [200, 24]] as const) {
    const g = geometry(columns, rows)
    const sc = g.worker.screen
    // The command is newer in RUNNING: its output's newest line, and nothing of the activity.
    const out = screenText(decode(draw(RUNNING, 12, columns, rows)), columns, sc)
    if (!out.includes('tests/todo')) throw new Error(`${columns}×${rows}: no output in\n${out}`)
    // The diff: + lines in GOOD, - lines in BAD, from the first change on a short screen.
    const words = decode(drawCtx({ s: EDITING, columns, rows }))
    const diff = screenText(words, columns, sc)
    const lines = diffLines(EDITING.last_diff!.diff, sc.h)
    expect(diff.split('\n')[0]!.startsWith(lines[0]!.kind === 'del' ? '- ' : lines[0]!.kind === 'add' ? '+ ' : '  ')).toBe(true)
    for (let r = 0; r < sc.h && r < lines.length; r++) {
      const fg = words[((sc.row + r) * columns + sc.col) * 3 + 1]!
      if (lines[r]!.kind === 'add') expect(fg).toBe(NIGHT.good)
      if (lines[r]!.kind === 'del') expect(fg).toBe(NIGHT.bad)
    }
    if (sc.h >= 3 && !diff.includes('+ const t')) throw new Error(`${columns}×${rows}: no added line in\n${diff}`)
    // With neither, the context bar and its reading.
    const bare = screenText(decode(drawCtx({ s: BARE, columns, rows })), columns, sc)
    if (!bare.includes('41%')) throw new Error(`${columns}×${rows}: no 41% in\n${bare}`)
  }
  // The activity line is the caption's alone, at every size and width, for every fixture.
  for (const rows of SIZES) {
    for (const columns of [60, 80, 144]) {
      const sc = geometry(columns, rows).worker.screen
      for (const [name, s] of [...FIXTURES, ['editing', EDITING], ['bare', BARE]] as [string, Summary][]) {
        const a = activity(s, T)
        const text = screenText(decode(draw(s, 12, columns, rows)), columns, sc).replace(/\n/g, ' ')
        for (const bit of [a.text, 'Bash ·', 'Edit ·', 'thinking…', 'reading prompt', 'starting…', 'no log yet', 'finished']) {
          if (text.includes(bit)) throw new Error(`${name} at ${columns}×${rows}: the monitor prints ${bit}: ${text}`)
        }
      }
    }
  }
})

test('office-hd: a diff and a command output are cut to the screen, the shared indent gone', () => {
  const lines = diffLines(RUNNING.last_diff!.diff, 3)
  expect(lines.map(l => l.kind)).toEqual(['del', 'del', 'add'])
  expect(lines[0]!.text).toBe('if (title.length === 0) return false')
  expect(diffLines(RUNNING.last_diff!.diff, 5)[0]!.kind).toBe('ctx') // one line of context on a tall screen
  expect(diffLines('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b', 4).map(l => l.text)).toEqual(['a', 'b'])
  expect(outputLines([' RUN  v2', '', ' ✓ ok  '], 1)).toEqual(['✓ ok'])
  expect(outputLines(['a', 'b', 'c'], 2)).toEqual(['b', 'c'])
  expect(wrap('Fix empty-title validation in the todo store', 12, 2)).toEqual(['Fix', 'empty-title…'])
  expect(wrap('Add due dates', 20, 2)).toEqual(['Add due dates'])
})

test('office-hd: screen readings never run together; the type-check goes first when room is short', () => {
  for (const s of [RUNNING, FINISHED, FAILED, { ...RUNNING, tsc: [{ t: T, errors: 3 }] }]) {
    for (let w = 0; w <= 40; w++) {
      const line = checksLine(s, w)
      expect(line.length <= w).toBe(true)
      // Two readings always have " · " between them; never `failing tsc✓` or `✓tsc`.
      if (line.includes('tsc') && /✓|✖ \d+ failing|\d\/\d/.test(line.split('tsc')[0]!)) expect(line.includes(' · tsc')).toBe(true)
      expect(/\Stsc|tsc[✓✖]/.test(line)).toBe(false)
    }
  }
  // The tests' reading is kept and the tsc dropped before the tests' reading is shortened.
  expect(checksLine(RUNNING, 11)).toBe('✖ 1 failing')
  // On the board the reading keeps a cell clear of the tally and of the elapsed time.
  for (const columns of [60, 61, 70, 80, 100, 144, 200]) {
    for (const rows of [15, 17, 24]) {
      const g = geometry(columns, rows)
      for (const s of [RUNNING, CELEB, BUSY, FINISHED, FAILED]) {
        const b = boardOf(g, s, memoryOf(s, T), T)
        if (!b.checks) continue
        const end = b.checks.col + b.checks.text.length
        if (b.elapsed && b.elapsed.row === b.checks.row) expect(end < b.elapsed.col).toBe(true)
        const last = b.star ? b.star[0] : b.marks.at(-1)?.col
        if (last != null && b.checks.row === 1) expect(b.checks.col > last + 1).toBe(true)
      }
    }
  }
})

test("office-hd: the orchestrator's monitor shows its state: waiting or thinking; with no orchestrator there is no monitor", () => {
  for (const [columns, rows] of [[60, 10], [80, 15], [144, 24]] as const) {
    const g = geometry(columns, rows)
    const waiting = screenText(decode(draw(THINKING, 3, columns, rows, YOU_WAITING)), columns, g.orch.screen)
    if (!waiting.includes('waiting')) throw new Error(`${columns}×${rows}: no waiting in\n${waiting}`)
    const thinking = screenText(decode(draw(THINKING, 3, columns, rows, YOU_THINKING)), columns, g.orch.screen)
    if (!thinking.includes('thinking')) throw new Error(`${columns}×${rows}: no thinking in\n${thinking}`)
    const solo = draw(THINKING, 3, columns, rows)
    expect(/[a-z0-9]/i.test(screenText(decode(solo), columns, g.orch.screen))).toBe(false)
    expect(boxColours(solo, columns, g.orch.screen).has(NIGHT.mon)).toBe(false)
  }
})

test("office-hd: the orchestrator's cable carries packets in the tool's class colour while it runs a tool", () => {
  const columns = 80
  const rows = 15
  const g = geometry(columns, rows)
  const lit = (you: You): number => {
    let n = 0
    for (const frame of [0, 3, 7, 12]) {
      const words = decode(draw(THINKING, frame, columns, rows, you))
      for (const [col, row] of g.paths.orch) if (words[(row * columns + col) * 3 + 1] === CLASS_COLOR.shell) n++
    }
    return n
  }
  expect(lit(YOU_TOOL) > 0).toBe(true)
  expect(lit(YOU_THINKING)).toBe(0)
})

test('office-hd: transparent leaves the corners unpainted; painted mode fills the wall', () => {
  for (const rows of [10, 15, 17, 24]) {
    for (const columns of [60, 80, 144]) {
      const clear = decode(draw(RUNNING, 12, columns, rows, YOU_TOOL, true))
      for (const [col, row] of [[0, 0], [columns - 1, 0], [0, rows - 1], [columns - 1, rows - 1]] as const) {
        const i = (row * columns + col) * 3
        if (clear[i] !== 0x20 || clear[i + 1] !== NONE || clear[i + 2] !== NONE) throw new Error(`${columns}×${rows} cell (${col}, ${row}) is painted`)
      }
      const painted = decode(draw(RUNNING, 12, columns, rows, YOU_TOOL, false))
      expect(painted[1] === NONE && painted[2] === NONE).toBe(false)
    }
  }
})

test('office-hd: the figures face each other: the eye on the head’s inner side', () => {
  for (const [columns, rows] of [[60, 10], [80, 15], [144, 24], [200, 17]] as const) {
    const g = geometry(columns, rows)
    expect(g.orch.eye.x > g.orch.head.cx).toBe(true)
    expect(g.worker.eye.x < g.worker.head.cx).toBe(true)
    expect(g.orch.head.x < g.worker.head.x).toBe(true)
    // The eye's cell: skin with the eye's dark quadrant on the inner side (▙ top-right dark, ▟ top-left dark).
    const words = decode(draw(RUNNING, 12, columns, rows, YOU_THINKING))
    const glyph = (x: number, y: number) => words[((y >> 2) * columns + (x >> 1)) * 3]!
    expect(glyph(g.orch.eye.x, g.orch.eye.y)).toBe(0x2599)
    expect(glyph(g.worker.eye.x, g.worker.eye.y)).toBe(0x259f)
  }
})

const SCREEN = 0x0a0e0a
const SCREEN_OFF = 0x060806
const PHOS = 0x62e07e
const MUG = 0xc2603a
const SHEET = 0xf4efe6
const SKIN = 0xe0b48a
const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)

/** The glyphs of one row. */
function rowText(words: Uint32Array, columns: number, row: number): string {
  let out = ''
  for (let x = 0; x < columns; x++) out += String.fromCodePoint(words[(row * columns + x) * 3]!)
  return out
}

test('office-hd: nothing reaches the last column; the elapsed time ends one column before it', () => {
  for (const columns of [60, 80, 100, 144]) {
    for (const rows of SIZES) {
      const g = geometry(columns, rows)
      for (const [name, s] of [...FIXTURES, ['busy', BUSY]] as [string, Summary][]) {
        for (const you of YOUS) {
          const words = decode(draw(s, 12, columns, rows, you))
          for (let row = 0; row < rows; row++) {
            const last = rowText(words, columns, row).at(-1)!
            if (/[\p{L}\p{N}…★]/u.test(last)) throw new Error(`${name} at ${columns}×${rows}: row ${row} ends in ${last}`)
          }
          if (!g.clock) continue
          // The elapsed time, right-aligned on its row (on the board or alone): the frame in column
          // C-2, the text just left of it.
          const el = s.exists ? fmtDur(elapsedOf(s, T)) : '--'
          const line = rowText(words, columns, g.clock.row)
          if (g.clock.right !== columns - 2 || line.slice(columns - 2 - el.length, columns - 2) !== el) {
            throw new Error(`${name} at ${columns}×${rows}: badge row is ${line}`)
          }
        }
      }
      // The caption rows stay at the bottom: the desk labels on the next to last, the caption last.
      const words = decode(draw(RUNNING, 12, columns, rows, YOU_THINKING))
      expect(rowText(words, columns, rows - 2).startsWith(' you · opus 5')).toBe(true)
      expect(rowText(words, columns, rows - 2).trimEnd().endsWith('qwen coder')).toBe(true)
      expect(rowText(words, columns, rows - 1).slice(1, 3)).toBe('⠹ ')
    }
  }
})

test("office-hd: an idle orchestrator's monitor is off, names its model dim and shows the hand-off under it", () => {
  for (const [columns, rows] of [[60, 10], [80, 15], [144, 24]] as const) {
    const g = geometry(columns, rows)
    const sc = g.orch.screen
    const idle: You = { state: 'idle', since: T - 60, turns: 0, model: 'claude-opus-5-5' }
    const words = decode(draw(RUNNING, 12, columns, rows, idle))
    const text = screenText(words, columns, sc)
    if (!/^you( ·)? opus 5/.test(text.split('\n')[0]!)) throw new Error(`${columns}×${rows}: no model in\n${text}`)
    expect(text.includes('idle')).toBe(false)
    for (let x = 0; x < 3; x++) {
      const i = (sc.row * columns + sc.col + x) * 3
      expect(words[i + 2]).toBe(SCREEN_OFF)
      expect(lum(words[i + 1]!) < lum(PHOS) / 2).toBe(true)
    }
    // No more sheen stripes: the rows under the label carry the hand-off's first line, dim.
    expect(text.includes('▞')).toBe(false)
    if (sc.h >= 2) {
      const under = screenText(words, columns, { ...sc, row: sc.row + 1, h: sc.h - 1 })
      if (!under.startsWith('Fix')) throw new Error(`${columns}×${rows}: no hand-off under the label in\n${text}`)
      expect(lum(words[((sc.row + 1) * columns + sc.col) * 3 + 1]!) < lum(PHOS) / 2).toBe(true)
    }
    // With no model known and no hand-off the screen is off and says nothing; with the hand-off
    // claimed it says nothing either (a dim cursor waits).
    const none = screenText(decode(draw({ ...RUNNING, handoff: null }, 12, columns, rows, { ...idle, model: undefined })), columns, sc)
    expect(/[a-z0-9]/i.test(none)).toBe(false)
    const claimedHandoff = screenText(decode(drawCtx({ columns, rows, you: { ...idle, model: undefined }, shown: ['handoff'] })), columns, sc)
    expect(/[a-z0-9]/i.test(claimedHandoff)).toBe(false)
  }
})

test('office-hd: with no orchestrator your desk gives way to a tall window and a plant, and the worker takes its name', () => {
  // docs/DESIGN.md 36: the pane following this session passes `worker: 'claude'`, no `you`.
  const SESSION: Summary = { ...RUNNING, model: 'claude-opus-5-5', server: null, memory: null, handoff: null }
  const YOU_SHIRT = 0x9a5a9a
  for (const rows of [...SIZES, 17, 30]) {
    for (const columns of [60, 80, 100, 144, 200]) {
      const g = geometry(columns, rows, false)
      expect(g.solo).toBe(true)
      expect(g.paths.orch).toEqual([])
      // The window fills your desk's zone, a cell clear of its ends, and reaches from the room's
      // ceiling (the top row, or a showcase's tray) down to a sill a row over the desks.
      const w = g.window!
      expect(w.c0 - 1 >= g.orch.zone[0] && w.c1 + 1 < g.orch.zone[1]).toBe(true)
      expect(w.top).toBe(g.top)
      expect(w.top + w.sky + 1).toBe(g.D - 1)
      expect(g.plant).not.toBe(null)
      for (const shown of [undefined, WALL]) {
        const cells = officeHd.draw({ s: SESSION, a: activity(SESSION, T), frame: 12, t: T, columns, rows, worker: 'claude', season: 'none', shown: shown && new Set(shown) } as SceneCtx)
        const words = decode(cells)
        const all = allText(words, columns)
        expect(/\byou\b/.test(all)).toBe(false)
        expect(all.includes('worker')).toBe(false)
        const label = rowText(words, columns, g.labelRow)
        // The desk is just `claude`; the rack, standing for the model, names it unless the hand-off is claimed.
        expect(label.trimEnd().endsWith('claude')).toBe(true)
        expect(label.includes('claude ·')).toBe(false)
        expect(all.match(/opus 5/g)?.length ?? 0).toBe(shown ? 0 : 1)
        // No one in your chair: your shirt is nowhere, the plant's pot is on the floor.
        expect(new Set(words).has(YOU_SHIRT)).toBe(false)
        expect(boxColours(cells, columns, pxCells(g.plant!.pot)).has(0x9a4a2e)).toBe(true)
        expect(/no s(erve)?rv?/.test(all)).toBe(false)
      }
    }
  }
  // A worker with no server says so once, under the rack.
  const bare = allText(decode(draw({ ...RUNNING, server: null, memory: null }, 12, 80, 15)), 80)
  expect(bare.match(/no s(erve)?rv?/g)?.length).toBe(1)
  // With an orchestrator known the two desks stand as before.
  const two = allText(decode(draw(RUNNING, 12, 80, 15, YOU_THINKING)), 80)
  expect(rowText(decode(draw(RUNNING, 12, 80, 15, YOU_THINKING)), 80, geometry(80, 15).labelRow).trimStart().startsWith('you')).toBe(true)
  expect(two.includes('worker · qwen coder')).toBe(true)
})

test('office-hd: a station whose class has not run is off: dim label on a dark face, no dash', () => {
  // RUNNING: no web or agent calls; the right column is grep, web, agent.
  for (const [columns, rows] of [[80, 15], [100, 24], [144, 15]] as const) {
    const g = geometry(columns, rows)
    const words = decode(draw(RUNNING, 12, columns, rows))
    for (const [i, name] of [[1, 'web'], [2, 'agent']] as const) {
      const box: Box = { col: g.panelR + 1, row: g.pt + i * g.PS + 1, w: g.P - 2, h: g.PH - 2 }
      const text = screenText(words, columns, box)
      // A screen of several rows names the class with its glyph beside the word (docs/DESIGN.md 41).
      const glyph = `${CLASS_GLYPH[name === 'web' ? 'web' : 'agent']} `
      if (![`${name} 0`, `${name[0]}0`, `${glyph}${name} 0`].some(t => text.startsWith(t))) throw new Error(`${columns}×${rows}: ${name} screen reads\n${text}`)
      expect(/[–—]/.test(text)).toBe(false)
      for (let r = box.row; r < box.row + box.h; r++) {
        for (let col = box.col; col < box.col + box.w; col++) {
          const k = (r * columns + col) * 3
          const face = words[k] === 0x2588 ? words[k + 1] : words[k + 2]
          if (face !== SCREEN_OFF) throw new Error(`${columns}×${rows}: ${name} cell ${col},${r} face ${face!.toString(16)}`)
        }
      }
      expect(lum(words[(box.row * columns + box.col) * 3 + 1]!) < lum(PHOS) / 2).toBe(true)
    }
    // A station that has run is lit on the live screen colour.
    const grep: Box = { col: g.panelR + 1, row: g.pt + 1, w: g.P - 2, h: 1 }
    expect(screenText(words, columns, grep).startsWith(g.PH > 3 ? '⌕ grep 4' : 'grep 4')).toBe(true)
    expect(words[(grep.row * columns + grep.col) * 3 + 2]).toBe(SCREEN)
  }
})

test('office-hd: claimed facts drop their text and keep the pictures', () => {
  for (const [columns, rows] of [[80, 15], [100, 24], [144, 24]] as const) {
    const g = geometry(columns, rows)
    const free = decode(drawCtx({ s: BARE, columns, rows }))
    const words = decode(drawCtx({ s: BARE, columns, rows, shown: WALL }))
    const all = allText(words, columns)
    // Unclaimed, the scene spells them out somewhere.
    const freeText = allText(free, columns)
    for (const bit of ['41%', 'tok/s', ...(rows >= 24 ? ['GB'] : []), 'failing', '21m00s', 'read 14']) if (!freeText.includes(bit)) throw new Error(`${columns}×${rows}: no ${bit} unclaimed`)
    for (const bit of ['41%', '54.2k', 'tok/s', 'GB', 'failing', 'tsc ✓', '21m00s']) if (all.includes(bit)) throw new Error(`${columns}×${rows}: ${bit} is still printed`)
    // The stations keep their names and last labels, without counts; the decode bar and the tally stay.
    for (const [i, list] of [[0, g.panelL], [1, g.panelR]] as const) {
      for (let k = 0; k < 3; k++) {
        const box: Box = { col: list + 1, row: g.pt + k * g.PS + 1, w: g.P - 2, h: g.PH - 2 }
        const text = screenText(words, columns, box)
        if (/\d/.test(text.split('\n')[0]!.replace(/todo\S*|npm test.*/, ''))) throw new Error(`${columns}×${rows}: panel ${i}.${k} keeps a count: ${text}`)
      }
    }
    const read: Box = { col: g.panelL + 1, row: g.pt + g.PS + 1, w: g.P - 2, h: g.PH - 2 }
    if (!screenText(words, columns, read).includes('todo.ts')) throw new Error(`${columns}×${rows}: the read station lost its label`)
    const b = boardOf(g, BARE, memoryOf(BARE, T), T, new Set(WALL))
    expect(b.marks.length).toBe(2)
    expect(b.elapsed).toBe(null)
    expect(b.checks).toBe(null)
    // The context bar still fills on the worker's monitor: its ▆ cells are there, the reading is not.
    const sc = g.worker.screen
    expect(screenText(words, columns, sc).split('\n')[0]!.startsWith('ctx ')).toBe(true)
  }
  // The rack's speed row goes with `decode`, the memory row with `memory`; the screen keeps the bar.
  const g = geometry(100, 24)
  const rack: Box = { col: g.rack.col + 1, row: g.pt + 1, w: g.rack.w - 2, h: 3 }
  const only = (f: Fact[]) => screenText(decode(drawCtx({ columns: 100, rows: 24, shown: f })), 100, rack)
  expect(only([]).includes('30 tok/s') && only([]).includes('43/64 GB')).toBe(true)
  expect(only(['decode']).includes('tok/s')).toBe(false)
  expect(only(['decode']).includes('43/64 GB')).toBe(true)
  expect(only(['memory']).includes('GB')).toBe(false)
})

test('office-hd: with the hand-off claimed the models go from the desk labels and your monitor, your activity stays', () => {
  for (const [columns, rows] of [[80, 15], [100, 24], [144, 24], [60, 10]] as const) {
    const g = geometry(columns, rows)
    for (const you of [YOU_THINKING, YOU_TOOL, YOU_WAITING, { state: 'idle', since: T - 60, turns: 0, model: 'claude-opus-5-5' } as You]) {
      const free = decode(drawCtx({ columns, rows, you }))
      const words = decode(drawCtx({ columns, rows, you, shown: ['handoff'] }))
      expect(allText(free, columns).includes('opus 5')).toBe(true)
      const all = allText(words, columns)
      for (const bit of ['opus 5', 'qwen coder']) if (all.includes(bit)) throw new Error(`${columns}×${rows} (${you.state}): ${bit} is still printed`)
      const labels = rowText(words, columns, g.labelRow)
      expect(labels.startsWith(' you ')).toBe(true)
      expect(labels.includes('worker')).toBe(true)
      // The rack keeps its label.
      const mid = (w: Uint32Array) => rowText(w, columns, g.labelRow).slice(g.orch.zone[1] + 1, g.worker.zone[0])
      expect(mid(words)).toBe(mid(free))
      expect(/\w/.test(mid(words))).toBe(true)
      // Your monitor starts with your activity.
      const first = screenText(words, columns, g.orch.screen).split('\n')[0]!
      const want = you.state === 'thinking' ? 'thinking' : you.state === 'tool' ? 'Bash' : you.state === 'waiting' ? 'waiting' : null
      if (want && !first.includes(want)) throw new Error(`${columns}×${rows}: your monitor starts ${first}`)
    }
  }
})

test('office-hd: the board shows the tally, the star after a flip and the parcels; elapsed in its corner unless claimed', () => {
  for (const [columns, rows] of [[80, 15], [100, 24], [144, 24], [60, 17]] as const) {
    const g = geometry(columns, rows)
    const m = memoryOf(RUNNING, T)
    const b = boardOf(g, RUNNING, m, T)
    expect(b.face != null).toBe(true)
    expect(b.marks.map(x => x.ok)).toEqual([false, false])
    expect(b.star).toBe(null)
    expect(b.parcels.length).toBe(2)
    // Drawn: one ▌ stroke a run, red for these two failing runs.
    const words = decode(drawCtx({ columns, rows }))
    for (const mk of b.marks) {
      const k = (mk.row * columns + mk.col) * 3
      expect(words[k]).toBe(0x258c)
      expect(words[k + 1]).toBe(NIGHT.bad)
    }
    // After the flip: a gold star, kept for the rest of the run.
    const cm = memoryOf(CELEB, T + 120)
    const cb = boardOf(g, CELEB, cm, T + 120)
    expect(cb.star != null).toBe(true)
    const cw = decode(drawCtx({ s: CELEB, columns, rows, t: T + 120 }))
    const sk = (cb.star![1] * columns + cb.star![0]) * 3
    expect(String.fromCodePoint(cw[sk]!)).toBe('★')
    expect(cw[sk + 1]).toBe(NIGHT.warn)
    // The elapsed time sits in the face's top right corner; claimed, it goes and the face narrows.
    expect(b.elapsed!.row).toBe(1)
    expect(b.elapsed!.col + b.elapsed!.text.length).toBe(b.face!.col + b.face!.w - 1)
    const c2 = boardOf(g, RUNNING, m, T, new Set<Fact>(['elapsed']))
    expect(c2.elapsed).toBe(null)
    expect(rowText(decode(drawCtx({ columns, rows, shown: ['elapsed'] })), columns, 1).includes('21m00s')).toBe(false)
    // Parcels: one a commit, at most MAX_PARCELS.
    expect(boardOf(g, BUSY, memoryOf(BUSY, T), T).parcels.length <= MAX_PARCELS).toBe(true)
  }
  // No runs, no commits, no tsc: no board; the elapsed time alone keeps its badge, claimed it goes too.
  const plain: Summary = { ...RUNNING, tests: [], tsc: [], git: null }
  const g = geometry(80, 15)
  const alone = boardOf(g, plain, memoryOf(plain, T), T)
  expect(alone.marks.length + alone.parcels.length).toBe(0)
  expect(alone.shelf).toBe(null)
  expect(alone.face!.w).toBe('◷ 21m00s'.length + 2)
  const bare = boardOf(g, plain, memoryOf(plain, T), T, new Set<Fact>(['elapsed']))
  expect(bare.face).toBe(null)
  expect(bare.shelf).toBe(null)
})

test('office-hd: each run-memory object appears with its field, and only then', () => {
  for (const [columns, rows] of [[80, 15], [100, 24], [144, 24], [60, 15]] as const) {
    const g = geometry(columns, rows)
    for (const s of [RUNNING, CELEB, BUSY, FAILED]) {
      const m = memoryOf(s, T)
      const pr = props(g, m)
      expect(pr.mugs.length).toBe(m.mugs)
      expect(pr.notes.length).toBe(Math.min(MAX_NOTES, m.failing))
      expect(pr.crumples.length).toBe(m.crumples)
      expect(pr.bin != null).toBe(m.crumples > 0)
      expect(pr.pages != null).toBe(m.pages > 0)
      if (pr.pages) expect(pr.pages.h).toBe(m.pages)
      // Drawn in their roles: mugs MUG, the paper stack and the crumples paper, notes BAD.
      if (activity(s, T).state === 'done') continue // the room is dimmed: the colours are shades
      const cells = drawCtx({ s, columns, rows })
      for (const b of pr.mugs) expect(boxColours(cells, columns, pxCells(b)).has(MUG)).toBe(true)
      if (pr.pages) expect(boxColours(cells, columns, pxCells(pr.pages)).has(SHEET)).toBe(true)
      if (pr.bin) expect(boxColours(cells, columns, pxCells(pr.crumples[0]!)).has(SHEET)).toBe(true)
      for (const b of pr.notes) expect(boxColours(cells, columns, pxCells(b)).has(NIGHT.bad)).toBe(true)
    }
    // Nothing to show, nothing drawn: a fresh run has no mugs, stack, bin or notes.
    const fresh = props(g, memoryOf({ ...RUNNING, turns: 3, tool_counts: [], tests: [], errors: 0, denials: 0 }, T))
    expect(fresh.mugs.length + fresh.crumples.length + fresh.notes.length).toBe(0)
    expect(fresh.pages == null && fresh.bin == null).toBe(true)
  }
  // A stalled run with no mug yet gets one, for the steam.
  expect(props(geometry(80, 15), memoryOf({ ...THINKING, turns: 2 }, T), { stalled: true }).mugs.length).toBe(1)
  // The light palette keeps the paper stack on half cells.
  expect(props(geometry(80, 15), memoryOf(RUNNING, T), { light: true }).pages!.h % 2).toBe(0)
})

test('office-hd: the worker cheers after the flip and the sticky notes fall away', () => {
  for (const [columns, rows] of [[80, 15], [100, 24]] as const) {
    const g = geometry(columns, rows)
    const d = g.worker
    // Both hands over the head on the cheering frames (frame 12: up; 15: down).
    const hand = { col: (2 * d.rel0 + 1 - 9) >> 1, row: d.head.y / 4 - 1 }
    const at = (frame: number, t: number) => decode(drawCtx({ s: CELEB, columns, rows, frame, t }))
    const fg = (w: Uint32Array) => [w[(hand.row * columns + hand.col) * 3 + 1], w[(hand.row * columns + hand.col) * 3 + 2]]
    expect(fg(at(12, T + 5)).includes(SKIN)).toBe(true)
    expect(fg(at(15, T + 5)).includes(SKIN)).toBe(false)
    // Long after the flip, no more cheering.
    expect(fg(at(12, T + 120)).includes(SKIN)).toBe(false)
    // The notes the red run left (4) fall from the monitor's side in the first seconds, then are gone.
    const notes = props(g, memoryOf(CELEB, T), { failing: 4 }).notes
    const red = (w: Uint32Array) => notes.some(b => {
      const c = pxCells(b)
      const col = c.col + c.w - 1 // the note's whole cell (the other is half bezel)
      return [w[(c.row * columns + col) * 3 + 1], w[(c.row * columns + col) * 3 + 2]].some(x => x != null && x !== NONE && ((x >> 16) & 255) > 150 && ((x >> 16) & 255) > 2 * ((x >> 8) & 255))
    })
    expect(red(at(12, T - 1 + 0.1))).toBe(true)
    expect(red(at(12, T + 10))).toBe(false)
  }
})

test('office-hd: once done the printed slip slides back along the floor and rests on your desk with a stamp', () => {
  // An idle orchestrator: your desk stands, its power lamp (in the slip's cells) not lit green.
  const you: You = { state: 'idle', since: T - 9, turns: 0 }
  for (const [columns, rows] of [[80, 15], [100, 24], [60, 10]] as const) {
    const g = geometry(columns, rows)
    const done = FINISHED.last_ts!
    // Sliding: white paper on the floor band between the desks, none on your desk yet.
    const sliding = decode(drawCtx({ s: FINISHED, columns, rows, t: done + SLIP_SECS / 2, frame: 0, you }))
    let onFloor = 0
    for (let col = g.orch.zone[1]; col < g.worker.zone[0]; col++) if (sliding[(g.F * columns + col) * 3 + 1] === SHEET) onFloor++
    expect(onFloor > 0).toBe(true)
    const slip = pxCells(slipBox(g))
    expect(boxColours(drawCtx({ s: FINISHED, columns, rows, t: done + SLIP_SECS / 2, frame: 0, you }), columns, slip).has(NIGHT.good)).toBe(false)
    // Resting: on your desk, a green stamp for a success, red for a failure.
    expect(boxColours(drawCtx({ s: FINISHED, columns, rows, frame: 0, you }), columns, slip).has(NIGHT.good)).toBe(true)
    expect(boxColours(drawCtx({ s: FAILED, columns, rows, frame: 0, you }), columns, slip).has(NIGHT.bad)).toBe(true)
    // While the run is live there is no slip.
    expect(boxColours(drawCtx({ columns, rows, you }), columns, { ...slip, w: 1 }).has(NIGHT.good)).toBe(false)
  }
})

test('office-hd: solo the slip rests on the worker’s desk at once, stamped on its outer cell', () => {
  for (const [columns, rows] of [[80, 15], [100, 24], [60, 10]] as const) {
    const g = geometry(columns, rows, false)
    const slip = slipBox(g)
    // On the worker's desk top, in front of its monitor, clear of the hand-off's path on the floor.
    expect(slip.x >= g.worker.zone[0] * 2 && slip.x + slip.w <= (g.worker.zone[1] + 1) * 2).toBe(true)
    expect(slip.y).toBe((g.D - 1) * 4 + 2)
    const done = FINISHED.last_ts!
    const early = decode(drawCtx({ s: FINISHED, columns, rows, t: done + SLIP_SECS / 2, frame: 0 }))
    for (let col = 0; col < g.worker.zone[0]; col++) expect(early[(g.F * columns + col) * 3 + 1] === SHEET).toBe(false)
    expect(boxColours(drawCtx({ s: FINISHED, columns, rows, t: done + SLIP_SECS / 2, frame: 0 }), columns, pxCells(slip)).has(NIGHT.good)).toBe(true)
    // The stamp sits on the slip's outer cell, toward the worker's chair.
    const outer = pxCells({ ...slip, x: slip.x + slip.w - 2, w: 2 })
    expect(boxColours(drawCtx({ s: FAILED, columns, rows, frame: 0 }), columns, outer).has(NIGHT.bad)).toBe(true)
  }
})

/** The sub-pixel boxes of the room's fixed objects and the run memory's, for the overlap test. */
function objects(g: Geometry, s: Summary, columns: number, t = T): [string, Px][] {
  const m = memoryOf(s, t)
  const out: [string, Px][] = []
  const add = (name: string, b: Px | null | undefined) => b && b.w > 0 && b.h > 0 && out.push([name, b])
  const ring = (b: Box): Px => ({ x: b.col * 2 + 1, y: b.row * 4 + 2, w: b.w * 2 - 2, h: (b.h - 1) * 4 })
  for (const [name, d] of (g.solo ? [['worker', g.worker]] : [['orch', g.orch], ['worker', g.worker]]) as [string, Geometry['worker']][]) {
    const sc = d.screen
    const x0 = d.dir > 0 ? sc.col * 2 - 1 : (sc.col - 1) * 2
    add(`${name} monitor`, { x: x0, y: d.top * 4 + 2, w: (sc.w + 1) * 2 + 1, h: (g.D - 1 - d.top) * 4 })
    const X = (dx: number, w: number) => (d.dir > 0 ? 2 * d.rel0 + dx : 2 * d.rel0 + 2 - dx - w)
    const sm = 7 + ((sc.w + 2) >> 1) - 1
    add(`${name} stand`, { x: X(sm * 2, 4), y: (g.D - 1) * 4 + 2, w: 4, h: 2 })
    add(`${name} plank`, { x: Math.min(X(10, 2 * (sc.w + 4)), X(10, 2 * (sc.w + 4))), y: g.D * 4, w: 2 * (sc.w + 4), h: 4 })
    add(`${name} leg`, { x: X(14, 1), y: g.D * 4 + 4, w: 1, h: (g.F - g.D - 1) * 4 })
    add(`${name} far leg`, { x: X(2 * (8 + sc.w) + 1, 1), y: g.D * 4 + 4, w: 1, h: (g.F - g.D - 1) * 4 })
    add(`${name} shoe`, { x: X(10, 4), y: (g.F - 1) * 4 + 2, w: 4, h: 2 })
    add(`${name} riser`, { x: d.riser * 2 + (d.dir > 0 ? 0 : 1), y: 4, w: 1, h: (d.top - 1) * 4 })
  }
  // Solo the slip rests where the sheet does; the two are never drawn together (the sheet only while live).
  add('sheet', { x: 2 * g.worker.rel0 + 2 - 16 - 4, y: (g.D - 1) * 4 + 2, w: 4, h: 2 })
  if (!g.solo) add('slip', slipBox(g))
  add('cat', catBox(g, columns))
  if (g.size !== 'compact') {
    for (const [i, col] of [g.panelL, g.panelL, g.panelL, g.panelR, g.panelR, g.panelR].entries()) add(`panel ${i}`, ring({ col, row: g.pt + (i % 3) * g.PS, w: g.P, h: g.PH }))
  }
  add('rack', { x: g.rack.col * 2 + 1, y: g.pt * 4 + 2, w: g.rack.w * 2 - 2, h: (g.F - g.pt) * 4 - 2 })
  const pk = pumpkinCells(g)
  const b = boardOf(g, s, m, t, undefined, pk)
  if (b.face) add('board', ring(b.face))
  add('shelf', b.shelf)
  b.parcels.forEach((p, i) => add(`parcel ${i}`, p))
  const pr = props(g, m)
  pr.mugs.forEach((p, i) => add(`mug ${i}`, p))
  add('pages', pr.pages)
  add('bin', pr.bin)
  pr.crumples.forEach((p, i) => add(`crumple ${i}`, p))
  pr.notes.forEach((p, i) => add(`note ${i}`, p))
  if (g.window) add('window', { x: (g.window.c0 - 1) * 2, y: 3, w: (g.window.c1 - g.window.c0 + 3) * 2, h: (g.window.sky + 1) * 4 })
  if (g.plant) {
    add('pot', g.plant.pot)
    g.plant.leaves.forEach((b, i) => add(`leaf ${i}`, b))
  }
  return out
}

test('office-hd: no object overlaps another or reaches past the canvas, at every size, width and palette', () => {
  const pumpkinDay = new Date(2026, 9, 31, 12).getTime() / 1000
  for (const rows of [...SIZES, 11, 17, 30]) {
    for (const [columns, withYou] of [60, 61, 62, 70, 80, 100, 120, 144, 200].flatMap(c => [[c, true], [c, false]] as [number, boolean][])) {
      const g = geometry(columns, rows, withYou)
      for (const s of [RUNNING, CELEB, BUSY, FAILED, FINISHED]) {
        const objs = objects(g, s, columns)
        const pk = pumpkinCells(g)
        const halloween = boardOf(g, s, memoryOf(s, pumpkinDay), pumpkinDay, undefined, pk)
        if (pk) objs.push(['pumpkin', { x: pk.col * 2, y: pk.row * 4 + 2, w: 6, h: 4 }])
        if (halloween.shelf) objs.push(['halloween shelf', halloween.shelf])
        for (const [name, b] of objs) {
          if (b.x < 0 || b.y < 0 || b.x + b.w > columns * 2 || b.y + b.h > g.labelRow * 4) throw new Error(`${columns}×${rows}${withYou ? '' : ' solo'}: ${name} at ${JSON.stringify(b)} leaves the room`)
        }
        for (let i = 0; i < objs.length; i++) {
          for (let j = i + 1; j < objs.length; j++) {
            const [na, a] = objs[i]!
            const [nb, b] = objs[j]!
            if (na === 'shelf' && nb === 'halloween shelf') continue
            if ((na === 'shelf' || nb === 'shelf') && (na === 'pumpkin' || nb === 'pumpkin')) continue // not drawn together: the shelf moves on 31 October
            if (overlap(a, b)) throw new Error(`${columns}×${rows}${withYou ? '' : ' solo'}: ${na} ${JSON.stringify(a)} overlaps ${nb} ${JSON.stringify(b)}`)
          }
        }
      }
    }
  }
  // Every palette draws every size and width without a cell past the canvas.
  for (const p of Object.values(PALETTES)) {
    for (const rows of SIZES) {
      for (const columns of [60, 80, 100, 144, 200]) {
        for (const s of [CELEB, BUSY, FINISHED]) expect(decode(drawCtx({ s, columns, rows, palette: p, transparent: false })).length).toBe(columns * rows * 3)
      }
    }
  }
})

/** Cell boxes: the cat's (from its sub-pixel box), the window with its sill and lights, the pumpkin's. */
function catCells(g: Geometry, columns = g.C): Box | null {
  const b = catBox(g, columns)
  return b && pxCells(b)
}
function windowCells(g: Geometry): Box | null {
  const w = g.window
  return w && { col: w.c0 - 1, row: w.top, w: w.c1 - w.c0 + 3, h: w.sky + 2 }
}
const within = (bs: (Box | null)[], col: number, row: number) => bs.some(b => b != null && col >= b.col && col < b.col + b.w && row >= b.row && row < b.row + b.h)

/** The cells (column, row) where two encoded frames differ. */
function changed(a: string, b: string, columns: number): [number, number][] {
  const A = decode(a)
  const B = decode(b)
  expect(A.length).toBe(B.length)
  const out: [number, number][] = []
  for (let i = 0; i < A.length / 3; i++) {
    if (A[i * 3] !== B[i * 3] || A[i * 3 + 1] !== B[i * 3 + 1] || A[i * 3 + 2] !== B[i * 3 + 2]) out.push([i % columns, Math.floor(i / columns)])
  }
  return out
}

test('office-hd: the cat sits on the floor line beside the rack, clear of the panels, the rack, the desks and the labels', () => {
  for (const rows of [officeHd.rows.standard, officeHd.rows.large, 17, 30]) {
    // From 62 columns; at 60 and 61 the wall between the desks is too narrow for it.
    for (const columns of [60, 61]) expect(catBox(geometry(columns, rows), columns)).toBe(null)
    for (let columns = 62; columns <= 220; columns++) {
      const g = geometry(columns, rows)
      const b = catBox(g, columns)
      if (!b) throw new Error(`no cat at ${columns}×${rows}`)
      expect(b.x + b.w <= g.rack.col * 2 - 2).toBe(true) // a cell clear of the rack's frame
      expect(b.x > (g.orch.zone[1] + 1) * 2).toBe(true)
      expect(b.x + b.w <= columns * 2).toBe(true)
      expect(b.y + b.h).toBe(g.F * 4) // on the floor line, not through it
      const lowest = g.pt + 2 * g.PS + g.PH - 1 // the lowest panel's bottom ring row: its bezel in the top half
      expect(b.y >= lowest * 4 + 2).toBe(true) // under that bezel, not on it
      expect(b.x % 2 === 0 && b.y % 2 === 0).toBe(true) // whole half cells: ▀ ▄ █ only
    }
  }
  expect(catBox(geometry(80, officeHd.rows.compact))).toBe(null)
  expect(catBox(geometry(40, officeHd.rows.standard), 40)).toBe(null)
  // Drawn: the floor line runs on under the cat, its last row of pixels just above the line.
  const g = geometry(80, 15)
  const b = catBox(g)!
  const words = decode(drawCtx({}))
  for (let col = b.x >> 1; col < (b.x + b.w) >> 1; col++) expect(words[(g.F * 80 + col) * 3 + 1]).toBe(NIGHT.ground)
})

test('office-hd: the cat sleeps while the worker thinks and sits up, eyes open, during a tool call', () => {
  const p = NIGHT
  for (const [columns, rows] of [[80, officeHd.rows.standard], [100, officeHd.rows.large], [144, officeHd.rows.large]] as [number, number][]) {
    const b = catCells(geometry(columns, rows))!
    const sit = boxColours(drawCtx({ columns, rows }), columns, b)
    const nap = boxColours(drawCtx({ columns, rows, s: THINKING }), columns, b)
    expect(sit.has(p.ink) && sit.has(p.inkDim)).toBe(true)
    expect(nap.has(p.inkDim)).toBe(true)
    expect(nap.has(p.ink)).toBe(false)
    // Done: still there, dimmed with the room.
    expect(boxColours(drawCtx({ columns, rows, s: FINISHED }), columns, b).has(p.inkDim)).toBe(false)
  }
})

test('office-hd: seasons and holidays change only the window, the pumpkin on the worker monitor and the shelf beside it', () => {
  const at = (y: number, m: number, d: number, h = 12, s = 0) => new Date(y, m - 1, d, h, 0, s).getTime() / 1000
  const times = [T, at(2026, 7, 15), at(2026, 7, 15, 2), at(2026, 10, 31), at(2026, 12, 24), at(2027, 1, 1, 0, 4)]
  for (const [columns, rows, you] of [[60, 15], [80, 15], [100, 24], [144, 24], [80, 10]].flatMap(([c, r]) => [[c, r, YOU_THINKING], [c, r, undefined]]) as [number, number, You | undefined][]) {
    const g = geometry(columns, rows, you != null)
    for (const t of times) {
      const s = { ...RUNNING, mtime: t - 2, last_ts: t - 2 }
      const none = drawCtx({ columns, rows, t, s, season: 'none', you })
      // On 31 October a shelf down at the pumpkin's rows moves right of it: its row may change too.
      const sr = boardOf(g, s, memoryOf(s, t), t).shelf
      const shelfRow: Box | null = sr && { col: 0, row: sr.y >> 2, w: columns, h: 1 }
      for (const season of [undefined, 'winter', 'spring', 'summer', 'autumn']) {
        for (const [x, y] of changed(none, drawCtx({ columns, rows, t, s, season: season as string, you }), columns)) {
          if (!within([windowCells(g), pumpkinCells(g), shelfRow], x, y)) throw new Error(`${season} at ${columns}×${rows}, ${new Date(t * 1000)}: cell ${x},${y}`)
        }
      }
    }
  }
})

test('office-hd: the pumpkin sits on the worker monitor on 31 October; the lights hang on the window', () => {
  const S = seasonTones(NIGHT)
  const t = new Date(2026, 9, 31, 12).getTime() / 1000
  const g = geometry(80, 15)
  const pk = pumpkinCells(g)!
  const cells = drawCtx({ t, s: { ...RUNNING, mtime: t - 2, last_ts: t - 2 }, season: undefined })
  const pc = boxColours(cells, 80, pk)
  expect(pc.has(S.pumpkin[0]) && pc.has(S.pumpkin[1]) && pc.has(S.pumpkin[2])).toBe(true)
  // Clear of the monitor's screen and its riser.
  expect(pk.row + pk.h - 1).toBe(g.worker.top)
  expect(pk.col + pk.w <= g.worker.screen.col + g.worker.screen.w).toBe(true)
  expect(g.worker.riser < pk.col || g.worker.riser >= pk.col + pk.w).toBe(true)
  const xmas = new Date(2026, 11, 24, 21).getTime() / 1000
  for (const you of [YOU_THINKING, undefined]) {
    const w = geometry(80, 15, you != null).window!
    const lit = boxColours(drawCtx({ t: xmas, frame: 0, s: { ...RUNNING, mtime: xmas - 2, last_ts: xmas - 2 }, season: undefined, you }), 80, { col: w.c0, row: 0, w: w.c1 - w.c0 + 1, h: 1 })
    expect(lit.has(S.lights[0]!)).toBe(true)
  }
})

test('office-hd: paper and phosphor draw the cat and the room from their roles', () => {
  for (const id of ['paper', 'phosphor'] as const) {
    const p = PALETTES[id]
    const cells = drawCtx({ palette: p, transparent: false, columns: 100, rows: 24 })
    const cat = boxColours(cells, 100, catCells(geometry(100, 24))!)
    expect(cat.has(p.inkDim) && cat.has(p.ink)).toBe(true)
    const all = new Set(decode(cells))
    expect(all.has(p.wall) && all.has(p.desk) && all.has(p.mon)).toBe(true)
    for (const c of [NIGHT.wall, NIGHT.desk, NIGHT.mon]) expect(all.has(c)).toBe(false)
  }
})
