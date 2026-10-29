// The orchestrator's own activity (docs/DESIGN.md 17): the session showing the pane, watched through
// the engine's events. Kept in a module variable by register.tsx (not $.state; a reload starts it
// idle) and handed to the scenes as `SceneCtx.you`. This module holds the shape and a pure reader.
import type { ToolClass } from '../types'
import { toolClass } from './activity.ts'

export type You = {
  /** `waiting`: the turn ended, the person's move. */
  state: 'idle' | 'thinking' | 'tool' | 'waiting'
  /** While `tool`. */
  tool?: string
  cls?: ToolClass
  /** Epoch seconds the state began. */
  since: number
  /** Turns this session (from turn.start). */
  turns: number
  /** `$.session.model()` at start. */
  model?: string
  /** The handoff file's mtime, when the worker's log is newer than it. */
  lastHandoff?: number
}

/** Before the first turn. */
export const YOU_IDLE: You = { state: 'idle', since: 0, turns: 0 }

/** What the orchestrator is doing at `t`: its state, the seconds in it, and the tool class while `tool`. */
export function youActivity(you: You | undefined, t: number): { state: You['state']; secs: number; cls?: ToolClass } {
  if (!you) return { state: 'idle', secs: 0 }
  const secs = Math.max(0, t - you.since)
  if (you.state === 'tool') return { state: 'tool', secs, cls: you.cls ?? toolClass(you.tool) }
  return { state: you.state, secs }
}
