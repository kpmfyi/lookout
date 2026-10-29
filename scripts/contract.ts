// The Summary contract (docs/DESIGN.md 3) on a real file: the log reader (docs/DESIGN.md 43.5) over
// Node reads tests/logs/running.jsonl and the real hooks/prices.json, with no model server, and
// the keys it prints must be the contract's, the required ones there. types/index.d.ts makes the
// shapes a compile-time check; this one catches what only the output shows (an extra key, a
// missing one, a server where none was asked for). Node 24 runs it directly, from anywhere:
//   node scripts/contract.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Reader } from '../hooks/reader/index.ts'
import { ROOT, nodeIo } from './node-io.ts'

const ALLOWED = new Set(`path exists size mtime error source model cwd started last_ts turns ctx out_est think_ms tool_ms
thinking text errors denials result pending stalled tool_counts files events last_diff last_bash last_error
turn_secs ctx_series tests tsc handoff cost server memory git until transcript prompt`.split(/\s+/))
const REQUIRED = ['path', 'exists', 'source', 'pending', 'events', 'turn_secs', 'ctx_series', 'cost', 'server', 'memory', 'git']

function check(ok: boolean, what: string): void {
  if (!ok) {
    console.error(`contract: ${what}`)
    process.exit(1)
  }
}

const home = mkdtempSync(join(tmpdir(), 'lookout-contract-'))
try {
  const io = nodeIo({ env: { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') } })
  const s = await new Reader().summarize(io, { log: join(ROOT, 'tests', 'logs', 'running.jsonl'), server: 'none', noRuns: true })
  // As the pane receives it: through JSON.
  const d = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
  const extra = Object.keys(d).filter(k => !ALLOWED.has(k)).sort()
  const missing = REQUIRED.filter(k => !(k in d))
  check(extra.length === 0, `keys not in the contract: ${extra.join(', ')}`)
  check(missing.length === 0, `required keys missing: ${missing.join(', ')}`)
  check(d.exists === true, 'the log does not exist')
  check(d.error === undefined, `the reader failed: ${String(d.error)}`)
  check(d.server === null, 'server must be null with server none')
  const cost = d.cost as Record<string, unknown> | null
  const costKeys = cost ? Object.keys(cost).filter(k => k !== 'at_all').sort().join(' ') : ''
  check(cost === null || costKeys === 'basis compare priced_at prices usd', `cost keys: ${costKeys}`)
  check(Object.keys(d.source as object).sort().join(' ') === 'name path', 'source must be {name, path}')
  console.log(`ok: ${Object.keys(d).length} keys`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
