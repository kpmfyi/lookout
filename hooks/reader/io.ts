// What the log reader reaches outside itself (docs/DESIGN.md 43.5): files, commands, the network
// and the clock, behind one small interface. mod-io.ts implements it over the mod's `$`;
// scripts/node-io.ts over Node, for the scripts and the parity run; the tests fake it.

/** A path's stat, links followed. */
export type IoStat = {
  kind: 'file' | 'dir' | 'other'
  size: number
  /** Last modification, epoch seconds. */
  mtime: number
  /** Where the path lands, every link followed; absent when the host cannot say. */
  real?: string
  /** The file's inode, where the host gives one: a different one is another file at the same path. */
  ino?: number
}

export type Io = {
  /** The plugin's folder: hooks/prices.json is under it. */
  root: string
  /** `darwin`, `linux`, ...; absent when the host does not say (memory then probes /proc/meminfo, then vm_stat). */
  platform?: string
  /** Epoch seconds. */
  now(): Promise<number>
  /** The reader asks for HOME and XDG_CACHE_HOME only. */
  env(name: 'HOME' | 'XDG_CACHE_HOME'): Promise<string | undefined>
  /** null when the path leads nowhere. */
  stat(path: string): Promise<IoStat | null>
  /** Up to `length` bytes from `offset` (fewer at the end of the file). */
  read(path: string, offset: number, length: number): Promise<Uint8Array>
  /** A whole small file as UTF-8 text; rejects when missing. */
  readText(path: string): Promise<string>
  /** Replaces a file, creating its folders. */
  write(path: string, text: string): Promise<void>
  /** Appends to a file, creating it but not its folder. */
  append(path: string, text: string): Promise<void>
  /** Runs a command (no shell); any exit code resolves, a command that cannot start or overruns rejects. */
  run(argv: readonly string[], timeoutMs: number): Promise<{ code: number; stdout: string }>
  /** GET `url`: status null when nothing answered in time (text then says why). */
  fetch(url: string, timeoutMs: number): Promise<{ status: number | null; text: string }>
}
