// The log reader (docs/DESIGN.md 43.5): `summarize(io, opts)` gives the Summary (docs/DESIGN.md 3)
// of one stream-json log or session transcript; `modIo($)` is its Io over the mod's API.
//
//   const s = await summarize(modIo($), { log: path, server: 'auto', compare: 'claude-sonnet-5-5' })
export { Reader, summarize, runRecord, sourceName } from './reader.ts'
export type { ReaderOptions } from './reader.ts'
export type { Io, IoStat } from './io.ts'
export { modIo } from './mod-io.ts'
