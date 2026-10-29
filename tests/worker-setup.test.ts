import { expect, test } from 'claude-code/testing'

import { shellQuote, WORKER_SERVERS, workerCommand, workerServer } from '../hooks/worker-setup.ts'

const SCRIPT = 'scripts/lookout-worker'

test('no options: the script probes, with the task as a placeholder', () => {
  expect(workerCommand({ scriptPath: SCRIPT })).toBe('scripts/lookout-worker "the task"')
  expect(workerCommand({ scriptPath: SCRIPT, server: 'auto', model: ' ', task: '  ' })).toBe('scripts/lookout-worker "the task"')
})

test('a server name, in the spelling the script takes', () => {
  expect(workerCommand({ scriptPath: SCRIPT, server: 'ollama', task: 'add tests' })).toBe("scripts/lookout-worker --server ollama 'add tests'")
  expect(workerCommand({ scriptPath: SCRIPT, server: 'LM Studio' })).toBe('scripts/lookout-worker --server lmstudio "the task"')
  expect(workerCommand({ scriptPath: SCRIPT, server: 'llama-server' })).toBe('scripts/lookout-worker --server llama.cpp "the task"')
  expect(workerCommand({ scriptPath: SCRIPT, server: 'mlx' })).toBe('scripts/lookout-worker --server mlx-serve "the task"')
})

test('an unknown name is left out, so the script probes', () => {
  expect(workerCommand({ scriptPath: SCRIPT, server: 'none' })).toBe('scripts/lookout-worker "the task"')
})

test('a URL is passed as given, without a trailing slash', () => {
  expect(workerCommand({ scriptPath: SCRIPT, server: 'http://127.0.0.1:9000/' }))
    .toBe('scripts/lookout-worker --server http://127.0.0.1:9000 "the task"')
})

test('the model and the task are quoted for sh', () => {
  expect(workerCommand({ scriptPath: SCRIPT, model: 'coder:7b', task: "fix the user's login" }))
    .toBe("scripts/lookout-worker --model coder:7b 'fix the user'\\''s login'")
  expect(workerCommand({ scriptPath: '/opt/my tools/lookout-worker', model: 'org/model q4' }))
    .toBe("'/opt/my tools/lookout-worker' --model 'org/model q4' \"the task\"")
})

test('shellQuote leaves plain words bare and quotes the rest', () => {
  expect(shellQuote('plain-word_1.2')).toBe('plain-word_1.2')
  expect(shellQuote('')).toBe("''")
  expect(shellQuote('$HOME')).toBe("'$HOME'")
  expect(shellQuote("a'b")).toBe("'a'\\''b'")
  expect(shellQuote('two\nlines')).toBe("'two\nlines'")
})

test('the server table: one row per server the script knows, each on /v1/messages', () => {
  expect(WORKER_SERVERS.map(s => s.name)).toEqual(['llama.cpp', 'mlx-serve', 'vllm', 'ollama', 'lmstudio'])
  expect(WORKER_SERVERS.map(s => s.url)).toEqual([
    'http://127.0.0.1:8080', 'http://127.0.0.1:8080', 'http://127.0.0.1:8000', 'http://127.0.0.1:11434', 'http://127.0.0.1:1234',
  ])
  for (const s of WORKER_SERVERS) {
    expect(s.messages).toBe('/v1/messages')
    expect(s.label.length > 0 && s.models.length > 0 && s.start.length > 0 && s.notes.length > 0).toBe(true)
  }
})

test('workerServer finds a row by any usual spelling', () => {
  expect(workerServer('lms')?.label).toBe('LM Studio')
  expect(workerServer(' Ollama ')?.url).toBe('http://127.0.0.1:11434')
  expect(workerServer('llamacpp')?.name).toBe('llama.cpp')
  expect(workerServer('auto')).toBe(null)
  expect(workerServer(undefined)).toBe(null)
})
