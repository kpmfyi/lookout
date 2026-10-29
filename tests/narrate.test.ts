// The pane in plain words (docs/DESIGN.md 38.1): storyOf says what the worker is doing, the task,
// the run so far and what is worth a look, without jargon, for every state, every tool and every
// moment of the demo loop.
import { expect, test } from 'claude-code/testing'

import type { Summary, WatchEvent } from '../types'
import { activity } from '../hooks/activity.ts'
import { DEMO_LOOP_SECS, demoSummary } from '../hooks/demo.ts'
import { memoryOf } from '../hooks/memory.ts'
import { CAPTION_MAX, RECENT_SECS, type Story, cut, inWords, midline, recent, shellDoing, storyOf, toolDoing } from '../hooks/narrate.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING } from './fixtures.ts'
import { SESSION_NOFILE, SESSION_RUNNING, SESSION_WAITING } from './session-fixture.ts'

const WORKER = 'The worker'
const CLAUDE = 'Claude'

/** The story of `s` at `t`, through the same activity and memory the pane uses. */
function story(s: Summary, t = T, who = s.transcript ? CLAUDE : WORKER): Story {
  return storyOf(s, activity(s, t), memoryOf(s, t), t, who)
}

/** RUNNING with a different pending tool call (and no running command to read instead). */
function running(tool: string, label: string, extra: Partial<Summary> = {}): Summary {
  return { ...RUNNING, pending: { kind: 'tool', tool, cls: 'other', label, since: T - 4 }, last_bash: null, ...extra }
}

/** Tool calls that ended `status`, `ago` seconds before T each. */
function calls(status: 'ok' | 'error' | 'denied', ...ago: number[]): WatchEvent[] {
  return ago.map(dt => ({ t: T - dt, kind: 'tool', tool: 'Bash', cls: 'shell', label: 'npm test', status, dur: 1 }))
}

/** Every string a story holds. */
function words(st: Story): string[] {
  return [st.now, st.caption, st.task, ...st.soFar, ...st.heads, st.outcome].filter((x): x is string => x != null)
}

/** Words the reader is not expected to know. "API" only as "at API prices". */
const JARGON = [/\bBash\b/, /prefill/i, /\bctx\b/i, /\btsc\b/, /stdout/i, /tok\/s/i, /\bAPI\b(?! prices)/]

function jargonIn(st: Story): string[] {
  return words(st).filter(w => JARGON.some(re => re.test(w)))
}

/** One demo loop at 0.5 s steps, `loops` loops in. */
function demoWalk(loops = 0): { e: number; s: Summary; st: Story }[] {
  const out = []
  for (let i = 0; i < DEMO_LOOP_SECS / 0.5; i++) {
    const elapsed = loops * DEMO_LOOP_SECS + i * 0.5
    const t = T + elapsed
    const s = demoSummary(elapsed, t)
    out.push({ e: i * 0.5, s, st: storyOf(s, activity(s, t), memoryOf(s, t), t, WORKER) })
  }
  return out
}

// ── Words

test('narrate: durations in words, rounded down', () => {
  expect(inWords(0)).toBe('under a second')
  expect(inWords(1)).toBe('1 second')
  expect(inWords(12.9)).toBe('12 seconds')
  expect(inWords(60)).toBe('1 minute')
  expect(inWords(4 * 60 + 59)).toBe('4 minutes')
  expect(inWords(3600)).toBe('1 hour')
  expect(inWords(3600 + 20 * 60)).toBe('1 hour 20 minutes')
  expect(inWords(2 * 86_400)).toBe('2 days')
  expect(inWords(3 * 86_400 + 2 * 3600)).toBe('3 days 2 hours')
  expect(inWords(-5)).toBe('under a second')
})

test('narrate: cut ends in an ellipsis within its length; who reads mid-sentence', () => {
  expect(cut('short', 10)).toBe('short')
  const c = cut('add a due date to every todo in the list', 20)
  expect(c.length <= 20).toBe(true)
  expect(c.endsWith('…')).toBe(true)
  expect(midline('The worker')).toBe('the worker')
  expect(midline('Claude')).toBe('Claude')
})

// ── Now, per state

test('narrate: thinking, and how long once it is long', () => {
  const st = story(THINKING)
  expect(st).toMatchObject({ now: 'The worker is thinking.', caption: 'thinking', outcome: null })
  expect(story(THINKING, T + 120).now).toBe('The worker has been thinking for 2 minutes.')
  expect(story(THINKING, T + 120).caption).toBe('thinking')
})

test('narrate: reading the conversation before it answers', () => {
  // The demo reads its prompt from 6 s to 9 s.
  const s = demoSummary(7, T + 7)
  const a = activity(s, T + 7)
  expect(a.state).toBe('prefill')
  const st = storyOf(s, a, memoryOf(s, T + 7), T + 7, WORKER)
  expect(st.now).toBe('The worker is reading through the conversation before it answers.')
  expect(st.caption).toBe('reading the conversation')
})

test('narrate: a tool call is said as what it does, with how long once it is long', () => {
  expect(story(RUNNING)).toMatchObject({ now: 'The worker is running the tests.', caption: 'running the tests' })
  expect(story(RUNNING, T + 200).now).toBe('The worker has been running the tests for 3 minutes.')
  expect(story(running('Read', 'src/todo.ts'))).toMatchObject({ now: 'The worker is reading todo.ts.', caption: 'reading todo.ts' })
})

test('narrate: this session waits on you; a worker waits to start', () => {
  expect(story(SESSION_WAITING)).toMatchObject({ now: 'Your turn: Claude has finished and is waiting for you.', caption: 'your turn', outcome: null })
  const unstarted: Summary = { ...THINKING, started: null, model: null, turns: 0 }
  expect(story(unstarted)).toMatchObject({ now: 'Waiting for the worker to start.', caption: 'waiting for the worker to start' })
  // A session with nothing asked yet.
  const fresh: Summary = { ...SESSION_WAITING, turns: 0, prompt: null }
  expect(story(fresh).now).toBe('Waiting for your first prompt.')
})

test('narrate: a stall says how long and why, once', () => {
  const s: Summary = { ...THINKING, mtime: T - 240, last_ts: T - 240, pending: { kind: 'model', since: T - 240 } }
  const st = story(s)
  expect(st.now).toBe('Nothing has happened for 4 minutes; the worker may be stuck waiting on the model.')
  expect(st.caption).toBe('quiet for 4 minutes')
  expect(st.heads.some(h => /nothing has happened/i.test(h))).toBe(false)
})

test('narrate: nothing to watch yet, or this session before its first prompt', () => {
  expect(story(NOLOG)).toEqual({ now: 'Nothing to watch yet.', caption: 'nothing to watch yet', task: null, soFar: [], heads: [], outcome: null, claims: [] })
  expect(story(SESSION_NOFILE)).toMatchObject({ now: 'Waiting for your first prompt.', caption: 'waiting for your first prompt', task: null })
})

test('narrate: an ended run has no now, only the outcome', () => {
  expect(story(FINISHED)).toMatchObject({ now: null, caption: 'finished' })
  expect(story(FAILED)).toMatchObject({ now: null, caption: 'stopped' })
})

// ── Tool calls

test('narrate: the file tools name the file, not its path', () => {
  expect(toolDoing('Read', 'src/deep/store.ts').long).toBe('reading store.ts')
  expect(toolDoing('Edit', 'src/todo.ts').long).toBe('editing todo.ts')
  expect(toolDoing('MultiEdit', 'src/todo.ts').long).toBe('editing todo.ts')
  expect(toolDoing('Write', 'tests/due.test.ts').long).toBe('writing due.test.ts')
  expect(toolDoing('NotebookEdit', 'notes/explore.ipynb').long).toBe('editing a notebook')
  expect(toolDoing('Read', '').long).toBe('reading a file')
  const long = toolDoing('Read', 'src/a-very-long-module-name-for-the-due-date-parser.ts')
  expect(long.short.length <= CAPTION_MAX).toBe(true)
  expect(long.short.startsWith('reading ')).toBe(true)
})

test('narrate: searching, looking and the web', () => {
  expect(toolDoing('Grep', 'dueDate')).toEqual({ long: 'searching the code for “dueDate”', short: 'searching for “dueDate”' })
  expect(toolDoing('Grep', 'validateTitle in src').long).toBe('searching the code for “validateTitle”')
  const wide = toolDoing('Grep', 'export function (parseDue|formatDue|compareDue)\\(')
  expect(wide.long.length < 70).toBe(true)
  expect(wide.short.length <= CAPTION_MAX).toBe(true)
  expect(toolDoing('Glob', 'src/**/*.ts').long).toBe('looking for files')
  expect(toolDoing('LS', 'src').long).toBe('looking around the project')
  expect(toolDoing('WebFetch', 'https://example.com/docs').long).toBe('reading a web page')
  expect(toolDoing('WebSearch', 'date parsing').long).toBe('searching the web')
})

test('narrate: helpers, the to-do list, connected tools and the unknown', () => {
  expect(toolDoing('Task', 'review the diff')).toEqual({ long: 'handing part of the job to a helper', short: 'handing work to a helper' })
  expect(toolDoing('Agent', 'explore').long).toBe('handing part of the job to a helper')
  expect(toolDoing('TodoWrite', '{}').long).toBe('updating its to-do list')
  expect(toolDoing('mcp__lookout__status', '{}').long).toBe('using lookout')
  expect(toolDoing('mcp__plugin_engineering_tracker__search', '{}').long).toBe('using tracker')
  expect(toolDoing('mcp__claude_ai_Team_Calendar__list', '{}').long).toBe('using Team Calendar')
  expect(toolDoing('Frobnicate', '{}').long).toBe('using Frobnicate')
})

test('narrate: shell commands by what they do', () => {
  const cases: [string, string][] = [
    ['npm test', 'running the tests'],
    ['npm test -- todo', 'running the tests'],
    ['pnpm run test:unit', 'running the tests'],
    ['yarn test', 'running the tests'],
    ['bun test', 'running the tests'],
    ['npx vitest run', 'running the tests'],
    ['jest --watch=false', 'running the tests'],
    ['python -m pytest -q', 'running the tests'],
    ['pytest tests/', 'running the tests'],
    ['go test ./...', 'running the tests'],
    ['cargo test', 'running the tests'],
    ['mocha', 'running the tests'],
    ['claude plugin test .', 'running the tests'],
    ['cd app && npm test 2>&1 | tail -20', 'running the tests'],
    ['npx tsc --noEmit', 'checking the types'],
    ['npm run typecheck', 'checking the types'],
    ['mypy src', 'checking the types'],
    ['npm run lint', 'checking the code style'],
    ['eslint src', 'checking the code style'],
    ['ruff check .', 'checking the code style'],
    ['npm run build', 'building the project'],
    ['cargo build --release', 'building the project'],
    ['git commit -m "Sort todos"', 'saving its work as a commit'],
    ['git add -A && git commit -m "x"', 'saving its work as a commit'],
    ['git -C app commit -m "x"', 'saving its work as a commit'],
    ['git push --force', 'pushing its work'],
    ['git status', 'checking what changed'],
    ['git diff --stat', 'checking what changed'],
    ['git log --oneline -5', 'checking what changed'],
    ['git show HEAD', 'checking what changed'],
    ['npm i date-fns', 'installing packages'],
    ['npm install', 'installing packages'],
    ['pip install requests', 'installing packages'],
    ['ls -la src', 'looking around the project'],
    ['cat src/todo.ts', 'looking around the project'],
    ['find . -name "*.ts"', 'looking around the project'],
    ['head -20 README.md', 'looking around the project'],
    ['rg dueDate src', 'looking around the project'],
    ['mkdir -p src/due', 'moving files around'],
    ['mv a.ts b.ts', 'moving files around'],
    ['rm -rf dist', 'moving files around'],
    ['curl -s https://example.com', 'fetching something from the web'],
    ['wget https://example.com/a.tgz', 'fetching something from the web'],
    ['FOO=1 ./scripts/seed.sh', 'running a command (seed.sh)'],
    ['make-coffee --strong', 'running a command (make-coffee)'],
  ]
  for (const [cmd, said] of cases) expect([cmd, shellDoing(cmd)]).toEqual([cmd, said])
})

test('narrate: Bash uses the running command when it has one, else its label (a command or a description)', () => {
  // The label is the description; the running last command is the same call.
  const s = running('Bash', 'Run the todo tests', { last_bash: { ...RUNNING.last_bash!, cmd: 'npx vitest run todo', status: 'running', t: T - 4 } })
  expect(story(s).now).toBe('The worker is running the tests.')
  // A description alone is read for what it says.
  expect(toolDoing('Bash', 'Typecheck the project').long).toBe('checking the types')
  expect(toolDoing('Bash', 'Commit the parser change').long).toBe('saving its work as a commit')
  expect(toolDoing('Bash', 'Seed the local database').long).toBe('running a command')
  expect(story(SESSION_RUNNING)).toMatchObject({ now: 'Claude is checking the types.', caption: 'checking the types' })
  // A command alone is read as a command.
  expect(toolDoing('Bash', 'git status').long).toBe('checking what changed')
  expect(toolDoing('Bash', '').long).toBe('running a command')
  // A finished last command is an earlier call: the label speaks for the pending one.
  const old = running('Bash', 'git push', { last_bash: { ...RUNNING.last_bash!, cmd: 'npm test', status: 'ok', t: T - 100 } })
  expect(story(old).now).toBe('The worker is pushing its work.')
})

// ── The task

test('narrate: the task, this session or a worker, one line and cut', () => {
  expect(story(SESSION_WAITING).task).toBe(`You asked: "Now add a --due flag to the CLI's add command."`)
  expect(story(RUNNING).task).toBe('Working on: "Fix empty-title validation in the todo store"')
  expect(story(THINKING).task).toBe(null)
  expect(story({ ...SESSION_WAITING, prompt: null }).task).toBe(null)
  const loose: Summary = { ...RUNNING, handoff: { ...RUNNING.handoff!, text: '  Add   due dates\nthen the overdue view' } }
  expect(story(loose).task).toBe('Working on: "Add due dates"')
  const long: Summary = { ...SESSION_WAITING, prompt: { text: 'Add a due date to every todo, parse relative dates like tomorrow and next week, sort by it, and show the overdue ones first', t: T } }
  const task = story(long).task!
  expect(task.startsWith('You asked: "Add a due date')).toBe(true)
  expect(task.endsWith('…"')).toBe(true)
  expect(task.length <= 'You asked: ""'.length + 90).toBe(true)
})

// ── So far

test('narrate: so far, the three facts that say the most', () => {
  expect(story(RUNNING).soFar).toEqual(['21 minutes, 18 turns', 'tests: 10 of 11 passing', 'changed 3 files'])
  // Early on, nothing changed and no tests: the cost fills the third place.
  const early: Summary = { ...THINKING, files: [] }
  expect(story(early).soFar).toEqual(['1 minute, 3 turns', 'no changes yet', 'about $0.04 at API prices'])
  // All passing.
  expect(story(SESSION_WAITING).soFar).toEqual(['15 minutes, 9 turns', 'tests: all 12 passing', 'changed 1 file'])
  // A run with no tests yet and a context window over half full.
  const half: Summary = { ...RUNNING, tests: [], ctx: 80_000 }
  expect(story(half).soFar).toEqual(['21 minutes, 18 turns', 'changed 3 files', 'context window 61% full'])
  // Commits before the cost.
  expect(story({ ...RUNNING, tests: [] }).soFar).toEqual(['21 minutes, 18 turns', 'changed 3 files', 'made 2 commits'])
  // The log reader lists at most eight files.
  const many: Summary = { ...RUNNING, files: Array.from({ length: 8 }, (_, i) => [`src/f${i}.ts`, 1] as [string, number]) }
  expect(story(many).soFar).toContain('changed at least 8 files')
  // Never more than three.
  for (const s of [RUNNING, THINKING, FINISHED, FAILED, SESSION_WAITING]) expect(story(s).soFar.length <= 3).toBe(true)
})

test('narrate: so far after the end leaves the time to the outcome, and names the real cost', () => {
  expect(story(FINISHED).soFar).toEqual(['tests: all 24 passing', 'changed 2 files', 'made 1 commit'])
  const bare: Summary = { ...FINISHED, tests: [], git: null }
  expect(story(bare).soFar).toEqual(['changed 2 files', 'cost $1.86'])
  // The run's totals of failed and blocked calls, when there is room for them.
  expect(story(FAILED).soFar).toEqual(['tests: 14 of 16 passing', 'changed 1 file', 'along the way, 3 tool calls failed and 1 action was blocked'])
  expect(story({ ...bare, errors: 2, denials: 0 }).soFar).toEqual(['changed 2 files', 'cost $1.86', 'along the way, 2 tool calls failed'])
  expect(story({ ...RUNNING, tests: [], git: null, errors: 4 }).soFar.some(f => f.startsWith('along the way'))).toBe(false)
  expect(story(NOLOG).soFar).toEqual([])
})

// ── Worth a look

test('narrate: worth a look, worst first, at most three', () => {
  expect(story(RUNNING).heads).toEqual(['1 test is failing — the worker is working on it', '1 tool call failed in the last few minutes'])
  const events = [...calls('error', 200, 120, 30), ...calls('denied', 90, 20)]
  const bad: Summary = { ...RUNNING, tests: [{ t: T - 10, failed: 3, passed: 8, total: 11 }], tsc: [{ t: T - 9, errors: 4 }], events, errors: 5, denials: 2, ctx: 125_000 }
  expect(story(bad).heads).toEqual(['3 tests are failing — the worker is working on it', 'the last type check found 4 errors', '2 actions were blocked by your permission settings just now'])
  // Lower down the list, once the worse ones clear.
  const later: Summary = { ...bad, tests: [], tsc: [{ t: T - 9, errors: 0 }] }
  expect(story(later).heads).toEqual(['2 actions were blocked by your permission settings just now', '3 tool calls failed just now', 'the context window is nearly full; older detail may be summarised away'])
  // All is well.
  expect(story({ ...RUNNING, tests: [], events: calls('ok', 30) }).heads).toEqual([])
  // Not live: nobody is working on it.
  expect(story({ ...SESSION_WAITING, tests: [{ t: T - 60, failed: 1, passed: 11, total: 12 }] }).heads).toEqual(['1 test is failing'])
})

test('narrate: failed and blocked calls are worth a look for the last few minutes only', () => {
  // A long run with old trouble and a clean last five minutes: calm goes quiet.
  const old: Summary = { ...RUNNING, tests: [], tsc: [], errors: 14, denials: 3, events: [...calls('error', 3000, 1200, 400), ...calls('denied', 2000, RECENT_SECS + 1), ...calls('ok', 60, 5)] }
  expect(story(old).heads).toEqual([])
  // Inside the window, counted from the timeline; under a minute is just now.
  const mixed: Summary = { ...old, events: [...old.events!, ...calls('error', 250, 100), ...calls('denied', RECENT_SECS)] }
  expect(story(mixed).heads).toEqual(['1 action was blocked by your permission settings in the last few minutes', '2 tool calls failed in the last few minutes'])
  expect(recent({ ...old, events: calls('error', 250, 59) }, T, 'error')).toEqual({ n: 2, when: 'just now' })
  expect(recent({ ...old, events: calls('denied', 61) }, T, 'denied')).toEqual({ n: 1, when: 'in the last few minutes' })
  // Rows with no time, other statuses and a clock behind the row count for nothing.
  const odd: Summary = { ...old, events: [{ ...calls('error', 10)[0]!, t: null }, ...calls('ok', 10), ...calls('error', -30)] }
  expect(recent(odd, T, 'error').n).toBe(0)
  // Five minutes on, the same run is quiet again.
  expect(story(mixed, T + RECENT_SECS + 1).heads.some(h => /failed|blocked/.test(h))).toBe(false)
})

test('narrate: Claude keeps its capital mid-sentence', () => {
  const s: Summary = { ...SESSION_RUNNING, tests: [{ t: T - 60, failed: 2, passed: 10, total: 12 }] }
  expect(story(s).heads[0]).toBe('2 tests are failing — Claude is working on it')
})

test('narrate: a context window nearly full is worth a look, not a fact', () => {
  const full: Summary = { ...RUNNING, tests: [], events: [], ctx: 120_000 }
  const st = story(full)
  expect(st.heads).toEqual(['the context window is nearly full; older detail may be summarised away'])
  expect(st.soFar.some(f => f.startsWith('context window'))).toBe(false)
})

// ── The outcome

test('narrate: how the run ended, in one sentence', () => {
  expect(story(FINISHED).outcome).toBe('Finished in 30 minutes after 42 turns: all 24 tests pass and it made 1 commit.')
  expect(story(FAILED).outcome).toBe('Stopped after 39 minutes and 60 turns: it hit its turn limit; 2 of 16 tests are still failing.')
  // The failing tests are told by the outcome, not again under worth a look.
  expect(story(FAILED).heads.some(h => /tests? (is|are) failing/.test(h))).toBe(false)
  const crash: Summary = { ...FAILED, tests: [], result: { ...FAILED.result!, subtype: 'error_during_execution' } }
  expect(story(crash).outcome).toBe('Stopped after 39 minutes and 60 turns: something went wrong while it was working.')
  const odd: Summary = { ...FAILED, tests: [], result: { ...FAILED.result!, subtype: 'error_something_new' } }
  expect(story(odd).outcome).toBe('Stopped after 39 minutes and 60 turns: it ended with an error.')
  const plain: Summary = { ...FINISHED, tests: [], git: null }
  expect(story(plain).outcome).toBe('Finished in 30 minutes after 42 turns.')
  // A log that stopped with no result row.
  const ended: Summary = { ...THINKING, pending: { kind: 'done' } }
  expect(story(ended).outcome).toBe('Stopped after 1 minute: the log ended without saying how it finished.')
})

test('narrate: a session never has an outcome', () => {
  for (const s of [SESSION_WAITING, SESSION_RUNNING, SESSION_NOFILE]) expect(story(s).outcome).toBe(null)
  // Even handed a done activity, it is the person's move.
  const st = storyOf(SESSION_WAITING, { ...activity(SESSION_WAITING, T), state: 'done', ok: true }, memoryOf(SESSION_WAITING, T), T, CLAUDE)
  expect(st).toMatchObject({ now: 'Your turn: Claude has finished and is waiting for you.', caption: 'your turn', outcome: null })
})

// ── Claims

test('narrate: claims are the facts the drawn lines spell out, each once', () => {
  // The task (the hand-off), time and turns, tests, a failing test and a failed call; the files
  // line claims nothing, and the commits fact stays unclaimed: its line fell past the third place.
  expect(story(RUNNING).claims).toEqual(['handoff', 'elapsed', 'turns', 'checks', 'errors'])
  expect(story(RUNNING).soFar.some(f => /commit/.test(f))).toBe(false)
  // Early on: time and turns, and the cost.
  expect(story({ ...THINKING, files: [] }).claims).toEqual(['elapsed', 'turns', 'cost'])
  // The context window, as a fact or as worth a look.
  expect(story({ ...RUNNING, tests: [], ctx: 80_000 }).claims).toEqual(['handoff', 'elapsed', 'turns', 'ctx', 'errors'])
  expect(story({ ...RUNNING, tests: [], events: [], ctx: 120_000 }).claims).toEqual(['handoff', 'elapsed', 'turns', 'git', 'ctx'])
  // This session's prompt is its hand-off.
  expect(story(SESSION_WAITING).claims).toEqual(['handoff', 'elapsed', 'turns', 'checks'])
  // Ended: so far's tests and commits, then the outcome's time, turns, tests and commits.
  expect(story(FINISHED).claims).toEqual(['handoff', 'checks', 'git', 'elapsed', 'turns'])
  expect(story(FAILED).claims).toEqual(['checks', 'errors', 'elapsed', 'turns'])
  // A stall told under worth a look is like Now: no claim.
  const quiet: Summary = { ...RUNNING, tests: [], events: [], stalled: true, mtime: T - 400, handoff: null, git: null, files: [], cost: null }
  expect(story(quiet).heads).toEqual(['nothing has happened for 6 minutes'])
  expect(story(quiet).claims).toEqual(['elapsed', 'turns'])
  expect(story(NOLOG).claims).toEqual([])
})

test('narrate: every demo frame claims exactly what its lines say', () => {
  // A word check over the drawn lines, as a cross-check on the tags.
  const said: [string, RegExp][] = [
    ['turns', /\b\d+ turns?\b/],
    ['checks', /\btests?\b|type check/],
    ['git', /\bcommits?\b/],
    ['errors', /failed|blocked/],
    ['ctx', /context window/],
    ['cost', /\$\d|a cent/],
  ]
  for (const { e, st } of demoWalk(1)) {
    const lines = [...st.soFar, ...st.heads, ...(st.outcome ? [st.outcome] : [])]
    for (const [fact, re] of said) {
      const has = st.claims.includes(fact as Story['claims'][number])
      expect([e, fact, has]).toEqual([e, fact, lines.some(l => re.test(l))])
    }
    expect(new Set(st.claims).size).toBe(st.claims.length)
  }
})

// ── The demo, frame by frame

test('narrate: every demo frame has a short caption, a now or an outcome, and no jargon', () => {
  for (const loops of [0, 1, 6]) {
    for (const { e, st } of demoWalk(loops)) {
      expect([loops, e, st.caption, st.caption.length <= CAPTION_MAX]).toEqual([loops, e, st.caption, true])
      expect([loops, e, (st.now == null) !== (st.outcome == null)]).toEqual([loops, e, true])
      expect([loops, e, jargonIn(st)]).toEqual([loops, e, []])
      expect(st.soFar.length <= 3 && st.heads.length <= 3).toBe(true)
      expect(st.task).toBe('Working on: "Add due dates to todo items, with tests"')
    }
  }
})

test('narrate: the demo loop reads as a story', () => {
  const at = (e: number) => demoWalk(0).find(f => f.e === e)!.st
  expect(at(2).now).toBe('The worker is thinking.')
  expect(at(10).caption).toBe('running the tests')
  expect(at(22).now).toBe('The worker is editing todo.ts.')
  expect(at(27).caption).toBe('searching for “dueDate”')
  expect(at(44).caption).toBe('handing work to a helper')
  expect(at(52).heads[0]).toBe('2 tests are failing — the worker is working on it')
  expect(at(55).caption).toBe('checking the code style')
  expect(at(56).caption).toBe('pushing its work')
  expect(at(58).heads).toEqual(['2 tests are failing — the worker is working on it', '1 action was blocked by your permission settings just now', '2 tool calls failed just now'])
  expect(at(62).caption).toBe('quiet for 2 seconds')
  expect(at(66)).toMatchObject({ now: null, caption: 'finished', outcome: 'Finished in 1 minute after 16 turns: all 12 tests pass and it made 1 commit.' })
  expect(at(70)).toMatchObject({ caption: 'stopped', outcome: 'Stopped after 1 minute and 16 turns: it hit its turn limit; all 12 tests pass and it made 1 commit.' })
})

test('narrate: no jargon in any fixture or tool phrase', () => {
  for (const s of [RUNNING, THINKING, FINISHED, FAILED, NOLOG, SESSION_WAITING, SESSION_RUNNING, SESSION_NOFILE]) {
    for (const t of [T, T + 300]) expect(jargonIn(story(s, t))).toEqual([])
  }
  const labels = (tool: string) => (tool === 'Bash' ? ['npx tsc --noEmit', 'Run tsc', 'git status', ''] : ['src/todo.ts', 'dueDate', ''])
  for (const tool of ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookEdit']) {
    for (const label of labels(tool)) {
      const d = toolDoing(tool, label)
      expect([tool, label, JARGON.some(re => re.test(d.long) || re.test(d.short))]).toEqual([tool, label, false])
    }
  }
})

test('narrate: pure, the same inputs tell the same story', () => {
  expect(JSON.stringify(story(RUNNING))).toBe(JSON.stringify(story(RUNNING)))
})
