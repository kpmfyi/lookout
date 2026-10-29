// lookout: the performance bench (docs/DESIGN.md 30). Times, per frame (p50 / p95 in ms):
//   - every scene's draw (which encodes) at each size and 80 / 144 columns, 200 frames, with the
//     running fixture and with the demo's scripted run;
//   - the module grid (DEFAULT_ORDER: pack, draw, encode) at 80 / 144 columns;
//   - HiCanvas.encode alone at 144 × 30 on a busy canvas;
//   - demoSummary alone;
//   - the log reader (docs/DESIGN.md 43.5) on the largest fixture log: a fresh Reader each call (the
//     whole log parsed), and one Reader polled again over the unchanged log (a stat), per call.
// Usage (Node 24 runs TypeScript directly), from the repo root:
//   node scripts/bench.ts                 # everything
//   node scripts/bench.ts --frames 50     # fewer frames
//   node scripts/bench.ts --no-reader     # skip the log reader
import './polyfill.ts' // first: Canvas.encode needs Uint8Array.prototype.toBase64

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import type { Activity } from '../hooks/activity.ts'
import { demoSummary } from '../hooks/demo.ts'
import { drawGrid, packModules } from '../hooks/grid.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { DEFAULT_ORDER } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import { PALETTES } from '../hooks/palette.ts'
import { Reader } from '../hooks/reader/index.ts'
import { SCENES, SCENE_SIZES, rowsFor } from '../hooks/scenes/index.ts'
import type { SceneCtx } from '../hooks/scenes/index.ts'
import { RUNNING, T, YOU_THINKING } from '../tests/fixtures.ts'
import { nodeIo } from './node-io.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const FRAMES = argv.includes('--frames') ? Number(argv[argv.indexOf('--frames') + 1]) : 200
const WARM = 20
const READER = !argv.includes('--no-reader')
const COLUMNS = [80, 144] as const

type Row = { what: string; p50: number; p95: number; n: number }
const rows: Row[] = []

function stats(ms: number[]): { p50: number; p95: number } {
  const s = [...ms].sort((a, b) => a - b)
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
  return { p50: at(0.5), p95: at(0.95) }
}

/** Time `fn(i)` for `n` iterations after a warm-up, one sample per call. */
function time(what: string, n: number, fn: (i: number) => unknown): Row {
  let sink = 0
  for (let i = 0; i < WARM; i++) sink += String(fn(i)).length
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint()
    const out = fn(i)
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
    sink += typeof out === 'string' ? out.length : 0
  }
  if (sink < 0) console.log(sink) // keep the results alive
  const row = { what, n, ...stats(ms) }
  rows.push(row)
  return row
}

// The demo's run, one summary and activity per frame, built before the timing (a tick reads the
// summary the poll left; it does not build one).
const DEMO: { s: Summary; a: Activity; t: number }[] = []
for (let i = 0; i < FRAMES + WARM; i++) {
  const e = (i * 0.36) % 72
  const s = demoSummary(e, T)
  DEMO.push({ s, a: activity(s, T), t: T })
}
const RUN_A = activity(RUNNING, T)
const pal = PALETTES.night

for (const sc of SCENES) {
  for (const size of SCENE_SIZES) {
    for (const columns of COLUMNS) {
      const rowsN = rowsFor(sc, size)
      const base = { columns, rows: rowsN, you: YOU_THINKING, transparent: true, palette: pal, orchestrator: 'claude-opus-5-5' }
      time(`scene ${sc.id} ${size} ${columns} running`, FRAMES, i => sc.draw({ ...base, s: RUNNING, a: RUN_A, frame: i, t: T } as SceneCtx))
      time(`scene ${sc.id} ${size} ${columns} demo`, FRAMES, i => {
        const d = DEMO[i % DEMO.length]!
        return sc.draw({ ...base, s: d.s, a: d.a, frame: i, t: d.t } as SceneCtx)
      })
    }
  }
}

for (const columns of COLUMNS) {
  const ui = { view: 'fold', scene: 'observatory', size: 'compact', palette: 'night', source: 'worker' }
  const mctx = (i: number): ModuleCtx => ({ s: RUNNING, a: RUN_A, you: YOU_THINKING, frame: i, t: T, compare: 'claude-sonnet-5-5', ui, palette: pal })
  const packed = packModules(DEFAULT_ORDER, columns, mctx(0))
  time(`grid ${columns} (${packed.rows} rows)`, FRAMES, i => {
    const c = new HiCanvas(columns, packed.rows)
    drawGrid(c, packed, mctx(i))
    return c.encode()
  })
}

{
  const c = new HiCanvas(144, 30)
  c.fill((x, y) => (((x * 2654435761) ^ (y * 40503)) >>> 0) & 0xffffff)
  for (let r = 0; r < 30; r += 3) c.text(2, r, 'a busy canvas with some text over it', 0xffffff)
  time('encode 144x30 busy', FRAMES, () => c.encode())
}

time('demoSummary', FRAMES, i => demoSummary(i * 0.37, T + i))

if (READER) {
  const logs = readdirSync(join(ROOT, 'tests', 'logs')).filter(f => f.endsWith('.jsonl'))
  const largest = logs.map(f => ({ f, n: statSync(join(ROOT, 'tests', 'logs', f)).size })).sort((a, b) => b.n - a.n || a.f.localeCompare(b.f))[0]!.f
  const cache = mkdtempSync(join(tmpdir(), 'lookout-bench-'))
  // Commands (git, memory) are answered without running, so the time is the reader's own.
  const io = nodeIo({ env: { HOME: cache, XDG_CACHE_HOME: cache }, run: () => ({ code: 1, stdout: '' }) })
  const opts = { log: join(ROOT, 'tests', 'logs', largest), server: 'none', noRuns: true }
  const timed = async (reader: () => Reader, n: number): Promise<number[]> => {
    const ms: number[] = []
    for (let i = 0; i < n + WARM; i++) {
      const r = reader()
      const t0 = process.hrtime.bigint()
      const out = await r.summarize(io, opts)
      if (out.error) throw new Error(`the reader failed on ${largest}: ${out.error}`)
      if (i >= WARM) ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
    }
    return ms
  }
  const n = 50
  rows.push({ what: `reader ${largest}, fresh`, n, ...stats(await timed(() => new Reader(), n)) })
  const kept = new Reader()
  rows.push({ what: `reader ${largest}, polled again`, n, ...stats(await timed(() => kept, n)) })
  rmSync(cache, { recursive: true, force: true })
}

const w = Math.max(...rows.map(r => r.what.length))
console.log(`lookout bench · node ${process.version} · ${FRAMES} frames · ms per frame (per call / per run)`)
console.log(`${'what'.padEnd(w)}  ${'p50'.padStart(8)}  ${'p95'.padStart(8)}`)
for (const r of rows) console.log(`${r.what.padEnd(w)}  ${r.p50.toFixed(3).padStart(8)}  ${r.p95.toFixed(3).padStart(8)}`)
