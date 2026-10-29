// The reader's Io over the mod's `$` (docs/DESIGN.md 43.5).
//
// `$.fs.read` returns a whole file (4 MiB at most) and `$.fs` has no append, so: a small file, or
// a read that ends in the first MiB, comes whole through `$.fs.read` and is cut here; a read
// further into a larger file is `tail -c +N | head -c L | base64` through `$.process.run`
// (POSIX tools; base64 because a process's output arrives as text), 2 MiB at most per read, which
// the follower never exceeds. An append is `tee -a` with the text on its standard input (O_APPEND,
// so a line lands whole), falling back to a read and a write where no process can run.
import type { EngineInterface } from 'claude-code'

import type { Io, IoStat } from './io.ts'

/** Reads ending within this many bytes come through `$.fs.read`; past it, through a process. */
const WHOLE = 1024 * 1024

function fromBase64(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64
  if (native) return native(b64.replace(/\s+/g, ''))
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function modIo($: EngineInterface): Io {
  const whole = async (path: string): Promise<Uint8Array> => fromBase64((await $.fs.read(path, { as: 'bytes' })).base64)
  const ranged = async (path: string, offset: number, length: number): Promise<Uint8Array> => {
    const r = await $.process.run(['/bin/sh', '-c', 'tail -c +"$1" -- "$2" | head -c "$3" | base64', 'sh', String(offset + 1), path, String(length)], { timeoutMs: 15_000 })
    if (r.exitCode !== 0 || r.isStdoutTruncated) throw new Error(`cannot read ${path}`)
    return fromBase64(r.stdout)
  }
  return {
    root: $.plugin.root,
    async now() {
      try {
        return (await $.clock.now()) / 1000
      } catch {
        return Date.now() / 1000
      }
    },
    // The two variables the reader reads, each by its literal name (validate lists what a module reads).
    async env(name) {
      try {
        if (name === 'HOME') return (await $.env.get('HOME')) ?? undefined
        if (name === 'XDG_CACHE_HOME') return (await $.env.get('XDG_CACHE_HOME')) ?? undefined
      } catch {
        // no environment on this host
      }
      return undefined
    },
    async stat(path): Promise<IoStat | null> {
      try {
        const st = await $.fs.stat(path, { resolve: true })
        return { kind: st.kind, size: st.size, mtime: st.mtimeMs / 1000, ...(st.realPath ? { real: st.realPath } : {}) }
      } catch {
        return null
      }
    },
    async read(path, offset, length) {
      if (length <= 0) return new Uint8Array(0)
      if (offset + length <= WHOLE) {
        try {
          return (await whole(path)).slice(offset, offset + length)
        } catch {
          // over 4 MiB, or refused: try the process
        }
      }
      try {
        return await ranged(path, offset, length)
      } catch (err) {
        // No process here (no POSIX shell, or refused): a file of 4 MiB or less still reads whole.
        try {
          return (await whole(path)).slice(offset, offset + length)
        } catch {
          throw err
        }
      }
    },
    readText(path) {
      return $.fs.read(path)
    },
    write(path, text) {
      return $.fs.write(path, text)
    },
    async append(path, text) {
      let r: { exitCode: number } | undefined
      try {
        r = await $.process.run(['tee', '-a', path], { stdin: text, timeoutMs: 5000 })
      } catch {
        let had = ''
        try {
          had = await $.fs.read(path)
        } catch {
          // a new file
        }
        await $.fs.write(path, had + text)
        return
      }
      if (r.exitCode !== 0) throw new Error(`cannot append to ${path}`)
    },
    async run(argv, timeoutMs) {
      const r = await $.process.run(argv, { timeoutMs })
      return { code: r.exitCode, stdout: r.stdout }
    },
    async fetch(url, timeoutMs) {
      const stop = new AbortController()
      const timer = $.clock.sleep(timeoutMs, { signal: stop.signal }).then(
        () => ({ status: null, text: 'timed out' }),
        () => ({ status: null, text: 'timed out' }),
      )
      const call = $.http.fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } }).then(
        r => ({ status: r.status, text: r.text }),
        (err: unknown) => ({ status: null, text: err instanceof Error ? err.message : String(err) }),
      )
      try {
        return await Promise.race([call, timer])
      } finally {
        stop.abort()
      }
    },
  }
}
