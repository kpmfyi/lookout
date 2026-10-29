// The dashboard's blocks (docs/DESIGN.md 6, 8, 22, 43.2): the detailed layout off the terminal,
// where no Raster draws the modules, shows the numbers as text instead: key numbers, where the time
// goes, pace and context, the model server, the machine, checks and commits.
import type { RenderElement } from 'claude-code'

import { ctxLimitOf, elapsedOf, fmtDur, k, toolClass } from '../activity.ts'
import { CLASS_GLYPH, G } from '../glyphs.ts'
import { section } from './rows.tsx'
import type { Draw } from './rows.tsx'
import { BLOCKS, avg, bar, clock, pct, spark } from './text.ts'

/** The sparklines' and bars' width. */
function sparkWidth(cols: number): number {
  return Math.max(10, Math.min(40, cols - 30))
}

/** Key numbers, time, pace and context, the model server and the machine. */
export function dashboardBlocks(d: Draw): RenderElement {
  const { Box, Text } = d.ui
  const { s, t, cols, spin } = d
  const done = s.result
  const elapsed = elapsedOf(s, t)
  const ctxLimit = ctxLimitOf(s)
  const ctxNow = s.ctx ?? 0
  const cost = s.cost
  const sparkW = sparkWidth(cols)
  const nTools = (s.tool_counts ?? []).reduce((acc, [, c]) => acc + c, 0)
  const toolMix = (s.tool_counts ?? []).map(([n, c]) => `${CLASS_GLYPH[toolClass(n)]}${c}`).join(' ')
  const thinkS = (s.think_ms ?? 0) / 1000
  const toolS = (s.tool_ms ?? 0) / 1000
  const modelS = Math.max(0, elapsed - thinkS - toolS)
  const splitW = Math.max(10, cols - 2)
  const seg = (x: number) => Math.round((x / Math.max(elapsed, 1)) * splitW)
  const thinkW = Math.min(splitW, seg(thinkS))
  const toolW = Math.min(splitW - thinkW, seg(toolS))
  const modelW = Math.max(0, splitW - thinkW - toolW)
  const turnSecs = s.turn_secs ?? []
  const sortedTurns = [...turnSecs].sort((x, y) => x - y)
  const srv = s.server
  const reqs = srv?.done ?? []
  const lastReq = reqs.at(-1)
  const decode = reqs.map(r => r.decode_tps)
  const prefill = reqs.map(r => r.prefill_tps)
  const specs = reqs.map(r => r.spec ?? 0).filter(x => x > 0)
  const rates = srv?.rates
  const inflight = srv?.inflight
  const mem = s.memory
  return (
        <Box flexDirection="column">
          {/* Key numbers */}
          <Box flexDirection="row" marginTop={1}>
            <Box flexDirection="column" width={Math.floor(cols / 2)}>
              <Text wrap="truncate-end">
                <Text dimColor>turn   </Text>
                <Text bold>{s.turns ?? 0}</Text>
              </Text>
              <Text wrap="truncate-end">
                <Text dimColor>tools  </Text>
                <Text bold>{nTools}</Text> <Text dimColor>{toolMix}</Text>
              </Text>
              <Text wrap="truncate-end">
                <Text dimColor>errors </Text>
                <Text bold color={(s.errors ?? 0) > 0 ? 'error' : 'success'}>
                  {s.errors ?? 0}
                </Text>
                {(s.denials ?? 0) > 0 ? <Text color="error"> ({s.denials} denied)</Text> : null}
              </Text>
            </Box>
            <Box flexDirection="column" width={cols - Math.floor(cols / 2)}>
              <Text wrap="truncate-end">
                <Text dimColor>≈out   </Text>
                <Text bold>{k(s.out_est)}</Text>
                <Text dimColor> tok</Text>
              </Text>
              <Text wrap="truncate-end">
                <Text dimColor>think  </Text>
                <Text bold>{fmtDur(thinkS)}</Text>
              </Text>
              {cost ? (
                <Text wrap="truncate-end">
                  <Text dimColor>≈ </Text>
                  <Text bold color="warning">
                    ${cost.usd.toFixed(2)}
                  </Text>
                  <Text> at {cost.compare}</Text>
                  <Text dimColor> (estimate)</Text>
                  {done?.cost != null ? <Text color="success"> · real ${done.cost.toFixed(2)}</Text> : null}
                </Text>
              ) : null}
            </Box>
          </Box>

          {/* Where the time goes */}
          {section(d, 'Time', `think ${fmtDur(thinkS)} · tools ${fmtDur(toolS)} · model ${fmtDur(modelS)}`)}
          <Text wrap="truncate-end">
            <Text color="permission">{'█'.repeat(Math.max(0, thinkW))}</Text>
            <Text color="bashBorder">{'█'.repeat(Math.max(0, toolW))}</Text>
            <Text color="claude">{'█'.repeat(Math.max(0, modelW))}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            <Text color="permission">■</Text> thinking  <Text color="bashBorder">■</Text> running tools  <Text color="claude">■</Text> reading prompt + writing
          </Text>

          {/* Pace and context */}
          {section(d, 'Pace', `${turnSecs.length} turns · median ${fmtDur(pct(sortedTurns, 0.5))} · p90 ${fmtDur(pct(sortedTurns, 0.9))}`)}
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text dimColor>s/turn  </Text>
              <Text color="suggestion">{spark(turnSecs, sparkW)}</Text>
            </Text>
            <Text wrap="truncate-end">
              <Text dimColor>context </Text>
              <Text color="claude">{spark(s.ctx_series ?? [], sparkW, ctxLimit ?? undefined)}</Text>
              <Text dimColor>
                {' '}
                {k(ctxNow)}
                {ctxLimit ? ` / ${k(ctxLimit)}` : ''}
              </Text>
            </Text>
          </Box>
          {ctxLimit ? (
            <Text wrap="truncate-end">
              <Text dimColor>window  </Text>
              <Text color={ctxNow / ctxLimit > 0.8 ? 'error' : ctxNow / ctxLimit > 0.6 ? 'warning' : 'success'}>{bar(ctxNow / ctxLimit, sparkW)}</Text>
              <Text dimColor> {Math.round((ctxNow / ctxLimit) * 100)}%</Text>
            </Text>
          ) : null}

          {/* Model server (local models only) */}
          {srv ? (
            <Box flexDirection="column">
              {section(d, 'Model server', `${srv.adapter}${reqs.length ? ` · ${reqs.length} recent requests` : ''}`)}
              {!srv.ok || srv.note ? (
                <Text dimColor wrap="truncate-end">
                  {srv.note ?? 'not answering'}
                </Text>
              ) : null}
              {lastReq ? (
                <Box flexDirection="column">
                  <Text wrap="truncate-end">
                    <Text dimColor>decode  </Text>
                    <Text color="success">{spark(decode, sparkW)}</Text>
                    <Text bold> {lastReq.decode_tps.toFixed(0)}</Text>
                    <Text dimColor> tok/s (avg {avg(decode).toFixed(0)})</Text>
                  </Text>
                  <Text wrap="truncate-end">
                    <Text dimColor>prefill </Text>
                    <Text color="suggestion">{spark(prefill, sparkW)}</Text>
                    <Text bold> {k(lastReq.prefill_tps)}</Text>
                    <Text dimColor> tok/s</Text>
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    last: {k(lastReq.prompt)} prompt ({((lastReq.cached / Math.max(lastReq.prompt, 1)) * 100).toFixed(1)}% cached) → {lastReq.gen} tok ·{' '}
                    {lastReq.stop || '—'}
                    {specs.length ? ` · draft ${avg(specs).toFixed(2)} tok/step` : ''}
                  </Text>
                </Box>
              ) : null}
              {rates ? (
                <Text wrap="truncate-end">
                  <Text dimColor>rates   </Text>
                  {rates.decode_tps != null ? <Text bold>{rates.decode_tps.toFixed(0)}</Text> : null}
                  {rates.decode_tps != null ? <Text dimColor> tok/s decode · </Text> : null}
                  {rates.prefill_tps != null ? <Text bold>{k(rates.prefill_tps)}</Text> : null}
                  {rates.prefill_tps != null ? <Text dimColor> tok/s prefill · </Text> : null}
                  {rates.kv_used != null ? <Text bold>{Math.round(rates.kv_used * 100)}%</Text> : null}
                  {rates.kv_used != null ? <Text dimColor> kv · </Text> : null}
                  {rates.running != null ? <Text bold>{rates.running}</Text> : null}
                  {rates.running != null ? <Text dimColor> running</Text> : null}
                </Text>
              ) : null}
              {inflight?.prompt && !done ? (
                <Text color="claude" wrap="truncate-end">
                  {spin} in flight: {k(inflight.prompt)} prompt, {k(inflight.prompt - (inflight.cached ?? 0))} new · {inflight.msgs ?? '?'} msgs
                </Text>
              ) : null}
            </Box>
          ) : null}

          {/* Machine */}
          {mem?.total_gb ? (
            <Text wrap="truncate-end">
              <Text dimColor>memory  </Text>
              <Text color={(mem.free_gb ?? 0) < 16 ? 'error' : 'subtle'}>{bar(1 - (mem.free_gb ?? 0) / mem.total_gb, sparkW)}</Text>
              <Text dimColor>
                {' '}
                {Math.round(mem.free_gb ?? 0)} GB free{mem.server_gb ? ` · server ${Math.round(mem.server_gb)} GB` : ''}
              </Text>
            </Text>
          ) : null}
        </Box>
  )
}

/** Tests and type-check, or null when the run has neither. */
export function checksBlock(d: Draw): RenderElement | null {
  const { Box, Text } = d.ui
  const s = d.s
  const sparkW = sparkWidth(d.cols)
  const tests = s.tests ?? []
  const lastTest = tests.at(-1)
  const lastTsc = (s.tsc ?? []).at(-1)
  if (!lastTest && !lastTsc) return null
  return (
        <Box flexDirection="column">
          {section(d, 'Checks', `${tests.length} test runs`)}
          {lastTest ? (
            <Text wrap="truncate-end">
              <Text dimColor>tests   </Text>
              {tests.slice(-sparkW).map(r => (
                <Text color={r.failed > 0 ? 'error' : 'success'}>
                  {BLOCKS[Math.min(7, Math.round((r.total / Math.max(...tests.map(x => x.total), 1)) * 7))]}
                </Text>
              ))}
              <Text bold color={lastTest.failed > 0 ? 'error' : 'success'}>
                {' '}
                {lastTest.passed}/{lastTest.total}
              </Text>
              {lastTest.failed > 0 ? <Text color="error"> ({lastTest.failed} failing)</Text> : <Text color="success"> ✓</Text>}
            </Text>
          ) : null}
          {lastTsc ? (
            <Text wrap="truncate-end">
              <Text dimColor>tsc     </Text>
              {(s.tsc ?? []).map(r => (
                <Text color={r.errors > 0 ? 'error' : 'success'}>{r.errors > 0 ? '✖' : '✓'}</Text>
              ))}
              <Text color={lastTsc.errors > 0 ? 'error' : 'success'}> {lastTsc.errors > 0 ? `${lastTsc.errors} errors` : 'clean'}</Text>
            </Text>
          ) : null}
        </Box>
  )
}

/** Commits, or null outside a git repository. */
export function gitBlock(d: Draw): RenderElement | null {
  const { Box, Text } = d.ui
  const git = d.s.git
  if (!git) return null
  return (
        <Box flexDirection="column">
          {section(d, 'Git', `${G.branch} ${git.branch}`)}
          {git.commits.length === 0 ? <Text dimColor>no commits yet this session</Text> : null}
          {git.commits.map(c => {
            const ins = (c.stat.match(/(\d+) insertion/) ?? [])[1]
            const del = (c.stat.match(/(\d+) deletion/) ?? [])[1]
            return (
              <Text wrap="truncate-end">
                <Text color="warning">{c.hash}</Text> <Text dimColor>{clock(c.t)}</Text> {c.subject}
                <Text color="success">{ins ? ` +${ins}` : ''}</Text>
                <Text color="error">{del ? ` -${del}` : ''}</Text>
              </Text>
            )
          })}
          {git.dirty || git.untracked ? (
            <Text dimColor wrap="truncate-end">
              uncommitted: {git.dirty || 'no tracked changes'}
              {git.untracked ? ` · ${git.untracked} untracked` : ''}
            </Text>
          ) : null}
        </Box>
  )
}
