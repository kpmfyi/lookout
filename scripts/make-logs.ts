// Writes the SYNTHETIC fixtures of tests/logs/ (tests/log-fixtures.ts builds them; deterministic,
// so regenerating changes no byte). Node 24 runs it directly, from anywhere:
//   node scripts/make-logs.ts
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { fixtureLogs } from '../tests/log-fixtures.ts'
import { ROOT } from './node-io.ts'

const OUT = join(ROOT, 'tests', 'logs')
mkdirSync(OUT, { recursive: true })
for (const [name, text] of Object.entries(fixtureLogs())) {
  const path = join(OUT, name)
  writeFileSync(path, text)
  console.log(`${relative(process.cwd(), path).padEnd(40)} ${String(statSync(path).size).padStart(6)} bytes`)
}
