// The orchestrator's own activity (docs/DESIGN.md 17), collected from the engine's events of the
// session showing the pane: turn.start → thinking, a main-loop tool.call → tool for the call's
// duration, turn.complete → waiting. Subagents' turns and calls (`e.agentId` set) are passed on
// unseen. Every hook returns `next(e)` with the event untouched: this only watches.
//
// register.tsx registers the hooks itself (`on('turn.start', watchTurnStart)` and so on: the engine
// wants `on` called literally there). The state is this module's own variable, not `$.state`, so a
// reload starts it idle.
import type { Hook } from 'claude-code'

import { toolClass } from './activity.ts'
import { YOU_IDLE } from './you.ts'
import type { You } from './you.ts'

let you: You = { ...YOU_IDLE }
let inTurn = false
// Main-loop tool calls in flight (the model may run several at once).
let calls = 0
let now: () => number = () => Date.now() / 1000

function enter(state: You['state'], tool?: string): void {
  const next: You = { state, since: now(), turns: you.turns }
  if (you.model !== undefined) next.model = you.model
  if (you.lastHandoff !== undefined) next.lastHandoff = you.lastHandoff
  if (state === 'tool' && tool !== undefined) {
    next.tool = tool
    next.cls = toolClass(tool)
  }
  you = next
}

/** What the orchestrator is doing now (a fresh object on every change). */
export function youNow(): You {
  return you
}

/** The orchestrator's model, read by register.tsx at session.start. */
export function setYouModel(model: string | undefined): void {
  if (model === you.model) return
  const { model: _old, ...rest } = you
  you = model ? { ...rest, model } : rest
}

/** The newest hand-off the worker has picked up (the handoff file's mtime); older ones are ignored. */
export function setYouHandoff(since: number | null | undefined): void {
  if (since == null || (you.lastHandoff != null && since <= you.lastHandoff)) return
  you = { ...you, lastHandoff: since }
}

/** A new session: idle, the turn count from zero; the model is kept. `clock` replaces the time source. */
export function resetYou(clock?: () => number): void {
  if (clock) now = clock
  inTurn = false
  calls = 0
  const model = you.model
  you = model ? { ...YOU_IDLE, model } : { ...YOU_IDLE }
}

export const watchTurnStart: Hook<'turn.start'> = async ($, e, next) => {
  if (e.agentId === undefined) {
    inTurn = true
    calls = 0
    you = { ...you, turns: you.turns + 1 }
    enter('thinking')
  }
  return next(e)
}

export const watchToolCall: Hook<'tool.call'> = async ($, e, next) => {
  if (e.agentId !== undefined) return next(e)
  calls++
  enter('tool', e.tool)
  try {
    return await next(e)
  } finally {
    calls = Math.max(0, calls - 1)
    if (calls === 0 && inTurn && you.state === 'tool') enter('thinking')
  }
}

export const watchTurnComplete: Hook<'turn.complete'> = async ($, e, next) => {
  if (e.agentId === undefined) {
    inTurn = false
    calls = 0
    enter('waiting')
  }
  return next(e)
}
