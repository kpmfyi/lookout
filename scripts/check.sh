#!/usr/bin/env bash
# lookout: run every check. Usage: scripts/check.sh   (from anywhere)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
step() { printf '\n== %s\n' "$*"; }
command -v node >/dev/null 2>&1 || { echo "node is not on PATH (Node 24 runs the scripts)"; exit 1; }

# ---------------------------------------------------------------------------------------------
# The log reader's fixtures and contract (hooks/reader, docs/DESIGN.md 43.5)

step "fixtures are reproducible and small"
before="$(cat tests/logs/*.jsonl | shasum)"
node scripts/make-logs.ts >/dev/null
after="$(cat tests/logs/*.jsonl | shasum)"
[ "$before" = "$after" ] || { echo "tests/logs changed when regenerated: commit the output of scripts/make-logs.ts"; exit 1; }
for f in tests/logs/*.jsonl; do
  [ "$(wc -c <"$f")" -lt 102400 ] || { echo "$f is over 100 KB"; exit 1; }
done
echo ok

step "contract check (docs/DESIGN.md section 3): the reader on tests/logs/running.jsonl, server none"
node scripts/contract.ts

step "worker script (scripts/lookout-worker, docs/DESIGN.md 43.4)"
sh scripts/test-worker.sh

# ---------------------------------------------------------------------------------------------
# The mod: the manifest and hooks module as the engine reads them, and every test
step "plugin validate / test"
if [ -f "$ROOT/.claude-plugin/plugin.json" ]; then
  claude plugin validate "$ROOT"
  claude plugin test "$ROOT"
else
  echo "skipped: no .claude-plugin/plugin.json yet"
fi

# ---------------------------------------------------------------------------------------------
step "typescript: strict type check (optional: needs tsc and the engine's generated types)"
if [ -f .claude-plugin/types/tsconfig.json ] && TSC="$(command -v tsc || ls node_modules/.bin/tsc 2>/dev/null)" && [ -n "$TSC" ]; then
  "$TSC" -p . && echo ok
else
  echo "skipped: run 'tsc -p .' with TypeScript installed once the mod has loaded (types are written to .claude-plugin/types/)"
fi

step "no hard-coded private names (docs/DESIGN.md section 2)"
# The words are not in the repo: put one per line in .check-private (git-ignored), or in
# LOOKOUT_PRIVATE_WORDS separated by commas. Ports, hostnames, model ids and project names.
paths=()
for p in hooks tests types README.md; do [ -e "$p" ] && paths+=("$p"); done
words="${LOOKOUT_PRIVATE_WORDS:-}"
if [ -f "$ROOT/.check-private" ]; then
  words="$words,$(grep -v '^#' "$ROOT/.check-private" | paste -sd, -)"
fi
pattern="$(printf '%s' "$words" | tr ',' '\n' | sed '/^$/d' | paste -sd'|' -)"
if [ -z "$pattern" ]; then
  echo "skipped: no .check-private file and LOOKOUT_PRIVATE_WORDS unset"
elif grep -rnE "$pattern" "${paths[@]}"; then
  echo "found hard-coded private names above"; exit 1
else
  echo ok
fi

step "all checks passed"
