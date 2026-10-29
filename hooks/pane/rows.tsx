// What every layout draws with (docs/DESIGN.md 38, 40.1): `Draw`, the one draw's context the
// render hands calm and detailed, and the rows they share: a section title, the thinking's runs in
// their theme colours, and the thinking's gist.
import type { ElementTable, RenderElement } from 'claude-code'

import type { Replay, Summary } from '../../types'
import type { Earned } from '../achievements.ts'
import type { Activity } from '../activity.ts'
import type { Fact } from '../facts.ts'
import type { ModuleCtx, PaneUi } from '../modules/index.ts'
import type { Story } from '../narrate.ts'
import { gist, highlight } from '../thought.ts'
import type { Role, Run } from '../thought.ts'
import type { PlainNow, Shape } from './config.ts'

/** One pane draw, as worked out once and handed to the layout that draws it (`$` goes beside it: the engine is never put in an object). */
export type Draw = {
  ui: ElementTable
  /** The terminal's Raster element, null on a surface without one. */
  Raster: ElementTable<'terminal'>['Raster'] | null
  isTerm: boolean
  shape: Shape
  s: Summary
  a: Activity
  /** The pane's clock (the replay's while replaying), the frame, and the pane's size. */
  t: number
  f: number
  cols: number
  rows: number
  spin: string
  /** The status mark: ✓ or ✖ once done, the spinner while live, else ○. */
  statusMark: string
  /** Whether `d` unfolded the last edit, the last command and the timeline (docs/DESIGN.md 38.2). */
  unfolded: boolean
  rp: Replay | null
  earned: Earned | null
  /** calm's story (docs/DESIGN.md 38.1); null in the detailed layouts. */
  story: Story | null
  /** The detailed layout's modules that have a reading, in order. */
  visible: string[]
  /** The facts the pane spells out itself (docs/DESIGN.md 31); undefined off the terminal. */
  shown: Set<Fact> | undefined
  mctx: ModuleCtx
  picks: PaneUi
  plainNow: PlainNow | undefined
  /** The thinking, trimmed ('' for none). */
  thinking: string
  sceneRaster: RenderElement | null
  replayRow: RenderElement | null
  controls: RenderElement | null
  replayControls: RenderElement | null
}

// The thinking's colours from the theme (docs/DESIGN.md 40.1).
const ROLE_STYLE: Record<Role, { color?: string; bold?: boolean }> = {
  plain: {},
  problem: { color: 'error' },
  good: { color: 'success' },
  intent: { bold: true },
  unsure: { color: 'warning' },
  name: { color: 'suggestion' },
}

/** A block's title row, with its dim note on the right. */
export function section(d: Draw, title: string, right?: string, color = 'claude'): RenderElement {
  const { Box, Text } = d.ui
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text bold color={color}>
        {title}
      </Text>
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  )
}

/**
 * Runs as one Text (docs/DESIGN.md 40.1): each role in its theme colour over the row's own look
 * (`dim`, `italic`); `stale` plain words, a newer answer on its way, draw dimmed and uncoloured.
 */
export function runsRow(d: Draw, key: string, runs: readonly Run[], opts: { dim?: boolean; italic?: boolean; stale?: boolean; label?: string } = {}): RenderElement {
  const { Text } = d.ui
  return (
    <Text key={key} dimColor={opts.dim || opts.stale} italic={opts.italic}>
      {opts.label ? <Text dimColor>{opts.label}</Text> : null}
      {runs.map((r, i) =>
        r.role === 'plain' ? (
          r.text
        ) : opts.stale ? (
          <Text key={`${key}-${i}`} dimColor>
            {r.text}
          </Text>
        ) : (
          <Text key={`${key}-${i}`} color={ROLE_STYLE[r.role].color} bold={ROLE_STYLE[r.role].bold}>
            {r.text}
          </Text>
        ),
      )}
    </Text>
  )
}

/** The thinking's gist in `lines` rows, its words coloured by role: dim italic, as thinking has been drawn. */
export function gistRow(d: Draw, key: string, lines: number): RenderElement {
  return runsRow(d, key, highlight(gist(d.thinking, Math.max(1, lines) * (d.cols - 4))), { dim: true, italic: true })
}
