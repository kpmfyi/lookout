// The log parse (docs/DESIGN.md 3, 36): rows of a `claude -p --output-format stream-json --verbose`
// log or of a Claude Code session transcript, fed one at a time into a state that can say the
// Summary's log-only fields at any point. Pure; the follower (follow.ts) feeds it the rows a poll
// appended, so a poll costs the new rows, not the file.
//
// Where a row holds a value of a type the summariser did not expect, Python raised and the whole
// parse failed ("parse failed: TypeError"); here the value is read as str() would show it and the
// parse goes on. Every row the summariser read without error reads the same.
import type { Summary, ToolClass, WatchEvent } from '../../types'
import { countTsc, detectTests } from './detect.ts'
import { unifiedDiff } from './difflib.ts'
import { Counter, cpLen, cpTail, isDict, num, oneLine, or, pyDumps, pyEq, pyKey, pyStr, splitlines, strip, rstrip, truthy, S } from './py.ts'

type Row = Record<string, unknown>

/** What Claude Code wraps round a user row that is no prompt and starts no turn. */
const QUIET = new RegExp(`^${S}*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder|user-prompt-submit-hook)>`)
const INTERRUPTED = new RegExp(`^${S}*\\[Request interrupted by user`)

const TOOL_CLASS: Record<string, ToolClass> = {
  Bash: 'shell',
  Read: 'read', NotebookRead: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Grep: 'search', Glob: 'search', LS: 'search',
  WebFetch: 'web', WebSearch: 'web',
  Task: 'agent', Agent: 'agent',
}

export function toolClass(name: unknown): ToolClass {
  return typeof name === 'string' ? TOOL_CLASS[name] ?? 'other' : 'other'
}

/** The parts of the Summary the log alone decides (the reader adds the clock's and the world's). */
export type Parsed = Pick<Summary, 'cwd' | 'model' | 'started' | 'last_ts' | 'turns' | 'ctx' | 'out_est' | 'think_ms' | 'thinking' | 'text' |
  'errors' | 'denials' | 'result' | 'pending' | 'tool_ms' | 'tool_counts' | 'files' | 'events' | 'last_diff' | 'last_bash' | 'last_error' |
  'ctx_series' | 'tests' | 'tsc' | 'transcript' | 'prompt'>

/** What the clock-dependent finish and the cost estimate need beside it. */
export type Priv = {
  turn_ts: (number | null)[]
  growth_tok: number
  rest_tok: number
  ctx_max: number
  /** Transcript only: each assistant message's [start, end] (docs/DESIGN.md 36). */
  spans?: [number | null, number | null][]
}

type Ev = Omit<WatchEvent, 'label' | 'tool'> & { label: unknown; tool?: unknown }
type Tool = { name: unknown; inp: unknown; ev: Ev | null }
/** Whose move a transcript's newest row says it is: ['assistant', t, stop_reason, block types] or [kind, t]. */
type Main = ['assistant', number | null, unknown, unknown[]] | ['input' | 'result' | 'end', number | null]
type DiffSrc =
  | { kind: 'edit'; path: string; old: unknown; new: unknown; t: number | null }
  | { kind: 'multi'; path: string; edits: unknown; t: number | null }
  | { kind: 'write'; path: string; content: unknown; t: number | null }

/** Kept beyond what the Summary shows only as far as a later row can still change it. */
const EVENTS_SHOWN = 80
const KEEP = { turnTs: 61, ctxSeries: 60, tests: 30, tsc: 10, spans: 61 }

function push<T>(list: T[], item: T, keep: number): void {
  list.push(item)
  if (list.length > keep * 2) list.splice(0, list.length - keep)
}

/** The summariser's rel(): a path under cwd made relative to it. */
function rel(path: unknown, cwd: unknown): string {
  const p = truthy(path) ? pyStr(path) : ''
  if (typeof cwd === 'string' && cwd) {
    const base = cwd.replace(/\/+$/, '')
    if (p.startsWith(`${base}/`)) return p.slice(base.length + 1)
  }
  return p
}

function get(o: unknown, k: string): unknown {
  return isDict(o) ? o[k] : undefined
}

/** dict.get(k, d): a key present with null stays null. */
function dget(o: Row, k: string, d: unknown): unknown {
  return k in o ? o[k] : d
}

/** A tool call's label: its command's description, its file, its pattern, its URL, ... */
export function toolLabel(name: unknown, inp: unknown, cwd: unknown): unknown {
  if (!isDict(inp)) return oneLine(inp, 120)
  if (name === 'Bash') return or(inp.description, null) ?? oneLine(dget(inp, 'command', ''), 120)
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookRead' || name === 'NotebookEdit') {
    return rel(or(inp.file_path, null) ?? or(inp.notebook_path, null) ?? '', cwd)
  }
  if (name === 'Grep' || name === 'Glob') {
    const where = rel(or(inp.path, null) ?? '', cwd)
    return oneLine(pyStr(dget(inp, 'pattern', '')) + (where ? ` in ${where}` : ''), 120)
  }
  if (name === 'LS') return rel(or(inp.path, null) ?? '', cwd)
  if (name === 'WebFetch') return oneLine(dget(inp, 'url', ''), 120)
  if (name === 'WebSearch') return oneLine(dget(inp, 'query', ''), 120)
  if (name === 'Task' || name === 'Agent') return oneLine(or(inp.description, null) ?? dget(inp, 'prompt', ''), 120)
  return oneLine(pyDumps(inp), 120)
}

function editDiff(path: string, old: unknown, next: unknown): string {
  const a = splitlines(truthy(old) ? pyStr(old) : '')
  const b = splitlines(truthy(next) ? pyStr(next) : '')
  return unifiedDiff(a, b, `a/${path}`, `b/${path}`, 2).join('\n')
}

/** A user row's words and whether it carries tool results. */
function said(content: unknown): [string | null, boolean] {
  if (typeof content === 'string') return [content, false]
  if (!Array.isArray(content)) return [null, false]
  const blocks = content.filter(isDict)
  const texts = blocks.filter(b => b.type === 'text').map(b => (truthy(b.text) ? pyStr(b.text) : ''))
  return [texts.length ? texts.join('\n') : null, blocks.some(b => b.type === 'tool_result')]
}

/**
 * Transcript: whether the newest row that says whose move it is leaves it to the person. Nothing
 * asked yet, a turn that ended or was interrupted, or an assistant message with no tool call that
 * is more than thinking (thinking never ends a turn).
 */
function waitsOnPerson(last: Main | null): boolean {
  if (last === null || last[0] === 'end') return true
  if (last[0] !== 'assistant') return false
  const [, , stop, blocks] = last
  return stop !== 'tool_use' && !blocks.includes('tool_use') && blocks.some(b => b !== 'thinking')
}

export class LogParse {
  /** Read as a session transcript (docs/DESIGN.md 36): the follower sets it for each row it applies, and for the finish. */
  transcript: boolean
  private cwd: unknown = null
  private model: unknown = null
  started: number | null = null
  private lastTs: number | null = null
  private turns = 0
  private ctx = 0
  private outEst = 0
  private thinkMs = 0
  private thinking = ''
  private text = ''
  private errors = 0
  private denials = 0
  private result: Record<string, unknown> | null = null
  private readonly tools = new Map<string, Tool>()
  private readonly events: Ev[] = []
  /** Tool events in call order; those no longer running are dropped as the list grows. */
  private running: Ev[] = []
  private readonly files = new Counter()
  private readonly toolCounts = new Counter()
  private diffSrc: DiffSrc | null = null
  private diffMemo: { src: DiffSrc; out: NonNullable<Summary['last_diff']> } | null = null
  private lastBash: (NonNullable<Summary['last_bash']> & { id: unknown }) | null = null
  private lastError: Summary['last_error'] = null
  private lastMsg: unknown = null
  private readonly turnTs: (number | null)[] = []
  private readonly ctxSeries: number[] = []
  private readonly tests: NonNullable<Summary['tests']> = []
  private readonly tsc: NonNullable<Summary['tsc']> = []
  private toolMs = 0
  private ctxMax = 0
  private growthTok = 0
  private restTok = 0
  private prevCtx = 0
  private prompt: Summary['prompt'] = null
  private lastMain: Main | null = null
  private prevWhen: number | null = null
  private readonly spans: [number | null, number | null][] = []

  constructor(told: boolean) {
    this.transcript = told
  }

  /** One kept row, stamped `when` (its timestamp, or null). */
  apply(d: Row, when: number | null): void {
    const transcript = this.transcript
    const t = d.type
    let before: number | null = null
    if (when) {
      this.started = this.started || when
      this.lastTs = when
    }
    if (transcript) {
      this.cwd = or(this.cwd, d.cwd ?? null)
      before = this.prevWhen
      this.prevWhen = when || this.prevWhen
    }
    if (t === 'system' && d.subtype === 'init') {
      this.model = d.model ?? null
      this.cwd = d.cwd ?? null
    } else if (transcript && t === 'system') {
      if (d.subtype === 'turn_duration') this.lastMain = ['end', when] // the engine's mark that a turn is over
    } else if (t === 'assistant') this.assistant(d, when, before)
    else if (t === 'user') this.user(d, when)
    else if (t === 'result') {
      const u = isDict(d.usage) ? d.usage : {}
      this.result = {
        subtype: d.subtype ?? null, turns: d.num_turns ?? null, duration_ms: d.duration_ms ?? null, api_ms: d.duration_api_ms ?? null,
        input: 'input_tokens' in u ? u.input_tokens : 0, cache_read: 'cache_read_input_tokens' in u ? u.cache_read_input_tokens : 0,
        cache_write: 'cache_creation_input_tokens' in u ? u.cache_creation_input_tokens : 0, output: 'output_tokens' in u ? u.output_tokens : 0,
        cost: pyStr(this.model).startsWith('claude') ? d.total_cost_usd ?? null : null,
      }
    }
  }

  private assistant(d: Row, when: number | null, before: number | null): void {
    const transcript = this.transcript
    const m = truthy(d.message) && isDict(d.message) ? d.message : {}
    const id = m.id ?? null
    if (!pyEq(id, this.lastMsg)) {
      this.lastMsg = id
      this.turns += 1
      const u = truthy(m.usage) && isDict(m.usage) ? m.usage : {}
      this.ctx = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
      // Local servers report the whole prompt as input with no cache split: the context's growth
      // counts as new (a cache write) and the rest as a cache read.
      const grown = Math.max(this.ctx - this.prevCtx, 0)
      this.growthTok += grown
      this.restTok += this.ctx - grown
      this.prevCtx = this.ctx
      push(this.turnTs, when, KEEP.turnTs)
      push(this.ctxSeries, this.ctx, KEEP.ctxSeries)
      this.ctxMax = Math.max(this.ctxMax, this.ctx)
      if (transcript) push(this.spans, [before || when, when], KEEP.spans)
    }
    if (transcript) {
      if (truthy(m.model) && m.model !== '<synthetic>') this.model = m.model // <synthetic>: an error the engine wrote itself
      this.thinkMs += num(d.thinkingDurationMs)
    }
    this.thinkMs += num(d.thinking_duration_ms)
    const content = truthy(m.content) && Array.isArray(m.content) ? m.content : []
    for (const b of content) {
      if (!isDict(b)) continue
      const bt = b.type
      if (bt === 'thinking' && strip(truthy(b.thinking) ? pyStr(b.thinking) : '')) {
        const s = pyStr(b.thinking)
        this.thinking = strip(s)
        this.outEst += Math.floor(cpLen(s) / 4)
        this.event({ t: when, kind: 'think', label: oneLine(s, 200) })
      } else if (bt === 'text' && strip(truthy(b.text) ? pyStr(b.text) : '')) {
        const s = pyStr(b.text)
        this.text = strip(s)
        this.outEst += Math.floor(cpLen(s) / 4)
        this.event({ t: when, kind: 'text', label: oneLine(s, 200) })
      } else if (bt === 'tool_use') this.toolUse(b, when)
    }
    if (transcript) this.lastMain = ['assistant', when, m.stop_reason ?? null, content.filter(isDict).map(b => b.type ?? null)]
  }

  private toolUse(b: Row, when: number | null): void {
    const name = or(b.name, '?')
    const inp = or(b.input, {}) as unknown
    this.outEst += Math.floor(cpLen(pyDumps(inp)) / 4)
    this.toolCounts.add(name)
    const label = toolLabel(name, inp, this.cwd)
    const ev: Ev = { t: when, kind: 'tool', tool: name, cls: toolClass(name), label, status: 'running' }
    this.tools.set(pyKey(b.id ?? null), { name, inp: name === 'Bash' ? inp : null, ev })
    this.event(ev)
    this.running.push(ev)
    if (this.running.length > 256) this.running = this.running.filter(e => e.status === 'running')
    if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') this.files.add(label)
    const path = String(label)
    if (name === 'Edit') this.diffSrc = { kind: 'edit', path, old: get(inp, 'old_string'), new: get(inp, 'new_string'), t: when }
    else if (name === 'MultiEdit') this.diffSrc = { kind: 'multi', path, edits: get(inp, 'edits'), t: when }
    else if (name === 'Write') this.diffSrc = { kind: 'write', path, content: get(inp, 'content'), t: when }
    else if (name === 'Bash') {
      const desc = get(inp, 'description')
      const command = isDict(inp) ? dget(inp, 'command', '') : ''
      this.lastBash = { cmd: command as string, desc: (desc ?? null) as string | null, out: [], more: 0, status: 'running', t: when, id: b.id ?? null }
    }
  }

  private user(d: Row, when: number | null): void {
    const transcript = this.transcript
    const msg = truthy(d.message) && isDict(d.message) ? d.message : {}
    const c = msg.content
    const r = transcript ? d.toolUseResult : d.tool_use_result
    if (transcript) {
      const [words, results] = said(c)
      if (results) this.lastMain = ['result', when]
      const quiet = words === null || truthy(d.isCompactSummary) || truthy(d.isVisibleInTranscriptOnly) || QUIET.test(words)
      if (words !== null && INTERRUPTED.test(words)) this.lastMain = ['end', when]
      else if (!results && !quiet) {
        // A prompt, or another input that starts a turn (a teammate's message, a task's notice, a
        // command's expansion); only what the person typed is a prompt.
        const origin = d.origin
        const typed = !truthy(d.isMeta) && (!isDict(origin) || origin.kind === undefined || origin.kind === null || origin.kind === 'human')
        if (typed && strip(words!)) this.prompt = { text: oneLine(words, 200), t: when }
        this.lastMain = ['input', when]
      }
    }
    if (!Array.isArray(c)) return
    for (const b of c) {
      if (!isDict(b) || b.type !== 'tool_result') continue
      const tool = this.tools.get(pyKey(b.tool_use_id ?? null))
      const name = tool ? tool.name : null
      const inp = tool ? tool.inp : {}
      const ev = tool ? tool.ev : null
      let body: unknown = b.content
      if (Array.isArray(body)) body = body.filter(isDict).map(x => ('text' in x ? (x.text === null ? '' : pyStr(x.text)) : '')).join('\n')
      const text = body === null || body === undefined ? '' : pyStr(body)
      const err = truthy(b.is_error)
      const lower = err ? text.toLowerCase() : ''
      const denied = err && (lower.includes('permission') || lower.includes('denied'))
      if (ev) {
        ev.status = denied ? 'denied' : err ? 'error' : 'ok'
        ev.dur = when && ev.t ? when - ev.t : null
        this.toolMs += (ev.dur || 0) * 1000
        if (err) ev.detail = oneLine(text, 300)
      }
      if (err) {
        this.errors += 1
        this.denials += denied ? 1 : 0
        this.lastError = { t: when, tool: (or(name, 'unknown')) as string, detail: oneLine(text, 300) }
      }
      if (name === 'Bash') this.bashResult(b, r, text, err, inp, when)
    }
  }

  private bashResult(b: Row, r: unknown, body: string, err: boolean, inp: unknown, when: number | null): void {
    let text = body
    if (isDict(r)) {
      const out = truthy(r.stdout) ? pyStr(r.stdout) : ''
      text = out + (truthy(r.stderr) ? `\n${pyStr(r.stderr)}` : '')
      if (!strip(text)) text = pyStr(or(r.returnCodeInterpretation, '(no output)'))
    }
    if (this.lastBash && pyEq(this.lastBash.id, b.tool_use_id ?? null)) {
      const lines = splitlines(rstrip(text))
      this.lastBash.out = lines.slice(-12)
      this.lastBash.more = Math.max(0, lines.length - 12)
      this.lastBash.status = err ? 'error' : 'ok'
    }
    const run = detectTests(text)
    if (run) push(this.tests, { t: when, failed: run.failed, passed: run.passed, total: run.total }, KEEP.tests)
    const cmd = isDict(inp) ? pyStr(dget(inp, 'command', '')) : ''
    const nTs = countTsc(text)
    if (cmd.includes('tsc') || cmd.includes('typecheck') || nTs) push(this.tsc, { t: when, errors: nTs }, KEEP.tsc)
  }

  private event(ev: Ev): void {
    this.events.push(ev)
    if (this.events.length > EVENTS_SHOWN * 2) this.events.splice(0, this.events.length - EVENTS_SHOWN)
  }

  /** The last edit as a diff, worked out once per edit (a poll that adds no edit reuses it). */
  private lastDiff(): Summary['last_diff'] {
    const src = this.diffSrc
    if (!src) return null
    if (this.diffMemo?.src !== src) {
      let out: NonNullable<Summary['last_diff']>
      if (src.kind === 'edit') out = { path: src.path, diff: editDiff(src.path, src.old, src.new), t: src.t }
      else if (src.kind === 'multi') {
        const list: unknown[] = Array.isArray(src.edits) ? src.edits : []
        const parts = list.filter(isDict).map(e => editDiff(src.path, e.old_string, e.new_string))
        out = { path: src.path, diff: parts.filter(p => p).join('\n'), t: src.t }
      } else {
        const lines = splitlines(truthy(src.content) ? pyStr(src.content) : '')
        const head = lines.slice(0, 40).map(l => `+${l}`).join('\n')
        out = { path: src.path, t: src.t, lines: lines.length, diff: `--- /dev/null\n+++ b/${src.path}\n@@ -0,0 +1,${Math.min(lines.length, 40)} @@\n${head}` }
      }
      this.diffMemo = { src, out }
    }
    return { ...this.diffMemo.out }
  }

  /** The log's fields now, and what the finish needs; copies, so the state reads on unchanged. */
  finish(): { out: Parsed; priv: Priv } {
    let running: Ev | undefined
    for (let i = this.running.length - 1; i >= 0; i--) {
      if (this.running[i]!.status === 'running') {
        running = this.running[i]
        break
      }
    }
    let pending: NonNullable<Summary['pending']>
    if (truthy(this.result)) pending = { kind: 'done' }
    else if (this.transcript && waitsOnPerson(this.lastMain)) pending = { kind: 'user', since: this.lastMain ? this.lastMain[1] : this.lastTs }
    else if (running) pending = { kind: 'tool', tool: running.tool as string, cls: running.cls!, label: running.label as string, since: running.t }
    else pending = { kind: 'model', since: this.lastTs }

    let bash: Summary['last_bash'] = null
    if (this.lastBash) {
      const { id: _, ...rest } = this.lastBash
      bash = { ...rest, out: [...rest.out] }
    }
    const out: Parsed = {
      cwd: this.cwd as string | null, model: this.model as string | null, started: this.started, last_ts: this.lastTs, turns: this.turns,
      ctx: this.ctx, out_est: this.outEst, think_ms: this.thinkMs, thinking: cpTail(this.thinking, 2000), text: cpTail(this.text, 1200),
      errors: this.errors, denials: this.denials, result: this.result ? ({ ...this.result } as Summary['result']) : null,
      pending, tool_ms: this.toolMs,
      tool_counts: this.toolCounts.mostCommon() as [string, number][],
      files: this.files.mostCommon(8) as [string, number][],
      events: this.events.slice(-EVENTS_SHOWN).map(e => ({ ...e })) as WatchEvent[],
      last_diff: this.lastDiff(), last_bash: bash, last_error: this.lastError ? { ...this.lastError } : null,
      ctx_series: this.ctxSeries.slice(-KEEP.ctxSeries), tests: this.tests.slice(-KEEP.tests).map(x => ({ ...x })),
      tsc: this.tsc.slice(-KEEP.tsc).map(x => ({ ...x })),
    }
    const priv: Priv = { turn_ts: this.turnTs.slice(-KEEP.turnTs), growth_tok: this.growthTok, rest_tok: this.restTok, ctx_max: this.ctxMax }
    if (this.transcript) {
      out.transcript = true
      out.prompt = this.prompt ? { ...this.prompt } : null
      // The model's move now: the message it is writing runs from the newest row to the clock.
      const spans = [...this.spans.slice(-KEEP.spans), ...(pending.kind === 'model' && this.lastTs ? [[this.lastTs, null] as [number, null]] : [])]
      priv.spans = spans.slice(-KEEP.spans)
    }
    return { out, priv }
  }
}

/**
 * Seconds per turn; the last turn runs to the result (finished) or to now (live). In a session
 * transcript a turn is one assistant message, from the row it answers (a prompt, a tool's result)
 * to the message, and the one being written runs to now: the tools' time and the person's time
 * between prompts are no turn's.
 */
export function turnSecs(out: Parsed, priv: Priv, now: number, round: (x: number) => number): number[] {
  if (priv.spans) return priv.spans.slice(-60).filter(([a]) => a).map(([a, b]) => round((b !== null ? b : now) - a!))
  const ts = priv.turn_ts
  const r = out.result
  const end = r ? (out.started || 0) + num(or(r.duration_ms, 0)) / 1000 : now
  const gaps: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const a = ts[i]
    const b = i + 1 < ts.length ? ts[i + 1] : end
    if (a && b) gaps.push(b - a)
  }
  return gaps.slice(-60).map(round)
}
