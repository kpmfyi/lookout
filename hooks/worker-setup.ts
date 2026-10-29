// The worker launcher, as the pane describes it (docs/DESIGN.md 43.4): the command line
// `/lookout worker` prints for the person to copy, and the model servers scripts/lookout-worker
// knows, as data. Pure: lookout never starts the worker itself.

export type WorkerServerName = 'llama.cpp' | 'mlx-serve' | 'vllm' | 'ollama' | 'lmstudio'

export type WorkerServer = {
  name: WorkerServerName
  label: string
  /** The base URL the launcher probes when `--server` is not given. */
  url: string
  /** Where the server takes Anthropic Messages API requests (ANTHROPIC_BASE_URL is the base URL). */
  messages: string
  /** Where the launcher finds the model to ask for. */
  models: string
  /** Starting it with a context large enough for Claude Code's prompt and tools (about 20k tokens). */
  start: string
  notes: string
}

/** In the order the launcher probes them; llama.cpp and mlx-serve share 8080 and are told apart by what they answer. */
export const WORKER_SERVERS: readonly WorkerServer[] = [
  {
    name: 'llama.cpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080', messages: '/v1/messages',
    models: '/v1/models (the one it serves), /props for the context',
    start: 'llama-server -m model.gguf -c 65536 --jinja',
    notes: 'ignores the model name in a request; also serves /v1/messages/count_tokens; tools need a chat template with tool calls (--jinja)',
  },
  {
    name: 'mlx-serve', label: 'mlx-serve', url: 'http://127.0.0.1:8080', messages: '/v1/messages',
    models: '/v1/models', start: 'mlx-serve --model <model>',
    notes: 'per-request speeds come from its log file (the serverLog setting)',
  },
  {
    name: 'vllm', label: 'vLLM', url: 'http://127.0.0.1:8000', messages: '/v1/messages',
    models: '/v1/models (max_model_len is the context)', start: 'vllm serve <model>',
    notes: 'only newer versions serve /v1/messages; tool calls need --enable-auto-tool-choice and a --tool-call-parser',
  },
  {
    name: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434', messages: '/v1/messages',
    models: '/api/ps (loaded), else /api/tags (pulled; loaded on the first request)',
    start: 'OLLAMA_CONTEXT_LENGTH=65536 ollama serve',
    notes: 'only newer versions serve /v1/messages; the default context can be smaller than Claude Code\'s prompt',
  },
  {
    name: 'lmstudio', label: 'LM Studio', url: 'http://127.0.0.1:1234', messages: '/v1/messages',
    models: '/api/v0/models, a loaded model only',
    start: 'lms server start; lms load <model> --context-length 65536',
    notes: '/v1/models lists every downloaded model and loads one on demand; a model loads with a small context unless told; no count_tokens',
  },
]

const ALIASES: Record<string, WorkerServerName> = {
  'llama.cpp': 'llama.cpp', llamacpp: 'llama.cpp', 'llama-server': 'llama.cpp', llama: 'llama.cpp',
  'mlx-serve': 'mlx-serve', mlx: 'mlx-serve', mlxserve: 'mlx-serve',
  vllm: 'vllm',
  ollama: 'ollama',
  lmstudio: 'lmstudio', 'lm-studio': 'lmstudio', 'lm studio': 'lmstudio', lms: 'lmstudio',
}

/** The server a name (or one of its usual spellings) stands for, or null. */
export function workerServer(name: string | null | undefined): WorkerServer | null {
  const n = ALIASES[(name ?? '').trim().toLowerCase()]
  return n ? WORKER_SERVERS.find(s => s.name === n) ?? null : null
}

/** A word as POSIX sh reads it back: bare when it is plain, else in single quotes. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

export type WorkerCommandOpts = { server?: string; model?: string; task?: string; scriptPath: string }

/**
 * The launcher's command line: `<script> [--server NAME|URL] [--model NAME] "the task"`. A server
 * name is written the way the script spells it, a URL as given; `auto`, empty or an unknown name
 * leaves `--server` out, so the script probes. No task gives the placeholder `"the task"`.
 */
export function workerCommand(opts: WorkerCommandOpts): string {
  const words = [shellQuote(opts.scriptPath)]
  const server = (opts.server ?? '').trim()
  if (/^https?:\/\//i.test(server)) words.push('--server', shellQuote(server.replace(/\/+$/, '')))
  else {
    const known = workerServer(server)
    if (known) words.push('--server', known.name)
  }
  const model = (opts.model ?? '').trim()
  if (model) words.push('--model', shellQuote(model))
  const task = (opts.task ?? '').trim()
  words.push(task ? shellQuote(task) : '"the task"')
  return words.join(' ')
}
