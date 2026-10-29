// Imported first by scripts/render-scenes.ts: the hooks runtime has Uint8Array.prototype.toBase64
// (Canvas.encode uses it); plain Node may not. ES imports are hoisted, so this lives in its own module.
;(Uint8Array.prototype as any).toBase64 ??= function (this: Uint8Array) {
  return Buffer.from(this).toString('base64')
}
