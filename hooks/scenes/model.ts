// The model as the scenes draw it when there is no model server to read (docs/DESIGN.md 36: the
// pane following this session names the worker and probes no server). The offices' rack then
// stands for the model itself: its lights follow what the model is doing, and the model's short
// name goes under it rather than beside the desk.
import type { SceneCtx } from './index.ts'

/**
 * How hard the model works, for a rack that stands for it: busy while it thinks or reads its
 * prompt, calmer during a tool call, null (idle) otherwise, as while it waits on you. Undefined
 * where the rack is a model server's, or a worker's with no server (the rack stays dark there).
 */
export function modelLoad(ctx: SceneCtx, st: string): number | null | undefined {
  if (ctx.worker == null || ctx.s.server != null) return undefined
  return st === 'thinking' || st === 'prefill' ? 0.85 : st === 'tool' ? 0.45 : null
}
