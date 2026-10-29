// The pane in plain words (docs/DESIGN.md 38.1): what the worker is doing now, the task, the run so
// far and what is worth a look, for the calm layout. A pure function of the summary, the activity,
// the run's memory and the clock, like the scenes, so replay and the tests stay honest.
//
// The reader may not know what a shell, a type checker or a context window is, so tool calls are
// said as what they do ("running the tests"), never as what they are called ("Bash · npm test").
// Sentences are short and calm; numbers are exact; durations are words ("4 minutes").
import type { Summary } from '../types'
import type { Activity } from './activity.ts'
import { isSession } from './activity.ts'
import type { Fact } from './facts.ts'
import type { RunMemory } from './memory.ts'

export type Story = {
  /** One sentence: what is happening now. Null once the run has ended (see `outcome`). */
  now: string | null
  /**
   * The short plain form of `now` for the scene's caption, lower case, no subject and no seconds
   * (the scene adds those): "running the tests", "thinking", "your turn". When ended, "finished".
   */
  caption: string
  /** One line: `You asked: "…"` or `Working on: "…"`; null with no task known. */
  task: string | null
  /** Up to three short plain facts about the run so far, most useful first. */
  soFar: string[]
  /** What is worth a look, worst first, at most three; empty when all is well. */
  heads: string[]
  /** One sentence on how the run ended; null while it runs. */
  outcome: string | null
  /**
   * The facts the task, So far, Worth a look and outcome lines spell out (docs/DESIGN.md 31), each
   * once: the pane claims them, so the scene drops its own text for them. Now is never a claim.
   */
  claims: Fact[]
}

/** One line of the story and the facts it spells out. */
type Line = { text: string; facts: Fact[] }

const line = (text: string, ...facts: Fact[]): Line => ({ text, facts })

/** The longest caption: the scene cuts captions on narrow panes, so the verb comes first. */
export const CAPTION_MAX = 32
/** The longest task text inside its quotes. */
export const TASK_MAX = 90
/** Thinking this long or longer says how long ("has been thinking for 2 minutes"). */
const LONG_SECS = 60
/** The context window counts as a fact from half full, and as worth a look from 85%. */
const CTX_NOTE = 0.5
const CTX_FULL = 0.85
/**
 * Failed and blocked tool calls are worth a look only this long after they happen (seconds), so
 * calm goes quiet again once things are fine; under a minute they happened "just now".
 */
export const RECENT_SECS = 300
const JUST_NOW_SECS = 60
/** The log reader lists at most this many edited files. */
const FILES_LISTED = 8

// ── Words

/** `n` and its noun, singular or plural: plural(1, 'turn') → "1 turn". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A duration in words, at the coarsest unit that still says something: "12 seconds", "4 minutes",
 * "1 hour 20 minutes", "3 days 2 hours". Rounded down, so it never overstates.
 */
export function inWords(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  if (s < 1) return 'under a second'
  if (s < 60) return plural(s, 'second')
  const m = Math.floor(s / 60)
  if (m < 60) return plural(m, 'minute')
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${plural(h, 'hour')} ${plural(m % 60, 'minute')}` : plural(h, 'hour')
  const d = Math.floor(h / 24)
  return h % 24 ? `${plural(d, 'day')} ${plural(h % 24, 'hour')}` : plural(d, 'day')
}

/** Cut `s` to at most `n` characters, ending in an ellipsis when cut (at a word when one is near). */
export function cut(s: string, n: number): string {
  if (s.length <= n) return s
  const head = s.slice(0, Math.max(1, n - 1))
  const space = head.lastIndexOf(' ')
  return `${(space >= n * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

/** `who` as it reads mid-sentence: "the worker", but "Claude" keeps its capital. */
export function midline(who: string): string {
  return /^Claude\b/.test(who) ? who : who.charAt(0).toLowerCase() + who.slice(1)
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

// ── Tool calls, as what they do

/** What a tool call does: `long` for a sentence ("searching the code for “x”"), `short` for the caption. */
export type Doing = { long: string; short: string }

const same = (s: string): Doing => ({ long: s, short: s })

/** `git`, with any options before its subcommand (`git -C dir commit`). */
const GIT = String.raw`^git\s+(?:-[Cc]\s+\S+\s+|--?\S+\s+)*`
const git = (sub: string) => new RegExp(`${GIT}(?:${sub})\\b`)

/** What one shell command does, by its words. Highest first: a test run piped to `tail` is a test run. */
const COMMANDS: [RegExp, string][] = [
  [
    /^(?:(?:npm|pnpm|yarn|bun|deno)\s+(?:run\s+)?(?:test|t)\b|(?:npm|pnpm|yarn)\s+run\s+[\w:-]*test|vitest|jest|mocha|ava|tap|pytest|py\.test|python3?\s+-m\s+(?:pytest|unittest)|(?:go|cargo|dotnet|mvn|gradle|gradlew|swift|mix|zig)\s+test|make\s+(?:test|check)\b|rspec|phpunit|tox|nox|ctest|claude\s+plugin\s+test)/,
    'running the tests',
  ],
  [/^(?:tsc|vue-tsc|mypy|pyright|flow|cargo\s+check|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:type-?check|types|tsc)\b)/, 'checking the types'],
  [/^(?:eslint|ruff|flake8|pylint|black|isort|prettier|biome|stylelint|rubocop|golangci-lint|gofmt|rustfmt|cargo\s+(?:clippy|fmt)|shellcheck|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|format|fmt)\b)/, 'checking the code style'],
  [/^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|(?:cargo|go|swift|dotnet|zig)\s+build|vite\s+build|next\s+build|webpack|rollup|esbuild|tsup|make(?=\s|$)|cmake|gradlew?\s+(?:build|assemble)|mvn\s+(?:package|install|compile))/, 'building the project'],
  [git('commit'), 'saving its work as a commit'],
  [git('push'), 'pushing its work'],
  [/^(?:npm\s+(?:i|install|ci|add)\b|(?:pnpm|bun)\s+(?:i|install|add)\b|yarn(?:\s+(?:install|add)\b|\s*$)|pip3?\s+install|python3?\s+-m\s+pip\s+install|uv\s+(?:pip\s+install|add|sync)|poetry\s+(?:add|install)|cargo\s+(?:add|install)|go\s+(?:get|install)|brew\s+install|apt(?:-get)?\s+install|gem\s+install|bundle(?:\s+install)?\s*$)/, 'installing packages'],
  [/^(?:curl|wget|http|xh)\b/, 'fetching something from the web'],
  [git('status|diff|log|show|blame'), 'checking what changed'],
  [git('add|stage'), 'getting its changes ready to save'],
  [git('pull|fetch|clone'), 'fetching the latest changes'],
  [/^(?:mkdir|mv|cp|rm|rmdir|touch|ln|chmod)\b/, 'moving files around'],
  [/^(?:ls|cat|find|fd|head|tail|grep|rg|ag|pwd|wc|tree|less|more|file|stat|du|which|sed\s+-n|awk|sort|jq|diff)\b/, 'looking around the project'],
]

/** The same families, said in a Bash call's description ("Run the unit tests", "Typecheck the project"). */
const DESCRIPTIONS: [RegExp, string][] = [
  [/\btests?\b|\btest suite|\bspecs?\b/i, 'running the tests'],
  [/\btype[- ]?check|\btypes\b|\btsc\b/i, 'checking the types'],
  [/\blint|\bformat|\bcode style/i, 'checking the code style'],
  [/\bbuild|\bcompile/i, 'building the project'],
  [/\bcommit/i, 'saving its work as a commit'],
  [/\bpush/i, 'pushing its work'],
  [/\binstall|\bdependenc/i, 'installing packages'],
  [/\bfetch|\bdownload|\bweb\b/i, 'fetching something from the web'],
  [/\bgit\b.*\b(?:status|diff|log)\b|\bwhat changed|\buncommitted/i, 'checking what changed'],
  [/\b(?:create|make|move|copy|remove|delete|rename)\b.*\b(?:dir|director|folder|file)/i, 'moving files around'],
  [/^(?:list|show|read|look|view|find|search|print|count|check)\b/i, 'looking around the project'],
]

/** One command line's parts (`a && b; c | d`), each without its env assignments and runner prefixes. */
function parts(cmd: string): string[] {
  const out: string[] = []
  for (let p of cmd.split(/&&|\|\||[;|\n]/)) {
    p = p.trim().replace(/^\(+/, '')
    for (;;) {
      const next = p
        .replace(/^\w+=\S*\s+/, '')
        .replace(/^(?:sudo|time|env|exec|command|nohup|npx|bunx|pnpx|(?:pnpm|yarn)\s+(?:exec|dlx)|uv\s+run|poetry\s+run)\s+/, '')
      if (next === p) break
      p = next
    }
    if (!p || /^(?:cd|export|source|\.|set|true|echo|printf)\b/.test(p)) continue
    // A program named by a path reads as its name: ./node_modules/.bin/vitest → vitest.
    out.push(p.replace(/^(\S*\/)(\S+)/, '$2'))
  }
  return out
}

/** What a shell command does: the most telling of its parts, or "running a command (<name>)". */
export function shellDoing(cmd: string, desc?: string | null): string {
  const ps = parts(cmd)
  for (const [re, words] of COMMANDS) if (ps.some(p => re.test(p))) return words
  if (desc) for (const [re, words] of DESCRIPTIONS) if (re.test(desc)) return words
  const first = (ps[0] ?? '').split(/\s+/)[0] ?? ''
  return first ? `running a command (${cut(basename(first), 14)})` : 'running a command'
}

/** True when a Bash label reads as a description ("Run the unit tests") rather than the command. */
function looksLikeWords(label: string): boolean {
  return /^[A-Z][a-z]+\s+\S/.test(label) && !/[|&;<>$=`\\/]|\s-{1,2}\w/.test(label)
}

/** The MCP server a tool belongs to, as a reader would name it: mcp__plugin_x_slack__send → "slack". */
function serverOf(tool: string): string {
  let name = tool.slice('mcp__'.length).split('__')[0] ?? ''
  name = name.replace(/^claude_ai_/, '')
  if (name.startsWith('plugin_')) name = name.slice(name.lastIndexOf('_') + 1)
  return name.replace(/_/g, ' ') || 'a connected tool'
}

/** A Grep label is `pattern` or `pattern in path`; the pattern is what the reader recognises. */
function grepPattern(label: string): string {
  return label.replace(/ in \S+$/, '')
}

/**
 * What the pending tool call is doing. `label` is the log reader's (`toolLabel` in
 * hooks/reader/parse.ts): a file path for the file tools, the pattern for Grep and Glob, the URL or
 * query for the web tools, the description for Task, and for Bash the description when there is
 * one, else the command; `cmd` is the command itself when known (the running `last_bash`).
 */
export function toolDoing(tool: string | undefined, label: string = '', cmd?: string | null): Doing {
  const file = basename(label)
  switch (tool) {
    case 'Read':
      return file ? { long: `reading ${file}`, short: `reading ${cut(file, CAPTION_MAX - 8)}` } : same('reading a file')
    case 'NotebookRead':
      return same('reading a notebook')
    case 'Edit':
    case 'MultiEdit':
      return file ? { long: `editing ${file}`, short: `editing ${cut(file, CAPTION_MAX - 8)}` } : same('editing a file')
    case 'Write':
      return file ? { long: `writing ${file}`, short: `writing ${cut(file, CAPTION_MAX - 8)}` } : same('writing a file')
    case 'NotebookEdit':
      return same('editing a notebook')
    case 'Grep': {
      const pat = grepPattern(label)
      if (!pat) return same('searching the code')
      return { long: `searching the code for “${cut(pat, 40)}”`, short: `searching for “${cut(pat, CAPTION_MAX - 16)}”` }
    }
    case 'Glob':
      return same('looking for files')
    case 'LS':
      return same('looking around the project')
    case 'Bash': {
      const words = cmd ? shellDoing(cmd, label !== cmd ? label : null) : looksLikeWords(label) ? shellDoing('', label) : shellDoing(label)
      return { long: words, short: cut(words, CAPTION_MAX) }
    }
    case 'WebFetch':
      return same('reading a web page')
    case 'WebSearch':
      return same('searching the web')
    case 'Task':
    case 'Agent':
      return { long: 'handing part of the job to a helper', short: 'handing work to a helper' }
    case 'TodoWrite':
      return same('updating its to-do list')
    case 'AskUserQuestion':
      return same('asking you a question')
    case 'ExitPlanMode':
      return same('showing you its plan')
    case 'Skill':
      return same('using a skill')
    case 'BashOutput':
      return same('checking on a running command')
    case 'KillShell':
    case 'KillBash':
      return same('stopping a command')
    case undefined:
    case '':
      return same('using a tool')
  }
  if (tool.startsWith('mcp__')) {
    const name = serverOf(tool)
    return { long: `using ${name}`, short: `using ${cut(name, CAPTION_MAX - 6)}` }
  }
  return { long: `using ${tool}`, short: `using ${cut(tool, CAPTION_MAX - 6)}` }
}

/** The pending call's command, when the running `last_bash` is that call. */
function pendingCmd(s: Summary): string | null {
  const p = s.pending
  const b = s.last_bash
  if (p?.kind !== 'tool' || p.tool !== 'Bash' || !b || b.status !== 'running' || !b.cmd) return null
  return b.t == null || p.since == null || b.t === p.since ? b.cmd : null
}

// ── The parts of the story

const RESULTS: Record<string, string> = {
  error_max_turns: 'it hit its turn limit',
  error_during_execution: 'something went wrong while it was working',
  error_max_budget_usd: 'it reached its spending limit',
  error_max_structured_output_retries: 'it could not give its answer in the form asked for',
}

function testsLine(s: Summary): { failed: number; passed: number; total: number } | null {
  const r = s.tests?.at(-1)
  return r && r.total > 0 ? r : null
}

function money(usd: number): string {
  return usd < 0.01 ? 'less than a cent' : `$${usd.toFixed(2)}`
}

function and(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
}

/** The task in one line, inside quotes, cut to TASK_MAX. */
function quoted(text: string): string {
  const line = text
    .split('\n')
    .map(l => l.replace(/^[\s#>*-]+/, '').trim())
    .find(l => l.length > 0)
  return line ? `"${cut(line.replace(/\s+/g, ' '), TASK_MAX)}"` : ''
}

function taskOf(s: Summary): string | null {
  if (isSession(s)) {
    const q = s.prompt?.text ? quoted(s.prompt.text) : ''
    return q ? `You asked: ${q}` : null
  }
  const q = s.handoff?.text ? quoted(s.handoff.text) : ''
  return q ? `Working on: ${q}` : null
}

function soFarOf(s: Summary, m: RunMemory, ended: boolean): Line[] {
  const out: Line[] = []
  // The outcome already says how long and how many turns once the run has ended.
  if (!ended) {
    const time = m.elapsed < 1 ? 'just started' : inWords(m.elapsed)
    out.push(m.turns > 0 ? line(`${time}, ${plural(m.turns, 'turn')}`, 'elapsed', 'turns') : line(time, 'elapsed'))
  }
  const tests = testsLine(s)
  if (tests) out.push(line(tests.failed === 0 ? `tests: all ${tests.total} passing` : `tests: ${tests.passed} of ${tests.total} passing`, 'checks'))
  // Files edited are no Fact of their own (git is the commits and the uncommitted changes).
  out.push(line(m.files === 0 ? 'no changes yet' : m.files >= FILES_LISTED ? `changed at least ${FILES_LISTED} files` : `changed ${plural(m.files, 'file')}`))
  // From 85% the context window is worth a look instead (heads), so it is said once.
  if (m.ctxFrac != null && m.ctxFrac >= CTX_NOTE && m.ctxFrac < CTX_FULL) out.push(line(`context window ${Math.round(m.ctxFrac * 100)}% full`, 'ctx'))
  if (m.commits > 0) out.push(line(`made ${plural(m.commits, 'commit')}`, 'git'))
  if (s.result?.cost != null) out.push(line(`cost ${money(s.result.cost)}`, 'cost'))
  else if (s.cost && s.cost.usd > 0) out.push(line(`about ${money(s.cost.usd)} at API prices`, 'cost'))
  // Once ended, the run's totals of failed and blocked calls, when nothing better fills the place
  // (worth a look only tells the last few minutes). The log reader counts a denial as an error too.
  if (ended) {
    const denials = s.denials ?? 0
    const failed = Math.max(0, (s.errors ?? 0) - denials)
    const bits = [failed ? `${plural(failed, 'tool call')} failed` : '', denials ? `${plural(denials, 'action')} ${denials === 1 ? 'was' : 'were'} blocked` : ''].filter(Boolean)
    if (bits.length) out.push(line(`along the way, ${and(bits)}`, 'errors'))
  }
  return out.slice(0, 3)
}

/**
 * Tool calls that ended `status` within RECENT_SECS of `t`, from the timeline (the log reader marks
 * each call `error` or `denied`, never both, and keeps the newest 80 rows), and when the newest was.
 */
export function recent(s: Summary, t: number, status: 'error' | 'denied'): { n: number; when: string } {
  let n = 0
  let newest = -Infinity
  for (const ev of s.events ?? []) {
    if (ev.kind !== 'tool' || ev.status !== status || ev.t == null) continue
    const age = t - ev.t
    if (age < 0 || age > RECENT_SECS) continue
    n++
    newest = Math.max(newest, ev.t)
  }
  return { n, when: t - newest < JUST_NOW_SECS ? 'just now' : 'in the last few minutes' }
}

function headsOf(s: Summary, a: Activity, m: RunMemory, who: string, t: number): Line[] {
  const out: Line[] = []
  const live = a.state === 'thinking' || a.state === 'prefill' || a.state === 'tool'
  // At the end, the outcome says how the tests stood.
  if (m.failing > 0 && a.state !== 'done') {
    const n = m.failing === 1 ? '1 test is failing' : `${m.failing} tests are failing`
    out.push(line(live ? `${n} — ${midline(who)} is working on it` : n, 'checks'))
  }
  if (m.tscErrors) out.push(line(`the last type check found ${plural(m.tscErrors, 'error')}`, 'checks'))
  const blocked = recent(s, t, 'denied')
  if (blocked.n > 0) out.push(line(`${plural(blocked.n, 'action')} ${blocked.n === 1 ? 'was' : 'were'} blocked by your permission settings ${blocked.when}`, 'errors'))
  const failed = recent(s, t, 'error')
  if (failed.n > 0) out.push(line(`${plural(failed.n, 'tool call')} failed ${failed.when}`, 'errors'))
  if (m.ctxFrac != null && m.ctxFrac >= CTX_FULL) out.push(line('the context window is nearly full; older detail may be summarised away', 'ctx'))
  // A stall that `now` already tells is not told twice; like Now, it claims nothing.
  if (s.stalled && a.state !== 'stalled' && a.state !== 'done' && s.mtime != null) out.push(line(`nothing has happened for ${inWords(t - s.mtime)}`))
  return out.slice(0, 3)
}

function outcomeOf(s: Summary, m: RunMemory): Line {
  const r = s.result
  const turns = r?.turns ?? m.turns
  const secs = r ? m.elapsed : s.started != null && s.last_ts != null ? s.last_ts - s.started : 0
  const turnsSaid = plural(turns, 'turn')
  const tests = testsLine(s)
  const bits: string[] = []
  const facts: Fact[] = ['elapsed']
  if (!r) return line(`Stopped after ${inWords(secs)}: the log ended without saying how it finished.`, ...facts)
  if (turns > 0) facts.push('turns')
  if (tests) {
    bits.push(tests.failed === 0 ? (tests.total === 1 ? 'the 1 test passes' : `all ${tests.total} tests pass`) : `${tests.failed} of ${tests.total} tests ${tests.failed === 1 ? 'is' : 'are'} still failing`)
    facts.push('checks')
  }
  if (m.commits > 0) {
    bits.push(`it made ${plural(m.commits, 'commit')}`)
    facts.push('git')
  }
  if (r.subtype === 'success') {
    const took = turns > 0 ? `${inWords(secs)} after ${turnsSaid}` : inWords(secs)
    return line(bits.length ? `Finished in ${took}: ${and(bits)}.` : `Finished in ${took}.`, ...facts)
  }
  const took = turns > 0 ? `${inWords(secs)} and ${turnsSaid}` : inWords(secs)
  const why = RESULTS[r.subtype] ?? 'it ended with an error'
  return line(bits.length ? `Stopped after ${took}: ${why}; ${and(bits)}.` : `Stopped after ${took}: ${why}.`, ...facts)
}

/** Now as a sentence and as the caption, per state. */
function nowOf(s: Summary, a: Activity, who: string): { now: string | null; caption: string } {
  const session = isSession(s)
  const mid = midline(who)
  switch (a.state) {
    case 'nolog':
      return session ? { now: 'Waiting for your first prompt.', caption: 'waiting for your first prompt' } : { now: 'Nothing to watch yet.', caption: 'nothing to watch yet' }
    case 'waiting':
      if (s.pending?.kind === 'user') {
        if ((s.turns ?? 0) === 0 && !s.prompt) return { now: 'Waiting for your first prompt.', caption: 'waiting for your first prompt' }
        return { now: `Your turn: ${mid} has finished and is waiting for you.`, caption: 'your turn' }
      }
      return { now: `Waiting for ${mid} to start.`, caption: cut(`waiting for ${mid} to start`, CAPTION_MAX) }
    case 'prefill':
      return { now: `${who} is reading through the conversation before it answers.`, caption: 'reading the conversation' }
    case 'thinking':
      return { now: a.secs >= LONG_SECS ? `${who} has been thinking for ${inWords(a.secs)}.` : `${who} is thinking.`, caption: 'thinking' }
    case 'tool': {
      const p = s.pending?.kind === 'tool' ? s.pending : null
      const d = toolDoing(a.tool ?? p?.tool, p?.label ?? '', pendingCmd(s))
      return { now: a.secs >= LONG_SECS ? `${who} has been ${d.long} for ${inWords(a.secs)}.` : `${who} is ${d.long}.`, caption: cut(d.short, CAPTION_MAX) }
    }
    case 'stalled': {
      // A stall is said in whole seconds at least: "for under a second" reads as a contradiction.
      const quiet = inWords(Math.max(1, a.secs))
      return { now: `Nothing has happened for ${quiet}; ${mid} may be stuck waiting on the model.`, caption: cut(`quiet for ${quiet}`, CAPTION_MAX) }
    }
    case 'done':
      return { now: null, caption: a.ok ? 'finished' : 'stopped' }
  }
}

/** The run in words. `who` is `Claude` (this session) or `The worker`. */
export function storyOf(s: Summary, a: Activity, m: RunMemory, t: number, who: string): Story {
  // A session has no result row and never ends: between turns it is the person's move (DESIGN 36).
  const session = isSession(s)
  const ended = a.state === 'done' && !session
  const said = a.state === 'done' && session ? { now: `Your turn: ${midline(who)} has finished and is waiting for you.`, caption: 'your turn' } : nowOf(s, a, who)
  const task = taskOf(s)
  const soFar = s.exists ? soFarOf(s, m, ended) : []
  const heads = s.exists ? headsOf(s, a, m, who, t) : []
  const outcome = ended ? outcomeOf(s, m) : null
  // What the drawn lines spell out, each fact once, in the order the lines come.
  const claims = new Set<Fact>(task ? ['handoff'] : [])
  for (const l of [...soFar, ...heads, ...(outcome ? [outcome] : [])]) for (const f of l.facts) claims.add(f)
  return {
    now: said.now,
    caption: said.caption,
    task,
    soFar: soFar.map(l => l.text),
    heads: heads.map(l => l.text),
    outcome: outcome?.text ?? null,
    claims: [...claims],
  }
}
