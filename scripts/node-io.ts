// The log reader's Io over Node (docs/DESIGN.md 43.5), for the scripts and the parity run:
// node:fs, child_process and fetch. Overrides fix the clock, the environment and commands.
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Io, IoStat } from '../hooks/reader/io.ts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export type NodeIoOptions = {
  /** A fixed clock (epoch seconds), or a function of it. */
  now?: number | (() => number)
  /** The environment the reader and its commands see (default process.env). */
  env?: Record<string, string | undefined>
  /** Answers a command before it runs: undefined lets it run. */
  run?: (argv: readonly string[]) => { code: number; stdout: string } | undefined
}

export function nodeIo(o: NodeIoOptions = {}): Io {
  const env = o.env ?? process.env
  return {
    root: ROOT,
    platform: process.platform,
    async now() {
      return typeof o.now === 'function' ? o.now() : o.now ?? Date.now() / 1000
    },
    async env(name) {
      return env[name]
    },
    async stat(path): Promise<IoStat | null> {
      try {
        const st = await fs.stat(path, { bigint: true })
        // Python's st_mtime: seconds + nanoseconds × 1e-9, as one double sum
        const mtime = Number(st.mtimeNs / 1_000_000_000n) + Number(st.mtimeNs % 1_000_000_000n) * 1e-9
        const kind = st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other'
        return { kind, size: Number(st.size), mtime, real: await fs.realpath(path), ino: Number(st.ino) }
      } catch {
        return null
      }
    },
    async read(path, offset, length) {
      const fh = await fs.open(path, 'r')
      try {
        const buf = new Uint8Array(length)
        let got = 0
        while (got < length) {
          const { bytesRead } = await fh.read(buf, got, length - got, offset + got)
          if (!bytesRead) break
          got += bytesRead
        }
        return buf.subarray(0, got)
      } finally {
        await fh.close()
      }
    },
    readText(path) {
      return fs.readFile(path, 'utf8')
    },
    async write(path, text) {
      await fs.mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await fs.writeFile(tmp, text)
      await fs.rename(tmp, path)
    },
    async append(path, text) {
      await fs.appendFile(path, text)
    },
    run(argv, timeoutMs) {
      const canned = o.run?.(argv)
      if (canned) return Promise.resolve(canned)
      return new Promise((resolve, reject) => {
        execFile(argv[0]!, argv.slice(1), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: env as NodeJS.ProcessEnv }, (err, stdout) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') reject(err)
          else if (err && err.killed) reject(err)
          else resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout })
        })
      })
    },
    async fetch(url, timeoutMs) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' }, signal: AbortSignal.timeout(timeoutMs) })
        return { status: r.status, text: await r.text() }
      } catch (err) {
        return { status: null, text: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
