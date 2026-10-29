// Fitting a scene drawn at its native height to the height a layout asks for (docs/DESIGN.md 14).
// Its own module so the scenes can import it without a cycle through the registry in index.ts.
import { Canvas } from '../canvas.ts'
import type { SceneCtx } from './index.ts'

/**
 * Fit a scene drawn at its `native` height (encoded cells, columns × native) to `ctx.rows`,
 * anchored at the bottom: extra rows go on top, painted by `sky(x, y)` (pixel coordinates in
 * the extra band; NONE leaves the terminal's colour), and a shorter height crops the top. Each
 * encoded cell row is columns × 12 bytes, a multiple of 3, so rows join and split as base64 text
 * without decoding; at the native height the cells come back untouched.
 */
export function fitRows(native: number, ctx: SceneCtx, cells: string, sky?: (x: number, y: number) => number): string {
  const rows = Number.isFinite(ctx.rows) ? Math.max(0, Math.floor(ctx.rows)) : native
  if (rows === native) return cells
  const rowChars = ctx.columns * 16 // columns × 3 words × 4 bytes, as base64
  if (rows < native) return cells.slice((native - rows) * rowChars)
  const top = new Canvas(ctx.columns, rows - native)
  if (sky) top.fill(sky)
  return top.encode() + cells
}
