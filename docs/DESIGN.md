# lookout — design

A Claude Code mod that opens a sidebar pane following a *worker* session: a headless
`claude -p --output-format stream-json --verbose` run, typically a local model doing the coding
while the session showing the pane (the *orchestrator*) writes handoffs and verifies. The pane
shows thinking, tool calls, diffs, test results, context growth, decode speed, memory and an API
cost estimate. At its top sits an animated pixel scene driven by what the worker is doing.

This document is the contract the build follows. Where code and this document disagree, fix one
and say which.

## 1. Name and shape of the repo

- Plugin name: `lookout`. Command: `/lookout`. Pane id: `lookout`. Pane title: `Lookout`.
- Repo root is the plugin folder (the marketplace file sits beside `plugin.json`).

```
.claude-plugin/plugin.json      manifest, userConfig, types pointer
.claude-plugin/marketplace.json the marketplace entry (repo root is the plugin folder)
hooks/hooks.json                { "modules": ["./register.tsx"] }
hooks/register.tsx              the pane, command, hotkeys, polling, animation tick, status tool
hooks/activity.ts               Summary → Activity (pure)
hooks/canvas.ts                 half-block pixel Canvas, palettes, bars/area/segments, encode
hooks/hicanvas.ts               HiCanvas: 2 × 4 sub-pixels per cell, quadrant/braille fitting (section 13)
hooks/image.ts                  the image path: a scene's canvas as true pixels (section 16)
hooks/font.ts                   3 × 5 pixel font for text on the image path (section 16)
hooks/charts.ts                 river, pace, contextHill, decodeHill, memoryGauge (dashboard rasters)
hooks/demo.ts                   the scripted demo run: (elapsed, now) → Summary (section 12)
hooks/you.ts                    the orchestrator's activity: the You shape and a pure reader (section 17)
hooks/session-watch.ts          the hooks that collect You from the session's own events (section 17)
hooks/status.ts                 the text of the status tool, pure (section 18)
hooks/scenes/index.ts           the scene registry, Scene/SceneCtx types, sizes (sections 5, 14)
hooks/scenes/fit.ts             fitting a fixed-height scene to the height a layout asks for
hooks/scenes/aurora.ts          scene: night sky, curtains, comet, tent at large (HiCanvas, 3/5/9 rows)
hooks/scenes/office.ts
hooks/scenes/office-hd.ts        scene: the high-density office (section 19)          scene: desk, rack, tool stations, the orchestrator's desk (15 rows)
hooks/scenes/network.ts         scene: you → worker → model diagram with packets (9 rows)
hooks/scenes/factory.ts         scene: conveyor, press, tool arms, QA lamp (12 rows)
hooks/scenes/observatory.ts     scene: dome, moon, constellation (HiCanvas, 7/12/20 rows)
hooks/scenes/terrarium.ts       scene: tank, plant, snail, fireflies (HiCanvas, 7/12/20 rows)
hooks/summarize.py              stdlib-only summariser: log → Summary JSON (one process per poll)
hooks/adapters.py               model-server adapters (mlx-serve, llama.cpp, ollama, lmstudio, vllm)
hooks/prices.json               the price table + the date it was checked
types/index.d.ts                Summary, ServerStats, PluginState contract
tests/pane.test.tsx             pane tests (plugin test kit)
tests/scenes.test.ts            every scene: sizes, heights and widths, frames differ, no throw
tests/<scene>.test.ts           per-scene tests (aurora, office, network, factory, observatory, terrarium)
tests/hicanvas.test.ts          mask → glyph, colour fitting, encoding (section 13)
tests/image.test.ts             the image path and its font
tests/demo.test.ts              the demo script visits every state, class and pulse
tests/status.test.ts            the status tool's text
tests/fixtures.ts               SYNTHETIC summaries (hand-written against the type), You fixtures
tests/logs/*.jsonl              synthetic stream-json logs for the Python tests (tests/make_logs.py)
tests/samples/*                 synthetic model-server responses for the adapter tests
tests/test_summarize.py         python -m unittest
scripts/check.sh                python tests, contract check, plugin validate/test, private-word grep
scripts/render-scenes.ts        docs/images/*.svg: stills per scene and state, large stills, animations
scripts/polyfill.ts             Uint8Array.prototype.toBase64 for the renderer under Node
docs/DESIGN.md                  this file
docs/images/*.svg               the README's scene images (from scripts/render-scenes.ts)
README.md                       install, quickstart, config reference, scenes, known limits
```

Decision: the summariser stays in Python (stdlib only). `$.fs.read` has no range read and is capped
at 4 MiB; `$.process.run` caps a child's *output* at 4 MiB, which is fine because the summary is
a few KB. Python 3.9+ on PATH is the one requirement; the README says so. Shebang on every
script: `#!/usr/bin/env -S python3 -I -u`.

Performance rule: the summariser is invoked every 1.5 s. It must return cached output when the
log's `(size, mtime)` and the server adapter's input have not changed (cache dir
`~/.cache/lookout/`). Parsing a 50 MB log every 1.5 s is not acceptable; parsing it once per change
is.

## 2. Configuration

All of it through `userConfig` in `plugin.json`; every field optional with a default, so the mod
loads with no setup. `register(on, options)` reads them. Resolution order for the log path:
command argument > env `LOOKOUT_LOG` > config `log` > first entry of `sources` > the convention
`./logs/worker-current.jsonl` relative to the orchestrator's cwd.

| field | type | default | meaning |
|---|---|---|---|
| `log` | string | `""` | path of the stream-json log to follow (`~` allowed) |
| `sources` | string[] | `[]` | named sources, each `name=path`, e.g. `worker=~/logs/worker-current.jsonl`; `/lookout worker` switches |
| `scene` | string, options `aurora`,`office` (+ later scenes) | `aurora` | the scene drawn at the top of the pane |
| `view` | string, options `dash`,`scene` | `dash` | start on the dashboard or the scene-first layout |
| `server` | string, options `auto`,`none`,`mlx-serve`,`llama.cpp`,`ollama`,`lmstudio`,`vllm` | `auto` | model-server adapter; `auto` probes the URL and picks the first that answers |
| `serverUrl` | string | `http://127.0.0.1:8080` | base URL of the model server |
| `serverLog` | string | `""` | path of the server's log file (mlx-serve reads its per-request stats here) |
| `compare` | string, options from `prices.json` (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `custom`, `off`) | `claude-sonnet-5-5` | which API model the cost estimate compares against |
| `customPrices` | string | `""` | `in,out,cacheWrite,cacheRead` in $/Mtok, used when `compare` is `custom` |
| `stallSecs` | number | `180` | seconds without log movement while waiting on the model before the pane says "stalled" |
| `handoffFile` | string | `""` | file whose first lines the orchestrator strip shows as "what was handed off"; empty means the convention below |
| `background` | string, options `terminal`,`scene` | `terminal` | `terminal`: scenes leave their background unpainted so the terminal's own colour shows through; `scene`: scenes paint their own walls and floors |

Conventions documented in the README:
- `*-current.jsonl` symlink: point `logs/worker-current.jsonl` at the newest run; the pane follows
  the symlink and notices when it is re-pointed (path stays, inode/size change).
- Handoff file: `<log basename>.handoff.md` beside the log (e.g. `logs/worker-current.handoff.md`,
  resolved through the symlink to the real log's sibling). Its first non-empty line is the
  one-line task; the file's mtime is "since when".

Command: `/lookout [<source name> | <path> | dash | scene | <scene name> | next]`. Hotkeys on the
terminal: `v` toggles dash/scene, `s` cycles scenes, `n` cycles sources. Buttons are plain, with the
hotkey shown dim after the label.

The mod never hard-codes a path, port, host or model name. `scripts/check.sh` greps `hooks/ tests/
types/ README.md` for a private word list kept outside the repo (`.check-private`, git-ignored) and
must find nothing.

## 3. The Summary contract (v3)

Produced by `summarize.py`, typed in `types/index.d.ts`, stored in the `summary` atom with
`shape: 'summary-3'`. The summariser is called as:

```
summarize.py --log <path> [--server auto|none|<adapter>] [--server-url URL] [--server-log PATH]
             [--compare <model>|custom|off] [--custom-prices in,out,cw,cr] [--handoff PATH]
             [--stall-secs N] [--transcript]
```

`--transcript` reads a Claude Code session transcript (section 36; also detected from the rows
themselves). Only then does the summary carry `transcript: true` and `prompt: { text, t }`, the
latest prompt the person typed, and `pending` may be `{ kind: 'user' }`: the session waits on them.

```ts
type ToolClass = 'shell' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

type WatchEvent = {
  t: number | null
  kind: 'think' | 'text' | 'tool'
  label: string
  tool?: string
  cls?: ToolClass
  status?: 'running' | 'ok' | 'error' | 'denied'
  dur?: number | null
  detail?: string
}

type ServerStats = {
  adapter: 'mlx-serve' | 'llama.cpp' | 'ollama' | 'lmstudio' | 'vllm'
  ok: boolean                 // false: adapter chosen but it could not answer; `note` says why
  note?: string
  sampled_at: number
  model?: string | null
  ctx_limit?: number | null
  resident_gb?: number | null
  inflight?: { msgs?: number | null; prompt?: number | null; cached?: number } | null
  done?: { prompt: number; gen: number; prefill_tps: number; cached: number; decode_tps: number; stop: string; spec: number | null }[]
  rates?: { decode_tps?: number; prefill_tps?: number; kv_used?: number; running?: number } | null
  log_mtime?: number
}

type Summary = {
  path: string; exists: boolean; size?: number; mtime?: number; error?: string
  source: { name: string; path: string }
  model?: string | null; cwd?: string | null
  started?: number | null; last_ts?: number | null
  turns?: number; ctx?: number; out_est?: number; think_ms?: number; tool_ms?: number
  thinking?: string; text?: string
  errors?: number; denials?: number
  result?: { subtype: string; turns: number; duration_ms: number; api_ms: number; input: number; cache_read: number; cache_write: number; output: number; cost: number | null } | null
  pending?: { kind: 'done' } | { kind: 'model'; since: number | null } | { kind: 'tool'; tool: string; cls: ToolClass; label: string; since: number | null }
  stalled?: boolean
  tool_counts?: [string, number][]
  files?: [string, number][]
  events?: WatchEvent[]
  last_diff?: { path: string; diff: string; t: number | null; lines?: number } | null
  last_bash?: { cmd: string; desc?: string | null; out: string[]; more: number; status: string; t: number | null } | null
  last_error?: { t: number | null; tool: string; detail: string } | null
  turn_secs?: number[]; ctx_series?: number[]
  tests?: { t: number | null; failed: number; passed: number; total: number }[]
  tsc?: { t: number | null; errors: number }[]
  handoff?: { text: string; path: string; since: number } | null
  cost?: { compare: string; usd: number; priced_at: string; prices: { in: number; out: number; cache_write: number; cache_read: number }; basis: string } | null
  server?: ServerStats | null
  memory?: { at: number; free_gb?: number; total_gb?: number; server_gb?: number; server_model?: string } | null
  git?: { branch: string; commits: { hash: string; t: number; subject: string; stat: string }[]; dirty: string; untracked: number } | null
}
```

Tool classes: `Bash`→shell; `Read`,`NotebookRead`→read; `Edit`,`Write`,`MultiEdit`,`NotebookEdit`→edit;
`Grep`,`Glob`,`LS`→search; `WebFetch`,`WebSearch`→web; `Task`,`Agent`→agent; MCP tools and the
rest→other.

Cost: `basis` is the string "estimate: context growth priced as cache writes, the rest as cache
reads, output from characters/4". `priced_at` is the ISO date from `prices.json`. When `compare`
is `off`, `cost` is null and the pane shows no money at all. When the log's model is an API Claude
model and the result row carries `total_cost_usd`, the pane shows that as "real" beside the estimate.

Test/typecheck detection must not depend on one runner. Recognise: vitest/jest (`Tests  N failed | M passed (T)`),
pytest (`N passed, M failed in`), go test (`ok`/`FAIL` lines, `--- FAIL`), cargo test (`test result: ok. N passed; M failed`),
bun test (`N pass  M fail`), `tsc` (`error TS1234`), and a generic `N passing / N failing` (mocha).
Record the runner name is not required; the counts are.

## 4. Activity model

`hooks/activity.ts`, pure: `activity(s: Summary, t: number): Activity`. Every scene and the status
line consume this, never the raw Summary, so the mapping is in one place.

```ts
type Activity = {
  state: 'nolog' | 'waiting' | 'prefill' | 'thinking' | 'tool' | 'stalled' | 'done'
  tool?: string; cls?: ToolClass            // when state is 'tool'
  ok?: boolean                              // when state is 'done'
  secs: number                              // in the current state
  text: string                              // one line for the status row
  intensity: number                         // 0..1: decode tok/s against a soft cap of 60, or 0.5 when unknown
  pulse: { kind: 'tests-pass' | 'tests-fail' | 'error' | 'denied' | 'commit'; age: number } | null
}
```

- `nolog`: the file does not exist yet. `waiting`: exists but has no init row yet.
- `prefill`: pending model, the server reports an in-flight request, and `secs` is within the
  estimated prefill time (new prompt tokens ÷ last prefill tok/s) + 1 s.
- `thinking`: pending model otherwise. (stream-json carries whole messages, so thinking and
  writing cannot be told apart live; do not pretend.)
- `tool`: pending tool. `stalled`: pending model and `t − mtime > stallSecs`.
- `done`: result row present; `ok` is `subtype === 'success'`.
- `pulse`: the newest of {last test run, last error, last denial, newest commit} whose age
  `t − event.t` is under 8 s. Scenes use it for a transient effect; it never changes the state.

## 5. Scene engine

```ts
export type SceneCtx = { s: Summary; a: Activity; frame: number; t: number; columns: number; orchestrator?: string; transparent?: boolean }
export type Scene = {
  id: string            // config / command name
  title: string         // shown in the toggle button
  rows: number          // constant: a blit must match the mounted size
  minColumns: number    // below this the scene draws a simpler layout, never nothing
  draw(ctx: SceneCtx): string   // encoded Raster cells, columns × rows
}
export const SCENES: readonly Scene[]
export function sceneById(id: string): Scene   // falls back to SCENES[0]
```

Rules every scene follows (and `tests/scenes.test.ts` checks):
- `draw` never throws for columns 40..144 with any fixture, including `nolog` and `done`.
- Two consecutive frames differ while `a.state !== 'done'`; a done scene may be still, but should
  keep a slow idle motion (stars twinkle, a cursor blinks) so the pane does not look frozen.
- The canvas size is `columns × rows` exactly; row count never changes between frames.
- Labels use `Canvas.label` (auto-contrast). Text stays inside the canvas: clamp with `cut`.
- A scene draws its own one-line caption on its last row: the activity text and seconds.
- Keep per-frame work small: no allocation of big arrays beyond the Canvas, no string building in
  inner loops. 144 columns × 15 rows is 4320 pixels; 120 ms is the budget with room to spare.
- Breakpoints: `narrow` < 60 columns, `mid` 60..99, `wide` ≥ 100. Each spec says what to drop.
- Transparency: when `ctx.transparent` (from `background: terminal`; undefined counts as true) a
  scene leaves its background pixels NONE (walls, floors, backdrop fill) so the terminal's colour
  shows; objects, floor lines and belts still draw. Aurora is exempt: its 3-row sky is the picture.

Flicker: the tick blits only the active scene's key; the render hook draws the scene at frame 0
with the same key, and `mountedColumns` guards blit size. When the view or scene changes, the
render hook redraws (atoms changed) and the next tick blits into the new key.

Off the terminal (desktop, vscode, mobile) there are no Rasters: show a one-line text status with
the spinner from the frame atom, as today.

## 6. Scenes

### 6.1 aurora (refine; 3 rows, minColumns 40)

Keep the current look; make the activity mapping richer and the done states calmer.
- Sky: the existing two-sine drift. `thinking`: drift speed 0.035·frame. `prefill`: the band
  frequency doubles (busier). `tool`: drift slows to 0.015 and the palette cools 20% toward LAGOON.
  `stalled`: drift stops, palette desaturates toward grey-violet, a dim "stalled Nm" caption.
- Comet on the bottom pixel row: speed and colour by state (`thinking` THINK 0.9, `prefill` WARN 2.4,
  `tool` colour by class: shell TOOLS, read 0x9fb4ff, edit 0xf2a65a, search 0xc9a0ff, web 0x6fd3ff,
  agent 0xf08a5d, other DIM; speed 1.6). Intensity scales the tail length 8..16.
- Stars: 1 per 9 columns on the top pixel row, twinkling with `hash(i)`; none in `done`.
- Pulses: `tests-pass` → a green shimmer sweeps left-to-right over 8 s (a brightened column that
  moves); `tests-fail` → the comet turns BAD and leaves a red trail for 8 s; `error`/`denied` → a
  one-pixel red flash at the right edge each 4 frames; `commit` → a short gold spark at the comet.
- `done ok`: LAGOON dawn, no comet, a ✓. `done fail`: the dark-red tint, a ✖.
- Text rows: row 0 `◆ model … elapsed`, row 1 `spinner status … secs`, row 2 `turn N · ctx K · N err · ~$X`
  (the money only when `cost` exists). Narrow: drop the ctx and money.

### 6.2 office (refine; 15 rows, minColumns 48)

Keep the layout (window, desk+agent, rack, ceiling cable tray, four stations). Changes:
- Stations become six on wide, four on mid, three on narrow: shell, files (read), edit, search,
  web, agent; lit by `a.cls`. Narrow keeps shell, edit, files.
- The rack: LED blink rate from `intensity`; memory meter stays. When `server` is null, the rack
  still draws (dim, steady) and its label reads "no server".
- A wall clock above the window: a 5×5 pixel disc whose hand angle is elapsed mod 60 min.
- A red lamp on the rack top for `pulse.kind === 'error' | 'denied'`, flashing every 3 frames.
- Tests: the strip above the stations stays; `tests-pass` pulse → 12 confetti pixels fall from the
  ceiling over 8 s (hash-positioned, colours GOOD/WARN/PAPER); `tests-fail` → the strip's last
  light flashes BAD and the agent's monitor shows two red lines.
- `stalled`: the agent leans back (head 1 px up, hand off keyboard), a coffee cup on the desk with
  a 2-pixel steam wisp that rises on alternate frames; the monitor dims.
- `done`: the lights go off except the window stars and the monitor's `✓`/`✖`; the comet-equivalent
  is a slow blink of the shell cursor.
- Caption row stays. Row 13 right side: `ctx 54k/262k 21%` when the limit is known.

### 6.3 network (new; 9 rows, minColumns 40) — "who talks to whom"

A system-design diagram that animates. Four nodes left to right, joined by links:

```
 [you]  ────  [worker]  ════  [model]
                  │
                [tools ▭▭▭▭]
```
- `you` (orchestrator): a small rounded box, label the orchestrator's model short name (from
  `$.session.model()`, passed in via `s.handoff`-adjacent state; see section 8). Its link to the
  worker carries one packet when the handoff file is newer than the worker's start (a "task" box
  travels right), else it is idle.
- `worker`: a box with a fill bar inside = ctx / ctx_limit (DUSK ramp). Its outline pulses with
  `intensity` while `thinking`.
- `model`: a box whose inner rows are "tokens": `thinking` → packets flow worker→model→worker, the
  return stream dense by `intensity`; `prefill` → packets flow worker→model only, WARN; links idle
  otherwise.
- `tools`: a row of six small squares under the worker (shell, read, edit, search, web, agent),
  each lit by cumulative count (log2 steps, as the office file stacks); the active one glows and
  packets run down the vertical link to it and back.
- Pulses: `tests-pass` → the tools row flashes GOOD once; `tests-fail` → BAD; `error` → the link
  from the active tool shows a red "x" packet travelling back to the worker; `commit` → a gold
  packet leaves the worker upward and off the top.
- Narrow (<60): drop the `you` node and the tool labels; keep worker/model/tools.
- Wide (≥100): add the server's live numbers under the model node (`42 tok/s · 14k prompt`) and
  the elapsed under the worker.
- `done`: links go dim, the worker box shows ✓/✖, the model box goes dark.

### 6.4 observatory (new; 12 rows, minColumns 40) — calm, for long runs

A night sky over a hill with a domed observatory at the right.
- Sky: INK→0x1a1b3a vertical ramp; 1 star per 6 columns in the top 60% of pixels, twinkling slowly
  (`hash(i)`, period 40 frames); the Milky Way as a faint diagonal band (`sin` of x+y, mixed 8%).
- The dome: a half-disc 9 px wide, with a 1-px slit whose position rotates with `frame*0.02` while
  `thinking` (the telescope is tracking); the slit glows THINK. During `prefill` the dome rotates
  faster (0.06). During `tool` the dome stops and a small lamp beside the door lights with the
  tool-class colour.
- Each turn adds a star to a constellation in the top-left: the `i`-th turn is a point at a
  hash-position inside a region; consecutive points are joined by a dim line (bresenham). After
  40 turns it restarts a new constellation to the right. This is the "progress" readout.
- Shooting stars: one per tool call event in the last 8 s (from `s.events`), streaking from the
  top-left down-right, colour by class, 10 frames long.
- Context as the moon: a disc at the top right whose lit fraction = ctx / ctx_limit (crescent→full);
  no limit → a steady half moon.
- Pulses: `tests-pass` → an aurora band appears across the sky for 8 s (AURORA mixed 25%);
  `tests-fail` → a cloud bank (DIM pixels, noisy) drifts over the dome for 8 s; `error` → a red
  blink of the dome lamp; `commit` → a satellite (one bright pixel) crosses left to right.
- `stalled`: clouds cover half the sky and stay; the dome slit closes.
- `done ok`: dawn — the sky ramp warms toward 0x2a2a55 → 0x6a5a7a over the bottom rows, stars fade,
  the dome slit closed. `done fail`: the night stays, the lamp red.
- Narrow: drop the constellation region. Caption on the last row.

### 6.5 terrarium (new; 12 rows, minColumns 40) — a glass tank that grows

- The tank: a glass box with a 1-px light-blue outline and soil (0x4a3222 → 0x2a1a12 ramp) on
  the bottom 3 pixel rows; a water line is not needed.
- A plant in the middle grows with the run: its height in pixels = 2 + 16·min(1, turns/40) (or
  ctx/ctx_limit when a limit is known), stem 0x3f8a3f, leaves alternate sides every 3 px, each leaf
  a 2×1 blob 0x7ed492; the top sprouts a bud that becomes a WARN flower when the newest test run
  passed, and a drooping brown leaf (0x8a6a3a) when it failed (pulse, then it stays until the next
  run).
- Fireflies: count = round(intensity·8) while `thinking`; each a GOOD/WARN pixel wandering on a
  hash-driven path, blinking every 5 frames. None in `tool`.
- Rain: during `prefill`, 1 drop per 4 columns falling (WARN-tinted 0x9fb4ff) from the lid; the soil
  darkens.
- A snail (3×2 px, shell 0xf2a65a, body 0xe0b48a) crawls along the soil during `tool` calls,
  direction by class (shell/read → right, edit/search → left, web/agent → it stops and raises
  its antennae: 2 pixels up). It rests otherwise.
- A sun lamp on the lid: brightness = intensity while `thinking`; a cone of light (mix 10%) falls
  on the plant.
- Pulses: `tests-pass` → the flower opens (3×3 WARN+PAPER), petals pop in over 8 frames;
  `tests-fail` → one leaf drops to the soil over 8 frames; `error` → the glass shows a red hairline
  crack at the right for 8 s; `commit` → a gold seed falls and a sprout (2 px) appears in the soil.
- `stalled`: the lamp off, a slow drip from the lid every 20 frames.
- `done ok`: night in the tank, fireflies all lit and still, flower open. `done fail`: the plant
  wilts 2 px, lamp red.
- Narrow: tank only, no labels but the caption.

### 6.6 factory (new; 12 rows, minColumns 48) — a line with QA at the end

- A conveyor belt across the lower third: alternating 0x3a3346/0x2e2a38 pixels that scroll right
  at speed 0.5·(1+intensity) while `thinking`, 1.5 while `tool`, stopped when `stalled`/`done`.
- Items on the belt: one crate per turn (the last 12 turns visible), each a 3×2 block coloured by
  how long that turn took (HEAT ramp, cap at the p95 of turn_secs); they ride the belt.
- Machines above the belt, left to right: a press (`thinking`: its ram goes down and up every 6
  frames), the tool arms (one per class; the active one swings: a 2-px arm rotates over 4
  positions), the QA lamp (last test run: GOOD/BAD/off), the packer (`commit` pulse: a crate is
  wrapped gold and slides off the right end).
- Steam from the press at a rate by `intensity`; sparks (3 WARN pixels, 2 frames) from the active
  arm on `error`; the belt turns red-tinted on `tests-fail` for 8 s; `tests-pass` → the QA lamp
  flashes and a green stamp (✓ pixel pattern 3×3) lands on the newest crate.
- `prefill`: a hopper above the press fills from the top (WARN pixels pouring in).
- `done`: belt stopped, lights low, the last crate with a ✓/✖ stamp.
- Narrow: two tool arms only (shell, edit); mid: four; wide: six and the hopper.

Two or three of 6.3–6.6 get built. All four are specified, so building another later costs no new
design work.

## 7. Model-server adapters (`hooks/adapters.py`)

Each adapter is a function `(url, log_path, cache) -> ServerStats | None` with a cheap `probe(url)`
for `auto`. They use `urllib` with a 1.5 s timeout and never raise; a failed read returns
`{adapter, ok: false, note}`. Per-adapter data:

| adapter | source | gives |
|---|---|---|
| `mlx-serve` | its log file (format in the original `summarize.py`: `POST /v1/messages (N msgs`, `prompt=`, `ctx=`, `resumed A of B`, `<- P+G tokens streamed [prefill: X tok/s (C cached / T total), decode: Y tok/s] [stop]`, `avg_per_round=`) plus `GET /v1/models` | `done[]`, `inflight`, `ctx_limit`, `model`, `resident_gb` |
| `llama.cpp` | `GET /props` (`default_generation_settings.n_ctx`, `model_path`), `GET /slots` (`is_processing`, `n_ctx`, prompt tokens), `GET /metrics` when enabled (`llamacpp:prompt_tokens_seconds`, `llamacpp:predicted_tokens_seconds`, `llamacpp:kv_cache_usage_ratio`, `llamacpp:requests_processing`) | `rates`, `inflight`, `ctx_limit`, `model` |
| `ollama` | `GET /api/ps` (`models[].name`, `size_vram`, `context_length`), `GET /api/version` for probe | `model`, `resident_gb`, `ctx_limit`; `rates` null (Ollama exposes per-request timings only to the caller); `note: "rates unavailable"` |
| `lmstudio` | `GET /api/v0/models` (loaded instances: `state`, `max_context_length`) | `model`, `ctx_limit`; `note: "rates unavailable"` |
| `vllm` | `GET /metrics` (`vllm:num_requests_running`, `vllm:prompt_tokens_total`, `vllm:generation_tokens_total`, `vllm:gpu_cache_usage_perc`), `GET /v1/models` | `rates` from counter deltas between polls (store the last sample in the cache dir), `kv_used`, `running`, `model` |

Memory: macOS via `vm_stat` + `sysctl hw.memsize` (as now); Linux via `/proc/meminfo`
(`MemTotal`, `MemAvailable`); elsewhere null. Cached 10 s in `~/.cache/lookout/mem.json`.

The pane without any adapter: no "Model server" section, the office rack labelled "no server",
the activity's `intensity` 0.5, and the prefill state never fires. It must look finished, not
broken.

## 8. Orchestrator strip

An optional first row of the pane (config `view` does not affect it; the strip is on when a
handoff is known OR when the orchestrator's model can be read). Content, one line, truncated:

`you · claude-fable-5-1  →  worker · local/qwen-coder-32b-q4  ·  "Implement the staged runner"  ·  since 14m`

- `you`: `$.session.model()` read once at session start into a module variable (not state).
- `worker`: `s.model`.
- the task: `s.handoff.text` (first non-empty line of the handoff file, cut to fit); without a
  handoff file, the worker's first `text` event; without that, "started".
- since: `t − s.handoff.since` when a handoff exists, else `t − s.started`.
On non-terminal surfaces it is the same `Text` row. Below 60 columns it drops the "you" half.

## 9. Cost estimate policy

- Prices live in `hooks/prices.json`: `{ "checked": "YYYY-MM-DD", "source": "<docs URL>", "models": { "<id>": { "in": …, "out": …, "cache_write": …, "cache_read": … } } }` in $/Mtok.
  Fill it with the `claude-api` skill, not from memory, and record the date.
- The pane labels it `≈ $X at <compare>` with a dim `(estimate)` and the Result section says
  `priced <date>`. Never the word "cost" without "estimate" beside it.
- Rationale stays in `basis` and the README's known-limits section (the 25× lesson).

## 10. Tests

- `tests/pane.test.tsx`: as today, over all four surfaces, with SYNTHETIC fixtures: `RUNNING`
  (local model, mlx-serve stats, mid tool call), `THINKING` (no server), `FINISHED`, `NOLOG`,
  `FAILED` (done, subtype error, a denied call). Plus: the `/lookout <name>` command switches
  sources; `v`/`s` hotkeys change view and scene; the orchestrator strip appears when `handoff`
  is set and the model label is from the fixture; no "$" text when `compare` is `off` (via
  `test(name, { options }, body)`).
- `tests/scenes.test.ts`: for each scene in `SCENES` × columns {40, 80, 144} × fixtures: `draw`
  returns a base64 string decoding to exactly `columns*rows*3` u32s; frames 1 and 2 differ for the
  live fixtures; every code point is a printable BMP width-1 character.
- `tests/test_summarize.py`: synthetic logs under `tests/logs/` covering: a run mid tool call, a
  finished run, an error + a denial, vitest + pytest + cargo outputs, an Edit and a Write diff, a
  log that is not a file, a truncated last line. Asserts the JSON matches the contract keys and
  the cost arithmetic (one hand-computed case). Adapter parsers get unit tests on captured sample
  texts (write the samples by hand from the documented formats; no network in tests).
- `scripts/check.sh` runs everything and the grep from section 2.

## 11. Build plan and milestones

1. **extract**: new name, paths out, config in, synthetic fixtures, adapters, green checks. Commit.
2. **scenes**: activity model, scene engine, refined aurora and office, scene tests. Live in the
   pane. Commit.
3. **more scenes**: chosen from 6.3–6.6. Commit per scene.
4. **adoptable**: README (install, quickstart, config, scenes with screenshots, known limits).
   Commit.
5. **publish**: marketplace file, secret scan, read-through, ask public/private + license, push.

Commits per milestone; no dependencies beyond the runtime (and stdlib Python, until section 43.5
removed it).

## 12. Demo mode

A scripted, looping synthetic run so every scene can show all of its states and pulses with no
worker at all: for trying the mod, for showing it to someone, and for the README animations.

- Entry points: `/lookout demo`, the setting `log: "demo"`, or `LOOKOUT_LOG=demo`. The source
  name is `demo`; `/lookout <path>` or `/lookout <source>` leaves it. `n` cycles past it like any
  named source only if `demo` is listed in `sources`.
- `hooks/demo.ts` exports `demoSummary(elapsed: number, now: number): Summary`, pure: the summary of a fictional
  run `elapsed` seconds in. `register.tsx`'s poll skips the summariser when the source is `demo`
  and stores `demoSummary(now − demoStart, now)` instead (demoStart is a module variable set when the
  demo is entered; a reload restarts it). The tick animates as usual.
- The fiction: model `local/qwen-coder-32b-q4`, cwd `~/work/acme-todo`, a handoff `"Add due dates
  to todo items, with tests"` with `since` = demoStart, an mlx-serve-shaped `server` whose
  `done[]` grows one entry per turn with decode 18..46 tok/s, `memory` fixed, `git` with commits
  appearing at the commit pulses, `cost` growing with context. `source.name` is `demo` and the
  pane shows a dim `demo` tag beside the model wherever the model name is printed (strip, dashboard
  header, scene text rows that print the model).
- The script, 72 s per loop, then wrapping (turns and ctx keep growing across loops, capped):

| seconds | state | notes |
|---|---|---|
| 0–6 | thinking | intensity ramps 0.3→0.9 |
| 6–9 | prefill | `inflight` with 24k new prompt tokens |
| 9–15 | tool shell | `Bash · npm test -- todo`; last_bash output appears at 15 |
| 15 | pulse tests-pass | `tests` gets `{failed:0, passed:12, total:12}` |
| 15–21 | thinking | |
| 21–26 | tool edit | `Edit src/todo.ts`, a `last_diff` |
| 26–29 | tool search | `Grep dueDate` |
| 29–33 | tool read | `Read src/store.ts` |
| 33–38 | thinking | |
| 38 | pulse commit | `git.commits` gains `Add due dates to todos` |
| 38–43 | tool web | `WebFetch date-fns docs` |
| 43–47 | tool agent | `Task review the diff` |
| 47–51 | tool shell | `Bash · npm test` |
| 51 | pulse tests-fail | `{failed:2, passed:10, total:12}` |
| 51–55 | thinking | |
| 55 | pulse error | `last_error` on Bash, `errors` += 1 |
| 55–58 | tool shell then pulse denied | `denials` += 1, an event with status `denied` |
| 58–65 | stalled | `stalled: true`, mtime frozen |
| 65–69 | done ok | `result.subtype = success` |
| 69–72 | done fail | `result.subtype = error_max_turns` |

  Each segment boundary is a turn: `turns` += 1, `ctx` += 2.5k–4k, `turn_secs` and `ctx_series`
  gain an entry, `events` gains the matching rows (think/text/tool with `cls`), `out_est` grows.
  Pulses are expressed through the fields `activity()` already reads (`tests[].t`, `last_error.t`,
  `git.commits[].t`, a `denied` event's `t`) at the demo's own clock, so no scene or the activity
  model learns anything about the demo.
- `scripts/render-scenes.ts` uses `demoSummary` for the animated SVGs (one loop, sampled every
  frame at 120 ms for 72 s would be 600 frames; sample 2 frames per second of script, 144 frames,
  and keep the diff-only encoding), and keeps the fixture stills.
- Tests: `tests/demo.test.ts` walks `demoSummary` at 0.5 s steps over one loop and asserts that
  `activity()` visits every state (`thinking`, `prefill`, `tool` with every class, `stalled`,
  `done` ok and not ok) and every pulse kind, that turns and ctx are monotonic within a loop, and
  that every scene draws every sampled second at 40/80/144 without throwing. `pane.test.tsx`
  gains: `/lookout demo` draws the pane with no `process.run` call and shows the `demo` tag.
- README: a "Try it without a worker" line under the quickstart: `/lookout demo`.

## 13. High-resolution canvas (glyph fitting)

The half-block `Canvas` gives one pixel per cell column and two per row. The terminal can do
four times that: a cell is a 2 × 4 grid when drawn with quadrant blocks (U+2596–259F), the
half and eighth blocks (U+2580–258F) and braille (U+2800–28FF). All are BMP width-1 and Ghostty,
iTerm, kitty, WezTerm and Alacritty draw them from built-in sprites. The cost: one foreground and
one background colour per cell.

`hooks/hicanvas.ts` exports `HiCanvas(columns, rows)` with `w = columns * 2`, `h = rows * 4` and
the same drawing API as `Canvas` (`set`, `get`, `fill`, `text`, `label`, `encode`, plus `rect`
and `line`). A sub-pixel is 1/2 cell wide and 1/4 cell tall, so with cells at about 1:2 the
sub-pixels are roughly square. Scenes pick the canvas; office keeps `Canvas`.

Encoding, per cell, over its 8 sub-pixels:
1. Partition the sub-pixels into two clusters. NONE (terminal default) is always its own
   cluster and always the background. Otherwise take the two most distant colours (RGB
   distance) as seeds, assign each sub-pixel to the nearer seed, average each cluster. The
   lighter cluster is the foreground, the darker the background (so blocks read as "lit on
   dark", matching the half-block canvas).
2. The 8-bit mask of foreground sub-pixels (row-major, top-left first) selects the glyph:
   - all 8 → `█`; none → space (bg only, or NONE/NONE when empty).
   - a mask that equals a block glyph's mask uses that glyph: `▀` (rows 0–1), `▄` (rows 2–3),
     `▌` (column 0), `▐` (column 1), the four quadrants `▘ ▝ ▖ ▗` and the pairs `▚ ▞` and triples
     `▛ ▜ ▙ ▟`, the lower eighths `▂` (row 3), `▆` (rows 1–3), the upper eighth `▔` is not
     usable at this grid (it is 1/8), skip it; `▁`/`▃`/`▅`/`▇` have no exact 2×4 mask, skip.
   - any other mask → the braille character whose dots match. Braille dot order is
     (col, row): dots 1,2,3 = col 0 rows 0–2, 4,5,6 = col 1 rows 0–2, 7 = col 0 row 3, 8 = col 1
     row 3; code point = 0x2800 + bits. The visual weight of a braille cell is lighter than a
     block, which is the point: it reads as texture.
3. Text glyphs (`text`/`label`) override the cell as in `Canvas`: the glyph, its ink, and the
   cell's background = the mean of its non-NONE sub-pixels (NONE when all are).

Tests (`tests/hicanvas.test.ts`): exact mask→glyph for every block glyph; a mixed mask gives the
right braille code point; NONE handling; a cell of one colour gives `█` with bg NONE; the encoded
length; a 2-colour gradient cell lands fg/bg within the input range; `label` contrast; every
code point printable BMP width-1. `scripts/render-scenes.ts` renders every glyph by its mask
(a rect per lit sub-pixel; braille dots as slightly inset rects) so the images stay faithful.

Performance: the encoder touches 8 sub-pixels per cell and at most ~20 mask comparisons (use a
lookup table from mask → code point built once at module load, 256 entries); 144 × 15 cells is
well under 1 ms.

Scene guidance for the hi-res canvas (what makes the office the strongest scene, carried over):
concrete objects with outlines and a ground line, a few colours per object, labels under things
not over them, one dedicated text row for the caption, and motion that means something.

### 6.1b aurora, rebuilt (5 rows, HiCanvas, minColumns 40)

A night-sky banner, not a gradient. Rows 0–3 are the picture (16 sub-pixel rows), row 4 is the
caption row on terminal background.
- Sky: a vertical ramp from 0x0a0b1a (top) to 0x141530 (horizon) painted on sub-pixels; stars as
  single lit sub-pixels (braille dots), ~1 per 3 columns, twinkling on `hash`; a thin horizon
  line of distant hills (2–3 sub-pixel bumps, 0x1b1c3a) along the bottom two sub-pixel rows.
- The aurora: 3–4 curtains, each a vertical streak field: for x, brightness = sum of two slow
  sines of x and frame (drift 0.02–0.05), extending from sub-pixel row 2 down to a wavy lower
  edge; colour by height on a GREEN→TEAL→VIOLET ramp (0x2fbf71, 0x3ec9c0, 0x8f6fe8), mixed into
  the sky at 35–70 % so braille dithering appears at the soft edges. State drives the curtains:
  `thinking` drift normal; `prefill` the curtains brighten and ripple faster; `tool` the curtains
  calm and the comet runs in the tool-class colour; `stalled` the curtains fade to grey-violet and
  freeze; `done ok` a dawn: the sky bottom warms to 0x5a3a5a→0xd08a5a over the last loop and the
  curtains thin out; `done fail` the sky stays, one red star.
- The comet: as before but on sub-pixels, head 2×2, tail 10–20 sub-pixels with braille falloff.
- Pulses: `tests-pass` a green shooting star left→right; `tests-fail` a red one right→left;
  `error`/`denied` a red blink of the brightest star; `commit` a gold satellite crossing high.
- Text: row 0 keeps `◆ model … elapsed` on a 1-cell dark strip? No: text over art was the
  problem. The caption row (row 4) holds `spinner status · secs`; the model/elapsed and the
  `turn · ctx · err · cost` line move to the pane's own text rows under the scene (the pane
  already prints the status row on non-terminal surfaces; on the terminal print the two lines as
  `Text` under the raster for every scene, so scenes never print stats).
  Consequence: aurora prints no stats; office, network and factory keep the labels that caption
  objects (model under the desk, tok/s under the rack, ctx in the worker box, turns by the belt)
  and print no separate stats line.

### 6.4b observatory and 6.5b terrarium on HiCanvas

Build 6.4 and 6.5 as written, on `HiCanvas` at 12 rows, as dioramas in the office's manner:
a ground line, concrete objects (the dome has a door, a lamp, a slit; the terrarium has a lid,
a lamp, glass walls with highlights, soil with pebbles), labels under objects, and the caption on
the last row.

## 14. Scene sizes (for alternative pane layouts)

Pane layouts the user can toggle through are coming: a wider sidebar, blocks moved around,
more detail per block. Scenes therefore stop having one fixed height. The contract:

```ts
export type SceneSize = 'compact' | 'standard' | 'large'
export type Scene = {
  id: string
  title: string
  minColumns: number
  rows: Record<SceneSize, number>      // e.g. aurora { compact: 3, standard: 5, large: 9 }
  draw(ctx: SceneCtx): string          // ctx.rows is the height to draw; always honoured
}
export type SceneCtx = { s; a; frame; t; columns; rows: number; orchestrator?; transparent? }
```

- `draw` must produce exactly `columns × ctx.rows` cells for ANY `rows >= rows.compact` (a layout
  may hand a scene an in-between height), and for columns 40..144 (wider is clipped by the
  pane, so draw up to 200 without throwing). A scene lays itself out from `columns` and `rows`
  the way it already does from `columns`: more rows mean taller objects, more sky, a second
  row of stations, bigger text margins, not stretched pixels. Aspect ratio changes with the
  layout; design objects with their own proportions and let the empty space go to sky, wall or
  floor.
- `rows.standard` is what the pane uses today; `compact` fits a short sidebar; `large` is for
  a layout that gives the scene the top third of a tall pane.
- The pane picks the size from the setting `sceneSize` (`compact` | `standard` | `large`,
  default `standard`) now, and from the layout later. The blit uses the mounted rows.
- `tests/scenes.test.ts` draws every scene at each of its three sizes and at two in-between
  heights (`compact + 1`, `standard + 2`) × columns {40, 80, 144, 200}; frames differ while
  live; done keeps idle motion; every size decodes to `columns × rows × 3` words.
- Existing scenes (office 15, network 9, factory 12) take `rows: { compact: n, standard: n,
  large: n }` with their current height for now, then get a real compact/large pass each.
  `hooks/hicanvas.ts` and `hooks/canvas.ts` already take any `(columns, rows)`.

Note (the size pick): `/lookout compact|standard|large` writes the `sceneSize` atom, tagged
`scene-size-2`, which holds the person's pick or null (a fresh session clears it). The drawn size
is the pick, else the `sceneSize` setting; panel and wall draw compact and large only when there is
no pick and the setting is the default. The pick used to live in a module variable, so a reload
forgot a pick equal to the setting (`standard`) and the layout's size came back; the atom keeps it.

## 15. Instrument modules and the panel layout

The starting picture: a wall of instrument panels (dials, VU meters,
oscilloscopes, LED matrices, tape reels, patch bays, seven-segment counters, lamps, toggles) in
two greys with one phosphor accent, a dark log screen in the middle, and the operator seated
below. Every one of those instruments has a reading in the Summary already. The dashboard's
blocks become **modules**: small HiCanvas instruments with one job each, tiled by a layout.

### Visual language (`hooks/panel.ts`)
- Palette `PANEL`: bezel 0x8d8d86, bezel light 0xc9c9c0, face 0x34343a, face dark 0x24242a,
  screw 0x5c5c62, screen 0x0a0e0a, phosphor 0x62e07e, phosphor dim 0x2c6b3b, phosphor glow
  0x9ff2b0, ink 0xe9e9e1, amber 0xf2c25b (warnings), red 0xf0605d (errors). Modules paint their
  own face (they are objects), so the terminal shows through only between modules.
- A module is a bezelled plate: 1-sub-pixel light edge top/left, dark edge bottom/right, a
  screw dot in each corner, a dim label in the lower edge (`c.label`, ink on face), and an
  instrument inside. Screens are inset dark rectangles with a 1-sub-pixel dim phosphor grid.
- Readouts: numbers as text in phosphor on a screen (crisp), or `nixie` seven-segment digits
  drawn from sub-pixels (4 × 7 per digit = 2 cells × 1.75 rows) for the big numbers in large
  layouts.
- Motion means something: a needle moves because a value moved; reels spin while the model
  generates; a lamp blinks because a test just ran. Idle modules are still.

### Module catalogue (`hooks/modules/*.ts`, each `draw(c: HiCanvas, box, data, frame)`)
| module | reading | instrument |
|---|---|---|
| `counter` | turns, tool calls, errors, ≈ cost, out tokens | screen with a text or nixie number and a unit |
| `dial` | ctx / limit, memory used | round gauge, tick marks, needle, red zone past 80 % |
| `vu` | decode tok/s, prefill tok/s | horizontal bar meter with peak-hold tick, scale marks |
| `scope` | turn seconds, ctx series | oscilloscope trace on a dotted grid, newest right |
| `ledmatrix` | tool counts by class | 6 × 4 dot grid per class, lit by log2(count), the active class blinking |
| `reels` | model generating | two tape reels rotating at `intensity`, stopped otherwise |
| `patchbay` | orchestrator ↔ worker ↔ server ↔ tools | jack grid with a cable to the busy jack, packets as in the network scene |
| `clock` | elapsed; the handoff's since | analogue face with two hands, or digital `hh:mm:ss` |
| `lamps` | test runs, tsc runs, errors, denials | a row of round lamps, green / red / off, newest right |
| `toggles` | view, scene, size, source | labelled rocker switches showing the current pick (read-only) |
| `river` | thinking / tools / model split | the existing time ribbon, re-drawn on the hi-res canvas |
| `strip` | orchestrator strip | a text screen: you → worker · task · since |

### Layouts (setting `layout`, hotkey `l`, `/lookout classic|panel|wall`)
The `layout` atom holds the pick; a fresh session takes the setting (default `classic`), a reload
keeps the pick (as `scene` does); `l` cycles classic → panel → wall. Off the terminal (no Rasters)
`panel` and `wall` draw as `classic`.
- `classic`: today's pane (scene on top, text blocks below).
- `panel`: the strip, the scene at `compact`, the two stats rows, then the module grid as ONE
  Raster (key `modules`, `HiCanvas(columns, packed.rows)` from `packModules(ids, columns, ctx)`,
  `ctx.ui` = view, scene, size, source), the buttons, then Result/Runs, the last error, Thinking,
  Last edit, Last command and Timeline. The numbers, Time, Pace, Model server, Memory, Checks and
  Git blocks are not drawn: the modules replace them (`v` therefore only matters in classic).
  Grid columns by pane width: 2 at < 70, 3 at < 100, 4 at < 130, 5 beyond (`hooks/grid.ts`).
- `wall`: the visible modules split in two halves, the first packed above the scene (Raster
  `modules-top`) and the rest below the stats rows (`modules-bottom`), the scene at `large`, then
  the same text blocks. Under 70 columns it draws as `panel`.
- Order is the config list `modules` (default `DEFAULT_ORDER`: strip, counter turns/tools/cost,
  dial ctx, vu decode, scope pace, ledmatrix, lamps, clock, reels, river); unknown ids are
  skipped (a list of only unknown ids falls back to the default); data-less modules are hidden.
- Scene size: `classic` draws the picked `sceneSize`; `panel` compact and `wall` large unless the
  person picked a size (the setting non-default, `/lookout compact|standard|large`, or an atom
  value that differs from the setting after a reload).
- The tick blits the mounted module Raster(s) every frame with the scene (reels, lamps and the
  clock move), at the rows packed at the last draw; `mountedKeys` holds the keys the last
  terminal draw mounted so a blit never targets an unmounted key. `drawGrid` + encode costs about
  0.6 ms at 144 columns (Node 24, the running fixture, 12 modules), so no frame skipping.

### A scene in this style (6.7, future): `controlroom`
The office's big sibling for the `large` size: the module wall as the back wall (a sample of
modules drawn small and live), the operator at a desk below it, a cat or dog on the floor,
the log screen in the middle showing the last three timeline lines. Shares `hooks/panel.ts`
with the modules.

## 16. True-pixel scenes (the image path)

Where the terminal draws images, the scene is an `Image` (`key` = scene id, the same `columns ×
rows` as the Raster) instead of a Raster; the two pane rows under it, the charts (still Rasters)
and `mountedColumns/Rows` are unchanged, and the tick blits `{ requestId, key, source }` each frame.

- **Pixels.** `hooks/image.ts` paints a canvas as `{ rgba, width, height }`: nearest-neighbour,
  one cell 8 × 16 image pixels (`Canvas` scale 8, `HiCanvas` scale 4), NONE transparent. The scale
  halves while the picture is over 2 MiB or 2048 px a side (144 × 15 cells is 1152 × 240, 1.1 MB).
- **Text.** Glyphs laid with `text`/`label` (read through the canvases' `glyphs()`) are drawn with
  the 3 × 5 font in `hooks/font.ts` at ×2, centred in the cell, on the cell's mean colour as in the
  Raster. Braille draws its dots; `◆ ✓ ✖ · …` have shapes; anything else is a solid box.
- **Detection.** The engine gives no "this terminal draws images" signal, so `renderer: auto` reads
  `TERM_PROGRAM` (`ghostty`, `kitty`, `WezTerm`, `iTerm.app` at 3.5+ via `TERM_PROGRAM_VERSION`),
  `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR` and `TERM` (`xterm-kitty`, `xterm-ghostty`) once a
  session; `TMUX` set means glyphs. iTerm2 draws them under the fullscreen layout only
  (`viewport.isFullscreen`). A blit denied because the Image draws its `alt` (or `fix:
  tmux-passthrough`) drops `auto` to glyphs for the session. `image` and `glyphs` force a path.
- **Spike shortcut.** Scenes are untouched: `Canvas.encode()` and `HiCanvas.encode()` note
  themselves to `captureEncoded(fn)` (canvas.ts), which runs `sc.draw(ctx)` and hands back every
  canvas it encoded; `sceneCapture` takes the last one `columns` wide, stacking the extra band
  `fitRows` encodes after it, or cropping the top, as `fitRows` does. The follow-up is a
  `drawCanvas?(ctx): Canvas | HiCanvas` on the scene contract, so the image path asks for the
  canvas directly and skips the cell encoding it never uses.
- **Cost.** Painting office at 144 columns takes about 0.3 ms; the base64 source is 1.47 MB, so at
  the 120 ms tick the terminal is sent some 12 MB/s while the worker is live.

## 17. The orchestrator's own activity and the two-desk office

The mod runs inside the orchestrator session, so it can watch that session too, through the
engine's own events, and draw the orchestrator beside the worker.

Data (`hooks/you.ts`, kept in a module variable, not `$.state`; a reload starts it idle):
```ts
export type You = {
  state: 'idle' | 'thinking' | 'tool' | 'waiting'   // waiting = the turn ended, the person's move
  tool?: string; cls?: ToolClass                     // while 'tool'
  since: number                                      // epoch seconds the state began
  turns: number                                      // turns this session (from turn.start)
  model?: string                                     // $.session.model() at start
  lastHandoff?: number                               // mtime of the handoff file when the worker's log is newer than it
}
```
Wiring in `register.tsx`: `on('turn.start')` → thinking; `on('tool.call')` → tool for the call's
duration (`await next(e)` around it, class via `toolClass`), back to thinking after;
`on('turn.complete')` → waiting; idle until the first turn. Main loop only: events carrying
`e.agentId` (a subagent's) are passed on unseen. The hook functions and the state live in
`hooks/session-watch.ts`; `register.tsx` calls `on(...)` with them itself (the engine's validator
wants `on("<event>", hook)` literally in the module that registers). `SceneCtx.you?: You` is passed
to every scene; the office is the first to draw it.

The two-desk office (office.ts, every size): a second desk to the LEFT of the window wall, or
on the right end past the stations on wide, with the orchestrator figure (a different shirt
colour, 0x9a5a9a, and a headset) facing a monitor of its own. Its monitor shows a slow cursor
while `waiting`, scrolling text while `thinking`, and the tool-class colour while `tool`. A
hand-off is a paper sheet (3×2 PAPER pixels) that slides along the floor from the orchestrator's
desk to the worker's desk when `you.lastHandoff` is newer than the last one drawn (8 frames),
then sits on the worker's desk. A speech bubble "…" above the orchestrator while thinking.
Labels under the desks: `you · <short model>` and `worker · <short model>`. On narrow (<60)
the orchestrator desk is dropped and the figure is a single seated silhouette at the far left.
With no `you` (older pane, tests), the office draws exactly as today.

## 18. The `lookout_status` tool

`$.tool.register({ name: 'status', description, inputSchema })` at `session.start`, served by
`on('tool.call', { tool: 'mcp__lookout__status' })`. The orchestrating model calls it to
verify the worker through the same summary the pane shows. Input: `{ source?: string,
detail?: 'brief' | 'full' }`. Output text (brief, ≤ 25 lines):

```
lookout · worker · local/qwen-coder-32b-q4 · following logs/worker-current.jsonl
state: running Bash "npm test -- todo" for 4s · turn 18 · ctx 54.2k/131.1k (41%) · 21m elapsed
tests: last run 12/12 passed (3m ago) · tsc clean · errors 1 · denials 0
last error: Bash exit 1 (6m ago): "..."
git: main · 2 commits since start · 1 file dirty
server: mlx-serve 30 tok/s decode · 12.1k tok/s prefill
cost: ≈ $0.47 at claude-sonnet-5-5 (estimate)
handoff: "Add due dates to todo items, with tests" · since 14m
```
`full` adds the last 10 timeline rows, the last diff header and the last command's output tail.
A missing log says so. The description tells the model when to call it ("after handing work to
the worker, to check progress, tests and errors without reading the log"). The tool never
controls the worker. Config `tool: boolean` (default true) turns registration off. The serving
hook answers `{ result: <text> }` (a hook's own answer to `tool.call` is `{ result }`); any failure
answers `lookout: <reason>` rather than an error. The text is built by `hooks/status.ts`
(`statusText`, pure).

## 19. office-hd: the high-density office

The office rebuilt on `HiCanvas` with the two figures facing each other and real readouts on
every screen. Scene id `office-hd`; the classic office stays as `office`.

Sizes `rows: { compact: 10, standard: 15, large: 24 }`, `minColumns: 60`; narrow (< 60) is not
supported: below 60 draw the standard layout cropped at the right and say so in a comment.

Layout, left → right (standard, 80 columns = 160 × 60 sub-pixels):
- **Orchestrator desk** at the left, figure facing RIGHT (toward the room), shirt 0x9a5a9a,
  headset; monitor on the desk's right half, angled toward the centre (a 1-sub-pixel bevel on
  the inner edge). Desk 0x6b4a32 with a 0x8a6a4a top edge; chair back behind the figure.
- **Worker desk** at the right, mirrored: figure facing LEFT, shirt 0x3d7ea6; a bigger monitor.
- **Between them, on the back wall**: the server rack (centre) with a readout screen on top,
  flanked by the tool station panels in a 3 × 2 grid (shell, read, edit / search, web, agent)
  in the §15 panel style (bezel 0x8d8d86, light edge 0xc9c9c0, dark edge 0x5c5c62, screw
  dots, phosphor screens 0x0a0e0a / 0x62e07e). A wall clock and the window (stars) at the top
  corners; a ceiling cable tray along the top with packets to the active station.
- **Floor**: a ground line and a floor band; the hand-off sheet slides from the orchestrator's
  desk to the worker's across the floor on a new handoff and rests by the worker's keyboard;
  the worker→rack cable runs along the floor's back edge.

Readouts (text via `c.label`, phosphor ink on screen, every line `cut` to its screen width):
- **Worker monitor** (≥ 14 cells × 3 text rows at standard; 4 rows at large): row 1 the
  activity (`Bash · npm test`, `thinking…`, `reading prompt`), row 2 `ctx ▮▮▮▮▯▯ 41%` (a
  6-cell bar from block characters, or sub-pixel bar + percentage), row 3 `tests 12/12 ✓ ·
  tsc ✓` (or `✖ 2 failing`), large adds row 4: the last edited file name. While thinking the
  screen also scrolls faint code lines in the pixels behind the text (dim, 0x1f3a2a).
- **Orchestrator monitor** (≥ 10 cells × 2 rows; 3 at large): row 1 `you · <short model>`,
  row 2 the state (`thinking…` / `waiting for you` / `tool · Bash`), large adds the handoff
  title. Cursor blink while waiting.
- **Rack readout**: `30 tok/s` and a decode bar; LED column by intensity; a memory meter
  `48/256 GB` as a vertical bar on the rack's side with a small label at large.
- **Station panels**: each a bezel with a 1-line phosphor screen: `$ 9` / `read 14` / `edit 7`
  / `grep 4` / `web 0` / `agent 0`, lit in `CLASS_COLOR` while active; at large a second line
  with the last label of that class from `s.events` (e.g. `npm test`, `todo.ts`), cut.
- **Lamp strip** above the panels: test runs (GOOD/BAD) newest right; tsc lamp; an error lamp
  that blinks on `error`/`denied` pulses.
- Labels under the desks: `you · opus 5` and `worker · qwen coder`. Caption on the last row.

Motion: typing hands on both figures when their side is active; packets worker→rack while
thinking (density by intensity), rack→worker during prefill (WARN), worker→station while a
tool runs; the orchestrator's cable lights when `you.state === 'tool'`; confetti on
`tests-pass`; red lamp + both monitors flashing a red row on `tests-fail`; the sheet on a new
handoff; stalled dims everything 40 % and shows steam from a mug on the worker's desk; done
turns the lights off except the monitors' ✓/✖ and the window stars.

Two-colour rule: every screen is a dark rectangle with text; bars are block characters in text
rows or solid sub-pixel fills (no gradients inside a cell); panel bevels are 1-sub-pixel lines
in one colour per edge.

## 20. Notifications: toasts and the status line

Setting `notify`: `off` | `status` | `toasts` | `both`, default `toasts`. Three events only:
- **tests failed**: `✖ worker: 2 of 12 tests failing` (once per test run, when `failed > 0`).
- **stalled**: `⏸ worker: no log movement for 3m` once when `stalled` becomes true, and
  `▶ worker resumed` once when it clears.
- **finished**: `✓ worker finished: success · 42 turns · 21m` / `✖ worker finished: error_max_turns`.
Toasts via `$.ui.toast(text)`; the status line via `$.ui.status(text)` shows the one-line
activity (`lookout · Bash npm test · 4s · ctx 41%`) while a run is live and clears
(`undefined`) when nothing is followed. Never during the first poll of a source (no toast
storm on open), never for the demo source, never twice for the same event (`hooks/notify.ts`
keeps the last-seen keys in a module variable; pure `diffEvents(prev, next, t)` returns the
list to emit; tests cover dedup, first-poll silence and the demo exclusion).

## 21. Replay of finished logs

`/lookout replay [<path>|<source>]` (default the followed log) replays a finished log from its
start: the pane's clock `t` runs from `started` at speed ×8 (hotkeys on the pane while
replaying: `p` pause/resume, `b` / `f` seek −30 s / +30 s (a Button hotkey is one digit or lowercase letter, so not `[` / `]`), `x` cycles ×1 ×4 ×8 ×32, `r`
leaves replay). The summariser takes `--until <epoch seconds>` and builds the summary as if
the log ended there: rows with a later timestamp are ignored, `result` only if before `until`,
`mtime` = `until`, `stalled` false, `pending` from the rows kept. The poll runs it with the
replay clock every 1.5 s (the cache key includes `until` rounded to the second). The scenes
and the orchestrator strip need no change; the caption row gets a `⏵ replay ×8` tag from the
pane (a dim `Text` row under the scene). A live source is left alone; replay keeps its own
atom `replay: { path, at, speed, paused } | null` (declared in the contract).

## 22. Runs scoreboard and compare-at-every-model

- The summariser, when a log has a `result` row, appends one line to `<log dir>/runs.jsonl`
  (once per real path; `~/.cache/lookout/runs-seen.json` remembers): `{ t, path, source,
  model, subtype, turns, duration_ms, ctx_max, out_est, tests_last, errors, denials,
  cost_at: { <compare id>: usd, … for every row of prices.json }, priced_at }`.
  `--runs-file PATH` overrides, `--no-runs` disables. `Summary.cost.at_all` carries the same
  per-model table for the live run.
- The pane's **Result** block gains a compare table when the run is done: one row per price
  model, `≈ $X`, the chosen compare bold, a dim `priced <date>` line, and when `runs.jsonl`
  exists beside the log (read with `$.fs.read`, last 8 lines) a **Runs** list: `hh:mm · model ·
  subtype · turns · wall · ≈ $ at <compare>`, newest first, the current run marked.

## 23. Polish pass: the slate panel, the modules, the two offices

The first module library took that picture of an instrument wall too literally: cream bakelite plates
with screws and engraved labels, block-digit counters, a needle dial, a dot-matrix and a
tape-reel. On a terminal those read as oversized frames and pixel mush. The offices, with
their thin monitor bezels and monospace readouts on dark screens (`read 14` over a dim
`todo.ts`), are what works. This pass brings the modules to that look and tightens both
offices. No new modules, ids, settings or layouts; the module ids, `hasData` rules and the
grid packer's contract stay, so a user's `modules` list keeps working.

### 23.1 The slate panel (hooks/panel.ts)

- **Frame.** One cell ring in the office-hd monitor material: `MON 0x55506a` with the
  `BEVEL 0x8f89a6` highlight on the top half-row (▀) and the left sub-column (▌) only; the
  bottom half-row (▄) and right sub-column (▐) in `MON`; the other half of each edge cell is
  the screen colour, so the frame reads half a cell thick. No screws, no light/dark plate
  edges, no face band: the inside is the screen (`PANEL.screen 0x0a0e0a`, faint graticule
  only on modules that draw a trace or a meter). `PANEL.bezel/light/edge/face/faceDark/screw`
  go away; the few `PANEL` names the scenes import stay as is.
- **Title row.** The module's title on the first inner row, left, in `inkDim` (now the office
  key-cap grey `0x8a8399`); its headline reading right-aligned on the same row in `phosphor`
  (or `red`/`amber` when hot). Nothing is engraved on the frame any more, so a module's
  usable height is `h − 2` rows, the first of them the title row.
- **Done state.** When `a.state === 'done'`, readings dim to `phosphorDim`, titles stay.
- **Text first.** Numbers are terminal text at the terminal's own size. `nixie`, `nixieWidth`,
  `nixiePw`, `NIXIE_ROWS`, `needle`, `tickRing` and the block font are deleted (no module may
  draw digits from pixels). `quad`, `qline`, `lampRow`, `write`, `writeRight`, `screen`,
  `fillCells`, `clipped`, `innerOf` stay; `plate(c, box, title, headline?, hot?)` draws the
  frame and the title row and returns the content box (rows under the title).
- **Graphics that stay.** Thin horizontal meters (one row: the bar on the quad grid, 2
  sub-rows tall, centred in the row, with its scale ticks as single quads under it), traces
  (quad lines), stacked class-colour bars, tick strips, lamps (●). Each is next to its text,
  never instead of it.

### 23.2 Module by module (hooks/modules)

Heights are the module's `minH` in rows (frame rows included). `wantsW` is unchanged.

- **strip** (hand-off), minH 3: title `hand-off`, headline the elapsed-since-handoff; row 2
  `you · opus 5 → qwen coder · <task…>`; a third row (when h ≥ 4) `you <state> <for>` and the
  worker's current tool, as now.
- **counter:*** minH 4: title row (`turns` … `18`; `tool calls` … `34`; `errors` … `1` in red
  when > 0; `≈ cost` … `$0.47`; `output` … `9.8k`), then one graphic row and one dim detail row:
  - turns: a tick strip, one `▮`-quad pair per turn (newest right, the last one blinking while
    live), coloured by the turn's length (phosphor under the median, amber over 2×); detail
    `avg 5.5s · last 3.0s`.
  - tools: a stacked bar by class in `CLASS_COLOR` (the office's striped screen); detail
    `read 14 · edit 7 · $ 9` (top three, class-coloured names).
  - errors: lamps `err ● deny ●`; detail the last error's tool and when.
  - cost: a bar of est against the highest price model in `cost.at_all` (dim track, phosphor
    fill) so the estimate's scale is visible; detail `sonnet 5 · real $0.52` when known.
  - output: a bar of output tokens against context used; detail `ctx 54.2k`.
  On `h = 3` (one content row) only the title row and the detail row; the graphic is dropped.
- **dial:ctx / dial:memory → linear meters**, minH 4 (ids unchanged, the title stays
  `context` / `memory`): title row headline `41%` (or `43 GB`); row 2 the meter: a dim track
  the inner width, phosphor fill to the fraction, amber past 80 %, red past 95 %, scale quads
  at 25/50/75 % under the bar; row 3 dim `54.2k of 131.1k` (`43 of 64 GB`). No needle.
- **vu:decode / vu:prefill**, minH 4: title `decode tok/s` headline `30`; row 2 the meter with
  a peak-hold quad in `phosphorGlow` at the peak; row 3 dim `peak 32 · 0 … 60`.
- **scope:pace / scope:ctx**, minH 5: title row with the last value as headline; the trace
  fills the rows under it (quad lines as now, graticule kept); for ctx the 80 % line stays as
  dim red quads. The readout no longer overlays the trace.
- **ledmatrix** (tools by class), minH 4: title `tools by class` headline the total; row 2 a
  full-width stacked bar in class colours, 2 sub-rows tall; row 3 the class names and counts
  in their colours spaced under their segments when the bar is wide enough, else as a plain
  `$9 read14 edit7 grep4` run; classes at 0 in `DIM`. No dots.
- **reels** (model), minH 4: title `model` headline the short model id; row 2 the worker's
  state and tool (`tool · Bash · 4s`, `thinking 12s`); row 3 a **tape**: the last events
  as a right-to-left ticker of class-coloured short names (`$ read edit edit $ …`), one cell
  per event plus a space, advancing one cell every 4 frames while live. No reels.
- **patchbay**, minH 5: keep the cords but on quads only and thinner (one quad wide); the
  endpoint labels stay text. Not in the default order; polish if it is cheap.
- **clock** (elapsed), minH 4: title `elapsed` headline `21:00` in phosphor text; row 2 a
  minute ribbon, one dim quad per minute with the current minute blinking; row 3 dim
  `turn 18 · 4s` (the current turn and how long it has run) or `handoff 21m40s` as now.
- **lamps** (checks), minH 4: unchanged content, the new frame.
- **toggles** (switches), minH 4: unchanged content, the new frame.
- **river** (time), minH 4: title `time` headline the total; row 2 the proportion bar with
  segment fills at `mix(screen, colour, 0.35)` and the segment's label in the full colour on
  top of it (label when ≥ 6 cells, one letter when ≥ 2, nothing under); row 3 a legend
  `think 17% · tools 12% · model 71%` in the colours. No saturated blocks.

### 23.3 The grid (hooks/grid.ts)

Unchanged packing. The gutter stays one cell. Because every module's frame is slate on the
screen colour, two modules stacked no longer need the plate's light/dark edges to part them;
`ROW_GAP` stays 0.

### 23.4 office-hd (hooks/scenes/office-hd.ts)

- The rack and stack screens use the monitor material (`MON`/`BEVEL`), half-cell frames like
  the two monitors; `BEZEL`, `LIGHT`, `DARK` go.
- The elapsed badge at the top right is right-aligned with one column of margin at every
  width (it is clipped at 100 columns today).
- A stack screen whose class count is 0 shows the label dim on a `SCREEN_OFF` face and no
  `—`; the box stays so the layout does not jump.
- The orchestrator's monitor when `you` is idle: `SCREEN_OFF` with the power lamp dim and
  `you · <model>` dim on the first row when the model is known (never a plain black box).
- The rack's amber load bar becomes the memory gauge: a slate track with a phosphor fill
  (amber only past 80 %).
- At the large size the stacks start three rows under the column headers and the headers sit
  two rows above the first screen, so the room's upper third is not empty; the window grows
  to four rows.

### 23.5 office (hooks/scenes/office.ts)

- The orchestrator's desk is laid out from the right edge inward and always ends one column
  before the edge; `you · opus 5` on the caption row is right-aligned and cut, never clipped.
  Below the width where the second desk fits with a one-column margin to the rack, it is not
  drawn (the breakpoint moves from 70 to whatever that is).
- The pillar boxes get the half-cell slate frame; a box with a count of 0 is off (`SCREEN_OFF`
  face, dim label, no icon). The icons stay.
- The moon is a disc of two tones with one crater, not a blob.

### 23.6 Checks

`scripts/check.sh` green; `node scripts/render-scenes.ts` rerun so `docs/images` matches;
the wall still packs the default order at 80, 100 and 144 columns without a module exceeding
its box; no module draws a braille glyph except a trace (`tests/modules.test.ts` keeps the
"quads only" rule for meters and bars).

## 24. Achievements

A small set of run milestones, kept per user in `$.store` (the plugin's own JSON store, shared by
every session and project) under `achievements`: `{ v: 1, earned: { <id>: { run, t } } }`, where
`run` is the run's key (`<path>:<started>:<duration_ms>`) and `t` when it was earned.

| id | title | earned when the run has its result row and |
|---|---|---|
| `first-light` | first light | always (the first finished run) |
| `green` | green | its last test run has `total > 0`, `failed = 0`, and `errors = 0` |
| `marathon` | marathon | `duration_ms > 3 600 000` |
| `centurion` | centurion | its `tool_counts` sum to 100 or more |
| `night-shift` | night shift | it finished (`last_ts`, else `started + duration`) between 00:00 and 05:00 local |
| `clean-hands` | clean hands | `denials = 0` and 20 or more tool calls |
| `frugal` | frugal | `cost.usd < 0.10` at the compare price, at least one turn (no `cost`, no award) |
| `handoff` | handoff | `handoff` is set (the summariser read a handoff file) |

- `hooks/achievements.ts`, pure: the catalogue (id, title, one-line description),
  `newAchievements(prev, s, t)` (the ids `s` earns that are not in `prev`, in catalogue order;
  nothing before the result row), `runKey`, `readEarned` (a defensive read of the stored value)
  and `earnedBy(earned, run)`.
- The poll of the live source, when a new summary with a result arrives: read the store, compute
  the new ids, write the store, then toast each once (`🏆 green: tests passing, no errors`) when
  `notify` is `toasts` or `both`. The earned map is mirrored into the `achievements` atom (tagged
  `achievements-1`) so the pane draws it. A store that cannot be read or written means no
  achievements (nothing announced that could not be kept). Unlike the run notifications, the first
  poll of a source may award: each achievement is raised once per user, so it cannot storm.
- Never for the demo source or during replay: those polls never reach it, and the Result block
  hides the lines there.
- The Result block lists `🏆 <title> · <description>` for each achievement whose `run` is the run
  on screen.
- Tests: `tests/achievements.test.ts` (each rule, its edges, dedup, the stored-value read);
  `tests/pane.test.tsx` (toasted once and stored, earlier earnings not raised again, `notify`
  off keeps quiet but stores, demo and replay never earn, no store means none).

## 25. The scene guide and sprites

- **`hooks/sprite.ts`**, pure: a sprite is a text picture, one character per pixel, rows on
  separate lines, `.` or space transparent, with a palette `Record<char, RGB>`.
  `sprite(text, palette)` parses it once (leading and trailing blank lines dropped, the common
  indent removed, short rows padded transparent; an unknown character throws, naming it and
  where) to `{ w, h, at(x, y) }` (`at` is null where transparent or outside). `blit(c, sp, x, y,
  opts?)` draws onto a `Canvas` (pixels: 1 × 2 per cell) and `blitHi` onto a `HiCanvas`
  (sub-pixels: 2 × 4 per cell), top-left at (x, y), visiting only the part that lands on the
  canvas. Options: `flipX`; `tint` + `tintBy` (mix toward a colour, default 0.5); `scale`
  (brightness, after the tint). `frameOf(frames, frame, every)` picks an animation frame. No
  existing scene is rewritten to use it; new scenes and the cat may.
- **`docs/CONTRIBUTING.md`**, under 250 lines: the scene contract (`Scene`, `SceneCtx`, sizes,
  `transparent`, `orchestrator`, `you`), the activity states and pulses, the two canvases and
  when to use each, the sprite helper with an example, the demo-mode requirement, registering a
  scene (`SCENES` and the `scene` setting's options), the per-scene test in the pattern of
  `tests/network.test.ts`, previews with `scripts/render-scenes.ts`, and the design rules:
  monospace text for every number, thin frames, graphics beside text not instead of it, nothing
  clipped at any width or size. The README's Contributing section links it.
- Tests: `tests/sprite.test.ts` (parse, transparency, padding, the unknown-character error, blit
  and blitHi, flip, tint and scale, clipping at every edge, frameOf).

## 26. Ambient layout

`ambient` is a fourth `PaneLayout`: the scene alone, for a second monitor or a pane glanced at.

- Entry: `/lookout ambient` toggles it (into ambient from the current layout, which the
  `beforeAmbient` atom keeps, and back to that layout); `l` cycles classic → panel → wall →
  ambient → classic; the `layout` setting's options gain `ambient`.
- Drawing (terminal only; elsewhere it draws as classic, like panel and wall): the room is the
  pane's `scroll.bodyRows` less the hotkey row (and the two replay rows while replaying), at
  least the scene's `rows.large`. A scene whose `rows.large > rows.standard` lays itself out by
  height and is drawn at the whole room; a fixed-height scene (office, network, factory today) is
  drawn at `rows.large`, centred in the room on the terminal's background (a `marginTop` above,
  a blank Box below, so the hotkey row stays at the bottom). The tick blits at the mounted height
  as usual.
- Shown: the scene, whose own last row is the one-line caption, then the hotkey row (`v`, `s`,
  `l`, `n`; `l` reads `layout classic`) and the replay row and hotkeys while replaying. Not
  shown: the orchestrator strip, the stats rows, the module grids, the Result block and every
  text block.
- The scene size is always `large` (or taller): a size pick and the `sceneSize` setting apply to
  the other layouts.
- Tests (`tests/pane.test.tsx`): the command draws aurora at the body's rows less one with no
  stats or blocks, the tick blits that height, the command again returns to the layout it left;
  network draws at its large size with the centring pads; the setting starts in ambient on the
  terminal and draws classic on the desktop; `l` cycles through ambient.


## 27. Palettes

`hooks/palette.ts` holds three palettes as one role map each (`Palette`: text inks, room
materials, screen and instrument tones, meaning colours, the tool-class colours and the four
ramps): `night` (the look everything was drawn with), `paper` (light terminals: light walls and
floors, dark ink, meaning colours darkened for contrast; monitors, screens and the phosphor stay
dark, as real screens do in daylight) and `phosphor` (one-colour green CRT; `bad` stays red so a
failure is never missed). The `palette` setting picks one (default `night`); `/lookout
night|paper|phosphor` switches it live and the pick lives in a declared `palette` atom. The pane
passes `palette` in `SceneCtx` and `ModuleCtx`; `paletteOf(ctx)` gives `night` when absent, so
older callers and tests keep working.

Rules: no scene or module paints a literal colour any more; every tone is a role or derived from
one with `mix` / `scale` inside the scene. A scene that needs a shade the map lacks derives it
(`deskTop` from `desk`, a shadow from `wall`); a new role is added to all three palettes at once.
`hooks/canvas.ts` keeps its exported constants (`INK`, `GOOD`, …) as the `night` values for the
charts of the text blocks, which follow the terminal theme through `Text` colours anyway.
Scenes memoise their derived tones per palette id (a module-level `Map<PaletteId, Tones>`), so
a frame costs no more than before. `tests/palette.test.ts`: the three maps have the same keys,
every scene and module draws in each palette without throwing, and in `paper` the wall is
lighter than the ink (luminance) while the screen stays darker than the phosphor.
`scripts/render-scenes.ts` adds `office-paper.svg` and `office-phosphor.svg` (running, 80
columns) for the README.

## 28. Seasons and the cat (office and office-hd)

- **Seasons.** The office window follows the date (`season` setting: `auto` from the local
  month, or a fixed season, or `none`; `/lookout season <…>` picks one live, kept in a declared
  `season` atom; the pane passes it as `SceneCtx.season`). Pure function of `t`: `seasonOf(t, setting)` in
  `hooks/seasons.ts` (shared by both offices, tested). Winter: a few falling snow pixels in the
  window and a white sill; spring: a lighter sky with two drifting cloud pixels; summer: a warm
  sky with a sun disc by day; autumn: two falling leaf pixels in amber. Holidays, same function:
  a pumpkin on the worker's desk on 31 October, a small string of three lights over the window
  from 20 December to 1 January, a firework burst in the window at midnight on 1 January. Each
  is a dozen lines at most and sits in the window or on the desk, never over a readout.
- **The cat.** A sprite built with `hooks/sprite.ts` (the first use of it), two frames: curled
  asleep and sitting. It sleeps on the floor beside the worker's desk while the worker waits or
  thinks, sits up and faces the rack during tool calls, and sits on the desk's far end when the
  run is done. Tail flicks every few seconds when awake. In office-hd it is beside the rack. Never
  under a readout, never past the pane's edge; absent below the width where it would overlap.
  Palette roles only (`inkDim` body, `ink` eyes in `night`; the same roles in the others).

## 29. The `controlroom` scene (6.7)

The office's big sibling for the large size: rows `{ compact: 10, standard: 16, large: 24 }`,
`minColumns` 60. The back wall is a wall of small live instruments: the scene packs a fixed
list of modules (`counter:turns`, `counter:tools`, `dial:ctx`, `vu:decode`, `scope:pace`,
`lamps`, `river`, `clock`) with `packModules`/`drawGrid` into the upper two thirds at the
panel's own gutters, drawn through `clipped`; the operator (the `you` figure when `you` is
known, else the worker) sits at a desk below, facing a long console screen that shows the last
three timeline lines (`s.timeline`, newest at the bottom, the tool names in their class colours);
the cat from 28 lies on the console's end. At `compact` only the console and two modules are
shown. A state lamp strip along the top edge follows the activity (phosphor pulse while live,
amber for stalled, red for failed, steady green for done). Everything from `hooks/panel.ts`
(slate frames) and the palette; registered in `SCENES` after terrarium and in the `scene`
setting; demo mode works like every scene; `tests/controlroom.test.ts` follows
`tests/network.test.ts`.

## 30. Performance pass

Measured, not guessed: a `scripts/bench.ts` that times, for each scene at each size and 80 /
144 columns and for the module grid at 80 / 144 columns, 200 frames of `draw` plus encode, and
prints a table (ms per frame, p50 and p95); plus the summariser on the largest fixture log with
and without the cache. Targets: every scene under 2 ms per frame at 144 columns large, the grid
under 1 ms, `HiCanvas.encode` under 0.3 ms at 144 × 30, the pane's tick doing no work when
nothing changed (same frame output as the last blit is skipped by comparing a cheap hash of the
cells, both for the scene and for each module grid). Known hot spots to check first: `clipped`'s
Proxy per module per frame (replace with a bounds-checking view object), `HiCanvas.encode`'s
glyph fitting (cache per mask), `demoSummary` rebuilding its summary each call, scenes that
allocate per frame (`new Canvas` is fine; per-pixel closures are not), the register tick doing a
full `JSON.stringify` of anything, and the summariser's cache key (`realpath` + stat each poll
is fine; re-parsing the log is not). Report before/after numbers in the commit message. No
behaviour change: the test suite is the regression gate, plus a golden-frame test for two scenes
(the encoded cells for the running fixture at frame 12 must match before and after).

**Results** (Node 24, `node scripts/bench.ts`, p50 ms per frame, before → after). Every target was
met before the pass except the encoder; the hot spots that mattered were the encoder and
`clipped`. Scenes at 144 columns large: controlroom 0.58 → 0.22, observatory 0.63 → 0.57,
office-hd 0.14 → 0.09, aurora 0.21 → 0.19, terrarium 0.22 → 0.18 (office, network and factory
under 0.04 either way). Module grid: 0.48 → 0.15 at 80 columns, 0.51 → 0.16 at 144.
`HiCanvas.encode` at 144 × 30 on random noise (eight colours in every cell, the worst case):
0.37 → 0.28; on real scene canvases about twice as fast. `demoSummary`: 0.005 (once a poll; left
alone). The summariser on the largest fixture: about 59 ms without the cache and 54 with it,
nearly all interpreter start-up; the cache hits on an unchanged log, and a log that grew is parsed
again in full (not changed here). What changed: the encoder (one-colour cells take a fast path,
NONE cells skip the pair search, channels unpacked once per pair, no rounding calls), `clipped`
(a HiCanvas subclass sharing the canvas's buffers instead of a Proxy that made a closure per
`set`), and the tick (a full FNV-1a hash of each key's cells; an unchanged frame is not blitted,
and every pane draw forgets the hashes). `tests/golden.test.ts` holds 41 hashes captured before
the pass (office-hd, office, controlroom, aurora and the grid, frames 12 and 13); `docs/images`
re-render byte for byte.

## 31. One home per fact

The wall layout said every reading three or four times (the current tool in the strip, the scene's
caption, the worker's monitor and the reels module; tool counts in four places; the elapsed time in
four places with two different values, because the strip counted from the hand-off and the rest
from the run's start). The rule from here on: **each fact is spelled out in one place in the pane,
and the scene is the place of last resort.**

- `hooks/facts.ts` names the facts (`Fact`) and what each module claims (`MODULE_FACTS`). The pane
  computes the claimed set from what it actually draws and passes it as `SceneCtx.shown` and
  `ModuleCtx.shown`; `claimed(shown, f)` is the test. Undefined claims nothing (tests, ambient).
- **Who claims what.** Panel and wall: the facts of the visible modules (after `moduleShown`), plus
  `timeline` (the Timeline block is drawn below). Classic in dashboard view: the text blocks' facts
  (`turns tools errors cost output elapsed time pace ctx decode prefill memory checks git timeline`;
  only the ones whose block has data). Classic in scene view: the facts of the blocks it still
  draws (`timeline`, and `checks` / `git` when those blocks show). Ambient: nothing; the scene
  speaks. Derive the set from what the draw actually renders, never from the layout name alone.
- **The activity line** (`Bash · npm test -- todo · 4s`) is never claimed: its home is the scene's
  caption on the terminal (the status row off it). Nothing else prints the current tool and its
  seconds: not a monitor in a scene, not a module (reels loses its state line and keeps the tape).
- **Scenes drop text, keep pictures.** For a claimed fact a scene removes its label or readout and
  keeps the drawing: stations still light with their class colour, the rack still blinks, the
  context bar still fills; only the count, the `tok/s`, the `ctx 54.2k/131.1k` go. A monitor that
  loses its readings shows *work* instead (see 33.2: the last diff, the last command's output),
  which no module shows. Lines of a diff or of command output on a scene's screen are texture
  (dim, cut to the screen), not readings, and may echo the Last edit / Last command blocks.
- **Pane rows.** In panel and wall the orchestrator strip text row is not drawn when the `strip`
  module is visible; the stats row under the scene drops every item a visible module claims (and
  is not drawn when nothing is left).
- **Between modules.** The default order drops `counter:tools` (`ledmatrix` shows the same counts
  by class); `counter:turns` keeps its bars and `avg`, and drops `last` when `scope:pace` is
  visible; `river`'s headline is the largest share (`model 71%`), not the elapsed (`clock` owns
  it); the `strip`'s headline is the hand-off's clock time (`since 14:02`), never a duration, so
  it can't be mistaken for the elapsed.
- Tests: for each layout, no visible text (module headlines and sub-rows, the scene's labels, the
  pane rows) prints the same reading twice. Check it with a test that draws the wall at 100 and
  144 columns on the running fixture and asserts the current tool label, the tool counts, the
  elapsed and the ctx percentage each appear once in the decoded text.

## 32. Run memory

Every scene used to be a function of *now*: a run that failed its tests for ten minutes and then
went green looked, a minute later, like any other run. `hooks/memory.ts` derives what a scene
remembers, as a pure function of the summary's histories and the clock (`memoryOf(s, t)`): turns
and mugs, edits and the paper stack, distinct files, the last 12 test runs as a tally, failing now
and at the worst, the newest red → green **flip** (and `celebrating` for 45 s after it), tsc
errors, commits, errors plus denials as crumpled paper, the context fraction and the elapsed.
Nothing is stored between frames, so replay and the golden frames stay honest.

A shared visual vocabulary, so the scenes agree (each scene draws these at its own resolution;
colours are palette roles: paper is the hand-off sheet's white, red is BAD, green is GOOD, the star
is WARN's amber):

| memory | object | where |
|---|---|---|
| `mugs` | coffee mugs, one per 10 turns (max 5) | the worker's desk |
| `pages` | a paper stack, one sheet per level (max 6) | the worker's desk, beside the monitor |
| `crumples` | paper balls in a bin, overflowing at 9 | the floor by the worker's chair |
| `failing` | red sticky notes on the worker's monitor bezel, one per failing test (max 4) | worker's monitor |
| `runs` | a tally: one mark per test run, green pass / red fail, oldest left | a board on the wall |
| `flip` | a gold star on the board, kept for the rest of the run | the board |
| `celebrating` | the worker raises both arms (two frames), the sticky notes fall away | worker |
| `commits` | small parcels on a shelf or out-tray, one per commit (max 6) | near the rack / your desk |
| `done` | a printed slip that travels back from the worker's desk to yours along the hand-off sheet's path, then rests on your desk with a green (success) or red stamp | both desks |

Each object appears only once it has something to show (no empty bin, no blank board). The demo
loop gains a red → green flip before its success ending (tests fail at 47 s, pass at 60 s), so
every scene shows the celebration in the demo and in the renders.

## 33. The two offices agree

### 33.1 office (hooks/scenes/office.ts)

- **You on the left, the worker on the right**, as in office-hd and in the strip's reading order
  (`you → worker`). The worker's desk is the one next to the stations and the rack; the hand-off
  sheet slides left to right. Shirt colours stay: you purple, the worker blue.
- The `ctx …` reading sits under the **worker's** label (it is the worker's context), not under
  `you · <model>`; dropped when `ctx` is claimed.
- The pale shape beside the window read as a moon indoors. It becomes a **wall clock**: a round
  face with two hands showing the local time (hour and minute from `t`), in every palette.
- Station counts and the rack's `tok/s` follow 31.
- Run memory (32): mugs, the paper stack, the bin, sticky notes on the worker's monitor, the
  celebration, the slip at `done`; parcels for commits on the rack's top. The test tally board
  goes on the back wall where there is room (large, and standard at 100 columns and over).
- Real sizes instead of `fitRows` padding: `compact` 10 rows (the desks and the rack, no wall
  objects), `standard` 15 (today's), `large` 22 (a taller back wall with the tally board, the
  clock and the window side by side).

### 33.2 office-hd (hooks/scenes/office-hd.ts)

- The cat sits **on** the floor line, not half through it.
- The empty top right (a lone elapsed badge in a large dark wall) becomes the **board**: the test
  tally, the star after a flip, the commit parcels on a shelf under it. The elapsed badge is
  dropped when `elapsed` is claimed, else it sits in the board's corner.
- The worker's monitor no longer prints the status (that is the caption's). It shows the **work**:
  the last diff's lines (`+` in GOOD, `-` in BAD, cut to the screen) while the worker edits, or
  the last command's output tail while it runs commands; with neither, the context bar and the
  checks line as today. Text on a screen never runs two readings together (`✖ 1 failing tsc✓`):
  each reading keeps a space before the next, and the lower-priority one is dropped when it
  doesn't fit.
- Your monitor, idle, shows the hand-off's first line dimmed instead of dark stripes.
- The centre panels (`$ 9 / npm test …`) keep the last label per class, and drop the counts when
  `tools` is claimed.
- Run memory (32) as in office.

## 34. controlroom v2

The controlroom was the panel layout with a person in front: in the wall layout it repeated every
module around it, its right half under the pace scope was empty, and its desk ran into the dark.

- **The wall shows what nothing else shows.** `WALL_MODULES` minus the modules whose facts are
  claimed (31); the freed slots hold the scene's own memory screens, drawn with `hooks/panel.ts`
  `plate` so they match: **tests** (the tally from 32 as large lamps with the pass count, the star
  after a flip), **commits** (the newest commit subjects, newest at the bottom, a parcel mark per
  commit), **files** (the files edited, most-touched first, with a bar per file's edit count).
  When nothing is claimed (classic scene view, ambient) the instruments come first and the memory
  screens fill what is left.
- **The chart recorder.** The empty right half becomes a floor-standing pen recorder: a cabinet
  with a paper strip feeding out of its top, the pen drawing context per turn (`ctx_series`) as a
  trace, the paper advancing one step per turn and piling in folds on the floor (the pile grows
  with turns: memory you can see). The pen moves while the model writes, rests otherwise; at
  `done` the strip is torn off and the last length hangs from the cabinet. Red pen marks where a
  test run failed, green where it passed.
- **The console** shows the orchestrator's own activity (the operator is you): your turn, your
  last tool, `waiting for you` / `idle`, from `you`; the worker's newest timeline rows only when
  `you` is unknown and `timeline` is not claimed.
- **The desk** ends at the recorder (a side table holding the cat), so nothing runs into the dark.
- The lamp strip celebrates the flip (a green sweep along the strip for `celebrating`).
- compact: the console, the tests screen and the recorder's top, no wall row.

## 35. factory and terrarium retired

Fewer, stronger scenes: factory's machines never read as anything, and terrarium's tank stayed
empty for most of a run. Both are removed (code, tests, renders, settings and docs). A `scene`
setting or saved pick naming either falls back to `office`. Sections 6.5, 6.5b and 6.6 stay
above as history.

## 36. This session

Most people who install lookout do not run a headless worker. For them the pane follows the
session it sits in: the session's own transcript (`~/.claude/projects/<project>/<session id>.jsonl`)
is a stream of the same user and assistant messages a `claude -p` log carries, and the summariser
reads it the same way (the model from the assistant messages; subagent side chains left out).

- **When.** The default source, in order: `LOOKOUT_LOG`, the `log` setting, the first named
  source, `./logs/worker-current.jsonl` when that file exists, else this session. `/lookout session`
  picks it by hand (`log: session` and `LOOKOUT_LOG=session` too); any other source leaves it. The
  pane names it `this session`. The source is stored as the sentinel `session`, not a path: `/clear`
  starts a new session id with no `session.start`, so the file is found again on every poll (the
  path the engine names for the current id, else `projects/<cwd slug>/<id>.jsonl`). Until the first
  prompt the file does not exist and the pane says so; it never guesses the newest transcript, which
  in a busy project is another session's.
- **Who is at the desk.** The worker is Claude, so the scenes name the worker's desk `claude`
  (`SceneCtx.worker`, default `worker`) and the pane passes no `you` and no `orchestrator`: the
  offices lay out the one desk, the controlroom's console has no second chair, the strip reads
  `claude · <model> · "<the latest prompt>" · since hh:mm`.
- **Between turns.** A session waits on the person, not the model: after a turn ends the state is
  `waiting` ("your turn"), never `stalled` and never `done` (a session has no result row).
- **Money.** The estimate prices the session at its own model when `prices.json` knows it (what
  this session would cost on the API), else at the `compare` setting; `off` stays off. No model
  server is probed.

## 37. network retired

network drew boxes and lines at a single height, with tool squares that stayed empty for most of a
run: a diagram, not a place. It goes the way of section 35; a setting or pick naming it falls back
to `office`. The lineup is office (the default), office-hd, controlroom, observatory and aurora.

## 38. Calm and detailed: two kinds of pane

The pane said everything at once, in one order, in every layout: the last diff and the last
command's output took the most rows and were worth the least, while the thinking (the one view into
why the worker does what it does) sat below the checks. Layouts now come in two kinds, and `l`
walks them from quiet to dense: **calm → classic → panel → wall → ambient**.

**What is worth what.** Highest: what it is doing now, in words; its thinking; the stats (time,
turns, tests, context, cost). Middle: checks, git, the result, the timeline. Lowest: the last edit's
diff and the last command's output: useful when debugging the worker, noise when watching it.

### 38.1 calm (the new default)

For watching, not debugging. Plain language, no jargon, nothing that scrolls.

1. The scene, standard size.
2. **Now** (the scene's caption on the terminal, see below): coloured by state: "Claude is running the tests." "The worker is reading
   todo.ts." "Your turn: Claude has finished and is waiting for you." "Nothing has happened for
   4 minutes; the worker may be stuck waiting on the model."
3. **The task**, one line: `You asked: "…"` for this session, `Working on: "…"` for a worker.
4. **Thinking**: the latest thinking, given the most room (up to 12 lines), titled with its age
   (`thinking · 20s ago`). With no thinking text (some models send none), the latest reply instead,
   titled `latest reply`.
5. **So far**: up to three short plain facts, most useful first ("12 minutes, 18 turns", "changed
   3 files", "tests: 10 of 11 passing", "context window 41% full", "about $0.47 at API prices").
6. **Worth a look**: only when something is: failing tests, type errors, blocked actions, failed
   tool calls, a context window nearly full, a stall. Worst first, at most three.
7. When the run ends, **the outcome** in one sentence replaces Now ("Finished in 21 minutes: all
   11 tests pass, 2 commits."), and the Result block's compare table and Runs list stay out.

No strip, no stats row, no checks, git, timeline, last edit or last command. Off the terminal calm
draws the same, without the scene.

**One home for Now.** On the terminal the scene's caption is the Now line: in calm the pane hands
the scene the activity with its text replaced by the story's `caption`, the short plain form
("running the tests", "thinking", "your turn", "quiet for 4 minutes"), and the scene adds its
spinner and seconds as always. No separate Now row is drawn there. Off the terminal (no scene) the
full `now` sentence is the first row.

The words come from one pure function, `storyOf(s, a, m, t, who)` in `hooks/narrate.ts`, returning
`{ now, caption, task, soFar, heads, outcome }`; `who` is `Claude` for this session and `The worker` for a
worker (sentences that start mid-line take its lower-case form). Tool calls are said as what they
do, not what they are called: Read "reading todo.ts", Edit "editing todo.ts", Grep "searching the
code for …", a test runner "running the tests", `tsc` "checking the types", `git commit` "saving its
work as a commit", an install "installing packages", Agent "handing part of the job to a helper",
TodoWrite "updating its to-do list", an MCP tool "using <server>". Unknown commands and tools fall
back to "running a command (<first word>)" and "using <tool>". The status caption under the scene
keeps the terse form in the detailed layouts.

### 38.2 classic, panel and wall (detailed)

Everything stays, in the order of what it is worth: the header and stats (or the modules), the
status, **Thinking** (moved up, up to 8 lines), then Checks, Git, the Result, the Timeline, and last
the Last edit and Last command.

- **Details (`d`).** The last edit and the last command are one line each by default: `Last edit
  14:02 · todo.ts · +12 −3` and `Last command 14:03 · npm test · exit 1`. `d` expands them to the
  diff and the output tail as before, and lets the timeline run long; `d` again folds them. The pick
  is kept in an atom, so a reload keeps it. Folded, the timeline shows its newest 6 rows.
- The `view` setting and `v` are retired: scene view was a quieter classic, and calm replaces it.
  A `view: scene` setting or saved pick reads as calm.

### 38.3 Off the terminal

calm and classic draw as themselves (without the scene); panel, wall and ambient draw as classic,
as before.

## 39. The showcase: a tall room is the dashboard

In ambient on a tall pane the scene gets every row, and the offices used them by stretching the
back wall: on a 100 × 50 pane office-hd drew two thirds empty wall above the stations. That pane is
the showcase, the view someone puts on a second monitor, so the extra height carries the run.

**When.** A scene drawn with more rows than its `large` layout (ambient is the one layout that does
this) keeps its large room at the bottom, desks, stations, rack and floor at their large geometry,
and fills the wall above with **wall screens**, in the order of what they are worth, each only when
it fits whole:

1. **The thinking screen**: one wide monitor across the wall between the window and the board (or
   full width under them), the latest thinking wrapped and showing its newest lines, titled with its
   age (`thinking · 20s ago`); with no thinking text, the latest reply (`latest reply · …`). It is
   the elastic band: rows left over after the bands below go to it, up to 16 lines.
2. **The instrument row**: modules (hooks/modules) mounted on the wall in slate frames, the readings
   the room does not already draw: turns, context, pace, where the time went, cost or output, and
   the clock where the board does not carry elapsed. The room's own art claims tools (the stations),
   decode (the rack), checks (the board) and the commits (the shelf), so no module repeats them.
   Each module needs its `hasData`; the row fits as many as its width takes, and keeps its slots
   for the whole run, so nothing moves.
3. **The departures board**: the recent tool calls as rows (`14:02 ✓ npm test 1m40s`), newest at
   the top, as many as fit in 4–10 rows.
4. Very tall panes only: a **details screen** with the last command's output tail beside the
   board. The worker's own monitor keeps the last diff.

The ceiling tray, cables and window move with the room; the window and the board stay at the top
corners. Whatever height is left goes to the thinking screen, so no wall is ever empty.

**Which scenes.** office-hd (above) and controlroom (its instrument wall gains the thinking screen
across the top and the departures board beside the recorder). office (half blocks) and the skies
keep drawing tall as they do: more sky is the point of a sky.

**Words.** Ambient's caption is the plain one calm uses (`story.caption`, section 38): the showcase
speaks to whoever walks past. Ambient claims nothing, so the scene spells out every reading once.

## 40. Thinking, made readable

The thinking is the most valuable text in the pane and the hardest to read: half-sentences,
markdown, code, paths and line numbers, in the model's private shorthand. Two layers turn it into
something a passer-by can follow.

### 40.1 The gist and the highlighter (always, local)

`hooks/thought.ts`, pure, no model:

- **Clean**: drop markdown marks (`#`, `*`, `>`, list bullets), fenced code (a block becomes
  `(code)`), line-number prefixes and long paths (to their basename); collapse whitespace; strip
  control characters.
- **Gist**: split into sentences and keep the newest that fit the room, with sentences of intent
  or finding ("I'll", "let me", "next", "the problem is", "because", "so") kept ahead of filler;
  the order on screen stays the order written.
- **Highlight**: the text becomes runs with a role: `problem` (fails, error, broken, missing,
  wrong, can't, doesn't), `good` (passes, works, fixed, done), `intent` (I'll, let me, next,
  instead, going to), `unsure` (maybe, might, not sure, a question), `name` (file names, `code`,
  identifiers), else `plain`. The pane colours them from the theme (problem error, good success,
  intent bold, unsure warning, name suggestion); the scenes from the palette. Colour marks a word,
  never a whole line, and at most a handful per line, so it reads as emphasis, not noise.

### 40.2 In plain words (a small model, opt-in by source)

When the thinking text changes, the pane may ask a small model (`haiku`, through `$.model.complete`,
the session's own API client) to say it again in one to three short sentences for someone who does
not program: what it is trying to do, what it found, what it will do next; no code, no jargon. The
reply marks words `[!problem]`, `[+good]` and `[?unsure]`, which the highlighter colours; anything
else in brackets is dropped.

- **Setting `explain`**: `off` (the default) never asks: out of the box nothing leaves the machine
  and the gist is the thinking's one form. `session` asks only for this session, whose thinking
  already came from the API; `all` asks for workers too (a local model's thinking then leaves the
  machine). Only the person turns it on.
- **Cost and pace**: one request in flight, at most one per 15 s, only while a thinking block or
  screen is on show, the thinking's tail cut to 4,000 characters, the answer cached by the text's
  hash for the session; never in replay; the demo carries its own canned plain words, so it makes no
  request.
- **On screen**: calm shows the plain words as its thinking block (`in plain words · 20s ago`) and
  falls back to the gist; the detailed layouts show the plain words over the highlighted gist; the
  showcase's thinking screen the same. While a new answer is on its way the old one stays, dimmed.
- **Honesty**: it is labelled `in plain words`, never presented as the model's own text, and a
  failed request leaves the gist alone without saying anything.

## 41. Glyphs for words

Where a glyph says what a word says, the glyph takes the word's room and gives it to the content
(a file name on the departures board, a command on a station). One vocabulary, `hooks/glyphs.ts`,
is the only place a glyph is chosen; the pane, the modules and the scenes all draw from it.

**Rules.**

1. A glyph replaces a word only where it is universal (`✓` `✖` `↻` `%` `$` before a command, `≈`
   before money) or where the same glyph stands **beside its word somewhere on screen**, its legend:
   the stations read `◇ read 8`, `✎ edit 7`, so the board's class column can be `◇` and `✎` alone. This
   keeps the rule that graphics go beside text, never instead of it: the legend is the text.
2. Only glyphs one cell wide in the common monospace fonts (SF Mono, Menlo, JetBrains Mono, Fira
   Code, Cascadia, DejaVu): geometric shapes, arrows, dingbats with text presentation. No emoji and
   nothing with an emoji presentation (no `⏱` `⚡` `⚠` `⏸`): those draw two cells wide or in colour,
   and break the grid. `glyphs.test.ts` holds the list to that.
3. calm's sentences and the plain words stay words (sections 38, 40): they are for someone who
   does not know the glyphs.
4. Narrow first: where a row has room for the word, a label may keep it; the glyph form is what a
   row falls back to before it cuts content.

**The vocabulary.**

| meaning | glyph | legend shown at |
|---|---|---|
| shell, read, edit, search, web, agent, other | `$` `◇` `✎` `⌕` `◎` `◈` `·` | the stations; module titles |
| done ok, failed, denied, running | `✓` `✖` `⊘` spinner | universal (denied beside "blocked" in Worth a look) |
| turns | `↻` | the turns module title |
| elapsed, time of day | `◷` | the board's corner, the clock module |
| context | `◔` (filled by share: `○ ◔ ◑ ◕ ●`) | the context module title |
| tests, type check | `✓ 12/12`, `✖ 2`, `tsc ✓` | the board |
| commits, branch | `◆`, `⎇` | the git block, the shelf |
| files changed | `✎ 3` | the files screen title |
| thinking, a reply, an earlier thought | `…`, `»`, `·` | the thinking screen's titles |
| stalled, waiting on you | `‖`, `○` | the status row |

## 42. Ambience: the lofi layer

The pane is something people sit beside while text streams in. The "lofi beats to study to" loops
show what makes that pleasant: a still, calm room where a few small things keep moving on slow
loops (rain on the glass, steam off a mug, a cat breathing, a light across the street going off).
Nothing there asks for attention, yet the picture never looks frozen. lookout adds that layer to
every scene as **ambience**: motion that means nothing and is built so it can never be mistaken for
motion that does.

### 42.1 The rules (each a test where it can be one)

Section 25's "motion means something" still governs everything that reports the run. Ambience is a
separate, purely decorative layer, held to these rules so the two never blur:

1. **Never over text.** Ambience only touches art cells. A cell that carries a letter, digit, glyph
   or caption in the frame without ambience is the same cell with it (test: ambience on and off at
   the same frame differ only in cells whose off-frame character is not text).
2. **Never in a meaning colour.** No red, green, amber-warning or thinking tone, so a drip is never
   read as an error or a glow as a test passing. Ambience draws in its own muted tones (warm
   lamplight, glass, steam, night city), derived per palette (paper: soft shadows; phosphor:
   dim greens only) (test: the fg/bg of cells that ambience changes are never the palette's `bad`,
   `good`, `warn` or `think`).
3. **Slow and small.** Loops are 2 to 60 seconds long; nothing blinks faster than twice a second; a
   breathing light changes brightness by 15 % at most; a moving speck is one sub-pixel. Loops of
   different lengths overlap so the whole picture does not repeat for minutes.
4. **No new signals.** No shooting stars (the aurora's shooting star reports a test run), no red
   lights, no flashing, nothing that starts or stops with the run's state. Ambience runs the same in
   every state: thinking, tool calls, your turn, done. Where a scene's meaningful motion and an
   ambient one share a spot (the aurora's curtain), the ambient one is the slower and dimmer.
5. **Pure.** A function of `frame` and `t` only, deterministic, no module state, so the goldens and
   the animated SVGs stay reproducible. Per-frame work stays small (section 3's rule).
6. **Off switch.** The `ambience` setting, `on` (default) or `off`. Off draws exactly what the scene
   drew before this section. `SceneCtx.ambience?: boolean` (undefined = on).

**Frame rate.** A finished run's scene ticked once a second (`IDLE_EVERY = 8`), which makes loops
stutter. With ambience on it ticks every second frame (about four a second); with ambience off it
keeps the old rate. The blit still skips frames whose cells did not change.

### 42.2 The pieces

`hooks/ambience.ts` holds the shared parts: `ambient(ctx)`, `breathe(frame, periodSecs, phase)`
(0..1, a smooth sine at the 120 ms tick), `ambientTones(p)` (memoised per palette) and the window
pieces both offices use.

- **The window at night**: a low **skyline** across the bottom of the glass, a shade darker than the
  sky, with a few windows lit warm; one at a time switches off or on every 20 to 40 seconds. A small
  **plane light** (white, blinking once every two seconds) crosses the top of the sky about every 90
  seconds. By day and in light palettes the skyline is a pale silhouette with no lights.
- **Rain on the glass**: in spring and autumn, a few drops run slowly down the glass, a sub-pixel
  at a time, leaving a short fading trail, and start again at the top. Winter keeps its snow; summer nights get two or three
  dim **fireflies** drifting low instead.
- **Steam**: the newest mug on a desk sends up a slow curl (braille texture, section 3's exception),
  bending with a sine; it fades and starts again every few seconds. office already has steam;
  office-hd gains it.
- **Lamplight**: a warm pool on the desk under the monitor, a little brighter toward the monitor,
  breathing over about eight seconds.
- **String lights**: a strand along the ceiling tray (office-hd) or the top of the wall (office),
  warm bulbs breathing out of phase with each other. Not during the `lights` holiday, which hangs
  its own on the window.
- **The cat**: asleep, its back rises and falls (a tone change on the back pixels, about four
  seconds a breath) and an ear twitches now and then; sitting, it blinks slowly.
- **Dust in the light**: by day, a few motes drift in the light from the window, low contrast.
- **The plant** (office-hd solo): its leaves sway a sub-pixel on a slow cycle.
- **Screens with no text rows** (monitor rows below the text, idle module faces): a faint scan band
  drifts down every few seconds. Never on a row with text.
- **controlroom**: a steaming mug on the console, a slow standby LED in a neutral tone, scan bands
  on idle screens.
- **observatory**: thin clouds drifting across the low sky, slowly enough that a cloud takes a
  minute to cross; the dome's slit glows faintly; grass at the horizon sways.
- **aurora**: chimney smoke curls from the cabin; the curtain keeps a very faint drift while idle,
  far slower and dimmer than its thinking ripple; a cloud bank drifts along the hills.

Each piece appears only where its scene has room for it, and a scene is free to leave one out when
it would crowd the picture. The compact size gets the cat, the steam and the lights at most.

## 43. v1: fewer views, one clear job

Forty-two sections of trying things left more views than one person can keep polished: five scenes,
five layouts, two renderers, a deprecated setting, and a 2,300-line register.tsx where each idea
landed. Before the repository goes public, lookout narrows to what it is for.

**The job.** A sidebar beside your Claude Code session: you work with Claude in the main area,
and the pane shows what is going on, either in that same session or in a worker you handed a task
to, typically a local model (llama.cpp, Ollama, LM Studio, mlx, vLLM) driven by `claude -p`, which
you are evaluating while you work. Everything below serves that.

### 43.1 Three scenes

| scene | for |
|---|---|
| **office** (default) | the sidebar: the room at sidebar widths, readable at a glance |
| **office-hd** | the same room at four times the density, and the showcase on a tall pane (39) |
| **observatory** | a quiet sky for an ambient pane or a second monitor |

controlroom and aurora retire: controlroom's instrument wall repeats the detailed layout's module
grid, and aurora's strip of sky repeats the observatory's mood. `RETIRED` maps `controlroom` to
office-hd and `aurora` to observatory, so a saved pick or setting keeps working. Their code, tests
and images leave the repository (the history keeps them).

### 43.2 Three layouts: calm → detailed → ambient

- **calm** (default), as in 38.1.
- **detailed**: the scene, the module grid under it (panel), then the blocks in the order of 38.2,
  with `d` for the diff and output. When the pane is wide enough for the wall (15), the modules
  flank a large scene instead; the pane picks, the person does not have to. Off the terminal it
  draws as classic did (the stats row instead of modules).
- **ambient**: the scene alone; the showcase on a tall pane.

`classic`, `panel` and `wall` (settings, saved picks, `/lookout <name>`) read as `detailed`. `l`
walks the three.

### 43.3 Settings and code that go

- `view` (deprecated in 38) goes. A saved `view` is ignored.
- The image renderer (`renderer`, hooks/image.ts) goes: it was opt-in, its bitmap text was rejected,
  and it doubled the paths every scene draw goes through. Glyphs are the one renderer.
- register.tsx splits by concern into modules of a few hundred lines each (config, sources and
  polling, the explain policy, the layouts, commands and keys), with register.tsx left as the wiring.
  A pure refactor: the goldens and pane tests must pass unchanged.

### 43.4 A worker in one command

The worker recipe in the README was four lines of environment and flags to get right per server.
`scripts/lookout-worker` (POSIX sh, no dependencies) does it:

```sh
lookout-worker [--server ollama|llama.cpp|lmstudio|mlx-serve|vllm|URL] [--model NAME] "the task"
```

It finds the running server (the adapters' default ports, or `--server`), picks its loaded model
when there is one, writes the task to `logs/worker-current.handoff.md`, and runs `claude -p` against
the server's Anthropic-compatible endpoint with `--output-format stream-json --verbose` into
`logs/worker-current.jsonl`, which the pane already follows. It prints what it is doing and how to
stop. lookout itself still only reads files: the script is something the person runs.
`/lookout worker` prints the exact command for the server it can see, so the person can copy it.

Which servers speak the Anthropic Messages API, on which path, is checked against the servers
installed on the build machine, not assumed; a server that does not is reported plainly with what
to run instead.

### 43.5 No Python

The log reader moves into the mod as TypeScript (`hooks/reader/`): the one install requirement goes,
the Summary becomes one type the compiler checks on both sides, and a poll reads only the bytes
appended since the last one instead of spawning `python3` every 1.5 s. A pure core parses rows into
the Summary; a thin I/O layer reaches files, `git`, memory and the model servers through `$.fs`,
`$.process` and `$.http`. The port is accepted when a parity run over every fixture and its
variants (replay, transcript, server none, compare off and custom, a hand-off) gives the same JSON
from both readers; then summarize.py, adapters.py and the Python checks leave the repository.

Result: 2,088 parity cases (every fixture × twelve flag variants, replay seeks, logs growing a
line and 997 bytes at a time then rewritten and shrunk, git in a scratch repo, the five adapters
against recorded samples, runs.jsonl byte for byte, a log of astral characters, invalid UTF-8, a
BOM and CRLF) and six real transcripts up to 52 MB gave identical JSON. A poll of an unchanged log
costs a stat (0.2 ms on 52 MB, where the Python re-read it in about 300 ms); an appended row costs
its bytes. Kept apart on purpose: with `serverUrl` unset the reader looks for a server on each
adapter's own port (`WORKER_SERVERS`, the one table the worker script's helper shares), so the rack
finds Ollama and LM Studio with no setting; non-finite custom prices give no estimate instead of
invalid JSON; a row with a field of an unexpected type is read as far as it goes instead of failing
the whole parse; a hand-off's BOM is dropped. `$.fs` reads whole files up to 4 MiB, so further
into a larger log the reader reads the tail through `sh` (`tail -c`), and appends through `tee -a`.

