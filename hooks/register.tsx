// lookout: follows a headless `claude -p --output-format stream-json --verbose` worker log, or with
// none this session's own transcript (docs/DESIGN.md 36), and draws it in a sidebar pane: an
// animated scene of what the worker is doing over, in calm (the default, docs/DESIGN.md 38), the
// run in plain words: the task, its thinking, the run so far and what is worth a look; or, in the
// detailed layout, the orchestrator strip, its latest thinking, the model server's numbers, pace
// and context, where the time goes, checks, commits, a timeline of tool calls, the last edit and
// the last command.
//   /lookout                     open the pane
//   /lookout <source name>       follow a named source from the `sources` setting
//   /lookout <path>              follow any stream-json log (or session transcript)
//   /lookout session             follow this session: its own transcript
//   /lookout <scene id>          switch the scene (office, office-hd, observatory; docs/DESIGN.md 43.1)
//   /lookout compact | standard | large   how tall the scene is drawn, for this session
//   /lookout calm | detailed     the pane layout (docs/DESIGN.md 38, 43.2; classic, panel and wall read as detailed); `l` cycles it
//   /lookout details             the detailed layout's last edit, last command and timeline in full, or folded again (`d`)
//   /lookout night | paper | phosphor     the colours the scenes and modules paint with (docs/DESIGN.md 27)
//   /lookout season <auto|winter|spring|summer|autumn|none>   what the offices' window shows (docs/DESIGN.md 28)
//   /lookout ambient             the scene alone, filling the pane (docs/DESIGN.md 26); again to leave
//   /lookout next                follow the next named source
//   /lookout demo                play a scripted 72 s run through every state (no worker needed)
//   /lookout replay [<path>|<source>]   replay a finished log from its start at ×8 (default the followed log)
//   /lookout worker [<task>]     print the scripts/lookout-worker command for the model server it sees (docs/DESIGN.md 43.4)
// The thinking is drawn as its gist with the words that matter coloured, and, only when the person
// turns on the `explain` setting, said again in plain words by a small model (docs/DESIGN.md 40).
// It also watches its own session (the orchestrator: turns, tool calls) for the office scene, and
// registers mcp__lookout__status, which answers the orchestrating model with the same summary.
// Following this session, the desk is Claude's and there is no orchestrator: no `you`, no hand-off.//
// This file is the wiring (docs/DESIGN.md 43.3): it hooks the engine's events to the pane's modules
// in hooks/pane/: config.ts (the settings), state.ts (the atoms and the module's own variables),
// sources.ts and poll.ts (what is followed, polled and replayed), explain.ts (the explain policy),
// alerts.ts (status line, toasts, achievements), tick.ts (the blits), render.tsx with calm.tsx,
// detailed.tsx and dashboard.tsx (the layouts), commands.tsx (the command and the keys) and
// status-tool.ts (mcp__lookout__status).
import type { Register } from 'claude-code'

import { sceneById } from './scenes/index.ts'
import { resetYou, setYouModel, watchToolCall, watchTurnComplete, watchTurnStart } from './session-watch.ts'
import { registerCommand, runCommand } from './pane/commands.tsx'
import { FRAME_MS, PANE, POLL_MS, TITLE, readConfig } from './pane/config.ts'
import { poll } from './pane/poll.ts'
import { draw } from './pane/render.tsx'
import { defaultSource, noteTranscript } from './pane/sources.ts'
import { mod, readLogPath, updateDetails, updateLayout, updateLogPath, updatePalette, updateScene, updateSceneSize, updateSeason, updateSourceName } from './pane/state.ts'
import { TOOL, registerStatusTool, statusFor } from './pane/status-tool.ts'
import { tick } from './pane/tick.ts'

export const register: Register = (on, options) => {
  mod.cfg = readConfig(options)
  // The orchestrator's own turns and tool calls (docs/DESIGN.md 17): watched, never altered.
  on('turn.start', watchTurnStart)
  // A watcher that fails passes the call on (replayed when it had already run): it never gates.
  on('tool.call', watchToolCall).catch(($, e, next) => next(e))
  on('turn.complete', watchTurnComplete)
  // This session's transcript as the engine names it (docs/DESIGN.md 36): at start, after a /clear
  // (a SessionStart of its own) and with every prompt. Watched, never altered; a failure passes on.
  on('classic.SessionStart', async ($, e, next) => {
    noteTranscript(e)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteTranscript(e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    mod.sessionCwd = e.cwd
    mod.projectsRead = null
    resetYou()
    $.session.model().then(
      m => setYouModel(m || undefined),
      () => setYouModel(undefined),
    )
    if (mod.cfg.tool) await registerStatusTool($)
    await registerCommand($)
    $.clock.every(POLL_MS, () => poll($))
    $.clock.every(FRAME_MS, () => tick($))
    // A fresh session takes the settings; a reload keeps what the person picked. A write that
    // fails (another copy of the mod writing the same state) must not skip the rest of the start:
    // the polls are already scheduled and the first one takes the default source.
    try {
      if (!(await readLogPath($))) {
        const src = await defaultSource($)
        await updateLogPath($, () => src.path)
        await updateSourceName($, () => src.name)
        await updateScene($, () => sceneById(mod.cfg.scene).id)
        await updateSceneSize($, () => null)
        await updatePalette($, () => null)
        await updateSeason($, () => null)
        await updateLayout($, () => mod.cfg.layout)
        await updateDetails($, () => false)
      }
    } catch {
      // The poll below recovers the source; the picks keep their defaults.
    }
    void poll($)
    void $.ui.open({ id: PANE, title: TITLE, backgroundColor: 'transparent' })
    return started
  })

  // The status tool (docs/DESIGN.md 18): read-only, so every failure is an answer, never a throw.
  // The matchers spell their names out, so `claude plugin validate` reads them; `satisfies` holds
  // each to the constant the other files use.
  on('tool.call', { tool: 'mcp__lookout__status' satisfies typeof TOOL }, async ($, e) => {
    try {
      return { result: await statusFor($, e.source, e.detail) }
    } catch (err) {
      return { result: `lookout: ${err instanceof Error ? err.message : String(err)}` }
    }
  }).catch(() => ({ result: 'lookout: the status check failed (timed out or crashed); the pane may still show the worker' }))

  on('command.run', { command: 'lookout' }, async ($, e) => {
    const text = await runCommand($, e.args.trim())
    await $.ui.open({ id: PANE, title: TITLE, backgroundColor: 'transparent' })
    return { text: `${TITLE}: ${text}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'lookout' satisfies typeof PANE }, async ($, e) => draw($, e))
}
