// calm (docs/DESIGN.md 38.1), the default layout: the scene, whose caption is Now; off the terminal
// Now is the first row, and once the run has ended the outcome takes its place on every surface.
// Then the task, the thinking (or the latest reply), the run so far and what is worth a look.
// Nothing else: the numbers are in So far, the achievements toast.
import type { RenderElement } from 'claude-code'

import { fmtDur } from '../activity.ts'
import { cut } from '../scenes/index.ts'
import { newestAt } from '../scenes/screens.ts'
import { gistRow, runsRow, section } from './rows.tsx'
import type { Draw } from './rows.tsx'
import { statusColor } from './text.ts'

export function calmPane(d: Draw & { story: NonNullable<Draw['story']> }): RenderElement {
  const { Box, Text } = d.ui
  const { s, a, t, cols, rows, isTerm, story, plainNow, thinking } = d
  const ended = a.state === 'done'
  const nowLine = ended ? (story.outcome ?? (isTerm ? null : a.text)) : isTerm ? null : (story.now ?? a.text)
  const calmLines = Math.min(12, Math.max(4, Math.floor(rows / 4)))
  const reply = (s.text ?? '').trim()
  const words = thinking || reply
  // In plain words when known (titled so: it is never the model's own text), else the gist.
  const at = plainNow ? plainNow.t || newestAt(s, 'think') : newestAt(s, thinking ? 'think' : 'text')
  const soFar = story.soFar.join(' · ')
  return (
    <Box flexDirection="column" width={cols}>
      {isTerm ? d.sceneRaster : null}
      {d.replayRow}
      {nowLine ? <Text color={statusColor(a)}>{`${a.state === 'waiting' ? '○' : d.statusMark} ${nowLine}`}</Text> : null}
      {story.task ? <Text wrap="truncate-end">{story.task}</Text> : null}
      {words ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="claude" wrap="truncate-end">
            {plainNow ? 'in plain words' : thinking ? 'thinking' : 'latest reply'}
            {at != null ? <Text dimColor>{` · ${fmtDur(t - at)} ago`}</Text> : null}
          </Text>
          {plainNow ? (
            runsRow(d, 'calm-plain', plainNow.runs, { stale: plainNow.stale })
          ) : thinking ? (
            gistRow(d, 'calm-gist', calmLines)
          ) : (
            <Text>{cut(words.replace(/\s+/g, ' '), calmLines * (cols - 4))}</Text>
          )}
        </Box>
      ) : null}
      {story.soFar.length > 0 ? (
        <Box flexDirection="column">
          {section(d, 'so far')}
          {/* One row when the facts fit on it, else one line each. */}
          {soFar.length <= cols ? (
            <Text>{soFar}</Text>
          ) : (
            story.soFar.map((line, i) => (
              <Text key={`so-far-${i}`} wrap="truncate-end">
                {line}
              </Text>
            ))
          )}
        </Box>
      ) : null}
      {story.heads.length > 0 ? (
        <Box flexDirection="column">
          {section(d, 'worth a look', undefined, 'warning')}
          {story.heads.map((line, i) => (
            <Text key={`head-${i}`} color="warning" wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      {d.controls}
      {d.replayControls}
    </Box>
  )
}
