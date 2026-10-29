// One home per fact (docs/DESIGN.md 31). Each reading the pane can show is a Fact; each module
// and text block that spells a fact out claims it, and the pane passes the claimed set to the scene
// as `SceneCtx.shown` (and to the modules as `ModuleCtx.shown`). A scene drops its own text for a
// claimed fact and keeps the picture (a station still lights, it just loses its count). The
// current activity line is never claimed: the scene's caption is its one home.
export type Fact =
  | 'handoff' // you → worker, the task, the models
  | 'elapsed' // the run's wall time
  | 'turns'
  | 'pace' // seconds per turn
  | 'tools' // tool calls, by kind or class
  | 'recent' // the last few tool calls in order
  | 'errors' // errors and denials
  | 'cost'
  | 'output' // estimated output tokens
  | 'ctx' // context used against the window
  | 'memory' // free memory, the server's resident size
  | 'decode' // model-server decode tok/s
  | 'prefill'
  | 'checks' // test runs and type-checks
  | 'time' // where the wall time went: thinking, tools, the model
  | 'git' // commits and uncommitted changes
  | 'timeline' // the recent events, as rows

/** What each module id claims. Unknown ids claim nothing. */
export const MODULE_FACTS: Record<string, readonly Fact[]> = {
  strip: ['handoff'],
  'counter:turns': ['turns'],
  'counter:tools': ['tools'],
  'counter:errors': ['errors'],
  'counter:cost': ['cost'],
  'counter:out': ['output'],
  'dial:ctx': ['ctx'],
  'dial:memory': ['memory'],
  'vu:decode': ['decode'],
  'vu:prefill': ['prefill'],
  'scope:pace': ['pace'],
  'scope:ctx': ['ctx'],
  ledmatrix: ['tools'],
  reels: ['recent'],
  patchbay: [],
  clock: ['elapsed'],
  lamps: ['checks', 'errors'],
  toggles: [],
  river: ['time'],
}

/** The facts the given module ids claim. */
export function factsOf(ids: readonly string[]): Set<Fact> {
  const out = new Set<Fact>()
  for (const id of ids) for (const f of Object.hasOwn(MODULE_FACTS, id) ? MODULE_FACTS[id]! : []) out.add(f)
  return out
}

/** True when `f` is claimed elsewhere in the pane; an absent set claims nothing. */
export function claimed(shown: ReadonlySet<Fact> | undefined, f: Fact): boolean {
  return shown != null && shown.has(f)
}
