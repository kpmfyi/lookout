#!/bin/sh
# lookout: checks for scripts/lookout-worker. Usage: scripts/test-worker.sh   (from anywhere)
# Hermetic and fast: stub servers (node, on ports the system picks) stand in for llama.cpp,
# an Ollama without the Messages API and LM Studio, a stub `claude` stands in for the worker, and
# every run gets LOOKOUT_WORKER_URLS or --server, so no real server on this machine is probed.
# Runs the script under sh, and under dash too when it is installed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$ROOT/scripts/lookout-worker"
command -v node >/dev/null 2>&1 || { echo "node is not on PATH (the stub servers need it)"; exit 1; }
T="$(mktemp -d "${TMPDIR:-/tmp}/lookout-test-worker.XXXXXX")" || exit 1
T="$(cd "$T" && pwd)"
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
FAILS=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
# expect NAME FILE PATTERN...: every fixed-string pattern occurs in FILE.
expect() {
  name="$1" file="$2"; shift 2
  for pat in "$@"; do
    if ! grep -qF -- "$pat" "$file"; then bad "$name: no \"$pat\" in:"; sed 's/^/     | /' "$file"; return; fi
  done
  ok "$name"
}
expect_not() {
  name="$1" file="$2"; shift 2
  for pat in "$@"; do
    if grep -qF -- "$pat" "$file"; then bad "$name: unexpected \"$pat\""; return; fi
  done
  ok "$name"
}

# ---------------------------------------------------------------------------------------------
# Stub servers

cat > "$T/stub.mjs" <<'EOF'
// One stub server: node stub.mjs KIND PORTFILE. Listens on a port the system picks and writes it to PORTFILE.
import { createServer } from 'node:http'
import { renameSync, writeFileSync } from 'node:fs'
const [kind, portfile] = process.argv.slice(2)
const LM = { data: [
  { id: 'big-model', type: 'llm', state: 'not-loaded', max_context_length: 262144 },
  { id: 'embed-model', type: 'embeddings', state: 'loaded', max_context_length: 2048 },
  { id: 'small-coder', type: 'llm', state: 'loaded', max_context_length: 65536, loaded_context_length: 49152, capabilities: ['tool_use'] },
] }
function lmstudio(path, method) {
  if (path === '/api/v0/models') return [200, kind === 'lmstudio' ? LM : { data: LM.data.slice(0, 2) }]
  if (path === '/v1/models') return [200, { data: LM.data.map(m => ({ id: m.id })), object: 'list' }]
  if (path === '/v1/messages' && method === 'POST') return [400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: Required' } }]
  return [200, { error: `Unexpected endpoint or method. (${method} ${path})` }]
}
function route(path, method) {
  if (kind.startsWith('lmstudio')) return lmstudio(path, method)
  if (kind === 'llamacpp') {
    if (path === '/props') return [200, { default_generation_settings: { n_ctx: 65536 }, model_path: '/models/tiny-coder-q4.gguf', chat_template_caps: { supports_tool_calls: true } }]
    if (path === '/v1/models') return [200, { object: 'list', data: [{ id: '/models/tiny-coder-q4.gguf', object: 'model' }] }]
    if (path === '/v1/messages' && method === 'POST') return [500, { error: { code: 500, message: "'messages' is required", type: 'server_error' } }]
    return [404, { error: { message: 'File Not Found', type: 'not_found_error', code: 404 } }]
  }
  if (kind === 'ollama-old') {
    if (path === '/api/version') return [200, { version: '0.1.0' }]
    if (path === '/api/ps') return [200, { models: [{ name: 'coder:7b', model: 'coder:7b', context_length: 8192, details: { family: 'x' } }] }]
    return [404, '404 page not found', 'text/plain']
  }
  return [404, 'no such stub', 'text/plain']
}
const server = createServer((req, res) => {
  req.resume() // the body is read and dropped
  req.on('end', () => {
    const [code, obj, ctype = 'application/json'] = route((req.url ?? '/').split('?')[0], req.method)
    const body = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))
    res.writeHead(code, { 'content-type': ctype, 'content-length': body.length })
    res.end(body)
  })
})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(`${portfile}.tmp`, String(server.address().port))
  renameSync(`${portfile}.tmp`, portfile)
})
EOF

start_stub() {  # start_stub KIND: the stub's base URL in $STUB
  node "$T/stub.mjs" "$1" "$T/$1.port" &
  PIDS="$PIDS $!"
  i=0
  while [ ! -s "$T/$1.port" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
  [ -s "$T/$1.port" ] || { echo "stub $1 did not start"; exit 1; }
  STUB="http://127.0.0.1:$(cat "$T/$1.port")"
}

# A port nothing listens on: bind one, then let it go.
CLOSED="http://127.0.0.1:$(node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close() })')"

start_stub llamacpp; LLAMA="$STUB"
start_stub ollama-old; OLLAMA="$STUB"
start_stub lmstudio; LMS="$STUB"
start_stub lmstudio-empty; LMS_EMPTY="$STUB"

# A stub claude: writes its arguments and the environment it was given to stdout (the log), and
# the prompt it read on stdin to prompt.txt beside the project.
cat > "$T/claude" <<'EOF'
#!/bin/sh
for a in "$@"; do printf 'arg %s\n' "$a"; done
for v in ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL ANTHROPIC_SMALL_FAST_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL \
  CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_MAX_CONTEXT_TOKENS CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; do
  eval "printf 'env %s=%s\n' $v \"\${$v-}\""
done
printf 'env ANTHROPIC_API_KEY=%s\n' "${ANTHROPIC_API_KEY-unset}"
cat > ../prompt.txt
EOF
chmod +x "$T/claude"

# ---------------------------------------------------------------------------------------------
# Checks, once per shell

SHELLS="sh"
command -v dash >/dev/null 2>&1 && SHELLS="sh dash"
for SH in $SHELLS; do
  printf '\n== %s\n' "$SH"
  O="$T/out.$SH"
  if "$SH" -n "$W"; then ok "parses"; else bad "parses"; fi

  "$SH" "$W" --help > "$O" 2>&1; [ $? = 0 ] && expect "--help" "$O" "usage: lookout-worker" "--dry-run" || bad "--help exits 0"
  "$SH" "$W" > "$O" 2>&1; [ $? = 2 ] && ok "no task: usage, exit 2" || bad "no task: usage, exit 2"
  "$SH" "$W" --bogus x > "$O" 2>&1; [ $? = 1 ] && expect "unknown option" "$O" "unknown option --bogus" || bad "unknown option exits 1"

  LOOKOUT_WORKER_URLS="$CLOSED" "$SH" "$W" --dry-run "x" > "$O" 2>&1; rc=$?
  [ $rc = 1 ] && expect "no server: the ports tried and how to start each" "$O" "no model server found (tried $CLOSED)" \
    "llama-server -m" "ollama serve" "lms server start" "vllm serve" "mlx-serve" || bad "no server exits 1 (got $rc)"

  # Auto: the closed port is skipped, the old Ollama is passed over, llama.cpp is taken.
  mkdir -p "$T/p-$SH"
  LOOKOUT_WORKER_URLS="$CLOSED $OLLAMA $LLAMA $LMS" "$SH" "$W" --dir "$T/p-$SH" --dry-run "add due dates" -- --max-turns 3 > "$O" 2>"$O.err"; rc=$?
  [ $rc = 0 ] || { bad "dry run exits 0 (got $rc)"; cat "$O.err"; }
  expect "dry run: server, model, env and command" "$O" "# lookout-worker --dry-run: llama.cpp at $LLAMA, model tiny-coder-q4" \
    "ANTHROPIC_BASE_URL=$LLAMA" "ANTHROPIC_AUTH_TOKEN=local" "ANTHROPIC_MODEL=tiny-coder-q4" \
    "ANTHROPIC_DEFAULT_SONNET_MODEL=tiny-coder-q4" "ANTHROPIC_SMALL_FAST_MODEL=tiny-coder-q4" \
    "CLAUDE_CODE_SUBAGENT_MODEL=tiny-coder-q4" "CLAUDE_CODE_MAX_CONTEXT_TOKENS=65536" "unset ANTHROPIC_API_KEY" \
    "claude -p --allowedTools 'Bash(npm test *)'" "--permission-mode acceptEdits --model tiny-coder-q4" \
    "--output-format stream-json --verbose --max-turns 3" "< logs/worker-current.handoff.md > logs/worker-current.jsonl" \
    "# also running: lmstudio at $LMS"
  expect "dry run: the old Ollama is skipped, said once" "$O.err" "skipped ollama at $OLLAMA"
  if [ -e "$T/p-$SH/logs" ]; then bad "dry run writes nothing"; else ok "dry run writes nothing"; fi

  LOOKOUT_WORKER_ALLOW= "$SH" "$W" --server "$LLAMA" --dry-run "x" > "$O" 2>&1
  expect_not "an empty LOOKOUT_WORKER_ALLOW drops the allowlist" "$O" "--allowedTools"

  "$SH" "$W" --server "$OLLAMA/" --dry-run "x" > "$O" 2>&1; rc=$?
  [ $rc = 1 ] && expect "no Messages API: said, with what to do" "$O" "ollama at $OLLAMA does not serve the Anthropic Messages API" \
    "answered 404" "Update Ollama" || bad "no Messages API exits 1 (got $rc)"

  "$SH" "$W" --server "$LMS" --dry-run "x" > "$O" 2>&1
  expect "LM Studio: the loaded chat model, not the first listed or the embedding" "$O" "lmstudio at $LMS, model small-coder" \
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS=49152"
  "$SH" "$W" --server "$LMS_EMPTY" --dry-run "x" > "$O" 2>&1; rc=$?
  [ $rc = 1 ] && expect "LM Studio with nothing loaded: says how to load one" "$O" "has no model loaded" "lms load" \
    || bad "nothing loaded exits 1 (got $rc)"
  "$SH" "$W" --server "$LMS_EMPTY" --model big-model --dry-run "x" > "$O" 2>&1
  expect "--model is taken as given" "$O" "model big-model" "ANTHROPIC_MODEL=big-model"
  expect_not "--model: no context claimed for a model that is not loaded" "$O" "CLAUDE_CODE_MAX_CONTEXT_TOKENS"

  # A real run with the stub claude: the hand-off, the log, the environment, and the rotation.
  P="$T/run-$SH/proj"; mkdir -p "$P"
  printf '# Fix the empty title\n\nDetails.\n' > "$T/task.md"
  for n in 1 2; do
    ANTHROPIC_API_KEY=sk-real CLAUDE="$T/claude" "$SH" "$W" --server "$LLAMA" --dir "$P" -f "$T/task.md" -- --max-turns 9 > "$O" 2>&1
  done
  expect "run: the summary block" "$O" "server  llama.cpp at $LLAMA" "model   tiny-coder-q4 (loaded, context 65536)" \
    'task    logs/worker-current.handoff.md ("Fix the empty title")' "log     $P/logs/worker-current.jsonl (the last run is now logs/worker-" \
    "watch   /lookout" "stop    Ctrl-C, or kill" "rack    for decode speed and memory"
  expect "run: claude's arguments and environment" "$P/logs/worker-current.jsonl" "arg -p" "arg Bash(npm test *)" \
    "arg stream-json" "arg --verbose" "arg --max-turns" "env ANTHROPIC_BASE_URL=$LLAMA" "env ANTHROPIC_MODEL=tiny-coder-q4" \
    "env ANTHROPIC_DEFAULT_HAIKU_MODEL=tiny-coder-q4" "env CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "env ANTHROPIC_API_KEY=unset"
  expect "run: the task on stdin and in the hand-off" "$T/run-$SH/prompt.txt" "# Fix the empty title" "Details."
  expect "run: the hand-off file" "$P/logs/worker-current.handoff.md" "# Fix the empty title"
  n_logs="$(ls "$P/logs" | grep -c '^worker-2.*\.jsonl$')"
  n_hand="$(ls "$P/logs" | grep -c '^worker-2.*\.handoff\.md$')"
  [ "$n_logs" = 1 ] && [ "$n_hand" = 1 ] && ok "run: the last run moved aside with its hand-off" || bad "rotation: $n_logs logs, $n_hand hand-offs"
done

printf '\n'
if [ "$FAILS" -gt 0 ]; then echo "$FAILS failed"; exit 1; fi
echo "all worker checks passed"
