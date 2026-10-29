// Model-server adapters (docs/DESIGN.md 7): mlx-serve, llama.cpp, vLLM, Ollama and LM Studio.
// Each has a cheap probe for `auto` and a `stats` that answers a ServerStats and never throws: a
// failed read gives `{ adapter, ok: false, note }`. The parsing is pure functions over text and
// JSON; the network is the `get` the reader hands in (a 1.5 s bound per request).
import type { ServerStats } from '../../types'
import { WORKER_SERVERS } from '../worker-setup.ts'
import type { WorkerServerName } from '../worker-setup.ts'
import { NS, S, basename, isDict, pyFloat, pyInt, pyRound, splitlines, strip, truthy } from './py.ts'

export type Adapter = ServerStats['adapter']

/** The probe order of `auto`. */
export const ORDER: readonly Adapter[] = ['mlx-serve', 'llama.cpp', 'vllm', 'ollama', 'lmstudio']

/** Each adapter's own default URL, from the one table of servers (hooks/worker-setup.ts). */
export function defaultUrl(name: Adapter): string {
  return WORKER_SERVERS.find(s => s.name === (name as WorkerServerName))?.url ?? 'http://127.0.0.1:8080'
}

/** GET a URL: [status, text]; status null when nothing answered (text then says why), text '' for a status that is not 2xx. */
export type Get = (url: string) => Promise<[number | null, string]>

export type VllmSample = { t: number; prompt: number | undefined; gen: number | undefined; running: number | undefined; kv: number | undefined }

export type ServerCtx = {
  get: Get
  /** Epoch seconds, for `sampled_at` and vLLM's rates. */
  now: number
  /** The last 400 KB of a server log as lines, and its mtime; rejects when unreadable. */
  tail: (path: string) => Promise<{ lines: string[]; mtime: number }>
  /** vLLM's previous counter sample per URL: its rates are deltas between polls. */
  vllm: Map<string, VllmSample>
}

type Out = ServerStats & Record<string, unknown>

async function getJson(get: Get, url: string): Promise<[number | null, unknown]> {
  const [status, text] = await get(url)
  if (status !== 200) return [status, null]
  try {
    return [status, JSON.parse(text)]
  } catch {
    return [status, null]
  }
}

const join = (url: string, path: string): string => (url || '').replace(/\/+$/, '') + path

/** Bytes as GB to 2 places, or null. */
function gb(n: unknown): number | null {
  try {
    return truthy(n) ? pyRound(pyFloat(n) / 2 ** 30, 2) : null
  } catch {
    return null
  }
}

function int(v: unknown): number | null {
  try {
    return v !== null && v !== undefined ? pyInt(v) : null
  } catch {
    return null
  }
}

const base = (adapter: Adapter, now: number): Out => ({ adapter, ok: false, sampled_at: now })

function finish(out: Out, notes: string[]): Out {
  if (notes.length) out.note = notes.join('; ')
  return out
}

function first(obj: unknown): unknown {
  const data = isDict(obj) ? obj.data : undefined
  if (Array.isArray(data)) return data[0]
  if (typeof data === 'string') return data[0]
  return undefined
}

// ── mlx-serve: per-request stats from its log file, plus GET /v1/models

const SERVER_DONE = /<- (\d+)\+(\d+) tokens streamed \[prefill: ([\d.]+) tok\/s \((\d+) cached \/ (\d+) total\), decode: ([\d.]+) tok\/s\] \[(\w*)\]/
const SPEC = /avg_per_round=([\d.]+)/
const MSGS = /\((\d+) msgs/

/** Per-request stats from mlx-serve log lines, plus the request in flight. */
export function parseMlxLog(lines: readonly string[]): { done: NonNullable<ServerStats['done']>; inflight: ServerStats['inflight']; ctx_limit: number | null } {
  const done: NonNullable<ServerStats['done']> = []
  let cur: Record<string, number | null> | null = null
  let spec: number | null = null
  let ctxLimit: number | null = null
  for (const l of lines) {
    if (l.startsWith('POST /v1/messages')) {
      const m = MSGS.exec(l)
      cur = { msgs: m ? Number(m[1]) : null }
      spec = null
    } else if (cur !== null && l.includes('prompt=') && l.includes('tokens')) {
      let m = /prompt=(\d+)/.exec(l)
      cur.prompt = m ? Number(m[1]) : null
      m = /ctx=(\d+)/.exec(l)
      if (m) ctxLimit = Number(m[1])
    } else if (cur !== null && l.includes('resumed')) {
      const m = /resumed (\d+) of (\d+)/.exec(l)
      if (m) cur.cached = Number(m[1])
    } else if (l.includes('avg_per_round')) {
      const m = SPEC.exec(l)
      spec = m ? pyFloat(m[1]) : spec
    } else {
      const m = SERVER_DONE.exec(l)
      if (m) {
        done.push({ prompt: Number(m[1]), gen: Number(m[2]), prefill_tps: pyFloat(m[3]), cached: Number(m[4]), decode_tps: pyFloat(m[6]), stop: m[7]!, spec })
        cur = null
      }
    }
  }
  return { done: done.slice(-60), inflight: cur as ServerStats['inflight'], ctx_limit: ctxLimit }
}

/** mlx-serve GET /v1/models: the first model's id, resident size and context length. */
export function parseMlxModels(obj: unknown): { model: unknown; resident_gb: number | null; ctx_limit: number | null } | null {
  const m = first(obj)
  if (!isDict(m)) return null
  return { model: m.id ?? null, resident_gb: gb(m.bytes_resident), ctx_limit: int(truthy(m.context_length) ? m.context_length : m.max_model_len) }
}

async function probeMlx(get: Get, url: string): Promise<boolean | null> {
  const [status, obj] = await getJson(get, join(url, '/v1/models'))
  if (status === null) return null
  const data = isDict(obj) ? obj.data : undefined
  return Array.isArray(data) && data.some(m => isDict(m) && 'bytes_resident' in m)
}

async function statsMlx(url: string, logPath: string | null, ctx: ServerCtx): Promise<Out> {
  const out = base('mlx-serve', ctx.now)
  const notes: string[] = []
  let ok = false
  if (logPath) {
    try {
      const { lines, mtime } = await ctx.tail(logPath)
      Object.assign(out, parseMlxLog(lines))
      out.log_mtime = mtime
      ok = true
    } catch {
      notes.push('server log unreadable')
    }
  } else notes.push('no server log set')
  const [, obj] = await getJson(ctx.get, join(url, '/v1/models'))
  const m = parseMlxModels(obj)
  if (m) {
    out.model = m.model as string | null
    out.resident_gb = m.resident_gb
    if (out.ctx_limit === undefined || out.ctx_limit === null) out.ctx_limit = m.ctx_limit
    ok = true
  } else notes.push('models endpoint unavailable')
  out.ok = ok
  return finish(out, notes)
}

// ── Prometheus text (llama.cpp and vLLM /metrics)

const PROM = new RegExp(`^([a-zA-Z_:][a-zA-Z0-9_:]*)(\\{.*\\})?${S}+(${NS}+)`)

/** {metric name: value}, labels dropped and samples of one name summed; NaN and Inf skipped. */
export function parsePrometheus(text: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of splitlines(truthy(text) ? String(text) : '')) {
    const line = strip(raw)
    if (!line || line.startsWith('#')) continue
    const m = PROM.exec(line)
    if (!m) continue
    let v: number
    try {
      v = pyFloat(m[3])
    } catch {
      continue
    }
    if (!Number.isFinite(v)) continue
    out[m[1]!] = (out[m[1]!] ?? 0) + v
  }
  return out
}

// ── llama.cpp: /props, /slots, and /metrics when started with --metrics

export function parseLlamacppProps(obj: unknown): { model: unknown; ctx_limit: number | null } | null {
  if (!isDict(obj)) return null
  const gen = truthy(obj.default_generation_settings) && isDict(obj.default_generation_settings) ? obj.default_generation_settings : {}
  const path = truthy(obj.model_path) ? obj.model_path : truthy(gen.model) ? gen.model : ''
  const name = truthy(path) ? basename(String(path)).replace(/\.gguf(?=\n?$)/, '') : null
  return { model: name || (truthy(obj.model_alias) ? obj.model_alias : null), ctx_limit: int(truthy(gen.n_ctx) ? gen.n_ctx : obj.n_ctx) }
}

/** Busy slots and the first busy slot's prompt size. */
export function parseLlamacppSlots(obj: unknown): { inflight: ServerStats['inflight']; running: number; ctx_limit: number | null } | null {
  if (!Array.isArray(obj)) return null
  const busy = obj.filter(s => isDict(s) && (truthy(s.is_processing) || s.state === 1 || s.state === true)) as Record<string, unknown>[]
  const withCtx = obj.find(s => isDict(s) && truthy(s.n_ctx)) as Record<string, unknown> | undefined
  const nCtx = withCtx ? int(withCtx.n_ctx) : null
  let inflight: ServerStats['inflight'] = null
  if (busy.length) {
    const s = busy[0]!
    const k = ['n_prompt_tokens', 'n_prompt_tokens_processed', 'n_past'].find(k => s[k] !== null && s[k] !== undefined)
    inflight = { msgs: null, prompt: k ? int(s[k]) : null }
    if (s.n_prompt_tokens_cache !== null && s.n_prompt_tokens_cache !== undefined) inflight.cached = int(s.n_prompt_tokens_cache) as number
  }
  return { inflight, running: busy.length, ctx_limit: nCtx }
}

export function parseLlamacppMetrics(text: unknown): NonNullable<ServerStats['rates']> | null {
  const m = parsePrometheus(text)
  const rates: NonNullable<ServerStats['rates']> = {}
  const names: [keyof NonNullable<ServerStats['rates']>, string][] = [
    ['prefill_tps', 'llamacpp:prompt_tokens_seconds'], ['decode_tps', 'llamacpp:predicted_tokens_seconds'],
    ['kv_used', 'llamacpp:kv_cache_usage_ratio'], ['running', 'llamacpp:requests_processing'],
  ]
  for (const [key, name] of names) {
    if (name in m) rates[key] = key === 'kv_used' ? pyRound(m[name]!, 3) : key === 'running' ? Math.trunc(m[name]!) : pyRound(m[name]!, 1)
  }
  return Object.keys(rates).length ? rates : null
}

async function probeLlamacpp(get: Get, url: string): Promise<boolean | null> {
  const [status, obj] = await getJson(get, join(url, '/props'))
  if (status === null) return null
  return isDict(obj) && 'default_generation_settings' in obj
}

async function statsLlamacpp(url: string, _log: string | null, ctx: ServerCtx): Promise<Out> {
  const out = base('llama.cpp', ctx.now)
  const notes: string[] = []
  let ok = false
  // The three reads at once: a server that does not answer costs one timeout, not three.
  const [[, props], [, slots], [status, text]] = await Promise.all([
    getJson(ctx.get, join(url, '/props')), getJson(ctx.get, join(url, '/slots')), ctx.get(join(url, '/metrics')),
  ])
  const p = parseLlamacppProps(props)
  if (p) {
    out.model = p.model as string | null
    out.ctx_limit = p.ctx_limit
    ok = true
  }
  const s = parseLlamacppSlots(slots)
  if (s) {
    out.inflight = s.inflight
    if (out.ctx_limit === undefined || out.ctx_limit === null) out.ctx_limit = s.ctx_limit
    ok = true
  } else notes.push('slots unavailable')
  if (status === 200) {
    out.rates = parseLlamacppMetrics(text)
    if (out.rates && s && !('running' in out.rates)) out.rates.running = s.running
  } else {
    out.rates = s ? { running: s.running } : null
    notes.push('metrics disabled')
  }
  out.ok = ok
  if (!ok) notes.unshift('server did not answer')
  return finish(out, notes)
}

// ── Ollama: /api/ps (loaded models), /api/version for the probe

export function parseOllamaPs(obj: unknown): { model: unknown; resident_gb: number | null; ctx_limit: number | null } | null {
  if (!isDict(obj) || !('models' in obj)) return null
  const models = obj.models
  if (!Array.isArray(models)) return null
  if (!models.length) return { model: null, resident_gb: null, ctx_limit: null }
  const m = isDict(models[0]) ? models[0] : {}
  return { model: truthy(m.name) ? m.name : m.model ?? null, resident_gb: gb(truthy(m.size_vram) ? m.size_vram : m.size), ctx_limit: int(m.context_length) }
}

async function probeOllama(get: Get, url: string): Promise<boolean | null> {
  const [status, obj] = await getJson(get, join(url, '/api/version'))
  if (status === null) return null
  return isDict(obj) && 'version' in obj
}

async function statsOllama(url: string, _log: string | null, ctx: ServerCtx): Promise<Out> {
  const out = base('ollama', ctx.now)
  const [, obj] = await getJson(ctx.get, join(url, '/api/ps'))
  const p = parseOllamaPs(obj)
  if (p === null) return finish(out, ['server did not answer'])
  Object.assign(out, p)
  out.ok = true
  out.rates = null
  return finish(out, [...(truthy(p.model) ? [] : ['no model loaded']), 'rates unavailable'])
}

// ── LM Studio: /api/v0/models (its REST API, loaded instances)

export function parseLmstudioModels(obj: unknown): { model: unknown; ctx_limit: number | null } | null {
  if (!isDict(obj) || !('data' in obj)) return null
  const data = obj.data
  if (!Array.isArray(data)) return null
  const loaded = data.filter(m => isDict(m) && m.state === 'loaded' && ['llm', 'vlm'].includes(('type' in m ? m.type : 'llm') as string)) as Record<string, unknown>[]
  if (!loaded.length) return { model: null, ctx_limit: null }
  const m = loaded[0]!
  return { model: m.id ?? null, ctx_limit: int(truthy(m.loaded_context_length) ? m.loaded_context_length : m.max_context_length) }
}

async function probeLmstudio(get: Get, url: string): Promise<boolean | null> {
  const [status, obj] = await getJson(get, join(url, '/api/v0/models'))
  if (status === null) return null
  return parseLmstudioModels(obj) !== null
}

async function statsLmstudio(url: string, _log: string | null, ctx: ServerCtx): Promise<Out> {
  const out = base('lmstudio', ctx.now)
  const [, obj] = await getJson(ctx.get, join(url, '/api/v0/models'))
  const p = parseLmstudioModels(obj)
  if (p === null) return finish(out, ['server did not answer'])
  Object.assign(out, p)
  out.ok = true
  out.rates = null
  return finish(out, [...(truthy(p.model) ? [] : ['no model loaded']), 'rates unavailable'])
}

// ── vLLM: /metrics counters, rates from deltas between polls; /v1/models

/** One counter sample from vLLM's /metrics text. */
export function vllmSample(text: unknown, now: number): VllmSample {
  const m = parsePrometheus(text)
  const kv = 'vllm:gpu_cache_usage_perc' in m ? m['vllm:gpu_cache_usage_perc'] : m['vllm:kv_cache_usage_perc']
  return { t: now, prompt: m['vllm:prompt_tokens_total'], gen: m['vllm:generation_tokens_total'], running: m['vllm:num_requests_running'], kv }
}

export function vllmRates(sample: VllmSample, prev: Partial<VllmSample>): NonNullable<ServerStats['rates']> | null {
  const rates: NonNullable<ServerStats['rates']> = {}
  if (sample.running !== undefined) rates.running = Math.trunc(sample.running)
  if (sample.kv !== undefined) rates.kv_used = pyRound(sample.kv, 3)
  const dt = typeof prev.t === 'number' ? sample.t - prev.t : 0
  if (dt > 0 && dt <= 60) {
    for (const [key, field] of [['decode_tps', 'gen'], ['prefill_tps', 'prompt']] as const) {
      const a = prev[field]
      const b = sample[field]
      if (a !== undefined && a !== null && b !== undefined && b >= a) rates[key] = pyRound((b - a) / dt, 1) // smaller: the server restarted
    }
  }
  return Object.keys(rates).length ? rates : null
}

/** Rates from a /metrics text and the previous sample (none on the first poll). */
export function parseVllmMetrics(text: unknown, prev: Partial<VllmSample> | null, now: number): NonNullable<ServerStats['rates']> | null {
  return vllmRates(vllmSample(text, now), prev ?? {})
}

async function probeVllm(get: Get, url: string): Promise<boolean | null> {
  const [status, text] = await get(join(url, '/metrics'))
  if (status === null) return null
  return status === 200 && text.includes('vllm:')
}

async function statsVllm(url: string, _log: string | null, ctx: ServerCtx): Promise<Out> {
  const out = base('vllm', ctx.now)
  const notes: string[] = []
  const [status, text] = await ctx.get(join(url, '/metrics'))
  if (status !== 200) return finish(out, ['metrics unavailable'])
  const sample = vllmSample(text, ctx.now)
  const prev = ctx.vllm.get(url)
  ctx.vllm.set(url, sample)
  out.rates = vllmRates(sample, prev ?? {})
  if (!prev) notes.push('rates after the next poll')
  const [, obj] = await getJson(ctx.get, join(url, '/v1/models'))
  const m = first(obj)
  if (isDict(m)) {
    out.model = (m.id ?? null) as string | null
    out.ctx_limit = int(m.max_model_len)
  } else notes.push('models endpoint unavailable')
  out.ok = true
  return finish(out, notes)
}

// ──

type Probe = (get: Get, url: string) => Promise<boolean | null>
type Stats = (url: string, log: string | null, ctx: ServerCtx) => Promise<Out>

const ADAPTERS: Record<Adapter, [Probe, Stats]> = {
  'mlx-serve': [probeMlx, statsMlx],
  'llama.cpp': [probeLlamacpp, statsLlamacpp],
  vllm: [probeVllm, statsVllm],
  ollama: [probeOllama, statsOllama],
  lmstudio: [probeLmstudio, statsLmstudio],
}

export function isAdapter(name: string): name is Adapter {
  return Object.hasOwn(ADAPTERS, name)
}

/** The first adapter in ORDER whose probe says yes, or null; nothing answering at all stops the probing. */
export async function detect(get: Get, url: string): Promise<Adapter | null> {
  for (const name of ORDER) {
    let r: boolean | null
    try {
      r = await ADAPTERS[name][0](get, url)
    } catch {
      r = false
    }
    if (r === null) break
    if (r) return name
  }
  return null
}

/** ServerStats for adapter `name`; never throws. */
export async function serverStats(name: Adapter, url: string, logPath: string | null, ctx: ServerCtx): Promise<ServerStats> {
  try {
    return await ADAPTERS[name][1](url, logPath, ctx)
  } catch (err) {
    return finish(base(name, ctx.now), [`adapter failed: ${err instanceof Error ? err.name : 'Error'}`])
  }
}
