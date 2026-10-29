// The detailed layouts (docs/DESIGN.md 15, 38.2, 43.2): the strip, the module grids around or under
// the scene (panel, wall) or the dashboard's blocks off the terminal (classic), then the blocks in
// the order of 38.2: the status, the thinking, the result and the runs, the last error, the
// timeline, and the last edit and last command, folded to a line each until `d`.
import type { EngineInterface, RenderElement } from 'claude-code'

import type { WatchEvent } from '../../types'
import { earnedBy, runKey } from '../achievements.ts'
import { ctxLimitOf, elapsedOf, fmtDur, k, modelLabel, toolClass } from '../activity.ts'
import { claimed } from '../facts.ts'
import type { Fact } from '../facts.ts'
import { CLASS_GLYPH, G } from '../glyphs.ts'
import { packModules } from '../grid.ts'
import type { Packed } from '../grid.ts'
import { cut } from '../scenes/index.ts'
import { runsText } from '../thought.ts'
import type { RunLine } from './config.ts'
import { checksBlock, dashboardBlocks, gitBlock } from './dashboard.tsx'
import { gridCells } from './layout.ts'
import { gistRow, runsRow, section } from './rows.tsx'
import type { Draw } from './rows.tsx'
import { isDemoPath, readRuns } from './sources.ts'
import { mod, mounted } from './state.ts'
import { PULSE, clock, commandStatus, diffCounts, hhmm, lineColor, shortModel, statusColor, stripText, trimDiff } from './text.ts'

// The detailed layouts folded (docs/DESIGN.md 38.2): the timeline's newest rows.
const TIMELINE_FOLDED = 6
// The label of the plain words in the detailed Thinking block: never shown as the model's own text.
const PLAIN_LABEL = 'in plain words: '

/** One Runs row: `hh:mm · model · subtype · turns · wall · ≈ $ at <compare>`. */
function runText(r: RunLine): string {
  const compare = mod.cfg.compare
  const parts = [hhmm(r.t), shortModel(r.model), r.subtype ?? '?', `${r.turns ?? '?'} turns`, r.duration_ms != null ? fmtDur(r.duration_ms / 1000) : '?']
  const usd = compare !== 'off' ? r.cost_at?.[compare] : undefined
  if (usd != null) parts.push(`≈ $${usd.toFixed(2)} at ${compare}`)
  return parts.join(' · ')
}

export async function detailedPane($: EngineInterface, d: Draw): Promise<RenderElement> {
  const { Box, Text, Code } = d.ui
  const { Raster, isTerm, shape, s, a, t, f, cols, rows, spin, unfolded, rp, earned, visible, shown, mctx, plainNow, thinking } = d
  const done = s.result
  const elapsed = elapsedOf(s, t)
  const fresh = s.mtime != null && t - s.mtime < 3
  const heart = done ? '■' : fresh ? PULSE[f % PULSE.length] : '○'
  const statusText = `${d.statusMark} ${a.text}${a.state === 'done' ? '' : ` · ${fmtDur(a.secs)}`}`
  const classic = shape === 'classic'
  // In panel and wall the strip module, when shown, is the hand-off's one home (docs/DESIGN.md 31).
  const strip = !classic && visible.includes('strip') ? null : stripText(s, cols)
  const ctxLimit = ctxLimitOf(s)
  const ctxNow = s.ctx ?? 0
  const cost = s.cost

  // ── body sizes; the timeline takes what's left (the pane scrolls past that)
  const thinkLines = Math.min(8, Math.max(3, Math.floor(rows / 9)))
  const diffLines = Math.min(14, Math.max(6, Math.floor(rows / 6)))
  const bashLines = Math.min(8, Math.max(4, Math.floor(rows / 8)))
  // The rows the detailed Thinking block's plain words take; the gist has the rest.
  const plainRows = plainNow ? Math.ceil((PLAIN_LABEL.length + runsText(plainNow.runs).length) / Math.max(1, cols - 4)) : 0
  const diff = s.last_diff
  const diffSource = diff ? trimDiff(diff.diff, diffLines + 3) : ''
  const diffN = diff ? diffCounts(diff.diff) : { plus: 0, minus: 0 }
  const bash = s.last_bash
  const bashOut = bash ? bash.out.slice(-bashLines) : []
  // Folded (docs/DESIGN.md 38.2) the timeline keeps its newest rows; unfolded it runs long.
  const events: WatchEvent[] = (s.events ?? []).slice(-(unfolded ? Math.max(8, rows - 20) : TIMELINE_FOLDED))

  const own = shown
  const showModel = !claimed(own, 'handoff')
  const showElapsed = !claimed(own, 'elapsed')
  const header =
    showModel || showElapsed ? (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">
          <Text color={done ? 'subtle' : fresh ? 'success' : 'warning'}>{heart} </Text>
          {showModel ? cut(modelLabel(s), cols - 16) : ''}
        </Text>
        {showElapsed ? <Text bold>{fmtDur(elapsed)}</Text> : null}
      </Box>
    ) : null
  const ctxPart = ctxLimit ? `ctx ${k(ctxNow)}/${k(ctxLimit)} · ${Math.round((ctxNow / ctxLimit) * 100)}%` : `ctx ${k(ctxNow)}`
  const items: [Fact, string][] = [
    ['turns', `turn ${s.turns ?? 0}`],
    ['ctx', ctxPart],
    ['errors', `${s.errors ?? 0} err`],
  ]
  if (cost) items.push(['cost', `≈$${cost.usd.toFixed(2)} at ${cost.compare}`])
  const stats = items.filter(([f]) => !claimed(own, f)).map(([, text]) => text)
  // The Result block's compare table and the Runs list (docs/DESIGN.md 22).
  const atAll = cost?.at_all && Object.keys(cost.at_all).length > 0 ? Object.entries(cost.at_all) : null
  const idW = atAll ? Math.max(...atAll.map(([id]) => id.length)) : 0
  const runs = done ? await readRuns($, s.path) : null
  // The achievements this run earned (docs/DESIGN.md 24); none for the demo or in replay.
  const trophies = done && earned && !rp && !isDemoPath(s.path) ? earnedBy(earned, runKey(s)) : []

  // The module grids (docs/DESIGN.md 15): panel one under the stats, wall the visible modules
  // split in two around the scene. The tick blits them every frame while live.
  const grids: { key: string; packed: Packed }[] = []
  if (shape === 'panel') grids.push({ key: 'modules', packed: packModules(visible, cols, mctx) })
  if (shape === 'wall') {
    const half = Math.ceil(visible.length / 2)
    grids.push({ key: 'modules-top', packed: packModules(visible.slice(0, half), cols, mctx) })
    grids.push({ key: 'modules-bottom', packed: packModules(visible.slice(half), cols, mctx) })
  }
  const drawn = grids.filter(g => g.packed.rows > 0)
  if (isTerm) {
    mounted.grids = drawn
    mounted.ui = d.picks
    for (const g of drawn) mounted.keys.add(g.key)
  }
  const grid = (key: string) => {
    const g = drawn.find(x => x.key === key)
    return g && Raster ? <Raster key={key} columns={cols} rows={g.packed.rows} cells={gridCells(g.packed, cols, mctx)} /> : null
  }

  return (
    <Box flexDirection="column" width={cols}>
      {strip ? (
        <Text wrap="truncate-end" dimColor={!s.handoff}>
          {strip}
        </Text>
      ) : null}
      {grid('modules-top')}
      {isTerm ? d.sceneRaster : null}
      {d.replayRow}
      {isTerm && (header || stats.length > 0) ? (
        <Box flexDirection="column">
          {header}
          {stats.length > 0 ? (
            <Text dimColor wrap="truncate-end">
              {stats.join(' · ')}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {grid('modules')}
      {grid('modules-bottom')}
      {d.controls}
      {d.replayControls}
      {isTerm ? null : (
        <Box flexDirection="column">
          {header}
          <Text color={statusColor(a)} wrap="truncate-end">
            {statusText}
          </Text>
        </Box>
      )}
      {isTerm && a.state === 'stalled' ? (
        <Text color="warning" wrap="truncate-end">
          {statusText}
        </Text>
      ) : null}

      {/* Thinking: worth the most after the status (docs/DESIGN.md 38.2), so it comes first. */}
      {section(d, 'Thinking', thinking ? `${k(thinking.length / 4)} tok` : undefined)}
      {/* The plain words first (labelled), then the gist with its words coloured (docs/DESIGN.md 40). */}
      {thinking && plainNow ? runsRow(d, 'thinking-plain', plainNow.runs, { stale: plainNow.stale, label: PLAIN_LABEL }) : null}
      {thinking ? gistRow(d, 'thinking-gist', thinkLines - plainRows) : <Text dimColor>(none yet)</Text>}
      {s.text ? <Text wrap="truncate-end">» {cut(s.text.replace(/\s+/g, ' '), cols * 2)}</Text> : null}

      {/* The dashboard's blocks, off the terminal (docs/DESIGN.md 43.2); on it the modules stand in for them. */}
      {!classic ? null : dashboardBlocks(d)}

      {/* Tests and type-check */}
      {classic ? checksBlock(d) : null}

      {/* Commits */}
      {classic ? gitBlock(d) : null}

      {done ? (
        <Box flexDirection="column">
          {section(d, 'Result', cost && !atAll ? `priced ${cost.priced_at}` : undefined)}
          <Text color={done.subtype === 'success' ? 'success' : 'error'} wrap="truncate-end">
            {done.subtype} · {done.turns} turns · wall {fmtDur(done.duration_ms / 1000)} · api {fmtDur(done.api_ms / 1000)}
          </Text>
          <Text dimColor wrap="truncate-end">
            in {k(done.input)} · cache read {k(done.cache_read)} · write {k(done.cache_write)} · out {k(done.output)}
          </Text>
          {cost && atAll
            ? atAll.map(([id, usd]) => (
                <Text key={`at-${id}`} wrap="truncate-end" bold={id === cost.compare} dimColor={id !== cost.compare}>
                  {`  ${id.padEnd(idW)}  ≈ $${usd.toFixed(2)}`}
                </Text>
              ))
            : null}
          {cost && atAll ? (
            <Text dimColor wrap="truncate-end">
              {`  priced ${cost.priced_at} · estimate`}
            </Text>
          ) : null}
          {trophies.map(x => (
            <Text key={`trophy-${x.id}`} wrap="truncate-end">
              {`🏆 ${x.title} · ${x.desc}`}
            </Text>
          ))}
          {runs?.lines?.length ? (
            <Box flexDirection="column">
              {section(d, 'Runs', `last ${runs.lines.length} · runs.jsonl`)}
              {runs.lines.map((r, i) => {
                const current = r.path != null && (r.path === runs.real || r.path === s.path)
                return (
                  <Text key={`run-${i}`} wrap="truncate-end" bold={current} dimColor={!current}>
                    {`${current ? '▶' : ' '} ${runText(r)}`}
                  </Text>
                )
              })}
            </Box>
          ) : null}
        </Box>
      ) : null}
      {s.last_error ? (
        <Text color="error" wrap="truncate-end">
          ✖ {clock(s.last_error.t)} {s.last_error.tool}: {s.last_error.detail}
        </Text>
      ) : null}

      {/* Timeline */}
      {section(d, 'Timeline', `last ${events.length}`)}
      {events.map(ev => {
        if (ev.kind === 'think') {
          return (
            <Text dimColor italic wrap="truncate-end">
              {clock(ev.t)} 💭 {ev.label}
            </Text>
          )
        }
        if (ev.kind === 'text') {
          return (
            <Text wrap="truncate-end">
              {clock(ev.t)} » {ev.label}
            </Text>
          )
        }
        const bad = ev.status === 'error' || ev.status === 'denied'
        // Denied is ⊘ beside its word; failed ✖, done ✓ (docs/DESIGN.md 41).
        const mark = ev.status === 'running' ? spin : ev.status === 'denied' ? G.denied : bad ? G.failed : G.ok
        const dur = ev.dur != null && ev.dur >= 1 ? ` ${fmtDur(ev.dur)}` : ''
        const icon = CLASS_GLYPH[ev.cls ?? toolClass(ev.tool)]
        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end" color={bad ? 'error' : ev.status === 'running' ? 'suggestion' : undefined}>
              <Text dimColor>{clock(ev.t)} </Text>
              <Text color={bad ? 'error' : ev.status === 'running' ? 'suggestion' : 'success'}>{mark}</Text> {icon} {ev.tool}{' '}
              <Text dimColor={!bad}>{ev.label}</Text>
              <Text dimColor>{dur}</Text>
              {ev.status === 'denied' ? <Text color="error"> denied</Text> : null}
            </Text>
            {bad && ev.detail ? (
              <Text color="error" wrap="truncate-end">
                {'           '}
                {ev.detail}
              </Text>
            ) : null}
          </Box>
        )
      })}

      {/* Last edit and last command: worth the least (docs/DESIGN.md 38.2), so last, and one line
          each until `d` unfolds the diff and the output. */}
      {diff && !unfolded ? (
        <Box marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              Last edit
            </Text>
            <Text dimColor>{` ${hhmm(diff.t ?? undefined)} · ${diff.path.split('/').at(-1) || diff.path} · `}</Text>
            <Text color="success">{`+${diffN.plus}`}</Text>
            <Text color="error">{` −${diffN.minus}`}</Text>
          </Text>
        </Box>
      ) : null}
      {diff && unfolded ? (
        <Box flexDirection="column">
          {section(d, 'Last edit', `${clock(diff.t)}${diff.lines ? ` · ${diff.lines} lines` : ''}`)}
          <Text dimColor wrap="truncate-end">
            {diff.path}
          </Text>
          <Code source={diffSource} format="diff" path={diff.path} wrap="truncate-end" />
        </Box>
      ) : null}

      {bash && !unfolded ? (
        <Box marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              Last command
            </Text>
            <Text dimColor>{` ${hhmm(bash.t ?? undefined)} · ${cut((bash.desc || bash.cmd.split('\n')[0] || '').trim(), Math.max(12, cols - 36))} · `}</Text>
            <Text color={bash.status === 'running' ? 'suggestion' : bash.status === 'ok' ? 'success' : 'error'}>{commandStatus(bash)}</Text>
          </Text>
        </Box>
      ) : null}
      {bash && unfolded ? (
        <Box flexDirection="column">
          {section(d, 'Last command', `${clock(bash.t)}${bash.desc ? ` · ${cut(bash.desc, 30)}` : ''}`)}
          <Text color="bashBorder" wrap="truncate-end">
            $ {bash.cmd.split('\n')[0]}
          </Text>
          {bash.status === 'running' ? <Text color="suggestion">{spin} running…</Text> : null}
          {bash.more > 0 ? <Text dimColor>  … {bash.more} lines above</Text> : null}
          {bashOut.map(line => (
            <Text color={lineColor(line)} dimColor={!lineColor(line)} wrap="truncate-end">
              {'  '}
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
