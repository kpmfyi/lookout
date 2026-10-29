# Contributing

Issues and pull requests are welcome. lookout is a Claude Code mod written in TypeScript with no
dependencies beyond the engine API and the standard library; keep it that way. This guide covers
how the repository is laid out, how to check a change, and, at length, how to build a scene.

## How the code is laid out

- **`hooks/register.tsx`**: the mod's entry (`hooks/hooks.json` names it), and only the wiring: it
  hooks the engine's events (session start, the command, the status tool, the pane's draw, the
  orchestrator's own turns) to the pane's modules in **`hooks/pane/`**, each with one job:
  - `config.ts`: the settings (`readConfig`), the layouts and how retired names read, the fixed
    numbers. `state.ts`: all the pane's state in one place: the `$.state` atoms, each read and
    written through its own function there (`claude plugin validate` reads a `read` or `update`
    only on an atom declared in the same file), and the module's own variables, grouped in a few
    objects (`mod`, `mounted`, `replayed`, `asked`) that other files set fields on.
  - `sources.ts`: the source a session starts on, this session's transcript, the reader's
    Summary of a path, runs.jsonl. `poll.ts`: following a source, the poll, replay.
    `alerts.ts`: the status line, toasts and achievements. `explain.ts`: the `explain` policy
    (when the thinking is put in plain words, at what pace, what is kept).
  - `render.tsx`: the pane draw, which picks the shape (calm, panel, wall, classic, ambient) and
    hands the layout a `Draw` (`rows.tsx`, with the rows every layout shares) to `calm.tsx` or
    `detailed.tsx`; `dashboard.tsx` holds the text blocks the detailed layout draws off the
    terminal. `layout.ts` and `text.ts` are what the layouts and the tick share; `tick.ts` blits
    the scene and the module grids between draws.
  - `commands.tsx`: `/lookout` and its arguments, `/lookout worker`, and the hotkey rows.
    `status-tool.ts`: `mcp__lookout__status`.

  The imports run one way (register.tsx → render → layouts → rows, text, layout → state →
  config), with no cycle; `$` is passed to declared functions, never put in an object.
- **`hooks/reader/`**: the log reader. It turns a `claude -p --output-format stream-json --verbose`
  log, or a Claude Code session transcript, into one `Summary` (the contract in
  [`types/index.d.ts`](../types/index.d.ts), [DESIGN.md](DESIGN.md) section 3), the one object the
  pane, the scenes, the modules and the status tool all read.
  - A **pure core**: `parse.ts` feeds rows one at a time into a state that can say the Summary's
    log fields at any point; `follow.ts` follows one log incrementally, so a poll reads only the
    bytes appended since the last one; `detect.ts` reads test-runner and `tsc` summaries out of
    command output; `cost.ts` is the API estimate; `server.ts` the model-server adapters' parsing;
    `difflib.ts` the last edit's diff; `py.ts` the few formatting rules the Summary's text depends
    on; `reader.ts` ties them together, each live part on its own clock.
  - A thin **I/O layer**: everything outside the reader (files, `git`, memory, the model servers,
    the clock) goes through the small interface in `io.ts`. `mod-io.ts` implements it over the
    mod's `$.fs`, `$.process` and `$.http`; [`scripts/node-io.ts`](../scripts/node-io.ts) over Node,
    for the scripts; the tests fake it.
  - The reader replaced the earlier Python summariser; it was accepted when a parity run over every
    fixture and its variants gave the same JSON from both.
- **`hooks/scenes/`**: the three scenes and their registry (below). **`hooks/modules/`**: the
  instrument modules of the detailed layout, packed into a grid by `hooks/grid.ts`.
- **Shared pieces**: `activity.ts` (what the worker is doing, for every scene), `facts.ts` (one home
  per fact), `ambience.ts` (the lofi layer), `palette.ts`, `seasons.ts`, `cat.ts`, `sprite.ts`,
  `canvas.ts` and `hicanvas.ts`, `demo.ts` (the scripted demo run), `thought.ts` (the thinking's
  gist), `worker-setup.ts` (what `/lookout worker` prints, and the servers
  [`scripts/lookout-worker`](../scripts/lookout-worker) knows).
- **`tests/`**: TypeScript tests run by `claude plugin test .`. `tests/fixtures.ts` holds synthetic
  summaries for the scene and module tests. The pane tests run the real reader inside the mod:
  `tests/pane-world.ts` writes their runs as logs and answers the files, commands and model servers
  the reader reaches, through the test kit's hooks. `tests/log-fixtures.ts` builds the synthetic
  logs and session transcripts the reader's tests read;
  [`scripts/make-logs.ts`](../scripts/make-logs.ts) writes them to `tests/logs/` (deterministic: a
  re-run changes no byte). `tests/server-samples.ts` holds synthetic model-server responses for the
  adapters. `tests/golden.test.ts` pins the drawn cells of the heaviest scenes and the module grid
  as hashes; a change to one is a change in what the pane draws, so print the new table
  (`GOLDEN_PRINT`) only when the change is on purpose.

## Checks

```sh
scripts/check.sh            # everything; run it before opening a pull request
claude plugin test .        # the TypeScript tests only
scripts/test-worker.sh      # scripts/lookout-worker against stub servers and a stub claude
node scripts/icon.mjs       # redraw .claude-plugin/icon.png, the listing icon
```

[`scripts/check.sh`](../scripts/check.sh) checks that `tests/logs/` regenerates byte for byte and
stays small, that the reader's output on `tests/logs/running.jsonl` keeps the Summary's keys
([`scripts/contract.ts`](../scripts/contract.ts)), runs `scripts/test-worker.sh`, then
`claude plugin validate` and the tests, the strict type check when `tsc` and the engine's
generated types are present (they are written to `.claude-plugin/types/` once the mod has loaded),
and a private-word check: it greps the code, the tests and the README for the words listed one per
line in `.check-private` (git-ignored) or in `LOOKOUT_PRIVATE_WORDS`. It needs Node 24 or newer,
`claude` and `curl` (the worker script's), and the usual POSIX tools. Fixtures, samples and docs are
synthetic; never paste a real log, path, host, port or model name.

# Building a scene

A scene is the animated picture at the top of the lookout pane: a pure function from what the
worker is doing to a grid of terminal cells. The rest of this guide is everything a new scene
needs. There are three today (office, office-hd and observatory); read them before starting one.

## The contract (`hooks/scenes/index.ts`)

```ts
type SceneSize = 'compact' | 'standard' | 'large'

type Scene = {
  id: string                       // the command and setting name: /lookout <id>
  title: string                    // shown on the `s` button
  rows: Record<SceneSize, number>  // the height for each size, e.g. { compact: 7, standard: 12, large: 20 }
  minColumns: number               // below this, draw a simpler layout (never nothing)
  draw(ctx: SceneCtx): string      // encoded Raster cells: exactly ctx.columns × ctx.rows
}

type SceneCtx = {
  s: Summary          // the worker's summary (types/index.d.ts): turns, ctx, tests, git, cost…
  a: Activity         // what the worker is doing now (below): react to this, not to raw fields
  frame: number       // the animation counter, one step per 120 ms tick
  t: number           // the clock, epoch seconds (the replay clock while replaying)
  columns: number     // the width to draw, 40..200
  rows: number        // the height to draw: any value >= rows.compact, not only the three sizes
  orchestrator?: string  // the model id of the session showing the pane, when known
  worker?: string     // the worker desk's name: `worker` when absent, `claude` when following this session
  transparent?: boolean  // leave the background unpainted (undefined counts as true)
  you?: You           // the orchestrator's own activity: idle, thinking, tool (hooks/you.ts)
  palette?: Palette   // the colours to paint with (hooks/palette.ts); paletteOf(ctx) gives night when absent
  season?: string     // what a window shows (hooks/seasons.ts); seasonOf(t, ctx.season)
  shown?: ReadonlySet<Fact>  // the facts the pane already spells out (hooks/facts.ts); undefined: none
  plain?: { runs: Run[]; t: number; stale: boolean }  // the thinking in plain words, when there is one
  ambience?: boolean  // the lofi layer (below); undefined counts as on, ambient(ctx) reads it
}
```

- `draw` is pure and must not throw for any fixture, at columns 40..200 and any height from
  `rows.compact` up. Allocate one canvas per draw and nothing big in inner loops: the tick calls
  it every 120 ms.
- **Sizes.** `compact` fits a short sidebar, `standard` is the usual pane, `large` is for the
  detailed layout on a wide pane and taller still for ambient. Lay the picture out again from
  `columns` and `rows` (more sky, a taller plant, a second row of objects); never stretch pixels.
  A scene drawn at one native height can use `fitRows(native, ctx, cells, sky?)` from
  `hooks/scenes/fit.ts` to sit at the bottom of a taller box, with `sky(x, y)` painting the band
  above.
- **transparent.** When `ctx.transparent !== false`, leave walls, floors and backdrops as `NONE`
  so the terminal's own colour shows; objects, lines and text still draw. With `false`
  (`background: scene`), paint them.
- **orchestrator, you and worker.** Scenes that show the person's side (the office's second desk)
  label it with `orchestrator` (shortened: no provider, no `claude-`) and animate it from `you`.
  Both may be undefined: draw an idle figure or nothing. When the pane follows its own session both
  are undefined and `worker` is `claude`: name the worker's desk with `ctx.worker ?? 'worker'`, and
  lay the room out for one desk.
- The last row is the caption: the activity text and its seconds (`a.text`, `fmtDur(a.secs)`),
  cut to fit. In the ambient layout it is the only line of words, so make it read well alone. It
  is the activity's one home: print the current tool and its seconds nowhere else in the scene.
- **shown: one home per fact** (docs/DESIGN.md 31). The pane passes the readings its own rows and
  modules already print. For each fact where `claimed(ctx.shown, f)` is true, drop your label or
  readout for it and keep the picture: a station still lights in its class colour, it just loses
  its count; a context bar still fills without `ctx 54.2k/131.1k`. Undefined claims nothing (tests,
  ambient): draw every label then.
- **Ambient.** A scene whose `rows.large` is taller than `rows.standard` is taken to lay itself
  out by height and is drawn as tall as the pane (40 rows and more); give the extra room to sky,
  wall or floor. A scene with one height is drawn at it, centred.

## The activity model (`hooks/activity.ts`)

`activity(s, t)` turns a summary into an `Activity`; every scene reads it, so all scenes agree.

| `a.state` | meaning | typical picture |
|---|---|---|
| `nolog` | the log does not exist yet | dark, still, a hint of the set |
| `waiting` | the log exists, no first row | lights on, nobody home |
| `prefill` | the model is reading a long prompt | input flowing in, a progress feel |
| `thinking` | waiting on the model (thinking or writing) | the figure works; speed from `a.intensity` |
| `tool` | a tool call runs; `a.tool` and `a.cls` say which | the station for that class lights up |
| `stalled` | no log movement for `stallSecs` | dim, a slow `…`, a warning tint |
| `done` | the result row arrived; `a.ok` says success | calm, a ✓ or ✖, slow idle motion only |

- Tool classes (`a.cls`): `shell`, `read`, `edit`, `search`, `web`, `agent`, `other`. Use
  `CLASS_COLOR` from `hooks/panel.ts` so a class has one colour everywhere.
- `a.intensity` (0..1): decode tok/s against a soft cap, 0.5 when unknown. Speed, brightness.
- `a.pulse`: `{ kind, age }` for 8 seconds after an event: `tests-pass`, `tests-fail`, `error`,
  `denied`, `commit`. A transient effect (a flash, a gold packet, a falling seed); it never
  changes the state. Fade it with `age`.
- Two consecutive frames must differ while the worker is live; a done scene keeps a slow idle
  motion (a twinkle, a blink) so the pane never looks frozen.

## Two canvases

Both take `(columns, rows)` and `encode()` to the Raster cells `draw` returns. Both lay text
over cells with `text(col, row, s, ink)` and `label(col, row, s, light?, dark?)` (picks light or
dark ink against what lies beneath).

- **`Canvas`** (`hooks/canvas.ts`): half blocks, 1 × 2 pixels per cell, any colour per pixel.
  Bold, chunky shapes: the office. Simple and fast.
- **`HiCanvas`** (`hooks/hicanvas.ts`): 2 × 4 sub-pixels per cell, drawn with quadrant, block and
  braille glyphs, at most two colours per cell (the encoder fits them). Fine lines, small
  sprites, curves, star fields: office-hd and observatory. Keep each cell to two colours where
  you can; a third gets blended.

Colours are `0xRRGGBB` numbers; `NONE` is the terminal's own colour. `mix`, `scale` and `ramp`
blend them. Paint from the palette (`paletteOf(ctx)`, hooks/palette.ts), so `paper` and
`phosphor` work too, and use its meaning roles (`good`, `bad`, `warn`, `think`, `tools`, `model`)
for anything that means something and for nothing else.

## Sprites (`hooks/sprite.ts`)

Draw a figure as text instead of code: one character per pixel, rows on separate lines, `.` (or
a space) transparent, and a palette from those characters to colours. Parse once at module load.

```ts
import { blit, blitHi, frameOf, sprite } from '../sprite.ts'

const PAL = { k: 0x3a3440, w: 0xf4efe6, p: 0xf08a5d }
const CAT_SIT = sprite(`
  .k...k.
  .kkkkk.
  kwkkkwk
  .kkpkk.
  ..kkk..
`, PAL)
const CAT_BLINK = sprite(`
  .k...k.
  .kkkkk.
  kkkkkkk
  .kkpkk.
  ..kkk..
`, PAL)

// inside draw(): x, y are pixels (Canvas) or sub-pixels (HiCanvas), the sprite's top-left
const cat = frameOf([CAT_SIT, CAT_SIT, CAT_SIT, CAT_BLINK], ctx.frame, 3)
blit(c, cat, x, floorY - cat.h, { flipX: facingLeft })
blitHi(hc, cat, x, y, { scale: a.state === 'stalled' ? 0.6 : 1, tint: GOOD, tintBy: pulseFade })
```

- `sprite(text, palette)` → `{ w, h, at(x, y) }`; an unknown character throws when the module
  loads, so a typo shows at once. The common indent is removed, so indent pictures with the code.
- `blit` / `blitHi` clip at the canvas edges; options `flipX`, `tint` + `tintBy` (mix toward a
  colour), `scale` (brightness, applied after the tint).
- `frameOf(frames, frame, every)` picks an animation frame from a list.

## Ambience: the lofi layer

Every scene has a slow decorative layer ([DESIGN.md](DESIGN.md) section 42, the user's view in
[REFERENCE.md](REFERENCE.md#ambience)): rain on the glass, steam off a mug, a cat breathing. It
keeps a calm picture from looking frozen and means nothing, so it has to be built so nobody can
mistake it for the motion that reports the run. A new scene should have some; these are the rules.

- **Behind the switch.** Draw it only when `ambient(ctx)` (from `hooks/ambience.ts`) is true, and
  with it off draw exactly what the scene drew without it. The goldens draw with ambience off.
- **Never over text.** Touch art cells only. A cell holding a letter, digit, glyph or the caption
  must be the same with ambience on and off. On a HiCanvas, leave out a speck that would share a
  cell with something drawn there, so every cell keeps its two colours.
- **Never in a meaning colour.** Not the palette's `bad`, `good`, `warn` or `think`. Take the muted
  tones of `ambientTones(p)` (memoised per palette), or derive your own per palette: soft shadows on
  `paper`, dim greens only on `phosphor`.
- **Slow and small.** Loops of 2 to 60 seconds; nothing blinks faster than twice a second; a
  breathing light changes brightness by 15 % at most (`breathe(frame, periodSecs, phase)` gives a
  smooth 0..1); a moving speck moves one sub-pixel at a time. Give loops different lengths so the
  whole picture does not repeat for minutes.
- **No new signals.** No red lights, no flashing, no shooting stars, nothing that starts or stops
  with the run's state: it runs the same while thinking, during a tool call, on your turn and when
  done. Where meaningful motion and an ambient one share a spot, the ambient one is the slower and
  dimmer.
- **Pure.** A function of `frame` and `t` only, with no module state, so the tests and the rendered
  SVGs stay reproducible. Keep per-frame work small.
- **Room first.** Add a piece only where the scene has room for it; the compact size gets two or
  three at most.

When the run is done the pane repaints about four times a second with ambience on, so loops of a
few seconds look smooth then too. Add a test in the pattern of `tests/ambience-skies.test.ts`: at
every size, a range of widths, every palette and every state, ambience changes only art cells,
never into a meaning colour, keeps a finished scene moving, and off matches the scene's hashes
from before.

## Demo mode: every scene must look right across it

`/lookout demo` plays a scripted 72-second run (`hooks/demo.ts`, `demoSummary(elapsed, now)`)
that visits every state, every tool class and every pulse, a red → green test flip, then a success
and a failure. It is how people first meet a scene and how the README's animations are made.
Watch your scene through a whole loop at 40, 80 and 144 columns and at each size before opening a
pull request; nothing may jump, clip or go blank. `tests/demo.test.ts` draws every registered
scene at every sampled second.

## Registering a scene

1. Write `hooks/scenes/<id>.ts` exporting `const <name>: Scene`. Export the colours and layout
   helpers your tests need. Scenes import helpers from `../canvas.ts`, `../hicanvas.ts`,
   `../ambience.ts`, `./fit.ts` and `../sprite.ts`; from `./index.ts` only types (a value import
   would be a cycle).
2. Import it in `hooks/scenes/index.ts` and add it to `SCENES` (the order `s` cycles).
3. Add the id to the `scene` setting's `options` in `.claude-plugin/plugin.json` and to its
   description, to the scene list in `README.md`, and to the scenes in `docs/REFERENCE.md` (a
   paragraph, its sizes, the state table's column and its ambience pieces).

Registered scenes are picked up by `tests/scenes.test.ts` (every fixture at every size and width
decodes to `columns × rows`, frames differ while live, done keeps idle motion, transparency) and
`tests/demo.test.ts` with no change.

## The test every scene needs

Add `tests/<id>.test.ts` for what makes your scene yours, in the pattern of
`tests/office.test.ts`: decode the cells, then check the picture.

```ts
import { expect, test } from 'claude-code/testing'
import { activity } from '../hooks/activity.ts'
import { lighthouse, BEAM } from '../hooks/scenes/lighthouse.ts'
import { FINISHED, RUNNING, T } from './fixtures.ts'

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4)) // [codePoint, fg, bg] per cell
}
const draw = (s = RUNNING, columns = 80, frame = 0) =>
  decode(lighthouse.draw({ s, a: activity(s, T), frame, t: T, columns, rows: lighthouse.rows.standard }))

test('lighthouse: the beam sweeps while the worker is live and rests when done', () => {
  expect(draw(RUNNING, 80, 3).join()).not.toBe(draw(RUNNING, 80, 4).join())
  expect([...draw(FINISHED)].includes(BEAM)).toBe(false)
})
```

Cover: the activity mapping you promise (which state draws what), each pulse you react to, the
narrow layout (below 60 columns) and `minColumns`, and that nothing lands outside the canvas at
40 and 200 columns. Fixtures live in `tests/fixtures.ts` and are synthetic.

Run everything with `scripts/check.sh` (or only the TypeScript tests with `claude plugin test .`).

## Previews

```sh
node scripts/render-scenes.ts     # writes docs/images/<id>-<state>.svg, <id>-large.svg and <id>.svg (animated)
open docs/images/<id>.svg         # any browser shows the SVGs; the animation is one demo loop
claude --plugin-dir .             # then /lookout demo, /lookout <id>, /lookout large, `l` for layouts
```

The renderer is deterministic (fixed fixtures, clock and frames), so a re-render changes only
what your scene changed. Commit the images with the scene so the pull request shows it.

## Design rules

The look people like is the offices: thin monitor bezels and small monospace readouts on dark
screens. The rules that keep a scene there:

- **Monospace text for every number.** Turns, seconds, tok/s, money: terminal text laid over the
  canvas with `label`/`text`, at the terminal's own size. Never draw digits out of pixels.
- **Thin frames.** A one-pixel or half-cell outline in a muted material; no thick bezels, screws
  or engraved plates. The inside of a frame is a screen, not a decoration.
- **Graphics beside text, not instead of it.** A meter sits next to its number; a lamp next to
  its label. The picture says what is happening at a glance, the text says how much.
- **Nothing clipped at any width or size.** Lay out from `columns` and `rows`; `cut` every label
  to the room it has; right-aligned text keeps one column of margin; drop detail (labels,
  stations) on narrow panes rather than overlapping it. Check 40, 59, 60, 99, 100, 144 and 200
  columns at every size.
- **Calm when done, quiet when idle.** Motion that reports the run means work. A finished run
  breathes slowly; a stalled one dims. Ambience is the one exception, and it follows its own rules
  above.
- **Readable on light terminals too.** With a transparent background your colours sit on the
  person's terminal colour: avoid dim violets for anything that must be read.
