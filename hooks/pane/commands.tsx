// Commands and keys: `/lookout` and its arguments (the list in register.tsx's header, docs/DESIGN.md
// 2, 21, 26, 36, 38, 43), `/lookout worker` (43.4), and the pane's hotkey rows (s, l, n, d; while
// replaying p, b, f, x, r). Each changes an atom or follows a source; the draw does the rest.
import type { ElementTable, EngineInterface, RenderElement } from 'claude-code'

import type { PaneLayout, Replay } from '../../types'
import { isDemo } from '../activity.ts'
import { DEMO } from '../demo.ts'
import { PALETTE_IDS, isPaletteId } from '../palette.ts'
import { SEASON_SETTINGS, isSeasonSetting } from '../seasons.ts'
import { RETIRED, SCENES, isSceneSize, nextScene, sceneById } from '../scenes/index.ts'
import { workerCommand, workerServer } from '../worker-setup.ts'
import { AS_DETAILED, LAYOUTS, SEEK_SECS, SESSION, THIS_SESSION, layoutOf, nextLayout, nextSpeed } from './config.ts'
import type { Shape } from './config.ts'
import { cycleSource, follow, leaveReplay, pauseReplay, seekReplay, speedReplay, startReplay } from './poll.ts'
import { followedText } from './sources.ts'
import { mod, readBeforeAmbient, readLayout, readSummary, seasonNow, updateBeforeAmbient, updateDetails, updateLayout, updatePalette, updateScene, updateSceneSize, updateSeason } from './state.ts'

/** Registers `/lookout`, its arguments listed for the person. */
export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'lookout',
    description: `Pane following a headless worker log, or this session (args: <source> | <path> | session | <scene> | compact | standard | large | ${LAYOUTS.join(' | ')} | details | ${PALETTE_IDS.join(' | ')} | season <${SEASON_SETTINGS.join('|')}> | next | demo | replay [<path>|<source>] | worker [<task>])`,
    argumentHint: `[source|path|session|<scene id>|compact|standard|large|${LAYOUTS.join('|')}|details|${PALETTE_IDS.join('|')}|season <season>|next|demo|replay [path|source]|worker [task]]`,
  })
}

/** `/lookout <arg>`: what it changed, in words. */
export async function runCommand($: EngineInterface, arg: string): Promise<string> {
  const lower = arg.toLowerCase()
  if (!arg) return `following ${await followedText($)}`
  if (lower === 'details') {
    const open = await updateDetails($, d => !d)
    return open ? 'details: the last edit, the last command and the timeline in full' : 'details: folded'
  }
  const sc = SCENES.find(x => x.id === lower)
  if (sc) {
    await updateScene($, () => sc.id)
    return `scene: ${sc.title}`
  }
  if (Object.hasOwn(RETIRED, lower)) {
    const to = sceneById(lower)
    await updateScene($, () => to.id)
    return `scene: ${to.title} (${lower} was retired)`
  }
  if (isSceneSize(lower)) {
    await updateSceneSize($, () => lower)
    return `scene size: ${lower}`
  }
  if (isPaletteId(lower)) {
    await updatePalette($, () => lower)
    return `palette: ${lower}`
  }
  if (lower === 'season' || lower.startsWith('season ')) {
    const pick = lower.slice('season'.length).trim()
    if (!pick) return `season: ${await seasonNow($)} (/lookout season ${SEASON_SETTINGS.join('|')})`
    if (!isSeasonSetting(pick)) return `no season ${pick}: ${SEASON_SETTINGS.join(', ')}`
    await updateSeason($, () => pick)
    return `season: ${pick}`
  }
  if (lower === 'ambient') {
    // A toggle: into ambient from whatever layout was up, and back to it.
    const was = layoutOf(await readLayout($))
    if (was === 'ambient') {
      const back = layoutOf(await readBeforeAmbient($))
      const to = back === 'ambient' ? 'calm' : back
      await updateLayout($, () => to)
      return `layout: ${to}`
    }
    await updateBeforeAmbient($, () => was)
    await updateLayout($, () => 'ambient')
    return 'layout: ambient (the scene alone; /lookout ambient again or `l` to leave)'
  }
  if ((LAYOUTS as readonly string[]).includes(lower) || AS_DETAILED.includes(lower)) {
    const to = layoutOf(lower)
    await updateLayout($, () => to)
    // The pane picks panel or wall by its width (docs/DESIGN.md 43.2).
    return to === lower ? `layout: ${to}` : `layout: ${to} (${lower} reads as detailed now)`
  }
  if (lower === 'next') return cycleSource($)
  if (lower === 'replay' || lower.startsWith('replay ')) return startReplay($, arg.slice('replay'.length).trim())
  if (lower === 'worker' || lower.startsWith('worker ')) return workerText($, arg.slice('worker'.length).trim())
  if (lower === DEMO) {
    await follow($, { name: DEMO, path: DEMO })
    return 'playing the demo: a scripted 72 s run through every state (no worker)'
  }
  if (lower === SESSION) {
    await follow($, { name: THIS_SESSION, path: SESSION })
    return `following ${await followedText($)}`
  }
  const named = mod.cfg.sources.find(x => x.name.toLowerCase() === lower)
  if (named) {
    await follow($, named)
    return `following ${named.name} (${named.path})`
  }
  await follow($, { name: 'path', path: arg })
  return `following ${arg}`
}

/**
 * `/lookout worker [task]` (docs/DESIGN.md 43.4): the scripts/lookout-worker command line to copy,
 * with the installed script's path and, when the log reader has found a model server (the
 * summary's `server`), `--server` and `--model` for it; otherwise the plain command (the script
 * probes the usual ports) and how to start a server. Read-only: lookout never starts the worker.
 */
async function workerText($: EngineInterface, task: string): Promise<string> {
  const s = await readSummary($)
  const seen = s && !isDemo(s) ? s.server ?? null : null
  const found = seen?.ok ? seen : null
  const label = found ? workerServer(found.adapter)?.label ?? found.adapter : ''
  const command = workerCommand({
    scriptPath: `${$.plugin.root}/scripts/lookout-worker`,
    // The URL the reader found it at when one is set; else the server's name, which the script finds on its own port.
    server: found ? mod.cfg.serverUrl || found.adapter : undefined,
    model: found?.model ?? undefined,
    task,
  })
  if (found) return `a worker on ${label}${found.model ? ` (${found.model})` : ''}, run from the project folder:\n  ${command}${sourceNote()}`
  const hint = seen
    ? `${workerServer(seen.adapter)?.label ?? seen.adapter} did not answer${seen.note ? ` (${seen.note})` : ''}: start it, then run this`
    : 'no model server seen: start one first (llama-server, ollama serve, lms server start, vllm serve or mlx-serve); the script finds it on its usual port'
  return `a worker on a local model server, run from the project folder:\n  ${command}\n${hint}${sourceNote()}`
}

/** The source named `worker`, which the command word hides, is still one `/lookout next` away. */
function sourceNote(): string {
  return mod.cfg.sources.some(x => x.name.toLowerCase() === 'worker') ? '\n(the source named worker: /lookout next reaches it)' : ''
}

/** The terminal's hotkey row: `d` in the detailed layouts, `s` the scene, `l` the layout, `n` the source. */
export function controlsRow($: EngineInterface, ui: ElementTable, o: { shape: Shape; unfolded: boolean; sceneId: string; picked: PaneLayout; src: string }): RenderElement {
  const { Box, Button } = ui
  return (
    <Box flexDirection="row" justifyContent="flex-end" gap={2}>
      {o.shape === 'classic' || o.shape === 'panel' || o.shape === 'wall' ? (
        <Button key="details" hotkey="d" plain dimColor onPress={() => void updateDetails($, d => !d)}>
          {o.unfolded ? 'fold' : 'details'}
        </Button>
      ) : null}
      <Button key="scene" hotkey="s" plain dimColor onPress={() => void updateScene($, id => nextScene(id).id)}>
        {`scene ${nextScene(o.sceneId).title}`}
      </Button>
      <Button key="layout" hotkey="l" plain dimColor onPress={() => void updateLayout($, id => nextLayout(layoutOf(id)))}>
        {`layout ${nextLayout(o.picked)}`}
      </Button>
      {mod.cfg.sources.length > 0 ? (
        <Button key="source" hotkey="n" plain dimColor onPress={() => void cycleSource($)}>
          {`source ${o.src || '?'}`}
        </Button>
      ) : null}
    </Box>
  )
}

/** Replay's own hotkeys (docs/DESIGN.md 21), on every surface while replaying. */
export function replayControlsRow($: EngineInterface, ui: ElementTable, rp: Replay): RenderElement {
  const { Box, Button } = ui
  return (
    <Box flexDirection="row" justifyContent="flex-end" gap={2}>
      <Button key="replay-pause" hotkey="p" plain dimColor onPress={() => void pauseReplay($)}>
        {rp.paused ? 'resume' : 'pause'}
      </Button>
      <Button key="replay-back" hotkey="b" plain dimColor onPress={() => void seekReplay($, -SEEK_SECS)}>
        {`−${SEEK_SECS}s`}
      </Button>
      <Button key="replay-forward" hotkey="f" plain dimColor onPress={() => void seekReplay($, SEEK_SECS)}>
        {`+${SEEK_SECS}s`}
      </Button>
      <Button key="replay-speed" hotkey="x" plain dimColor onPress={() => void speedReplay($)}>
        {`speed ×${nextSpeed(rp.speed)}`}
      </Button>
      <Button key="replay-live" hotkey="r" plain dimColor onPress={() => void leaveReplay($)}>
        live
      </Button>
    </Box>
  )
}
