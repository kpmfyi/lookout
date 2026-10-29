import { expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteInput, ModelCompleteResult, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import type { Summary } from '../types'
import { fmtDur } from '../hooks/activity.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { PaletteId } from '../hooks/palette.ts'
import { seasonTones } from '../hooks/seasons.ts'
import { SCENES, nextScene, rowsFor, sceneById } from '../hooks/scenes/index.ts'
import { EXPLAIN_SYSTEM, parseExplained, runsText, thoughtKey } from '../hooks/thought.ts'
import { demoPlain } from '../hooks/demo.ts'
import { fixtureLogs } from './log-fixtures.ts'
import {
  CWD, HOME, LOCAL, LOG, NOON, SESSION_FILE, SESSION_ID, StreamLog, T, World,
  appendTests, failed, finished, quick, running, say, session, sessionEnds, sessionTests, sessionThinks, thinking,
} from './pane-world.ts'
import type { RunningOpts } from './pane-world.ts'

const PANE = {
  plugin: 'lookout',
  component: 'Pane',
  requestId: 'lookout',
  props: {
    title: 'Lookout',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const WIDE = { ...PANE, props: { ...PANE.props, bodyColumns: 140 } }

/** The scene a fresh session draws: the first of the lineup. */
const DEFAULT = SCENES[0]!.id

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

type Scene = (w: World) => unknown

/** A world holding each scene's files (tests/pane-world.ts). */
function world(...scenes: Scene[]): World {
  const w = new World()
  for (const s of scenes) s(w)
  return w
}

/** What the real log reader makes of a scene's log: what the pane is expected to show. */
async function expected(scene: (w: World) => string): Promise<Summary> {
  const w = new World()
  return w.summary(scene(w))
}

// The scenes as the reader reads them (docs/DESIGN.md 43.5): each test's world holds the same logs.
const RUNNING = await expected(w => running(w))
const THINKING = await expected(w => thinking(w))
const FINISHED = await expected(w => finished(w, { path: LOG }))
const FAILED = await expected(w => failed(w))
const SESSION_RUNNING = await expected(w => session(w))

const runningAt = (o: RunningOpts): Scene => w => running(w, o)
const finishedAt = (path: string, end?: number): Scene => w => finished(w, { path, end })
const NO_LOG: Scene = () => undefined

type Tool = { name: string; description: string; inputSchema?: Record<string, unknown> }
type Command = { name: string; description: string; argumentHint?: string }

/**
 * Stand in for the engine: `w` answers the mod's files, commands and model servers, so the real
 * log reader runs over the world's logs (tests/pane-world.ts); the engine's clock starts at the
 * scenes' T. The worker log of the convention exists when the world has it; the session id is
 * SESSION_ID unless `sessionId` says otherwise. Registered tools and commands are recorded.
 */
function engine(
  on: On,
  w: World,
  o: { env?: Record<string, string>; tools?: Tool[]; commands?: Command[]; sessionId?: () => string } = {},
): MockClock {
  const env = o.env ?? {}
  on('env.get', (_, e) => ({ value: env[e.name] }))
  w.install(on)
  on('session.id', () => ({ value: o.sessionId?.() ?? SESSION_ID }))
  const clock = mock.clock(on, { now: T * 1000 })
  on('command.register', (_, e) => {
    o.commands?.push(e)
    return { value: { command: 'lookout' } }
  })
  on('tool.register', (_, e) => {
    o.tools?.push(e)
    return { value: { tool: `mcp__lookout__${e.name}` } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return clock
}

/** The log the reader read last: the newest stream-json log or transcript the mod stat'ed (runs.jsonl aside). */
function followed(w: World): string | undefined {
  return w.stats.findLast(p => p.endsWith('.jsonl') && !p.endsWith('/runs.jsonl'))
}

/** Start a session in the fixture project and let the first poll land. */
async function boot($: Engine, clock: MockClock): Promise<void> {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await clock.settle()
}

/** Run `/lookout <args>` as the person would type it. */
function lookout($: Engine, args: string) {
  return $.command.run({ command: 'lookout', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

const SECTIONS = [/^Time$/, /^Pace$/, /^Checks$/, /^Thinking$/, /^Timeline$/]

for (const [name, scene, fixture] of [
  ['running', (w: World) => running(w), RUNNING],
  ['thinking', (w: World) => thinking(w), THINKING],
  ['finished', finishedAt(LOG), FINISHED],
  ['failed', (w: World) => failed(w), FAILED],
] as const) {
  test(`the pane draws a ${name} run on every surface`, { options: { layout: 'detailed' } }, async ($, on) => {
    const clock = engine(on, world(scene))
    await boot($, clock)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const term = surface === 'terminal'
      if (term) {
        // The scene and the module grid are painted Rasters on the terminal (docs/DESIGN.md 43.2).
        expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
        expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeTruthy()
        expect(await ui.find({ type: 'Raster', key: 'pace' })).toBeFalsy()
      } else {
        expect((await ui.find({ type: 'Text', text: new RegExp(fixture.model!) }))?.text).toContain(fixture.model!)
      }
      // Off the terminal detailed draws as classic did: the dashboard's blocks; on it the modules stand in for them.
      for (const title of SECTIONS) {
        if (title.source.includes('Checks') && !fixture.tests?.length) continue
        const block = !/Thinking|Timeline/.test(title.source)
        expect(!!(await ui.find({ type: 'Text', text: title }))).toBe(!(term && block))
      }
      const server = await ui.find({ type: 'Text', text: /^Model server$/ })
      if (fixture.server && !term) expect(server).toBeTruthy()
      else expect(server).toBeFalsy()
      if (fixture.result) expect(await ui.find({ type: 'Text', text: /^Result$/ })).toBeTruthy()
      if (name === 'running') {
        expect(await ui.find({ type: 'Text', text: /^Last command$/ })).toBeTruthy()
        expect(!!(await ui.find({ type: 'Text', text: /^Git$/ }))).toBe(!term)
        expect(!!(await ui.find({ type: 'Text', text: /in flight/ }))).toBe(!term)
        expect(!!(await ui.find({ type: 'Text', text: /\(estimate\)/ }))).toBe(!term)
      }
      if (name === 'finished') expect(!!(await ui.find({ type: 'Text', text: /real \$1\.86/ }))).toBe(!term)
      if (name === 'failed') {
        expect(await ui.find({ type: 'Text', text: /error_max_turns/ })).toBeTruthy()
        expect(await ui.find({ type: 'Text', text: / denied$/ })).toBeTruthy()
      }
      await ui.unmount()
    }
  })
}

test('a model server that does not answer is said so in the Model server block', { options: { layout: 'detailed', server: 'llama.cpp', serverUrl: 'http://127.0.0.1:9' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Model server$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /server did not answer/ })).toBeTruthy()
  await ui.unmount()
})

test('a missing log says what it waits for, on every surface', { options: { log: LOG } }, async ($, on) => {
  const clock = engine(on, world(NO_LOG))
  await boot($, clock)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /waiting for .*worker-current\.jsonl/ })).toBeTruthy()
    // A worker log that is not there may never come: the other two ways in are named.
    const hint = await ui.find({ type: 'Text', text: /\/lookout session/ })
    expect(hint?.text).toContain('/lookout demo')
    await ui.unmount()
  }
})

test('a poll with no source yet takes the default instead of waiting on an empty path', async ($, on) => {
  const w = world(w => thinking(w))
  const clock = engine(on, w)
  // session.start's writes of the source are lost, as when another copy of the mod answered first.
  let starting = true
  on('state.set', (_, e, next) => (starting && e.plugin === 'lookout' && (e.key === 'logPath' || e.key === 'sourceName') ? { value: { isSet: false, version: 1 } } : next(e)))
  await boot($, clock)
  starting = false
  await clock.advance(1600)
  expect(followed(w)).toBe(LOG)
  expect(JSON.stringify(await lookout($, ''))).toContain(`following ${LOG}`)
})

test('the default log is the convention under the session directory, priced at the default compare', async ($, on) => {
  const w = world(w => thinking(w))
  const clock = engine(on, w)
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(followed(w)).toBe(LOG)
  expect(String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)).toContain('at claude-sonnet-5-5 (estimate)')
  await ui.unmount()
})

test('LOOKOUT_LOG wins over the settings', { options: { log: '~/logs/from-config.jsonl' } }, async ($, on) => {
  const w = world(w => thinking(w, '/srv/logs/from-env.jsonl'))
  const clock = engine(on, w, { env: { LOOKOUT_LOG: '/srv/logs/from-env.jsonl' } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(followed(w)).toBe('/srv/logs/from-env.jsonl')
  await ui.unmount()
})

test(
  'the command switches to a named source',
  { options: { layout: 'detailed', sources: ['worker=~/logs/worker-current.jsonl', 'api=~/logs/api-current.jsonl'] } },
  async ($, on) => {
    const w = world(runningAt({ path: `${HOME}/logs/worker-current.jsonl` }), finishedAt(`${HOME}/logs/api-current.jsonl`))
    const clock = engine(on, w, { env: { HOME } })
    await boot($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(followed(w)).toBe(`${HOME}/logs/worker-current.jsonl`)
    expect(await ui.find({ type: 'Text', text: /local\/qwen-coder-32b-q4/ })).toBeTruthy()

    const ran = await lookout($, 'api')
    expect(JSON.stringify(ran)).toContain('following api')
    expect(followed(w)).toBe(`${HOME}/logs/api-current.jsonl`)
    expect(await ui.find({ type: 'Text', text: /^Result$/ })).toBeTruthy()

    await lookout($, 'next')
    expect(followed(w)).toBe(`${HOME}/logs/worker-current.jsonl`)
    await ui.unmount()
  },
)

test('the scene hotkey cycles the lineup; there is no view hotkey any more', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  // The view and its `v` are retired (docs/DESIGN.md 38.2): calm stands for scene view.
  expect(await ui.find({ type: 'Button', key: 'view' })).toBeFalsy()
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.hotkey === 'v')).toBe(false)

  await ui.press({ key: 'scene' })
  expect(await ui.find({ type: 'Raster', key: SCENES[1]!.id })).toBeTruthy()
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeFalsy()
  // Cycling through the rest of the registry comes back round to the first scene.
  for (let i = 2; i < SCENES.length; i++) {
    await ui.press({ key: 'scene' })
    expect(await ui.find({ type: 'Raster', key: SCENES[i]!.id })).toBeTruthy()
  }
  await ui.press({ key: 'scene' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  await ui.unmount()
})

test('the command picks a scene; a retired one picks its stand-in', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'office-hd')
  expect(await ui.find({ type: 'Raster', key: 'office-hd' })).toBeTruthy()
  await lookout($, 'office')
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeTruthy()
  // docs/DESIGN.md 43.1: controlroom stands as office-hd, aurora as the observatory.
  expect(JSON.stringify(await lookout($, 'controlroom'))).toContain('scene: office hd (controlroom was retired)')
  expect(await ui.find({ type: 'Raster', key: 'office-hd' })).toBeTruthy()
  expect(JSON.stringify(await lookout($, 'aurora'))).toContain('scene: observatory (aurora was retired)')
  expect(await ui.find({ type: 'Raster', key: 'observatory' })).toBeTruthy()
  expect(await ui.find({ type: 'Raster', key: 'aurora' })).toBeFalsy()
  await ui.unmount()
})

for (const [retired, to] of [['controlroom', 'office-hd'], ['aurora', 'observatory']] as const) {
  test(`the \`scene\` setting ${retired} draws ${to}`, { options: { scene: retired } }, async ($, on) => {
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: to })).toBeTruthy()
    expect(await ui.find({ type: 'Raster', key: retired })).toBeFalsy()
    await ui.unmount()
  })

  test(`a scene saved as ${retired} draws ${to} after a reload`, async ($, on) => {
    reloadWith(on, { logPath: LOG, sourceName: 'default', scene: retired })
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: to })).toBeTruthy()
    // `s` goes on from the stand-in.
    expect((await ui.find({ type: 'Button', key: 'scene' }))?.text).toContain(`scene ${nextScene(to).title}`)
    await ui.unmount()
  })
}

test('the orchestrator strip names both models and the handed-off task', { options: { layout: 'detailed' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  // On the terminal the strip module is the hand-off's one home (docs/DESIGN.md 31), so the row is drawn elsewhere.
  for (const surface of SURFACES.filter(x => x !== 'terminal')) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    const strip = await ui.find({ type: 'Text', text: /^you · .*worker · / })
    expect(strip?.text).toContain('claude-opus-5-5')
    expect(strip?.text).toContain(`worker · ${RUNNING.model}`)
    expect(strip?.text).toContain('Fix empty-title validation')
    // The hand-off as a time of day, never a duration beside the elapsed.
    expect(strip?.text).toMatch(/· {2}since \d\d:\d\d$/)
    await ui.unmount()
  }
})

test('without a handoff the strip falls back to the first text', { options: { layout: 'detailed' } }, async ($, on) => {
  const clock = engine(on, world(w => thinking(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  const strip = await ui.find({ type: 'Text', text: /worker · / })
  expect(strip?.text).toContain('Looking at how todos are stored.')
  await ui.unmount()
})

test('model-server rates show when the adapter gives them', { options: { layout: 'detailed' } }, async ($, on) => {
  // llama.cpp's /metrics (tests/pane-world.ts): 42 tok/s decode, a 37% full KV cache, one request.
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /tok\/s decode/ })
  expect(row?.text).toContain('42')
  expect(row?.text).toContain('37%')
  expect(row?.text).toContain('1 running')
  await ui.unmount()
})

test('with serverUrl empty the reader looks on each server\'s own port; set, on that URL alone', async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  const origins = new Set(w.fetches.map(u => new URL(u).origin))
  for (const port of [8080, 8000, 11434, 1234]) expect(origins.has(`http://127.0.0.1:${port}`)).toBe(true)
  expect(RUNNING.server?.adapter).toBe('llama.cpp')
})

test('a serverUrl setting is the one URL the reader asks', { options: { serverUrl: 'http://127.0.0.1:8080' } }, async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  expect(new Set(w.fetches.map(u => new URL(u).origin))).toEqual(new Set(['http://127.0.0.1:8080']))
  // /lookout worker hands the script that URL rather than a name it would look for on the default port.
  expect(await commandText(lookout($, 'worker'))).toContain('/scripts/lookout-worker --server http://127.0.0.1:8080 --model qwen-coder-32b-q4 "the task"')
})

/** The [fg, bg] of the top-left cell of a Raster's encoded cells. */
function topLeft(cells: unknown): [number, number] {
  const bin = atob(String(cells))
  const bytes = new Uint8Array(12)
  for (let i = 0; i < 12; i++) bytes[i] = bin.charCodeAt(i)
  const w = new Uint32Array(bytes.buffer)
  return [w[1]!, w[2]!]
}
const NONE = 0x01000000

test('by default the scenes leave their background to the terminal', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  await lookout($, 'office')
  const office = await ui.find({ type: 'Raster', key: 'office' })
  expect(office).toBeTruthy()
  expect(topLeft(office!.props.cells)).toEqual([NONE, NONE])
  await ui.unmount()
})

test('the `background` setting `scene` paints the scene backgrounds', { options: { background: 'scene' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  await lookout($, 'office')
  const office = await ui.find({ type: 'Raster', key: 'office' })
  expect(office).toBeTruthy()
  expect(topLeft(office!.props.cells)).not.toEqual([NONE, NONE])
  await ui.unmount()
})

test('no money shows when compare is off', { options: { compare: 'off' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /\$\d+\.\d\d/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /estimate/ })).toBeFalsy()
    await ui.unmount()
  }
  // The reader prices nothing: no cost line for the orchestrator either.
  expect(String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)).not.toContain('cost:')
})

test('on the terminal detailed prints the model and the stats no module claims under the scene', { options: { layout: 'detailed', modules: ['clock'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: new RegExp(`${RUNNING.model!}$`) })).toBeTruthy()
  const stats = await ui.find({ type: 'Text', text: /^turn \d+ · ctx/ })
  expect(stats?.text).toContain(`turn ${RUNNING.turns}`)
  // The server gives the context limit, so the share shows.
  expect(stats?.text).toMatch(/ctx [\d.]+k\/[\d.]+k · \d+%/)
  expect(stats?.text).toContain(`${RUNNING.errors} err`)
  expect(stats?.text).toMatch(/≈\$\d+\.\d\d at /)
  await ui.unmount()
})

test('with compare off the stats row under the scene shows no money', { options: { compare: 'off', layout: 'detailed', modules: ['clock'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const stats = await ui.find({ type: 'Text', text: /^turn \d+ · ctx/ })
  expect(stats).toBeTruthy()
  expect(stats?.text).not.toContain('$')
  await ui.unmount()
})

test('a summary an earlier version stored is declined', async ($, on) => {
  on('state.get', (_, e) => (e.key === 'summary' ? { value: { value: { path: '/x', exists: true, api_eq_sonnet: 1 }, version: 1 } } : { value: { value: undefined, version: 0 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /reading log/ })).toBeTruthy()
  await ui.unmount()
})

test('the tick repaints only the mounted scene, at the mounted size, while the worker is live', async ($, on) => {
  const blits: { key: string; columns?: number; rows?: number; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e) blits.push({ key: e.key, columns: e.columns, rows: e.rows, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(360)
  expect(blits.length).toBeGreaterThan(0)
  const rows = rowsFor(sceneById(DEFAULT), 'standard')
  for (const b of blits) {
    expect(b.key).toBe(DEFAULT)
    expect(b.columns).toBe(80)
    expect(b.rows).toBe(rows)
    expect(atob(b.cells).length).toBe(80 * rows * 3 * 4)
  }
  await ui.unmount()
})

test('/lookout large draws the scene at its large height and the tick blits that height', async ($, on) => {
  const blits: { key: string; columns?: number; rows?: number; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e) blits.push({ key: e.key, columns: e.columns, rows: e.rows, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'office')
  const result = await lookout($, 'large')
  expect(JSON.stringify(result)).toContain('scene size: large')
  const rows = rowsFor(sceneById('office'), 'large')
  const raster = await ui.find({ type: 'Raster', key: 'office' })
  expect(raster).toBeTruthy()
  expect(raster!.props.rows).toBe(rows)
  expect(atob(String(raster!.props.cells)).length).toBe(80 * rows * 3 * 4)
  blits.length = 0
  await clock.advance(360)
  expect(blits.length).toBeGreaterThan(0)
  for (const b of blits) {
    expect(b.key).toBe('office')
    expect(b.rows).toBe(rows)
    expect(atob(b.cells).length).toBe(80 * rows * 3 * 4)
  }
  await ui.unmount()
})

test('the `sceneSize` setting picks the height a fresh session draws at', { options: { sceneSize: 'compact' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster', key: DEFAULT })
  expect(raster).toBeTruthy()
  expect(raster!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'compact'))
  await ui.unmount()
})

test('a missing log is not animated', { options: { log: LOG } }, async ($, on) => {
  let blits = 0
  on('ui.blit', () => {
    blits++
    return { value: {} }
  })
  const clock = engine(on, world(NO_LOG))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(600)
  expect(blits).toBe(0)
  await ui.unmount()
})

test('/lookout demo draws the scripted run without reading any log and shows the demo tag', { options: { layout: 'detailed' } }, async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  const ran = await lookout($, 'demo')
  expect(JSON.stringify(ran)).toContain('demo')
  const reads = [w.stats.length, w.reads.length, w.runs.length, w.fetches.length]
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    if (surface === 'terminal') {
      // The strip module carries the hand-off there (docs/DESIGN.md 31).
      expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
      expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeTruthy()
    } else {
      const strip = await ui.find({ type: 'Text', text: /worker · / })
      expect(strip?.text).toContain('local/qwen-coder-32b-q4 · demo')
      expect(strip?.text).toContain('Add due dates to todo items')
      expect(await ui.find({ type: 'Text', text: /^. local\/qwen-coder-32b-q4 · demo$/ })).toBeTruthy()
    }
    await ui.unmount()
  }
  await clock.advance(4_500)
  expect([w.stats.length, w.reads.length, w.runs.length, w.fetches.length]).toEqual(reads)

  // Any other source leaves the demo.
  await lookout($, '/srv/logs/other.jsonl')
  expect(followed(w)).toBe('/srv/logs/other.jsonl')
})

test('the `log` setting `demo` plays the demo without ever running the log reader', { options: { log: 'demo', layout: 'detailed' } }, async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /· demo/ })).toBeTruthy()
  await ui.unmount()
  expect(followed(w)).toBeUndefined()
  expect(w.runs).toEqual([])
  expect(w.fetches).toEqual([])
})

// ── One renderer (docs/DESIGN.md 43.3): the image path is gone, so a terminal that draws images
// gets the glyph scene like any other.

test('the scene is a Raster even on Ghostty, and never an Image', async ($, on) => {
  const clock = engine(on, world(w => running(w)), { env: { TERM_PROGRAM: 'ghostty' } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: DEFAULT })).toBeTruthy()
  expect(await ui.find({ type: 'Image' })).toBeFalsy()
  await ui.unmount()
})

// ── The orchestrator's own activity and the status tool (docs/DESIGN.md 17, 18)

test('the status tool is registered once at session start, named status', async ($, on) => {
  const tools: Tool[] = []
  const clock = engine(on, world(w => running(w)), { tools })
  await boot($, clock)
  expect(tools.length).toBe(1)
  expect(tools[0]!.name).toBe('status')
  expect(tools[0]!.description).toContain('never starts, stops or steers the worker')
  expect(JSON.stringify(tools[0]!.inputSchema)).toContain('"enum":["brief","full"]')
})

test('calling the status tool answers with the followed summary', async ($, on) => {
  const w = world(w => running(w), finishedAt('/srv/logs/other.jsonl'))
  const clock = engine(on, w)
  await boot($, clock)
  const brief = await $.tool.call({ tool: 'mcp__lookout__status', detail: 'brief' })
  const text = String(brief.result ?? brief.text)
  expect(text.startsWith('lookout ·')).toBe(true)
  expect(text).toContain('running Bash "Run the todo tests"')
  expect(text).not.toContain('timeline')
  const full = await $.tool.call({ tool: 'mcp__lookout__status', detail: 'full' })
  expect(String(full.result)).toContain(`timeline (last ${Math.min(10, RUNNING.events!.length)}):`)

  // Another source is read once for the call; the pane keeps following its own log.
  const other = await $.tool.call({ tool: 'mcp__lookout__status', source: '/srv/logs/other.jsonl' })
  expect(String(other.result)).toContain('result: success')
  expect(followed(w)).toBe('/srv/logs/other.jsonl')
  const again = await $.tool.call({ tool: 'mcp__lookout__status' })
  expect(String(again.result)).toContain('running Bash')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Result$/ })).toBeFalsy()
  await ui.unmount()
})

test('a status call for a log that is not there says so', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const r = await $.tool.call({ tool: 'mcp__lookout__status', source: '/nowhere.jsonl' })
  expect(String(r.result)).toMatch(/^lookout · worker · following \/nowhere\.jsonl\nstate: log missing: \/nowhere\.jsonl does not exist yet/)
  expect(r.isError).toBeFalsy()
})

test('with the `tool` setting off nothing is registered', { options: { tool: false } }, async ($, on) => {
  const tools: Tool[] = []
  const clock = engine(on, world(w => running(w)), { tools })
  await boot($, clock)
  expect(tools.length).toBe(0)
})

test('the orchestrator turns from thinking to waiting and the office draws it', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await boot($, clock)
  await lookout($, 'office')
  const officeCells = async (): Promise<string> => {
    const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
    const raster = await ui.find({ type: 'Raster', key: 'office' })
    await ui.unmount()
    expect(raster).toBeTruthy()
    return String(raster!.props.cells)
  }
  const before = await officeCells()

  await $.turn.start({ text: 'check the worker', turnId: 't1' })
  const thinkingCells = await officeCells()
  expect(await officeCells()).toBe(thinkingCells) // the same state draws the same office
  expect(thinkingCells).not.toBe(before) // idle → thinking

  await $.turn.complete({ answer: 'done', durationMs: 1200, isAborted: false, turnId: 't1', reason: 'answer' })
  const waiting = await officeCells()
  expect(waiting).not.toBe(thinkingCells)

  // A subagent's turn is not the orchestrator's.
  await $.turn.start({ text: 'sub', turnId: 't2', agentId: 'a1' })
  expect(await officeCells()).toBe(waiting)
})

// ── /lookout worker (docs/DESIGN.md 43.4): the launcher's command line, printed, never run

/** The command's text, as the person reads it. */
async function commandText(r: unknown): Promise<string> {
  return String((await r as { text?: string }).text ?? '')
}

test('/lookout worker prints the launcher for the server the reader found, with its model', async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  const runs = w.runs.length
  const text = await commandText(lookout($, 'worker'))
  expect(text).toMatch(/^Lookout: a worker on llama\.cpp \(qwen-coder-32b-q4\), run from the project folder:\n {2}\S*\/scripts\/lookout-worker --server llama\.cpp --model qwen-coder-32b-q4 "the task"$/)
  // The task, quoted for sh; nothing is run and the pane keeps following its log.
  expect(await commandText(lookout($, "worker add a test for the user's empty title"))).toContain(`--model qwen-coder-32b-q4 'add a test for the user'\\''s empty title'`)
  expect(w.runs.slice(runs).some(a => a.some(x => x.includes('lookout-worker')))).toBe(false)
  expect(await commandText(lookout($, ''))).toContain(`following ${LOG}`)
  await clock.advance(1_500)
  expect(followed(w)).toBe(LOG)
})

test('/lookout worker with no server seen prints the plain launcher and how to start one', async ($, on) => {
  const clock = engine(on, world(w => thinking(w)))
  await boot($, clock)
  const text = await commandText(lookout($, 'worker'))
  const lines = text.split('\n')
  expect(lines[0]).toBe('Lookout: a worker on a local model server, run from the project folder:')
  expect(lines[1]).toMatch(/^ {2}\S*\/scripts\/lookout-worker "the task"$/)
  expect(lines[2]).toMatch(/^no model server seen: start one first \(llama-server, ollama serve, lms server start, vllm serve or mlx-serve\)/)
  expect(lines.length).toBe(3)
})

test('/lookout worker names a server that stopped answering', { options: { server: 'llama.cpp', serverUrl: 'http://127.0.0.1:9' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const lines = (await commandText(lookout($, 'worker'))).split('\n')
  expect(lines[1]).toMatch(/\/scripts\/lookout-worker "the task"$/)
  expect(lines[2]).toMatch(/^llama\.cpp did not answer \(server did not answer.*\): start it, then run this$/)
})

test('/lookout worker in the demo or following this session prints the plain launcher', async ($, on) => {
  const clock = engine(on, world(w => running(w), w => session(w)), { env: { HOME } })
  await boot($, clock)
  await lookout($, 'demo')
  expect(await commandText(lookout($, 'worker'))).toMatch(/lookout-worker "the task"\nno model server seen/)
  await lookout($, 'session')
  await clock.advance(1_500)
  expect(await commandText(lookout($, 'worker'))).toMatch(/lookout-worker "the task"\nno model server seen/)
})

test('/lookout worker is in the command\'s help; a source named worker is still one `next` away', { options: { sources: ['worker=/srv/logs/w.jsonl', 'api=/srv/logs/a.jsonl'] } }, async ($, on) => {
  const commands: Command[] = []
  const w = world(runningAt({ path: '/srv/logs/w.jsonl' }), w => thinking(w, '/srv/logs/a.jsonl'))
  const clock = engine(on, w, { commands })
  await boot($, clock)
  expect(commands[0]!.description).toContain('worker [<task>]')
  expect(commands[0]!.argumentHint).toContain('worker [task]')
  expect(await commandText(lookout($, 'worker'))).toContain('(the source named worker: /lookout next reaches it)')
  expect(followed(w)).toBe('/srv/logs/w.jsonl')
  await lookout($, 'api')
  await lookout($, 'next')
  expect(followed(w)).toBe('/srv/logs/w.jsonl')
})

// ── Notifications, replay and the runs list (docs/DESIGN.md 20, 21, 22)

test('with notify toasts a new failing test run toasts once; the first poll is silent', { options: { notify: 'toasts' } }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  await clock.advance(1_500)
  expect(toasts).toEqual([])
  // The worker runs the tests again: the reader reads the appended rows.
  appendTests(w, LOG, 2, 10)
  await clock.advance(1_500)
  expect(toasts).toEqual(['✖ worker: 2 of 12 tests failing'])
  await clock.advance(4_500)
  expect(toasts.length).toBe(1)
})

test('notify off never toasts', { options: { notify: 'off' } }, async ($, on) => {
  let toasts = 0
  on('ui.toast', () => {
    toasts++
    return { value: undefined }
  })
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  appendTests(w, LOG, 2, 10)
  await clock.advance(3_000)
  expect(toasts).toBe(0)
})

test('a wait on the model past `stallSecs` on the reader\'s clock toasts a stall', { options: { notify: 'toasts' } }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The thinking log last moved at T - 6: past 180 s (the default) after a few minutes.
  const clock = engine(on, world(w => thinking(w)))
  await boot($, clock)
  await clock.advance(150_000)
  expect(toasts).toEqual([])
  await clock.advance(45_000)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/^⏸ worker: no log movement for /)
})

test('the `stallSecs` setting reaches the reader', { options: { notify: 'toasts', stallSecs: 600 } }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const clock = engine(on, world(w => thinking(w)))
  await boot($, clock)
  await clock.advance(200_000)
  expect(toasts).toEqual([])
})

test('with notify status the status line shows the activity', { options: { notify: 'status' } }, async ($, on) => {
  const lines: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  let toasts = 0
  on('ui.toast', () => {
    toasts++
    return { value: undefined }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  expect(lines.at(-1)).toContain('lookout · Bash Run the todo tests')
  expect(lines.at(-1)).toContain('41%')
  expect(toasts).toBe(0)
})

test('the demo source never toasts', { options: { notify: 'both' } }, async ($, on) => {
  let toasts = 0
  on('ui.toast', () => {
    toasts++
    return { value: undefined }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  await lookout($, 'demo')
  await clock.advance(90_000)
  expect(toasts).toBe(0)
})

test('/lookout replay reads the log as it stood, advances at ×8, pauses and returns to live', async ($, on) => {
  const w = world(w => running(w), runningAt({ path: '/srv/logs/old-run.jsonl' }))
  const clock = engine(on, w)
  await boot($, clock)
  const ran = await lookout($, 'replay /srv/logs/old-run.jsonl')
  expect(JSON.stringify(ran)).toContain('replaying /srv/logs/old-run.jsonl')
  expect(followed(w)).toBe('/srv/logs/old-run.jsonl')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^⏵ replay ×8 · / }))?.text).toBe('⏵ replay ×8 · 0s')

  await clock.advance(1_500)
  expect(await ui.find({ type: 'Text', text: /^⏵ replay ×8 · 12s$/ })).toBeTruthy()
  // 12 s in, the log had its first turn only.
  expect(await ui.find({ type: 'Text', text: /\b1 turn\b/ })).toBeTruthy()

  await ui.press({ key: 'replay-pause' })
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /^⏸ replay ×8 · 12s$/ })).toBeTruthy()

  await ui.press({ key: 'replay-forward' })
  expect(await ui.find({ type: 'Text', text: /^⏸ replay ×8 · 42s$/ })).toBeTruthy()
  await ui.press({ key: 'replay-speed' })
  expect(await ui.find({ type: 'Text', text: /^⏸ replay ×32 · / })).toBeTruthy()

  await ui.press({ key: 'replay-live' })
  expect(followed(w)).toBe(LOG)
  await clock.advance(1_500)
  expect(followed(w)).toBe(LOG)
  expect(await ui.find({ type: 'Text', text: /replay/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /\b18 turns\b/ })).toBeTruthy()
  await ui.unmount()
})

test('replay stops at the log end once the result is seen', async ($, on) => {
  const w = world(w => running(w), w => quick(w))
  const clock = engine(on, w)
  await boot($, clock)
  await lookout($, `replay ${CWD}/logs/quick.jsonl`)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(3_000)
  const row = await ui.find({ type: 'Text', text: /^⏹ replay ended · / })
  expect(row?.text).toBe('⏹ replay ended · 24s / 30m00s')
  await clock.advance(3_000)
  expect((await ui.find({ type: 'Text', text: /^⏹ replay ended · / }))?.text).toBe('⏹ replay ended · 24s / 30m00s')
  await ui.unmount()
})

test('replay of a log that is not there, or has no timestamped rows yet, says so', async ($, on) => {
  const w = world(w => running(w))
  w.put('/srv/logs/empty.jsonl', '')
  const clock = engine(on, w)
  await boot($, clock)
  expect(JSON.stringify(await lookout($, 'replay /srv/logs/nowhere.jsonl'))).toContain('cannot replay /srv/logs/nowhere.jsonl: no such log')
  expect(JSON.stringify(await lookout($, 'replay /srv/logs/empty.jsonl'))).toContain('cannot replay /srv/logs/empty.jsonl: no timestamped rows yet')
  expect(JSON.stringify(await lookout($, ''))).toContain(`following ${LOG}`)
})

/** `$1.23` as a regular expression's text. */
const usd = (x: number): string => `\\$${x.toFixed(2).replace('.', '\\.')}`

test('the Result block shows the compare table and the runs list, the run recorded by the reader', { options: { layout: 'detailed' } }, async ($, on) => {
  const w = world(finishedAt(LOG))
  // An older run in runs.jsonl beside the log; the reader appends this one when it sees its result (docs/DESIGN.md 22).
  const older = { t: FINISHED.last_ts! - 7200, path: `${CWD}/logs/older.jsonl`, source: 'api', model: 'local/qwen-coder-32b-q4', subtype: 'error_max_turns', turns: 60, duration_ms: 2_340_000, cost_at: { 'claude-sonnet-5-5': 2.05 }, priced_at: '2026-10-28' }
  w.put(`${CWD}/logs/runs.jsonl`, `${JSON.stringify(older)}\nnot json\n`)
  const clock = engine(on, w)
  await boot($, clock)
  const at = FINISHED.cost!.at_all!
  const recorded = w.text(`${CWD}/logs/runs.jsonl`).trim().split('\n')
  expect(recorded.length).toBe(3)
  expect(JSON.parse(recorded[2]!)).toMatchObject({ path: LOG, source: 'worker', model: 'claude-sonnet-5-5', subtype: 'success', turns: 42, duration_ms: 1_800_000 })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    const chosen = await ui.find({ type: 'Text', text: new RegExp(`claude-sonnet-5-5 +≈ ${usd(at['claude-sonnet-5-5']!)}$`) })
    expect(chosen).toBeTruthy()
    expect(chosen!.props.bold).toBe(true)
    expect(await ui.find({ type: 'Text', text: new RegExp(`claude-opus-5-5 +≈ ${usd(at['claude-opus-5-5']!)}$`) })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: new RegExp(`claude-haiku-5-5 +≈ ${usd(at['claude-haiku-5-5']!)}$`) })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /priced 2026-10-28/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^Runs$/ })).toBeTruthy()
    const current = await ui.find({ type: 'Text', text: /^▶ / })
    expect(current?.text).toMatch(new RegExp(`^▶ \\d\\d:\\d\\d · sonnet-5-5 · success · 42 turns · 30m00s · ≈ ${usd(at['claude-sonnet-5-5']!)} at claude-sonnet-5-5$`))
    expect(await ui.find({ type: 'Text', text: /qwen-coder-32b-q4 · error_max_turns · 60 turns · 39m00s · ≈ \$2\.05 at claude-sonnet-5-5$/ })).toBeTruthy()
    await ui.unmount()
  }
  // Read at most every 10 s, however often the pane draws.
  expect(w.reads.filter(p => p.endsWith('runs.jsonl')).length).toBe(1)
})

test('where no run could be recorded the Result block shows no runs list, and the real cost beside the estimate', { options: { layout: 'detailed' } }, async ($, on) => {
  const w = world(finishedAt(LOG))
  w.appendable = false
  const clock = engine(on, w)
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Result$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /claude-sonnet-5-5 +≈ \$\d+\.\d\d$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Runs$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /real \$1\.86/ })).toBeTruthy()
  await ui.unmount()
})

// ── Layouts (docs/DESIGN.md 15, 43.2)

const AT = (columns: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns: columns } })

/** A Raster's encoded cells as text, one line per row (the glyphs only). */
function rasterText(cells: unknown, columns: number): string {
  const bin = atob(String(cells))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const w = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  let out = ''
  for (let i = 0; i < w.length; i += 3) {
    out += String.fromCodePoint(w[i]! || 0x20)
    if ((i / 3 + 1) % columns === 0) out += '\n'
  }
  return out
}

// A pane too narrow for the wall: detailed draws as the panel there (docs/DESIGN.md 15, 43.2).
const NARROW = AT(60)

test('detailed under 70 columns draws the compact scene, one module grid and the text blocks, not the chart blocks', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const ran = await lookout($, 'detailed')
  expect(JSON.stringify(ran)).toContain('layout: detailed')
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  expect(grid).toBeTruthy()
  expect(grid!.props.columns).toBe(60)
  expect(atob(String(grid!.props.cells)).length).toBe(60 * Number(grid!.props.rows) * 3 * 4)
  // The default order on the running fixture: the decode meter and the turns counter are there.
  const text = rasterText(grid!.props.cells, 60)
  expect(text).toContain('tok/s')
  expect(text).toContain('turns')
  const scene = await ui.find({ type: 'Raster', key: DEFAULT })
  expect(scene!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'compact'))
  for (const gone of [/^Time$/, /^Pace$/, /^Model server$/, /^Checks$/, /^Git$/]) expect(await ui.find({ type: 'Text', text: gone })).toBeFalsy()
  for (const kept of [/^Thinking$/, /^Last command$/, /^Timeline$/]) expect(await ui.find({ type: 'Text', text: kept })).toBeTruthy()
  // The default modules claim every item of the stats row and the header (docs/DESIGN.md 31): the
  // turns counter, the context dial, the lamps, the cost counter, the clock and the hand-off.
  expect(await ui.find({ type: 'Text', text: /^turn \d+ · ctx/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /err/ })).toBeFalsy()
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeFalsy()
  await lookout($, 'calm')
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeFalsy()
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'standard'))
  await ui.unmount()
})

test('detailed at 120 columns splits the modules around the large scene (the wall)', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...AT(120), surface: 'terminal' })
  await lookout($, 'detailed')
  const top = await ui.find({ type: 'Raster', key: 'modules-top' })
  const bottom = await ui.find({ type: 'Raster', key: 'modules-bottom' })
  expect(top).toBeTruthy()
  expect(bottom).toBeTruthy()
  expect(top!.props.columns).toBe(120)
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeFalsy()
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'large'))
  expect(await ui.find({ type: 'Text', text: /^Time$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeTruthy()
  await ui.unmount()
})

test('the pane picks panel or wall by its width alone: the wall from 70 columns', { options: { layout: 'detailed' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  for (const [columns, key, size] of [[69, 'modules', 'compact'], [70, 'modules-top', 'large'], [144, 'modules-top', 'large']] as const) {
    const ui = await $.ui.mount({ ...AT(columns), surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key })).toBeTruthy()
    expect(await ui.find({ type: 'Raster', key: key === 'modules' ? 'modules-top' : 'modules' })).toBeFalsy()
    expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), size))
    await ui.unmount()
  }
})

for (const old of ['classic', 'panel', 'wall'] as const) {
  test(`/lookout ${old} picks detailed`, async ($, on) => {
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
    expect(JSON.stringify(await lookout($, old))).toContain(`layout: detailed (${old} reads as detailed now)`)
    expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeTruthy()
    expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout ambient')
    await ui.unmount()
  })

  test(`the \`layout\` setting ${old} reads as detailed`, { options: { layout: old } }, async ($, on) => {
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...AT(120), surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeTruthy()
    expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout ambient')
    await ui.unmount()
    // Off the terminal, as classic did.
    const desk = await $.ui.mount({ ...AT(120), surface: 'desktop' })
    expect(await desk.find({ type: 'Text', text: /^Time$/ })).toBeTruthy()
    await desk.unmount()
  })

  test(`a layout saved as ${old} reads as detailed after a reload, and \`l\` goes on from there`, async ($, on) => {
    reloadWith(on, { logPath: LOG, sourceName: 'default', layout: old })
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    let ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
    expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeTruthy()
    expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout ambient')
    await ui.press({ key: 'layout' })
    await ui.unmount()
    // The held state does not notify the pane: a fresh mount draws what the press wrote.
    ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
    expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout calm')
    expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeFalsy()
    await ui.unmount()
  })
}

test('`l` cycles calm → detailed → ambient → calm', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...AT(120), surface: 'terminal' })
  // calm, the default: no chart blocks, no timeline, no grids.
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Time$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeFalsy()
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.props.hotkey).toBe('l')
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout detailed')
  await ui.press({ key: 'layout' })
  // detailed, as the wall at this width.
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeTruthy()
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Time$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout ambient')
  await ui.press({ key: 'layout' })
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeFalsy()
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout calm')
  await ui.press({ key: 'layout' })
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Timeline$/ })).toBeFalsy()
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout detailed')
  await ui.unmount()
})

test('the `modules` setting packs exactly those modules', { options: { layout: 'detailed', modules: ['counter:turns', 'clock'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  expect(grid).toBeTruthy()
  const text = rasterText(grid!.props.cells, 60)
  expect(text).toContain('turns')
  expect(text).toContain('elapsed')
  expect(text).not.toContain('tok/s')
  expect(text).not.toContain('calls')
  await ui.unmount()
})

test('unknown module ids are skipped', { options: { layout: 'detailed', modules: ['bogus', 'counter:turns', 'toString'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  expect(grid).toBeTruthy()
  const text = rasterText(grid!.props.cells, 60)
  expect(text).toContain('turns')
  expect(text).not.toContain('tok/s')
  await ui.unmount()
})

test('a `modules` list of unknown ids only falls back to the default order', { options: { layout: 'detailed', modules: ['bogus'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  expect(rasterText(grid!.props.cells, 60)).toContain('tok/s')
  await ui.unmount()
})

test('the tick blits the module grid with the scene while live in detailed', { options: { layout: 'detailed' } }, async ($, on) => {
  const blits: { key: string; columns?: number; rows?: number; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e) blits.push({ key: e.key, columns: e.columns, rows: e.rows, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  const rows = Number(grid!.props.rows)
  await clock.advance(360)
  const mods = blits.filter(b => b.key === 'modules')
  expect(mods.length).toBeGreaterThan(0)
  for (const b of mods) {
    expect(b.columns).toBe(60)
    expect(b.rows).toBe(rows)
    expect(atob(b.cells).length).toBe(60 * rows * 3 * 4)
  }
  const scenes = blits.filter(b => b.key === DEFAULT)
  expect(scenes.length).toBeGreaterThan(0)
  for (const b of scenes) expect(b.rows).toBe(rowsFor(sceneById(DEFAULT), 'compact'))
  expect(blits.every(b => b.key === 'modules' || b.key === DEFAULT)).toBe(true)
  // In calm: no module key is blitted any more.
  await lookout($, 'calm')
  blits.length = 0
  await clock.advance(360)
  expect(blits.length).toBeGreaterThan(0)
  expect(blits.every(b => b.key === DEFAULT)).toBe(true)
  await ui.unmount()
})

test('a sceneSize the person set wins over the layout', { options: { layout: 'detailed', sceneSize: 'large' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'large'))
  await lookout($, 'standard')
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'standard'))
  await ui.unmount()
})

test('off the terminal detailed draws as classic did', { options: { layout: 'detailed' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...AT(120), surface })
    expect(await ui.find({ type: 'Raster' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /^Time$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^Checks$/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a size picked with the command survives a reload, even when it equals the setting', async ($, on) => {
  // A reload: the module's variables start over, the session's state is what the last load wrote
  // (following a log, layout panel as saved before 43.2, the person's pick `standard`).
  const seeded: Record<string, unknown> = {
    logPath: LOG,
    sourceName: 'default',
    layout: 'panel',
    sceneSize: { shape: 'scene-size-2', value: 'standard' },
  }
  const written = new Set<string>()
  on('state.set', ($, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded && !written.has(e.key) ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeTruthy()
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'standard'))
  await ui.unmount()
})

test('with no pick a reload keeps the layout default size', async ($, on) => {
  const seeded: Record<string, unknown> = { logPath: LOG, sourceName: 'default', layout: 'detailed' }
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'compact'))
  await ui.unmount()
})

// ── Achievements (docs/DESIGN.md 24)

/** The finished run ending at local noon (so `night-shift` never depends on the time zone), as the worker log. */
const NOON_RUN: Scene = finishedAt(LOG, NOON)

/** Toasts and the plugin store's writes, recorded. */
function recordAchievements(on: On, entries?: Record<string, unknown>) {
  const toasts: string[] = []
  const sets: { key: string; value: unknown }[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // The plugin store, in memory (what mock.store does), with its writes recorded.
  const store = new Map<string, unknown>(Object.entries(entries ?? {}))
  on('store.get', (_, e) => ({ value: store.has(e.key) ? JSON.parse(JSON.stringify(store.get(e.key))) : undefined }))
  on('store.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return { toasts, sets, trophies: () => toasts.filter(x => x.startsWith('🏆')) }
}

test('a finished run earns its achievements once: toasted, stored and listed under Result', { options: { notify: 'toasts', layout: 'detailed' } }, async ($, on) => {
  const rec = recordAchievements(on)
  const clock = engine(on, world(NOON_RUN))
  await boot($, clock)
  expect(rec.trophies()).toEqual([
    '🏆 first light: the first finished run',
    '🏆 green: tests passing, no errors',
    '🏆 clean hands: no denials in 20 or more tool calls',
    '🏆 handoff: the first run with a handoff file',
  ])
  const stored = rec.sets.filter(x => x.key === 'achievements').at(-1)?.value as { earned: Record<string, { run: string }> }
  expect(Object.keys(stored.earned)).toEqual(['first-light', 'green', 'clean-hands', 'handoff'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    expect(await ui.find({ type: 'Text', text: /^🏆 green · tests passing, no errors$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^🏆 first light/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^🏆 marathon/ })).toBeFalsy()
    await ui.unmount()
  }
  // Later polls of the same run raise nothing new.
  await clock.advance(6_000)
  expect(rec.trophies().length).toBe(4)
})

test('achievements earned in an earlier session are not toasted again', { options: { notify: 'both', layout: 'detailed' } }, async ($, on) => {
  const earlier = { v: 1, earned: { 'first-light': { run: '/elsewhere:1:2', t: 1 }, green: { run: '/elsewhere:1:2', t: 1 } } }
  const rec = recordAchievements(on, { achievements: earlier })
  const clock = engine(on, world(NOON_RUN))
  await boot($, clock)
  expect(rec.trophies()).toEqual(['🏆 clean hands: no denials in 20 or more tool calls', '🏆 handoff: the first run with a handoff file'])
  // This run's Result lists only what it earned.
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^🏆 clean hands/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^🏆 green/ })).toBeFalsy()
  await ui.unmount()
})

test('with notify off achievements are kept and listed but not toasted', { options: { notify: 'off', layout: 'detailed' } }, async ($, on) => {
  const rec = recordAchievements(on)
  const clock = engine(on, world(NOON_RUN))
  await boot($, clock)
  expect(rec.toasts).toEqual([])
  expect(rec.sets.some(x => x.key === 'achievements')).toBe(true)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^🏆 green/ })).toBeTruthy()
  await ui.unmount()
})

test('the demo and a replay never earn achievements', { options: { notify: 'toasts' } }, async ($, on) => {
  const rec = recordAchievements(on)
  const clock = engine(on, world(w => running(w), finishedAt('/srv/logs/old-run.jsonl', NOON)))
  await boot($, clock)
  await lookout($, 'demo')
  await clock.advance(80_000)
  await lookout($, 'replay /srv/logs/old-run.jsonl')
  await clock.advance(6_000)
  expect(rec.trophies()).toEqual([])
  expect(rec.sets.some(x => x.key === 'achievements')).toBe(false)
})

test('without a plugin store there are no achievements and the pane still draws', { options: { notify: 'toasts', layout: 'detailed' } }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const clock = engine(on, world(NOON_RUN))
  await boot($, clock)
  const ui = await $.ui.mount({ ...WIDE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Result$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^🏆/ })).toBeFalsy()
  expect(toasts.filter(x => x.startsWith('🏆'))).toEqual([])
  await ui.unmount()
})

// ── Ambient (docs/DESIGN.md 26)

test('/lookout ambient draws the scene alone filling the pane, and toggles back', async ($, on) => {
  const blits: { key: string; rows?: number }[] = []
  on('ui.blit', (_, e) => {
    blits.push({ key: e.key, rows: e.rows })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'detailed')
  const ran = await lookout($, 'ambient')
  expect(JSON.stringify(ran)).toContain('layout: ambient')
  // The office lays itself out by height: it takes the body's 60 rows less the hotkey row.
  const scene = await ui.find({ type: 'Raster', key: DEFAULT })
  expect(scene!.props.rows).toBe(59)
  expect(atob(String(scene!.props.cells)).length).toBe(80 * 59 * 3 * 4)
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeFalsy()
  for (const gone of [/^turn \d+ · ctx/, /^Thinking$/, /^Timeline$/, /^Last command$/, /^Result$/, /you · /]) {
    expect(await ui.find({ type: 'Text', text: gone })).toBeFalsy()
  }
  // The hotkeys stay, and say where `l` goes next.
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout calm')
  expect(await ui.find({ type: 'Button', key: 'details' })).toBeFalsy()
  expect((await ui.find({ type: 'Button', key: 'scene' }))?.props.hotkey).toBe('s')
  // The tick blits the scene at that height.
  blits.length = 0
  await clock.advance(360)
  expect(blits.length).toBeGreaterThan(0)
  expect(blits.every(b => b.key === DEFAULT && b.rows === 59)).toBe(true)
  // The same command goes back to the layout it left.
  expect(JSON.stringify(await lookout($, 'ambient'))).toContain('layout: detailed')
  expect(await ui.find({ type: 'Raster', key: 'modules-top' })).toBeTruthy()
  await ui.unmount()
})

test('in ambient a fixed-height scene draws at its large size, centred', async ($, on) => {
  // network was the lineup's last fixed-height scene (docs/DESIGN.md 37): with none left there is
  // nothing to centre, and every scene fills the pane (the test above).
  const fixed = SCENES.find(x => x.rows.large <= x.rows.standard)
  if (!fixed) return
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, fixed.id)
  await lookout($, 'ambient')
  const scene = await ui.find({ type: 'Raster', key: fixed.id })
  const rows = rowsFor(fixed, 'large')
  expect(scene!.props.rows).toBe(rows)
  const pad = Math.floor((59 - rows) / 2)
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.marginTop === pad)).toBe(true)
  // Under it as many blank rows less the odd one, so the hotkey row sits at the bottom.
  expect(boxes.some(b => b.props.height === 59 - rows - pad)).toBe(true)
  await ui.unmount()
})

test('the `layout` setting ambient starts there on the terminal; elsewhere it draws classic', { options: { layout: 'ambient' } }, async ($, on) => {
  const clock = engine(on, world(finishedAt(LOG)))
  await boot($, clock)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Raster', key: DEFAULT }))!.props.rows).toBe(59)
  expect(await term.find({ type: 'Text', text: /^Result$/ })).toBeFalsy()
  await term.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /^Result$/ })).toBeTruthy()
  expect(await desk.find({ type: 'Text', text: /^Timeline$/ })).toBeTruthy()
  await desk.unmount()
})

// ── Palettes (docs/DESIGN.md 27)

/** The ink colours of a Raster's cells. */
function inks(cells: string): Set<number> {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  const out = new Set<number>()
  for (let i = 0; i < words.length; i += 3) out.add(words[i + 1]!)
  return out
}

/** Which palette the observatory's caption (running: the palette's `ink`) was drawn in. */
async function skyPalette(ui: { find(q: object): Promise<{ props: Record<string, unknown> } | null | undefined> }): Promise<PaletteId | null> {
  const raster = await ui.find({ type: 'Raster', key: 'observatory' })
  if (!raster) return null
  const seen = inks(String(raster.props.cells))
  const ids = (Object.keys(PALETTES) as PaletteId[]).filter(id => seen.has(PALETTES[id].ink))
  return ids.length === 1 ? ids[0]! : null
}

test('the scene paints in the night palette by default', { options: { scene: 'observatory' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await skyPalette(ui)).toBe('night')
  await ui.unmount()
})

test('the `palette` setting reaches the scene and the modules', { options: { palette: 'paper', layout: 'detailed', scene: 'observatory' } }, async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await skyPalette(ui)).toBe('paper')
  // The module grid: the slate frames are the palette's monitor material.
  const grid = await ui.find({ type: 'Raster', key: 'modules' })
  expect(grid).toBeTruthy()
  expect(inks(String(grid!.props.cells)).has(PALETTES.paper.mon)).toBe(true)
  // The tick paints in it too.
  await clock.advance(360)
  const scene = blits.filter(b => b.key === 'observatory')
  expect(scene.length).toBeGreaterThan(0)
  for (const b of scene) {
    expect(inks(b.cells).has(PALETTES.paper.ink)).toBe(true)
    expect(inks(b.cells).has(PALETTES.night.ink)).toBe(false)
  }
  await ui.unmount()
})

test('/lookout night|paper|phosphor switches the palette live', { options: { scene: 'observatory' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await skyPalette(ui)).toBe('night')
  for (const id of ['phosphor', 'paper', 'night'] as const) {
    const r = await lookout($, id)
    expect(JSON.stringify(r)).toContain(`palette: ${id}`)
    await clock.settle()
    expect(await skyPalette(ui)).toBe(id)
  }
  await ui.unmount()
})

test('a palette picked with the command survives a reload', { options: { palette: 'night' } }, async ($, on) => {
  const seeded: Record<string, unknown> = {
    logPath: LOG,
    sourceName: 'default',
    scene: 'observatory',
    palette: { shape: 'palette-1', value: 'phosphor' },
  }
  const written = new Set<string>()
  on('state.set', ($, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded && !written.has(e.key) ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await skyPalette(ui)).toBe('phosphor')
  await ui.unmount()
})

// ── Seasons (docs/DESIGN.md 28)

/** The colours of a Raster's cells, ink and paper. */
function colours(cells: string): Set<number> {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  const out = new Set<number>()
  for (let i = 0; i < words.length; i += 3) out.add(words[i + 1]!).add(words[i + 2]!)
  return out
}

/** Whether the office Raster shows the winter window (its snowy sill). */
async function snowySill(ui: { find(q: object): Promise<{ props: Record<string, unknown> } | null | undefined> }): Promise<boolean> {
  const raster = await ui.find({ type: 'Raster', key: 'office' })
  expect(raster).toBeTruthy()
  return colours(String(raster!.props.cells)).has(seasonTones(PALETTES.night).sill)
}

test('the `season` setting reaches the office on the first draw and in the tick', { options: { scene: 'office', season: 'winter' } }, async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await snowySill(ui)).toBe(true)
  await clock.advance(360)
  const office = blits.filter(b => b.key === 'office')
  expect(office.length).toBeGreaterThan(0)
  for (const b of office) expect(colours(b.cells).has(seasonTones(PALETTES.night).sill)).toBe(true)
  await ui.unmount()
})

test('the `season` setting none shows no season in the window', { options: { scene: 'office', season: 'none' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await snowySill(ui)).toBe(false)
  await ui.unmount()
})

test('/lookout season <…> switches the season live; a bad one is refused', { options: { scene: 'office', season: 'summer' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await snowySill(ui)).toBe(false)
  expect(JSON.stringify(await lookout($, 'season'))).toContain('season: summer')
  expect(JSON.stringify(await lookout($, 'season winter'))).toContain('season: winter')
  await clock.settle()
  expect(await snowySill(ui)).toBe(true)
  expect(JSON.stringify(await lookout($, 'season monsoon'))).toContain('no season monsoon')
  await clock.settle()
  expect(await snowySill(ui)).toBe(true)
  expect(JSON.stringify(await lookout($, 'season none'))).toContain('season: none')
  await clock.settle()
  expect(await snowySill(ui)).toBe(false)
  await ui.unmount()
})

test('a season picked with the command survives a reload', { options: { scene: 'office', season: 'summer' } }, async ($, on) => {
  const seeded: Record<string, unknown> = {
    logPath: LOG,
    sourceName: 'default',
    scene: 'office',
    season: { shape: 'season-1', value: 'winter' },
  }
  const written = new Set<string>()
  on('state.set', ($, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded && !written.has(e.key) ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await snowySill(ui)).toBe(true)
  await ui.unmount()
})

test('the switches module shows the palette pick where its row has room', { options: { layout: 'detailed', palette: 'paper', modules: ['toggles'], sources: ['w=/home/dev/w.jsonl'] } }, async ($, on) => {
  const clock = engine(on, world(runningAt({ path: '/home/dev/w.jsonl' })))
  await boot($, clock)
  // 99 columns: three grid columns, the switches two of them (65 cells), one row of picks; the
  // wall at this width, so the one module is the top half's.
  const ui = await $.ui.mount({ ...AT(99), surface: 'terminal' })
  const grid = await ui.find({ type: 'Raster', key: 'modules-top' })
  expect(grid).toBeTruthy()
  const bin = atob(String(grid!.props.cells))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const words = new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
  let text = ''
  for (let i = 0; i < words.length; i += 3) text += String.fromCodePoint(words[i]!)
  expect(text).toContain('palette paper')
  expect(text.indexOf('palette')).toBeLessThan(text.indexOf('source w'))
  await ui.unmount()
})

// ── Blit only on change (docs/DESIGN.md 30)

test('the tick skips a blit whose cells did not change and blits a changed frame', { options: { layout: 'detailed', modules: ['counter:tools'] } }, async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeTruthy()
  // Three ticks: the scene moves every frame, the tool counter does not.
  await clock.advance(360)
  const scene = blits.filter(b => b.key === DEFAULT)
  const grid = blits.filter(b => b.key === 'modules')
  expect(scene.length).toBe(3)
  expect(new Set(scene.map(b => b.cells)).size).toBe(3)
  expect(grid.length).toBe(1) // the first tick after the draw; the identical frames after it are skipped
  // A fresh draw mounts its own cells: the next tick sends the grid again, once.
  await lookout($, 'detailed')
  await clock.settle()
  blits.length = 0
  await clock.advance(360)
  expect(blits.filter(b => b.key === 'modules').length).toBe(1)
  expect(blits.filter(b => b.key === DEFAULT).length).toBe(3)
  await ui.unmount()
})

// ── One home per fact (docs/DESIGN.md 31)

type Node = { type?: string; children?: unknown[] }

/** A node's text: its string children, depth first. */
function textOf(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!n || typeof n !== 'object') return ''
  return ((n as Node).children ?? []).map(textOf).join('')
}

/** The pane's own text rows above the hotkeys (the strip, the model and elapsed, the stats), in order. */
async function paneRows(ui: { findAll(q: object): Promise<unknown[]> }): Promise<string[]> {
  const root = (await ui.findAll({ type: 'Box' }))[0]
  const out: string[] = []
  let stop = false
  const walk = (n: unknown) => {
    if (stop || !n || typeof n !== 'object') return
    const node = n as Node
    if (node.type === 'Button') stop = true
    else if (node.type === 'Text') out.push(textOf(node))
    else for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return out
}

function count(text: string, what: string | RegExp): number {
  if (typeof what === 'string') return text.split(what).length - 1
  return [...text.matchAll(new RegExp(what.source, 'g'))].length
}

for (const columns of [100, 144]) {
  test(`detailed at ${columns} columns (the wall) spells each reading out once in its rows and modules`, { options: { layout: 'detailed' } }, async ($, on) => {
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...AT(columns), surface: 'terminal' })
    const grids: string[] = []
    for (const key of ['modules-top', 'modules-bottom']) {
      const g = await ui.find({ type: 'Raster', key })
      expect(g).toBeTruthy()
      grids.push(rasterText(g!.props.cells, columns))
    }
    const rows = await paneRows(ui)
    const all = [...rows, ...grids].join('\n')
    // The current tool and its seconds: the scene's caption is their one home, so neither the
    // pane's rows nor a module prints them.
    expect(count(all, RUNNING.pending!.kind === 'tool' ? RUNNING.pending!.label : '?')).toBe(0)
    expect(count(all, 'Bash ·')).toBe(0)
    // The worker's model: the strip module's, not the reels headline or the header as well.
    expect(count(all, 'qwen coder')).toBe(1)
    // The elapsed: the clock's headline (h:mm:ss) and nowhere else, not the header's `1h02m` form.
    expect(count(all, /\b\d+:\d\d:\d\d\b/)).toBe(1)
    const elapsed = Date.now() / 1000 - RUNNING.started!
    for (const d of [-1, 0, 1]) expect(all.includes(fmtDur(elapsed + d))).toBe(false)
    // The context share: the dial's headline only.
    const pct = `${Math.round((RUNNING.ctx! / RUNNING.server!.ctx_limit!) * 100)}%`
    expect(count(all, pct)).toBe(1)
    expect(all).not.toContain('ctx 54.2k/')
    // The tool counts: the ledmatrix by class, no tool-calls counter beside it.
    expect(count(all, 'tools by class')).toBe(1)
    expect(all).not.toContain('tool calls')
    // The hand-off: the strip module (its time of day), not the strip row as well.
    expect(count(all, 'Fix empty-title')).toBe(1)
    expect(rows.some(r => r.includes('worker ·'))).toBe(false)
    expect(all).toMatch(/since \d\d:\d\d/)
    // The stats row and the header are gone: every item is a module's.
    expect(rows).toEqual([])
    await ui.unmount()
  })
}

test('in detailed the strip row is drawn only while the strip module is not', { options: { layout: 'detailed', modules: ['counter:turns', 'clock'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await paneRows(ui)
  expect(rows.some(r => r.startsWith('you · claude-opus-5-5') && r.includes('worker ·'))).toBe(true)
  await ui.unmount()
})

test('in detailed with the strip module the strip row is not drawn', { options: { layout: 'detailed', modules: ['strip', 'counter:turns'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const rows = await paneRows(ui)
  expect(rows.some(r => r.includes('worker ·'))).toBe(false)
  expect(rasterText((await ui.find({ type: 'Raster', key: 'modules' }))!.props.cells, 60)).toContain('Fix empty-title')
  // The hand-off claims the models: the header keeps the elapsed only.
  expect(rows.some(r => r.includes(RUNNING.model!))).toBe(false)
  await ui.unmount()
})

test('the stats row drops what a visible module claims and keeps the rest', { options: { layout: 'detailed', modules: ['counter:turns', 'clock'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await paneRows(ui)
  const stats = rows.find(r => r.startsWith('ctx '))
  expect(stats).toBeTruthy()
  expect(stats).not.toContain('turn ')
  expect(stats).toContain(`${RUNNING.errors} err`)
  expect(stats).toMatch(/≈\$\d+\.\d\d at /)
  // The header keeps the model; the clock owns the elapsed.
  expect(rows.some(r => r.includes(RUNNING.model!))).toBe(true)
  const elapsed = Date.now() / 1000 - RUNNING.started!
  expect([-1, 0, 1].some(d => rows.join('\n').includes(fmtDur(elapsed + d)))).toBe(false)
  await ui.unmount()
})

test('detailed with modules that claim none of them keeps the strip row, the header and the whole stats row; calm draws none of them', { options: { modules: ['toggles'] } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'detailed')
  let rows = await paneRows(ui)
  expect(rows.some(r => r.includes('worker ·'))).toBe(true)
  expect(rows.some(r => r.includes(RUNNING.model!))).toBe(true)
  expect(rows.some(r => /^turn \d+ · ctx .* err/.test(r))).toBe(true)
  await lookout($, 'calm')
  rows = await paneRows(ui)
  expect(rows.some(r => r.includes('worker ·'))).toBe(false)
  expect(rows.some(r => r.includes(RUNNING.model!))).toBe(false)
  expect(rows.some(r => /^turn \d+ · ctx/.test(r))).toBe(false)
  await ui.unmount()
})

test('the tick blits the modules with the claims the draw made', { options: { layout: 'detailed', modules: ['counter:turns', 'scope:pace'] } }, async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  // The pace scope shows the newest turn: the turns counter keeps its average and drops `last`.
  const drawn = rasterText((await ui.find({ type: 'Raster', key: 'modules' }))!.props.cells, 60)
  expect(drawn).toContain('avg ')
  expect(drawn).not.toContain('last ')
  await clock.advance(360)
  const grid = blits.filter(b => b.key === 'modules')
  expect(grid.length).toBeGreaterThan(0)
  for (const b of grid) {
    expect(rasterText(b.cells, 60)).toContain('avg ')
    expect(rasterText(b.cells, 60)).not.toContain('last ')
  }
  await ui.unmount()
})

test('/lookout factory draws office and says the scene was retired', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const r = await lookout($, 'factory')
  expect(JSON.stringify(r)).toContain('scene: office (factory was retired)')
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeTruthy()
  await ui.unmount()
})

test('a terrarium pick saved before the retirement draws office after a reload', async ($, on) => {
  const seeded: Record<string, unknown> = { logPath: LOG, sourceName: 'default', scene: 'terrarium' }
  const written = new Set<string>()
  on('state.set', ($, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded && !written.has(e.key) ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeTruthy()
  await ui.unmount()
})

// ── Control characters from the log (the log reader's strings), and this session (docs/DESIGN.md 36)

test('ANSI colour codes and carriage returns in the log reach the tree clean', { options: { layout: 'detailed' } }, async ($, on) => {
  // The running command ends with coloured output and a hyperlinked error, then a reply over two lines.
  const out = '\x1b[32m✓\x1b[39m tests/todo.test.ts (12 tests)\r\n\x1b[1m\x1b[32m Tests  12 passed (12)\x1b[0m\nprogress 50%\rprogress 100%'
  const w = world(runningAt({ lastResult: { content: '\x1b]8;;file:///x\x07npm test\x1b]8;;\x07: exit code 1', stdout: out, error: true } }))
  const reply = new StreamLog(LOCAL, 'r-')
  reply.turn(T - 1, 54_600, [say('Tests pass.\r\nCommitting.')])
  w.append(LOG, reply.text(), T - 1)
  const clock = engine(on, w)
  await boot($, clock)
  // The last command's output shows unfolded (docs/DESIGN.md 38.2).
  await lookout($, 'details')
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    expect(await ui.find({ type: 'Text', text: /✓ tests\/todo\.test\.ts \(12 tests\)$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^ +Tests {2}12 passed \(12\)$/ })).toBeTruthy()
    // A carriage return ends a line, as the reader splits a command's output (docs/DESIGN.md 43.5).
    expect(await ui.find({ type: 'Text', text: /progress 50%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /progress 100%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /npm test: exit code 1/ })).toBeTruthy()
    for (const el of await ui.findAll({ type: 'Text' })) expect(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(el.text ?? '')).toBe(false)
    await ui.unmount()
  }
})

test('with no worker log a fresh install follows this session: its own transcript', { options: { layout: 'detailed' } }, async ($, on) => {
  const w = world(w => session(w, { waiting: true }))
  const clock = engine(on, w, { env: { HOME } })
  await boot($, clock)
  expect(followed(w)).toBe(SESSION_FILE)
  expect(JSON.stringify(await lookout($, ''))).toContain(`following this session (${SESSION_FILE})`)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...WIDE, surface })
    // On the terminal the strip module carries it (docs/DESIGN.md 31).
    if (surface !== 'terminal') {
      const strip = await ui.find({ type: 'Text', text: /^claude · / })
      expect(strip?.text).toMatch(/^claude · claude-opus-5-5 {2}· {2}"Now add a --due flag to the CLI's add command\." {2}· {2}since \d\d:\d\d$/)
    }
    // Nobody hands anything over, and nothing says worker.
    expect(await ui.find({ type: 'Text', text: /^you · / })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /\bworker\b/ })).toBeFalsy()
    if (surface !== 'terminal') expect(await ui.find({ type: 'Text', text: /your turn · / })).toBeTruthy()
    await ui.unmount()
  }
})

test('CLAUDE_CONFIG_DIR moves the projects folder; /lookout session picks this session by hand', async ($, on) => {
  const config = `/srv/claude-config/projects/-home-dev-work-acme-todo/${SESSION_ID}.jsonl`
  const w = world(w => running(w), w => session(w, { waiting: true, path: config }))
  const clock = engine(on, w, { env: { HOME, CLAUDE_CONFIG_DIR: '/srv/claude-config' } })
  await boot($, clock)
  expect(followed(w)).toBe(LOG) // the worker log exists
  const ran = await lookout($, 'session')
  expect(JSON.stringify(ran)).toContain('following this session (/srv/claude-config/projects/-home-dev-work-acme-todo/')
  expect(followed(w)).toBe(config)
  // Any other source leaves it.
  await lookout($, '/srv/logs/other.jsonl')
  expect(followed(w)).toBe('/srv/logs/other.jsonl')
})

test('the `log` setting `session` follows this session', { options: { log: 'session' } }, async ($, on) => {
  const w = world(w => running(w), w => session(w, { waiting: true }))
  const clock = engine(on, w, { env: { HOME } })
  await boot($, clock)
  expect(followed(w)).toBe(SESSION_FILE)
})

test('after /clear the pane follows the new session id; a reload keeps following this session', async ($, on) => {
  let id = SESSION_ID
  const w = world(w => session(w, { waiting: true }))
  const clock = engine(on, w, { env: { HOME }, sessionId: () => id })
  await boot($, clock)
  expect(followed(w)).toBe(SESSION_FILE)
  // /clear goes on under a new id and fires no session.start: the next poll finds the new file.
  id = '00000000-0000-4000-8000-0000000000bb'
  await clock.advance(1600)
  expect(followed(w)).toBe(`/home/dev/.claude/projects/-home-dev-work-acme-todo/${id}.jsonl`)
  // What is kept is `this session`, not a file: a reload resolves it again.
  await boot($, clock)
  expect(followed(w)).toBe(`/home/dev/.claude/projects/-home-dev-work-acme-todo/${id}.jsonl`)
  expect(JSON.stringify(await lookout($, ''))).toContain('following this session')
})

test("the engine's own transcript path wins over the computed one, for its session id", async ($, on) => {
  const w = world(w => session(w, { waiting: true }))
  const clock = engine(on, w, { env: { HOME } })
  on('classic.SessionStart', () => ({}))
  await boot($, clock)
  await $.classic.SessionStart({ source: 'startup', session_id: SESSION_ID, transcript_path: '/var/claude/elsewhere/s.jsonl' })
  await clock.advance(1600)
  expect(followed(w)).toBe('/var/claude/elsewhere/s.jsonl')
  // Told for another session (a stale one): the current id's file is computed instead.
  await $.classic.SessionStart({ source: 'clear', session_id: 'another-id', transcript_path: '/var/claude/elsewhere/old.jsonl' })
  await clock.advance(1600)
  expect(followed(w)).toBe(SESSION_FILE)
})

test('this session before its first prompt says so and names the other ways in', async ($, on) => {
  const clock = engine(on, world(NO_LOG), { env: { HOME } })
  await boot($, clock)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /this session: waiting for your first prompt$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /waiting for \// })).toBeFalsy()
    const hint = await ui.find({ type: 'Text', text: /\/lookout demo/ })
    expect(hint?.text).toContain('/lookout <source>')
    await ui.unmount()
  }
})

test("following this session the scenes draw no orchestrator: the session's own turns do not move them", async ($, on) => {
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await boot($, clock)
  for (const id of ['office', 'office-hd']) {
    await lookout($, id)
    const cells = async (): Promise<string> => {
      const ui = await $.ui.mount({ ...WIDE, surface: 'terminal' })
      const raster = await ui.find({ type: 'Raster', key: id })
      await ui.unmount()
      expect(raster).toBeTruthy()
      return String(raster!.props.cells)
    }
    const before = await cells()
    await $.turn.start({ text: 'check the session', turnId: `t-${id}` })
    expect(await cells()).toBe(before)
  }
})

test('the status tool describes this session when the pane follows it', async ($, on) => {
  const w = world(w => session(w, { waiting: true }), runningAt({ path: '/srv/logs/w.jsonl' }))
  const clock = engine(on, w, { env: { HOME } })
  await boot($, clock)
  const brief = String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)
  expect(brief.split('\n')[0]).toBe('lookout · claude · claude-opus-5-5 · following this session')
  expect(brief).toContain('state: your turn · the last turn ended')
  expect(brief).toContain('prompt: "Now add a --due flag')
  expect(brief).not.toContain('worker')
  // Following a worker, `session` still names this session.
  await lookout($, '/srv/logs/w.jsonl')
  const other = String((await $.tool.call({ tool: 'mcp__lookout__status', source: 'session' })).result)
  expect(other.split('\n')[0]).toBe('lookout · claude · claude-opus-5-5 · following this session')
  expect(followed(w)).toBe(SESSION_FILE)
  const worker = String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)
  expect(worker.split('\n')[0]).toContain('lookout · worker · ')
})

test('a session toasts as claude and never toasts a finish', { options: { notify: 'toasts' } }, async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const w = world(w => session(w))
  const clock = engine(on, w, { env: { HOME } })
  await boot($, clock)
  sessionTests(w, 2, 10)
  await clock.advance(1_500)
  expect(toasts).toEqual(['✖ claude: 2 of 12 tests failing'])
  // The turn ends: the person's move, no finish.
  sessionEnds(w, T + 3)
  await clock.advance(3_000)
  expect(toasts.length).toBe(1)
})

// ── Calm and detailed (docs/DESIGN.md 38)

/** Every text row of the pane in order, hotkeys included (`[s]`, `[l]`, …), and the Rasters by key. */
async function allRows(ui: { findAll(q: object): Promise<unknown[]> }): Promise<string[]> {
  const root = (await ui.findAll({ type: 'Box' }))[0]
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as Node & { props?: Record<string, unknown> }
    if (node.type === 'Button') out.push(`[${String(node.props?.hotkey ?? '')}]`)
    else if (node.type === 'Raster') out.push(`<${String(node.props?.key ?? '')}>`)
    else if (node.type === 'Text') out.push(textOf(node))
    else for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return out
}

/** The index of the first row matching `re`, or -1. */
function rowOf(rows: readonly string[], re: RegExp): number {
  return rows.findIndex(r => re.test(r))
}

/** The rows of a detailed or calm pane that only the detailed layout draws. */
const DETAILED = [/^Thinking$/, /^Checks$/, /^Git$/, /^Result$/, /^Runs$/, /^Timeline$/, /^Last edit/, /^Last command/, /^Time$/, /^Pace$/, /^Model server$/, /^🏆/]

test('calm, the default, draws the scene with the story as its caption, then the task, the thinking, so far and worth a look', async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const scene = await ui.find({ type: 'Raster', key: DEFAULT })
  expect(scene!.props.rows).toBe(rowsFor(sceneById(DEFAULT), 'standard'))
  const rows = await allRows(ui)
  // The blocks in order: the scene (whose caption is Now), the task, the thinking with its age,
  // so far, worth a look, then the hotkeys. No Now row on the terminal: the caption is its home.
  const order = [/^<office>$/, /^Working on: /, /^thinking · \S+ ago$/, /^so far$/, /^worth a look$/, /^\[s\]$/, /^\[l\]$/].map(re => rowOf(rows, re))
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((x, y) => x - y)).toEqual(order)
  expect(rowOf(rows, /^Working on: /)).toBe(1)
  // Nothing else: no strip, no header or stats rows, no detailed block, no view or details hotkey.
  for (const gone of [/you · /, /worker · /, new RegExp(`${RUNNING.model!}$`), /^turn \d+ · ctx/, ...DETAILED]) expect(rowOf(rows, gone)).toBe(-1)
  expect(rows.includes('[v]')).toBe(false)
  expect(rows.includes('[d]')).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'layout' }))?.text).toContain('layout detailed')
  // The words (hooks/narrate.ts): the plain caption on the scene, in the draw and in the tick.
  const caption = rasterText(scene!.props.cells, 80)
  expect(caption).toContain('running the tests')
  expect(caption).not.toContain('npm test -- todo')
  expect(rows[1]).toBe('Working on: "Fix empty-title validation in the todo store"')
  expect(rows[rowOf(rows, /^so far$/) + 1]).toContain('18 turns')
  expect(rows[rowOf(rows, /^worth a look$/) + 1]).toMatch(/1 test is failing/)
  expect((await ui.find({ type: 'Text', text: /1 test is failing/ }))!.props.color).toBe('warning')
  blits.length = 0
  await clock.advance(360)
  const ticked = blits.filter(b => b.key === DEFAULT)
  expect(ticked.length).toBeGreaterThan(0)
  for (const b of ticked) expect(rasterText(b.cells, 80)).toContain('running the tests')
  await ui.unmount()
})

test('ambient speaks the same plain caption as calm, and draws none of its text', async ($, on) => {
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e && typeof e.cells === 'string') blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'ambient')
  // The words (hooks/narrate.ts) on the scene, in the draw and in the tick: not the tool's label.
  const caption = rasterText((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.cells, 80)
  expect(caption).toContain('running the tests')
  expect(caption).not.toContain('npm test -- todo')
  blits.length = 0
  await clock.advance(360)
  const ticked = blits.filter(b => b.key === DEFAULT)
  expect(ticked.length).toBeGreaterThan(0)
  for (const b of ticked) expect(rasterText(b.cells, 80)).toContain('running the tests')
  // None of calm's text: no task, so far or worth a look (so ambient claims nothing either).
  const rows = await allRows(ui)
  for (const gone of [/^Working on: /, /^so far$/, /^worth a look$/, /^thinking · /]) expect(rowOf(rows, gone)).toBe(-1)
  // Back in detailed the scene keeps the terse status caption.
  await lookout($, 'detailed')
  expect(rasterText((await ui.find({ type: 'Raster', key: DEFAULT }))!.props.cells, 80)).not.toContain('running the tests')
  await ui.unmount()
})

test('calm off the terminal draws the same without the scene, the Now sentence first', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Raster' })).toBeFalsy()
    const rows = await allRows(ui)
    const order = [/^\S+ The worker /, /^Working on: /, /^thinking/, /^so far$/, /^worth a look$/].map(re => rowOf(rows, re))
    expect(order).toEqual([0, 1, 2, ...order.slice(3)])
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(rows[0]).toMatch(/The worker (is|has been) running the tests/)
    for (const gone of [/you · /, /worker · /, ...DETAILED]) expect(rowOf(rows, gone)).toBe(-1)
    await ui.unmount()
  }
})

test('calm, once the run has ended, says the outcome in place of Now; no Result, runs or trophies', { options: { notify: 'toasts' } }, async ($, on) => {
  const rec = recordAchievements(on)
  const clock = engine(on, world(NOON_RUN))
  await boot($, clock)
  // Achievements still toast.
  expect(rec.trophies().length).toBeGreaterThan(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const rows = await allRows(ui)
    const outcome = rowOf(rows, /^✓ Finished in /)
    expect(outcome).toBe(surface === 'terminal' ? 1 : 0)
    expect((await ui.find({ type: 'Text', text: /^✓ Finished in / }))!.props.color).toBe('success')
    expect(rowOf(rows, /^Working on: /)).toBe(outcome + 1)
    for (const gone of DETAILED) expect(rowOf(rows, gone)).toBe(-1)
    await ui.unmount()
  }
})

test('calm says a failed run in the error colour', async ($, on) => {
  const clock = engine(on, world(w => failed(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /^✖ Stopped after / })
  expect(row!.props.color).toBe('error')
  expect(row!.text).toContain('turn limit')
  await ui.unmount()
})

test('calm following this session tells it as Claude, under what you asked', async ($, on) => {
  const clock = engine(on, world(w => session(w, { waiting: true })), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rows = await allRows(ui)
  expect(rows[0]).toMatch(/^○ Your turn: Claude /)
  expect(rows[1]).toBe('You asked: "Now add a --due flag to the CLI\'s add command."')
  expect(rowOf(rows, /\bworker\b/i)).toBe(-1)
  await ui.unmount()
})

test('with no thinking text calm shows the latest reply instead', async ($, on) => {
  const w = world(runningAt({ noThinking: true }))
  const reply = (await w.summary(LOG)).text!
  const clock = engine(on, w)
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await allRows(ui)
  expect(rowOf(rows, /^thinking/)).toBe(-1)
  const title = rowOf(rows, /^latest reply · \S+ ago$/)
  expect(title).toBeGreaterThan(0)
  expect(rows[title + 1]).toBe(reply.replace(/\s+/g, ' '))
  await ui.unmount()
})

test('calm claims what it prints, so the scene drops the same text', { options: { scene: 'observatory' } }, async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // So far says "18 turns": the observatory's `turn 18` goes. Ambient claims nothing and keeps it.
  expect(rasterText((await ui.find({ type: 'Raster', key: 'observatory' }))!.props.cells, 80)).not.toContain(`turn ${RUNNING.turns}`)
  await lookout($, 'ambient')
  expect(rasterText((await ui.find({ type: 'Raster', key: 'observatory' }))!.props.cells, 80)).toContain(`turn ${RUNNING.turns}`)
  // The task line is the hand-off's home: the office names no models at the desks.
  await lookout($, 'ambient')
  await lookout($, 'office')
  expect(rasterText((await ui.find({ type: 'Raster', key: 'office' }))!.props.cells, 80)).not.toContain('you · ')
  await lookout($, 'ambient')
  expect(rasterText((await ui.find({ type: 'Raster', key: 'office' }))!.props.cells, 80)).toContain('you · ')
  await ui.unmount()
})

test('the detailed layout puts Thinking after the status, then Checks, Git, Result, Timeline, Last edit and Last command', { options: { layout: 'detailed' } }, async ($, on) => {
  const w = world(w => running(w))
  const clock = engine(on, w)
  await boot($, clock)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  let rows = await allRows(ui)
  let order = [/^. [^·]+ · \d+s$|^⠋ |^○ /, /^Thinking$/, /^turn +\d+$/, /^Checks$/, /^Git$/, /^Timeline$/, /^Last edit/, /^Last command/].map(re => rowOf(rows, re))
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((x, y) => x - y)).toEqual(order)
  await ui.unmount()
  // The same path now holds a finished run (a new run written over it): the reader starts over.
  finished(w, { path: LOG })
  await lookout($, 'detailed')
  await clock.advance(1_500)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  rows = await allRows(ui)
  order = [/^Thinking$/, /^Checks$/, /^Git$/, /^Result$/, /^Timeline$/, /^Last edit/, /^Last command/].map(re => rowOf(rows, re))
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((x, y) => x - y)).toEqual(order)
  // Last edit and Last command are the last rows.
  expect(rowOf(rows, /^Last command/)).toBe(rows.length - 1)
  await ui.unmount()
})

// As the panel and as the wall (docs/DESIGN.md 43.2).
for (const columns of [60, 120]) {
  test(`detailed at ${columns} columns folds the last edit and the last command to a line each; \`d\` unfolds them and the timeline`, { options: { layout: 'detailed' } }, async ($, on) => {
    const clock = engine(on, world(w => running(w)))
    await boot($, clock)
    const ui = await $.ui.mount({ ...AT(columns), surface: 'terminal' })
    const button = await ui.find({ type: 'Button', key: 'details' })
    expect(button?.props.hotkey).toBe('d')
    expect(button?.text).toContain('details')
    // Folded: one line each, no diff, no output, the newest 6 timeline rows.
    expect((await ui.find({ type: 'Text', text: /^Last edit \d\d:\d\d · todo\.ts · \+3 −2$/ }))).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^Last command \d\d:\d\d · Run the todo tests · running$/ }))).toBeTruthy()
    expect(await ui.find({ type: 'Code' })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /^\$ npm test -- todo$/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /^last 6$/ })).toBeTruthy()
    // Unfolded: the diff, the command and its output, the whole timeline.
    await ui.press({ key: 'details' })
    expect(await ui.find({ type: 'Code' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^\$ npm test -- todo$/ })).toBeTruthy()
    // The timeline unfolded: as many of the newest rows as the pane has room for.
    const shown = Number((await ui.find({ type: 'Text', text: /^last \d+$/ }))?.text.slice(5))
    expect(shown).toBeGreaterThan(6)
    expect(shown).toBeLessThanOrEqual(RUNNING.events!.length)
    expect((await ui.find({ type: 'Button', key: 'details' }))?.text).toContain('fold')
    // And the command folds them again.
    expect(JSON.stringify(await lookout($, 'details'))).toContain('details: folded')
    expect(await ui.find({ type: 'Code' })).toBeFalsy()
    await ui.unmount()
  })
}

test('a failed last command folds to its exit code when its output names one', { options: { layout: 'detailed' } }, async ($, on) => {
  const clock = engine(on, world(runningAt({ desc: null, lastResult: { content: 'Exit code 2\n FAIL tests/todo.test.ts', error: true } })))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Last command \d\d:\d\d · npm test -- todo · exit 2$/ })).toBeTruthy()
  await ui.unmount()
})

test('the details pick survives a reload', async ($, on) => {
  const seeded: Record<string, unknown> = {
    logPath: LOG,
    sourceName: 'default',
    layout: 'detailed',
    details: { shape: 'details-1', value: true },
  }
  reloadWith(on, seeded)
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Code' })).toBeTruthy()
  await ui.unmount()
})

/** The session's lookout state as a reload finds it: `seeded` read back, and every write kept with its version. */
function reloadWith(on: On, seeded: Record<string, unknown>): void {
  const held = new Map<string, { value: unknown; version: number }>(Object.entries(seeded).map(([key, value]) => [key, { value, version: 1 }]))
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && held.has(e.key) ? { value: held.get(e.key)! } : next(e)))
  on('state.set', ($, e, next) => {
    if (e.plugin !== 'lookout') return next(e)
    const now = held.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion != null && e.ifVersion !== now.version) return { value: { isSet: false, version: now.version } }
    held.set(e.key, { value: e.value, version: now.version + 1 })
    return { value: { isSet: true, version: now.version + 1 } }
  })
}

// The retired view (docs/DESIGN.md 38.2, 43.3): a `view` still in the session's state is ignored.
test('a view saved before its retirement is ignored after a reload', async ($, on) => {
  reloadWith(on, { logPath: LOG, sourceName: 'default', layout: 'detailed', view: 'scene' })
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'modules' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^so far$/ })).toBeFalsy()
  await ui.unmount()
})

test('/lookout calm picks calm; off the terminal calm draws as itself and detailed as classic did', async ($, on) => {
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  await lookout($, 'detailed')
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /^Timeline$/ })).toBeTruthy()
  expect(JSON.stringify(await lookout($, 'calm'))).toContain('layout: calm')
  expect(await desk.find({ type: 'Text', text: /^Timeline$/ })).toBeFalsy()
  expect(await desk.find({ type: 'Text', text: /^so far$/ })).toBeTruthy()
  await desk.unmount()
})

// ── Thinking, made readable (docs/DESIGN.md 40)

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
/** The small model's answer. */
const said = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })
const OVERLOADED: ModelCompleteResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
const PLAIN_A = 'Claude found that [!the flags are read by hand], so it adds the due date beside the tag in cli.ts.'
const PLAIN_C = 'Claude is checking the dates again and [+the tests pass].'

/**
 * Stand in for the small model: each request is recorded and answered by `answer` (by default
 * PLAIN_A); a throwing answer rejects the call, as the engine refusing it would.
 */
function smallModel(on: On, answer: (e: ModelCompleteInput, n: number) => ModelCompleteResult | Promise<ModelCompleteResult> = () => said(PLAIN_A)): ModelCompleteInput[] {
  const asks: ModelCompleteInput[] = []
  on('model.complete', async (_, e) => {
    asks.push(e)
    return { value: await answer(e, asks.length) }
  })
  return asks
}

/** This session thinking `text`, `dt` seconds on: a new row in its transcript. */
function sessionThinking(w: World, text: string, dt: number): void {
  sessionThinks(w, text, dt)
}

/** The innermost Text whose text is exactly `text` (a coloured run inside its row), or undefined. */
async function runNode(ui: { findAll(q: object): Promise<unknown[]> }, text: string): Promise<{ props: Record<string, unknown> } | undefined> {
  let found: { props: Record<string, unknown> } | undefined
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as Node & { props?: Record<string, unknown> }
    if (node.type === 'Text' && textOf(node) === text) found = { props: node.props ?? {} }
    for (const c of node.children ?? []) walk(c)
  }
  for (const n of await ui.findAll({ type: 'Text' })) walk(n)
  return found
}

/** The row after the first row matching `re`, or undefined. */
function rowAfter(rows: readonly string[], re: RegExp): string | undefined {
  const i = rowOf(rows, re)
  return i < 0 ? undefined : rows[i + 1]
}

test('this session: the thinking is asked for once in plain words, and calm shows them in colour', { options: { explain: 'session' } }, async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  // Nothing is asked before a draw shows the thinking.
  expect(asks.length).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_500)
  await clock.settle()
  expect(asks.length).toBe(1)
  const ask = asks[0]!
  expect(ask.model).toBe('haiku')
  expect(ask.system).toBe(EXPLAIN_SYSTEM)
  expect(ask.prompt).toContain(`<thinking_text>\n${SESSION_RUNNING.thinking}\n</thinking_text>`)
  expect(ask.prompt).toContain('starting with "Claude"')
  expect(ask.maxTokens).toBeLessThanOrEqual(300)
  expect(ask.timeoutMs).toBeGreaterThan(0)
  const rows = await allRows(ui)
  // Labelled as what it is, in place of the thinking block.
  expect(rowOf(rows, /^in plain words · \S+ ago$/)).toBeGreaterThan(0)
  expect(rowOf(rows, /^thinking · /)).toBe(-1)
  expect(rowAfter(rows, /^in plain words/)).toBe(runsText(parseExplained(PLAIN_A)))
  const problem = await runNode(ui, 'the flags are read by hand')
  expect(problem!.props.color).toBe('error')
  expect((await runNode(ui, 'cli.ts'))!.props.color).toBe('suggestion')
  // The same text is never asked for again.
  await clock.advance(30_000)
  await clock.settle()
  expect(asks.length).toBe(1)
  // Off the terminal the same words, in the same colours.
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(rowAfter(await allRows(desk), /^in plain words/)).toBe(runsText(parseExplained(PLAIN_A)))
  expect((await runNode(desk, 'the flags are read by hand'))!.props.color).toBe('error')
  await desk.unmount()
  await ui.unmount()
})

test('a new thinking text waits out the 15 s since the last request; the newest text wins, the old words dim meanwhile', { options: { explain: 'session' } }, async ($, on) => {
  const asks = smallModel(on, e => said(e.prompt.includes('Check the dates') ? PLAIN_C : PLAIN_A))
  const w = world(w => session(w))
  const clock = engine(on, w, { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_500)
  await clock.settle()
  expect(asks.length).toBe(1)
  // Two newer texts inside the 15 s: neither is asked for yet, and the old words stay, dimmed.
  sessionThinking(w, 'Parse the date with the local day.', 1)
  await clock.advance(3_000)
  await clock.settle()
  sessionThinking(w, 'Check the dates again, then run the tests.', 2)
  await clock.advance(3_000)
  await clock.settle()
  expect(asks.length).toBe(1)
  let rows = await allRows(ui)
  expect(rowOf(rows, /^in plain words · /)).toBeGreaterThan(0)
  const stale = await runNode(ui, runsText(parseExplained(PLAIN_A)))
  expect(stale!.props.dimColor).toBe(true)
  // Dimmed whole: the problem phrase loses its colour too.
  expect((await runNode(ui, 'the flags are read by hand'))!.props.color).toBeUndefined()
  // Past 15 s the newest text is asked for, not the one in between.
  await clock.advance(10_000)
  await clock.settle()
  expect(asks.length).toBe(2)
  expect(asks[1]!.prompt).toContain('Check the dates again')
  expect(asks.some(x => x.prompt.includes('Parse the date'))).toBe(false)
  rows = await allRows(ui)
  expect(rowAfter(rows, /^in plain words/)).toBe(runsText(parseExplained(PLAIN_C)))
  expect((await runNode(ui, runsText(parseExplained(PLAIN_C))))!.props.dimColor).toBeFalsy()
  expect((await runNode(ui, 'the tests pass'))!.props.color).toBe('success')
  await ui.unmount()
})

test('nothing is asked for under the default `explain` (off); calm shows the gist, highlighted', async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  const rows = await allRows(ui)
  expect(rowOf(rows, /^in plain words/)).toBe(-1)
  const gistRow = rowAfter(rows, /^thinking · \S+ ago$/)!
  expect(gistRow).toContain('Move the trim before the check')
  // The gist's words in their colours, inside the dim italic thinking.
  expect((await runNode(ui, 'src/todo.ts'))!.props.color).toBe('suggestion')
  const row = (await ui.findAll({ type: 'Text' })).find(n => textOf(n) === gistRow) as { props: Record<string, unknown> }
  expect(row.props.dimColor).toBe(true)
  expect(row.props.italic).toBe(true)
  await ui.unmount()
})

test('with `explain` all a worker is asked for too, as the worker', { options: { explain: 'all' } }, async ($, on) => {
  const asks = smallModel(on, () => said('The worker is moving [!the trim] before the length check in todo.ts.'))
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_500)
  await clock.settle()
  expect(asks.length).toBe(1)
  expect(asks[0]!.prompt).toContain('starting with "The worker"')
  expect(rowAfter(await allRows(ui), /^in plain words/)).toBe('The worker is moving the trim before the length check in todo.ts.')
  await ui.unmount()
})

test('with `explain` off nothing is asked for, even for this session', { options: { explain: 'off' } }, async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  expect(rowOf(await allRows(ui), /^thinking · \S+ ago$/)).toBeGreaterThan(0)
  await ui.unmount()
})

test('the demo shows its canned plain words and asks nothing', { options: { log: 'demo', explain: 'all' } }, async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => running(w)))
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  const rows = await allRows(ui)
  const words = rowAfter(rows, /^in plain words/)
  expect(words).toMatch(/^The worker /)
  // The status tool says them too.
  const status = String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)
  expect(status).toMatch(/\nthinking, in plain words: The worker /)
  expect(words).toBe(runsText(parseExplained(demoPlain('Plan: a dueDate field on Todo, parse it from the input, sort the list by it. Check the existing tests first.')!)))
  await ui.unmount()
})

test('a replay never asks and shows no plain words', async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  expect(JSON.stringify(await lookout($, 'replay'))).toContain('replaying')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  expect(rowOf(await allRows(ui), /^in plain words/)).toBe(-1)
  await ui.unmount()
})

test('a source switch aborts the request in flight; its answer is never shown', { options: { explain: 'session' } }, async ($, on) => {
  let release: (r: ModelCompleteResult) => void = () => {}
  const asks = smallModel(on, (_, n) => (n === 1 ? new Promise<ModelCompleteResult>(done => (release = done)) : said(PLAIN_C)))
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_500)
  expect(asks.length).toBe(1)
  // Switching away cuts the call short; the stand-in answering late changes nothing (an answer
  // kept would show below, the same text being back).
  await lookout($, 'demo')
  release(said(PLAIN_A))
  await clock.settle()
  expect(asks.length).toBe(1)
  // Back on this session the old answer is gone: the gist, until a new request answers.
  await lookout($, 'session')
  let rows = await allRows(ui)
  expect(rowOf(rows, /^in plain words/)).toBe(-1)
  expect(rowOf(rows, /^thinking · \S+ ago$/)).toBeGreaterThan(0)
  await clock.advance(16_000)
  await clock.settle()
  expect(asks.length).toBe(2)
  rows = await allRows(ui)
  expect(rowAfter(rows, /^in plain words/)).toBe(runsText(parseExplained(PLAIN_C)))
  await ui.unmount()
})

for (const [name, answer] of [
  ['an API error', () => OVERLOADED],
  ['a refused call', () => {
    throw new Error('blocked model')
  }],
  ['an empty reply', () => ({ isAnswered: false, reason: 'empty-reply', usage: USAGE }) as ModelCompleteResult],
] as const) {
  test(`after ${name} the gist stays, nothing is said, and the same text is not asked for again`, { options: { explain: 'session' } }, async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const asks = smallModel(on, answer)
    const w = world(w => session(w))
    const clock = engine(on, w, { env: { HOME } })
    await boot($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await clock.advance(1_500)
    await clock.settle()
    expect(asks.length).toBe(1)
    const rows = await allRows(ui)
    expect(rowOf(rows, /^in plain words/)).toBe(-1)
    expect(rowAfter(rows, /^thinking · \S+ ago$/)).toBe('The CLI parses its flags by hand; add --due beside --tag.')
    expect(rows.some(r => /error|failed|overloaded|plain words/i.test(r))).toBe(false)
    expect(toasts).toEqual([])
    await clock.advance(30_000)
    await clock.settle()
    expect(asks.length).toBe(1)
    // A new text: after an API error (or a refusal) the pause is a minute, else the usual 15 s.
    sessionThinking(w, 'Check the dates again, then run the tests.', 1)
    await clock.advance(16_000)
    await clock.settle()
    expect(asks.length).toBe(name === 'an empty reply' ? 2 : 1)
    await clock.advance(30_000)
    await clock.settle()
    expect(asks.length).toBe(2)
    await ui.unmount()
  })
}

test('the detailed layout shows the plain words over the highlighted gist', { options: { layout: 'detailed', explain: 'session' } }, async ($, on) => {
  smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(1_500)
  await clock.settle()
  const rows = await allRows(ui)
  const at = rowOf(rows, /^Thinking$/)
  expect(at).toBeGreaterThan(-1)
  // The section's title and its size, then the plain words and the gist.
  expect(rows[at + 2]).toBe(`in plain words: ${runsText(parseExplained(PLAIN_A))}`)
  expect(rows[at + 3]).toBe('The CLI parses its flags by hand; add --due beside --tag.')
  expect((await runNode(ui, '--due'))!.props.color).toBe('suggestion')
  expect((await runNode(ui, 'the flags are read by hand'))!.props.color).toBe('error')
  // The status tool carries the plain words under its state line.
  const status = String((await $.tool.call({ tool: 'mcp__lookout__status' })).result).split('\n')
  expect(status[2]).toBe(`thinking, in plain words: ${runsText(parseExplained(PLAIN_A))}`)
  await ui.unmount()
})

test('a reload keeps the plain words on screen without asking again', { options: { explain: 'session' } }, async ($, on) => {
  // A reload: the module's memory starts over; the atom still holds the answer for this text.
  const seeded: Record<string, unknown> = {
    logPath: 'session',
    sourceName: 'this session',
    plain: { shape: 'plain-1', value: { answer: { key: thoughtKey(SESSION_RUNNING.thinking!), reply: PLAIN_A, t: T - 30 }, failed: '' } },
  }
  const written = new Set<string>()
  on('state.set', ($, e, next) => {
    written.add(e.key)
    return next(e)
  })
  on('state.get', ($, e, next) => (e.plugin === 'lookout' && e.key in seeded && !written.has(e.key) ? { value: { value: seeded[e.key], version: 1 } } : next(e)))
  const asks = smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(rowAfter(await allRows(ui), /^in plain words/)).toBe(runsText(parseExplained(PLAIN_A)))
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  await ui.unmount()
})

test('ambient asks only where the showcase hangs a thinking screen: office-hd in a tall pane', { options: { layout: 'ambient', scene: 'office', explain: 'session' } }, async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => session(w)), { env: { HOME } })
  await boot($, clock)
  // office draws no thinking in ambient: nothing to put in plain words.
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  await ui.unmount()
  // office-hd at its large height has no wall screens either.
  await lookout($, 'office-hd')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: rowsFor(sceneById('office-hd'), 'large') + 1 } } })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  await ui.unmount()
  // Taller, the thinking screen is on the wall: asked for once.
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(1_500)
  await clock.settle()
  expect(asks.length).toBe(1)
  await ui.unmount()
})

test('an unknown `explain` value reads as off', { options: { explain: 'sometimes' } }, async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => running(w), w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.advance(20_000)
  await clock.settle()
  expect(asks.length).toBe(0)
  await lookout($, 'session')
  await clock.advance(1_500)
  await clock.settle()
  await clock.advance(1_500)
  await clock.settle()
  expect(asks.length).toBe(0)
  await ui.unmount()
})

test('by default nothing is asked for, not even for this session: the thinking stays on this machine', async ($, on) => {
  const asks = smallModel(on)
  const clock = engine(on, world(w => running(w), w => session(w)), { env: { HOME } })
  await boot($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await lookout($, 'session')
  for (let i = 0; i < 4; i++) {
    await clock.advance(15_000)
    await clock.settle()
  }
  expect(asks.length).toBe(0)
  await ui.unmount()
})

// ── The log reader in the pane, end to end (docs/DESIGN.md 43.5): tests/logs/running.jsonl's own
// bytes (tests/log-fixtures.ts writes them, scripts/check.sh checks they are reproducible), read
// through modIo and the mock engine's $.fs and $.process, as a poll does.

test('the pane follows tests/logs/running.jsonl as it grows, through the real reader', async ($, on) => {
  const w = new World()
  const text = fixtureLogs()['running.jsonl']!
  w.put(LOG, text, T - 2)
  const clock = engine(on, w)
  await boot($, clock)
  let status = String((await $.tool.call({ tool: 'mcp__lookout__status', detail: 'full' })).result)
  expect(status).toContain('running Bash "Typecheck the project"')
  expect(status).toContain('turn 8')
  expect(status).toContain('tests: last run 12/12 passed')
  // The type check passes and the model answers: rows appended to the log.
  const last = JSON.parse(text.trim().split('\n').at(-1)!) as { timestamp: string; message: { content: { id: string }[] } }
  const t = Date.parse(last.timestamp) / 1000
  const more = new StreamLog(LOCAL, 'g-')
  more.result(t + 4, last.message.content[0]!.id, '', { stdout: '' })
  more.turn(t + 6, 8_200, [say('Typecheck clean; committing next.')])
  w.append(LOG, more.text(), T)
  await clock.advance(1_500)
  status = String((await $.tool.call({ tool: 'mcp__lookout__status', detail: 'full' })).result)
  expect(status).not.toContain('running Bash')
  expect(status).toContain('turn 9')
  expect(status).toContain('tsc clean')
  expect(status).toContain('last text: "Typecheck clean; committing next."')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^so far$/ })).toBeTruthy()
  await ui.unmount()
})

test('a log over 1 MiB is read past its first MiB through the process, as $.fs reads whole files only', async ($, on) => {
  const w = new World()
  const pad = `${JSON.stringify({ type: 'system', subtype: 'status', note: 'x'.repeat(1000) })}\n`.repeat(1200)
  w.put(LOG, pad + fixtureLogs()['running.jsonl']!, T - 2)
  const clock = engine(on, w)
  await boot($, clock)
  expect(String((await $.tool.call({ tool: 'mcp__lookout__status' })).result)).toContain('running Bash "Typecheck the project"')
  expect(w.runs.some(a => a[0] === '/bin/sh' && /^tail -c/.test(a[2] ?? '') && a[5] === LOG)).toBe(true)
})

test('a finished run is appended to runs.jsonl through tee, once', async ($, on) => {
  const w = world(finishedAt(LOG))
  const clock = engine(on, w)
  await boot($, clock)
  await clock.advance(6_000)
  expect(w.runs.filter(a => a[0] === 'tee' && a[2] === `${CWD}/logs/runs.jsonl`).length).toBe(1)
  expect(w.text(`${CWD}/logs/runs.jsonl`).trim().split('\n').length).toBe(1)
})
