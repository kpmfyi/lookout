// The showcase's wall screens (docs/DESIGN.md 39): what a tall scene hangs on the wall above its room,
// drawn in the panel's slate frames (hooks/panel.ts `plate`) so they match the instrument modules.
// - The thinking screen (docs/DESIGN.md 40): the thinking in plain words when the pane has them
//   (`in plain words · 20s ago`), then the highlighted gist of the latest thinking (hooks/thought.ts;
//   with no thinking, the latest reply's), its newest lines; a screen taller than that gives the rows
//   over the gist to the run's earlier thoughts (·) and replies (»), a line each, dim.
// - The departures board: the recent tool calls as rows, newest at the top: the time, a mark (✓, ✖,
//   or a spinner for the call still running), the class's glyph in its colour, the label, and the
//   duration on the right.
// - The details screen: the last command's output tail.
// - The files screen: the files edited, most-touched first, the edit count and a bar for each.
// - An instrument row: modules (hooks/modules) packed side by side in one row, each in a slot that
//   holds for the run; a slot whose reading is absent is a dark plate with its title dim.
// The call still running is the activity, whose one home is the caption (docs/DESIGN.md 31): the
// board lists it only when the caption does not already spell its label out (ambient's plain
// caption, "running the tests"), and never with its seconds.
import type { Summary, ToolClass, WatchEvent } from '../../types'
import type { Activity } from '../activity.ts'
import { CLASS_GLYPH, G } from '../glyphs.ts'
import { gist, highlight, wrapRuns } from '../thought.ts'
import type { Role, Run } from '../thought.ts'
import { fmtDur, toolClass } from '../activity.ts'
import { GUTTER, drawGrid } from '../grid.ts'
import type { HiCanvas } from '../hicanvas.ts'
import { MODULES } from '../modules/index.ts'
import type { ModuleCtx } from '../modules/index.ts'
import { clamp, cut, lit, meter, mix, plate, write, writeRight } from '../panel.ts'
import type { CellBox, PanelTones, RGB } from '../panel.ts'

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The smallest thinking screen: the frame, the title and two lines. */
export const THINK_MIN_H = 5
/** The smallest departures board: the frame, the title and four calls; the most calls it lists. */
export const BOARD_MIN_H = 7
export const BOARD_MAX_ROWS = 10
/** The smallest details screen: the frame, the title and three lines. */
export const DETAILS_MIN_H = 6
/** Rows of one instrument row (the modules' `minH`), and the narrowest slot in it. */
export const MOD_H = 5
export const SLOT_MIN_W = 14

// ── Words for a screen.

/**
 * Prose for a screen: control characters and terminal escapes gone, tabs as spaces, and the light
 * markdown noise dropped (leading `#` and list stars, emphasis stars and underscores, backticks), one
 * entry per paragraph, blank ones left out.
 */
export function prose(text: string): string[] {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
    .split('\n')
    .map(line =>
      line
        .replace(/^\s*#+\s*/, '')
        .replace(/^\s*[*+]\s+/, '- ')
        .replace(/\*\*|__|`/g, '')
        .replace(/(^|\s)\*(\S)/g, '$1$2')
        .replace(/(\S)\*(?=\s|$|[.,;:!?])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

/** The newest event of `kind`'s time, or null. */
export function newestAt(s: Summary, kind: WatchEvent['kind']): number | null {
  return (s.events ?? []).findLast(ev => ev.kind === kind)?.t ?? null
}

/** The plain words as the scenes get them (docs/DESIGN.md 40.2): highlighted runs, their time, and whether a newer answer is on its way. */
export type Plain = { runs: Run[]; t: number; stale: boolean }

/** A row of the thinking screen: its runs and the layer it belongs to. */
export type ThinkRow = { runs: Run[]; layer: 'plain' | 'gist' | 'history' | 'gap' }

/**
 * The earlier thoughts and replies, oldest first, one line each with its mark (· a thought, » a
 * reply): the timeline's think and text rows, less the one the screen shows (its line opens it).
 */
export function historyOf(s: Summary, shown: string): string[] {
  const whole = shown.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (const e of s.events ?? []) {
    if (e.kind !== 'think' && e.kind !== 'text') continue
    const label = prose(e.label).join(' ')
    if (!label) continue
    if (whole.startsWith(label.replace(/…$/, ''))) continue
    out.push(`${e.kind === 'think' ? '·' : '»'} ${label}`)
  }
  return out
}

/**
 * What the thinking screen shows in `w × h` (docs/DESIGN.md 39, 40): the title, then the plain
 * words when there are any (`in plain words · 20s ago`; their rows dimmed while stale; whole, before
 * anything else), a blank row, and the highlighted gist of the latest thinking filling the rest when
 * two rows are left for it, its newest lines (`thinking · 20s
 * ago`; with no thinking, the latest reply's). Rows still to spare go to the run's earlier thoughts
 * and replies, a line each, over the gist. Null with nothing to read.
 */
export function thinkingScreen(s: Summary, t: number, w: number, h: number, plain?: Plain | null): { title: string; stale: boolean; rows: ThinkRow[] } | null {
  const think = (s.thinking ?? '').trim()
  const source = think || (s.text ?? '').trim()
  const words = plain && plain.runs.some(r => r.text.trim()) ? plain : null
  if (!source && !words) return null
  const age = (at: number | null) => (at != null ? ` · ${fmtDur(Math.max(0, t - at))} ago` : '')
  const title = words ? `in plain words${age(words.t)}` : think ? `thinking${age(newestAt(s, 'think'))}` : `latest reply${age(newestAt(s, 'text'))}`
  const rows: ThinkRow[] = []
  if (w <= 0 || h <= 0) return { title, stale: words?.stale ?? false, rows }
  if (words) {
    // The plain words first, and whole: the gist gets the rows under them only when two are left
    // after a blank one; words still too long for the screen end in `…`.
    const lines = wrapRuns(words.runs, w)
    const shown = lines.slice(0, h)
    if (lines.length > h) {
      const last = shown[h - 1]!.slice()
      const end = last.at(-1)
      if (end) last[last.length - 1] = { ...end, text: cut(`${end.text}…`, Math.max(1, w - last.slice(0, -1).reduce((n, r) => n + [...r.text].length, 0))) }
      shown[h - 1] = last
    }
    for (const line of shown) rows.push({ runs: line, layer: 'plain' })
    if (!source || rows.length + 3 > h) return { title, stale: words.stale, rows }
    rows.push({ runs: [], layer: 'gap' })
  }
  const rest = h - rows.length
  if (source && rest > 0) {
    const lines = wrapRuns(highlight(gist(source, rest * w)), w)
    const gistRows = lines.slice(Math.max(0, lines.length - rest)).map(line => ({ runs: line, layer: 'gist' as const }))
    const spare = rest - gistRows.length - 1
    const past = spare > 0 ? historyOf(s, source).slice(-spare) : []
    for (const line of past) rows.push({ runs: [{ text: cut(line, w), role: 'plain' }], layer: 'history' })
    if (past.length) rows.push({ runs: [], layer: 'gap' })
    rows.push(...gistRows)
  }
  return { title, stale: words?.stale ?? false, rows }
}

// ── The screens.

/** A run's ink on a screen (docs/DESIGN.md 40.1): the meaning colours, the bright ink for intent, the code ink for names. */
function roleInk(role: Role, base: RGB, P: PanelTones): RGB {
  switch (role) {
    case 'problem':
      return P.red
    case 'good':
      return P.green
    case 'unsure':
      return P.amber
    case 'intent':
      return P.ink
    case 'name':
      return P.classes.web
    default:
      return base
  }
}

/**
 * The thinking screen over `box` (`thinkingScreen` lays it out): the plain words and the gist in
 * their roles' colours, the earlier lines in dim phosphor, a cursor after the newest line while the
 * model writes.
 */
export function drawThinking(c: HiCanvas, box: CellBox, s: Summary, a: Activity, t: number, frame: number, P: PanelTones, plain?: Plain | null): void {
  const done = a.state === 'done'
  const inner = { w: Math.max(0, box.w - 2), h: Math.max(0, box.h - 3) }
  const what = thinkingScreen(s, t, inner.w, inner.h, plain)
  const cb = plate(c, box, what?.title ?? 'thinking', undefined, undefined, P)
  if (cb.w <= 0 || cb.h <= 0) return
  if (!what) {
    write(c, cb.col, cb.row, cb.w, s.exists ? 'nothing to read yet' : 'no log yet', P.phosphorDim, undefined, P)
    return
  }
  // The gist in a soft light ink (a reply's in phosphor), the plain words in the screen's ink;
  // everything quieter once the run is over, and the plain words dimmed while a newer answer is due.
  const think = !!(s.thinking ?? '').trim()
  const fade = (col: RGB, by: number) => (by > 0 ? mix(col, P.screen, by) : col)
  const doneBy = done ? 0.4 : 0
  const gistBase = think ? mix(P.ink, P.screen, 0.2) : P.phosphor
  what.rows.forEach((row, i) => {
    if (row.layer === 'gap') return
    if (row.layer === 'history') {
      write(c, cb.col, cb.row + i, cb.w, row.runs[0]?.text ?? '', P.phosphorDim, undefined, P)
      return
    }
    const base = row.layer === 'plain' ? P.ink : gistBase
    const by = Math.max(doneBy, row.layer === 'plain' && what.stale ? 0.45 : 0)
    let x = 0
    for (const run of row.runs) {
      if (x >= cb.w) break
      x += write(c, cb.col + x, cb.row + i, cb.w - x, run.text, fade(roleInk(run.role, base, P), by), undefined, P)
    }
  })
  // A cursor after the newest line while the model writes (the screen's motion).
  const last = what.rows.length - 1
  if (a.state === 'thinking' && last >= 0 && what.rows[last]!.layer === 'gist' && frame % 6 < 3) {
    const n = what.rows[last]!.runs.reduce((k, r) => k + [...r.text].length, 0)
    const ink = fade(gistBase, doneBy)
    if (n + 1 < cb.w) c.rect((cb.col + n + 1) * 2, (cb.row + last) * 4, 1, 4, ink)
    else if (what.rows.length < cb.h) c.rect(cb.col * 2, (cb.row + what.rows.length) * 4, 1, 4, ink)
  }
}

/** A tool call's duration for a board row: tenths under ten seconds, whole seconds under a minute, then minutes. */
export function callDur(secs: number): string {
  return secs < 10 ? `${secs.toFixed(1)}s` : fmtDur(secs)
}

/** The local time of day, hh:mm. */
function hhmm(t: number): string {
  const d = new Date(t * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const base = (path: string): string => path.split('/').at(-1) ?? path

/**
 * The calls the board lists, newest first, at most `n`: the finished ones, and the one still running
 * only when the caption (`a.text`) does not already spell its label out.
 */
export function departures(s: Summary, a: Activity, n: number): WatchEvent[] {
  const out: WatchEvent[] = []
  const ev = s.events ?? []
  for (let i = ev.length - 1; i >= 0 && out.length < n; i--) {
    const e = ev[i]!
    if (e.kind !== 'tool') continue
    if (e.status === 'running' && (a.state === 'done' || !e.label || (a.text ?? '').includes(e.label))) continue
    out.push(e)
  }
  return out
}

/**
 * The departures board over `box`: the recent tool calls, newest at the top. The class column is the
 * class's glyph alone, as office-hd's stations show it beside its word (docs/DESIGN.md 41), and the
 * room goes to the label.
 */
export function drawDepartures(c: HiCanvas, box: CellBox, s: Summary, a: Activity, frame: number, P: PanelTones): void {
  const done = a.state === 'done'
  const cb = plate(c, box, 'tool calls', undefined, undefined, P)
  if (cb.w <= 0 || cb.h <= 0) return
  const calls = departures(s, a, Math.min(cb.h, BOARD_MAX_ROWS))
  if (!calls.length) {
    write(c, cb.col, cb.row, cb.w, 'no tool calls yet', P.phosphorDim, undefined, P)
    return
  }
  // The class's glyph in its colour, and the time of day where the board can spare both. Too narrow
  // for them, the time goes first, then the class column; the label then takes the class's colour.
  const tagOf = (cls: ToolClass): string => CLASS_GLYPH[cls]
  const clsOf = (e: WatchEvent): ToolClass => e.cls ?? toolClass(e.tool)
  const durOf = (e: WatchEvent): string => (e.status !== 'running' && e.dur != null ? callDur(e.dur) : e.status === 'denied' ? 'denied' : '')
  const nameW = Math.max(...calls.map(e => [...tagOf(clsOf(e))].length))
  const durW = Math.max(0, ...calls.map(e => [...durOf(e)].length + 1))
  const labelRoom = (clockW: number, tagW: number) => cb.w - clockW - 2 - tagW - durW
  const LABEL_MIN = 8
  let clockW = cb.w >= 26 ? 6 : 0
  let tagW = nameW + 1
  if (labelRoom(clockW, tagW) < LABEL_MIN) clockW = 0
  if (labelRoom(clockW, tagW) < LABEL_MIN) tagW = 0
  calls.forEach((e, i) => {
    const row = cb.row + i
    const newest = i === 0
    let x = cb.col
    if (clockW && e.t != null) write(c, x, row, 5, hhmm(e.t), P.phosphorDim, undefined, P)
    x += clockW
    const running = e.status === 'running'
    const mark: [string, RGB] = running ? [SPIN[frame % SPIN.length]!, P.phosphor] : e.status === 'error' ? [G.failed, P.red] : e.status === 'denied' ? [G.denied, P.amber] : [G.ok, P.green]
    c.text(x, row, mark[0], lit(done, mark[1], P))
    x += 2
    const cls = clsOf(e)
    const clsInk = lit(done, P.classes[cls], P)
    if (tagW) {
      write(c, x, row, tagW - 1, tagOf(cls), clsInk, undefined, P)
      x += tagW
    }
    const dur = durOf(e)
    const right = cb.col + cb.w
    const room = right - x - (dur ? [...dur].length + 1 : 0)
    const label = cls === 'read' || cls === 'edit' ? base(e.label) : e.label
    const ink = tagW ? (newest ? lit(done, P.phosphor, P) : P.phosphorDim) : newest ? clsInk : mix(clsInk, P.screen, 0.35)
    write(c, x, row, room, label.replace(/\s+/g, ' '), ink, undefined, P)
    if (dur) writeRight(c, x, row, right - x, dur, e.status === 'denied' ? lit(done, P.amber, P) : P.phosphorDim, undefined, P)
  })
}

/** The details screen over `box`: the last command's output tail, the newest line brightest. */
export function drawDetails(c: HiCanvas, box: CellBox, s: Summary, a: Activity, frame: number, P: PanelTones): void {
  const done = a.state === 'done'
  const b = s.last_bash
  // The command names the screen unless it is the call running now, whose home is the caption.
  const running = b?.status === 'running' && !done
  const named = b && !(running && (a.text ?? '').includes(b.cmd))
  const title = named ? `$ ${b.cmd.replace(/\s+/g, ' ')}` : 'output'
  const head = !b ? undefined : running ? SPIN[frame % SPIN.length] : b.status === 'error' ? '✖' : '✓'
  const hot = !b ? undefined : running ? P.phosphor : b.status === 'error' ? P.red : P.green
  const cb = plate(c, box, title, head, hot && lit(done, hot, P), P)
  if (cb.w <= 0 || cb.h <= 0) return
  const lines = (b?.out ?? []).map(l => l.replace(/\t/g, '  ').replace(/[\x00-\x1f\x7f]/g, '').trim()).filter(Boolean)
  if (!lines.length) {
    write(c, cb.col, cb.row, cb.w, !b ? 'no command yet' : running ? 'waiting for output' : 'no output', P.phosphorDim, undefined, P)
    return
  }
  const shown = lines.slice(-cb.h)
  shown.forEach((line, i) => write(c, cb.col, cb.row + i, cb.w, line, i === shown.length - 1 ? lit(done, P.phosphor, P) : P.phosphorDim, undefined, P))
}

/** The files screen over `box`: the files edited, most-touched first: the count, a bar against the most-touched, the path (its tail when long). */
export function drawFiles(c: HiCanvas, box: CellBox, s: Summary, a: Activity, P: PanelTones): void {
  const done = a.state === 'done'
  const files = [...(s.files ?? [])].sort((p, q) => q[1] - p[1])
  const cb = plate(c, box, `${G.files} files`, files.length ? String(files.length) : undefined, lit(done, P.phosphor, P), P)
  if (cb.w <= 6 || cb.h <= 0) return
  if (!files.length) {
    write(c, cb.col, cb.row, cb.w, 'no files edited yet', P.phosphorDim, undefined, P)
    return
  }
  const top = files[0]![1] || 1
  const nw = Math.min(4, Math.max(...files.map(f => String(f[1]).length)))
  const bw = clamp(Math.floor(cb.w / 6), 2, 8)
  const edit = lit(done, P.classes.edit, P)
  files.slice(0, cb.h).forEach(([path, n], i) => {
    const row = cb.row + i
    const ink = i === 0 ? lit(done, P.phosphor, P) : P.phosphorDim
    writeRight(c, cb.col, row, nw, String(n), ink, undefined, P)
    meter(c, cb.col + nw + 1, row, bw, n / top, { fill: edit, track: P.track, tones: P })
    const room = cb.w - nw - bw - 2
    if (room <= 0) return
    const name = [...path].length > room ? `…${[...path].slice(-(room - 1)).join('')}` : path
    write(c, cb.col + nw + bw + 2, row, room, name, ink, undefined, P)
  })
}

/** A slot with no reading yet: its frame on a dark face, the title dim, no headline. */
export function offPlate(c: HiCanvas, box: CellBox, title: string, P: PanelTones): void {
  const { col, row, w, h } = box
  if (w < 2 || h < 2) return
  const face = mix(P.screen, P.lampOff, 0.5)
  const X0 = col * 2
  const Y0 = row * 4
  c.rect(X0, Y0, w * 2, h * 4, face)
  c.rect(X0 + w * 2 - 1, Y0 + 2, 1, h * 4 - 2, mix(P.mon, face, 0.25))
  c.rect(X0, Y0 + h * 4 - 2, w * 2, 2, mix(P.mon, face, 0.25))
  c.rect(X0, Y0, w * 2, 2, mix(P.bevel, P.mon, 0.5))
  c.rect(X0, Y0, 1, h * 4 - 2, mix(P.bevel, P.mon, 0.5))
  if (w > 2 && h > 2) write(c, col + 1, row + 1, w - 2, title, mix(P.inkDim, face, 0.35), undefined, P)
}

// ── An instrument row.

/**
 * Modules side by side in `box` (one row, `GUTTER` apart): first fit in the order given, each at its
 * `minW` at least, then the room left spread over them in proportion. Depends on the ids and the box
 * alone, never on the readings, so the slots hold for the run.
 */
export function instrumentRow(ids: readonly string[], box: CellBox): { id: string; box: CellBox }[] {
  const picked: { id: string; w: number }[] = []
  let used = 0
  for (const id of ids) {
    const m = MODULES[id]
    if (!m || m.minH > box.h) continue
    // Room for a title and a headline side by side (`≈ cost  $0.47`), not only the module's least.
    const w = Math.max(m.minW, SLOT_MIN_W)
    const need = w + (picked.length ? GUTTER : 0)
    if (used + need > box.w) continue
    picked.push({ id, w })
    used += need
  }
  if (!picked.length) return []
  const inner = picked.reduce((n, p) => n + p.w, 0)
  const room = box.w - (picked.length - 1) * GUTTER
  let x = box.col
  return picked.map((p, i) => {
    const w = i === picked.length - 1 ? box.col + box.w - x : Math.round((p.w / inner) * room)
    const out = { id: p.id, box: { col: x, row: box.row, w, h: box.h } }
    x += w + GUTTER
    return out
  })
}

/** Draw the modules in their slots: a module with its reading through the grid, a dark plate holding the place of one without. */
export function drawInstruments(c: HiCanvas, slots: { id: string; box: CellBox }[], mctx: ModuleCtx, P: PanelTones): void {
  const live: { id: string; box: CellBox }[] = []
  for (const slot of slots) {
    const m = MODULES[slot.id]
    let on = false
    try {
      on = m != null && m.hasData(mctx)
    } catch {
      on = false
    }
    if (on) live.push(slot)
    else offPlate(c, slot.box, m?.title ?? slot.id, P)
  }
  drawGrid(c, { boxes: live, rows: c.rows, gridCols: 1 }, mctx)
}
