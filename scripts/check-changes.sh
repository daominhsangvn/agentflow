#!/usr/bin/env bash
# Checks that the commits since <base> work and break nothing else, locally.
#
#   scripts/check-changes.sh --base <rev> [--only lint,typecheck,db,unit,e2e]
#                            [--e2e-spec <file>]... [--skip-smoke]
#
# Stages (each prints PASS/FAIL; full logs in .harness/check-changes/<time>/, which Playwright does not clean):
#   lint       Biome on the files changed since <base> (committed and uncommitted)
#   typecheck  design-system build (its exports point at dist/), then turbo
#              typecheck of the changed workspaces and everything depending on them
#   db         prisma validate; the local database matches schema.prisma; the
#              recorded checksum of each migration matches its file
#   unit       the full test script of each changed workspace (desktop: node + renderer lanes)
#   e2e        Playwright on the running dev stack: changed and --e2e-spec specs,
#              then the whole @smoke suite (unless --skip-smoke)
#
# e2e needs the dev stack: docker compose up -d, then
# pnpm turbo dev --filter=app --filter=api (see docs/e2e.md).
# Exit: 0 all pass, 1 a stage failed, 2 environment problem. macOS bash 3.2.

set -u

BASE=""
ONLY="lint,typecheck,db,unit,e2e"
EXTRA_SPECS=""
SMOKE=1
TAIL_LINES=40
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-agentflow-postgres-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --e2e-spec) EXTRA_SPECS="$EXTRA_SPECS ${2:-}"; shift 2 ;;
    --skip-smoke) SMOKE=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BASE" ] || { echo "usage: check-changes.sh --base <rev> [...] (see --help)" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "ENV not a git repo" >&2; exit 2; }
cd "$ROOT" || exit 2
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "ENV unknown base: $BASE" >&2; exit 2; }

# Non-login shells may default to a Node without pnpm: use the .nvmrc one.
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && [ -f .nvmrc ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
  nvm use >/dev/null 2>&1
fi
command -v pnpm >/dev/null 2>&1 || { echo "ENV pnpm not found (nvm use / corepack enable)"; exit 2; }
[ -d node_modules ] || { echo "ENV node_modules missing: run pnpm install"; exit 2; }

LOG_DIR="$ROOT/.harness/check-changes/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
CHANGED="$LOG_DIR/changed-files.txt"
{ git diff --name-only --diff-filter=d "$BASE"; git ls-files --others --exclude-standard; } \
  | grep -v '^\.harness/' | sort -u | while IFS= read -r f; do [ -f "$f" ] && echo "$f"; done > "$CHANGED"

echo "base $(git rev-parse --short "$BASE") -> HEAD $(git rev-parse --short HEAD) (+ uncommitted)"
echo "changed: $(wc -l < "$CHANGED" | tr -d ' ') files; logs: ${LOG_DIR#"$ROOT"/}"

STATUS=0
SUMMARY=""

enabled() { case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# run_gate <name> <log name> <cmd...>
run_gate() {
  local name="$1" log="$LOG_DIR/$2.log" start end
  shift 2
  start=$(date +%s)
  if "$@" > "$log" 2>&1; then
    end=$(date +%s)
    echo "PASS $name ($((end - start))s)"
    SUMMARY="$SUMMARY
PASS  $name"
  else
    end=$(date +%s)
    echo "FAIL $name ($((end - start))s, log: ${log#"$ROOT"/})"
    tail -n "$TAIL_LINES" "$log" | sed 's/^/  | /'
    SUMMARY="$SUMMARY
FAIL  $name  -> ${log#"$ROOT"/}"
    STATUS=1
  fi
}

skip() {
  echo "SKIP $1"
  SUMMARY="$SUMMARY
SKIP  $1"
}

pkg_name() { node -p 'require(process.argv[1]).name' "$ROOT/$1/package.json" 2>/dev/null; }
has_script() {
  node -e 'const p=require(process.argv[1]);process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' \
    "$ROOT/$1/package.json" "$2" 2>/dev/null
}

# The e2e tree has older type errors; only errors in files this range changed fail.
typecheck_changed_e2e() {
  local all="$LOG_DIR/typecheck-e2e-all.log" files
  npx tsc --noEmit -p tsconfig.playwright.json > "$all" 2>&1
  files="$(grep -E '^e2e/' "$CHANGED")"
  echo "all e2e type errors: $(grep -c 'error TS' "$all") (full output: ${all#"$ROOT"/})"
  if grep -F "$files" "$all" | grep 'error TS'; then
    return 1
  fi
  echo "none in the changed e2e files"
}

WORKSPACES="$(grep -oE '^(apps|packages)/[^/]+' "$CHANGED" | sort -u | while read -r ws; do
  [ -f "$ws/package.json" ] && echo "$ws"; done)"

# --- lint ------------------------------------------------------------------
if enabled lint; then
  LINT_FILES="$(grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$' "$CHANGED" | tr '\n' ' ')"
  if [ -n "$LINT_FILES" ]; then
    # shellcheck disable=SC2086
    run_gate "lint (biome, changed files)" lint npx biome check --no-errors-on-unmatched $LINT_FILES
  else
    skip "lint (no lintable files)"
  fi
fi

# --- typecheck -------------------------------------------------------------
if enabled typecheck; then
  run_gate "build design-system (dist + .d.ts)" build-design-system \
    pnpm --filter @agentflow-ai/design-system build
  FILTERS=""
  for ws in $WORKSPACES; do
    has_script "$ws" typecheck && FILTERS="$FILTERS --filter=...$(pkg_name "$ws")"
  done
  if [ -n "$FILTERS" ]; then
    # shellcheck disable=SC2086
    run_gate "typecheck (changed workspaces + dependents)" typecheck \
      pnpm turbo typecheck --output-logs=errors-only $FILTERS
  else
    skip "typecheck (no workspace changed)"
  fi
  if grep -qE '^e2e/' "$CHANGED"; then
    run_gate "typecheck e2e (errors in changed e2e files)" typecheck-e2e typecheck_changed_e2e
  fi
fi

# --- db --------------------------------------------------------------------
check_migration_checksums() {
  docker exec "$POSTGRES_CONTAINER" true >/dev/null 2>&1 || {
    echo "container $POSTGRES_CONTAINER is not running"; return 1; }
  local db rows failed=0
  db="$(sed -nE 's#^DATABASE_URL="?postgres(ql)?://[^/]+/([^?"]+).*#\2#p' packages/database/.env 2>/dev/null | head -1)"
  db="${db:-agentflow_ai}"
  rows="$(docker exec "$POSTGRES_CONTAINER" psql -U postgres -d "$db" -tAF ' ' \
    -c "select migration_name, checksum from _prisma_migrations where rolled_back_at is null")" || return 1
  echo "$rows" | while read -r name sum; do
    [ -n "$name" ] || continue
    file="packages/database/prisma/migrations/$name/migration.sql"
    if [ ! -f "$file" ]; then
      echo "MISSING $name (applied, no file)"; continue
    fi
    actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    if [ "$actual" = "$sum" ]; then echo "OK $name"; else echo "CHANGED $name"; fi
  done | tee /dev/stderr | grep -qE '^(MISSING|CHANGED)' && failed=1
  return "$failed"
}

if enabled db; then
  if grep -q '^packages/database/prisma/' "$CHANGED"; then
    run_gate "prisma validate + generate" db-generate \
      sh -c 'cd packages/database && pnpm prisma validate && pnpm prisma generate'
    run_gate "local database matches schema.prisma" db-drift \
      sh -c 'cd packages/database && pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code'
    run_gate "applied migration checksums match their files" db-checksums check_migration_checksums
  else
    skip "db (no prisma change)"
  fi
fi

# --- unit ------------------------------------------------------------------
if enabled unit; then
  for ws in $WORKSPACES; do
    has_script "$ws" test || continue
    # The workspace's own suite: turbo's ^test would stop at a failing dependency.
    run_gate "unit $(pkg_name "$ws")" "unit-$(echo "$ws" | tr / -)" pnpm -C "$ws" test
  done
fi

# --- e2e -------------------------------------------------------------------
stack_up() {
  local app api
  app="$(node -e 'require("dotenv").config({path:"apps/app/.env.local",quiet:true});process.stdout.write(process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3000")')"
  api="$(node -e 'require("dotenv").config({path:"apps/app/.env.local",quiet:true});process.stdout.write(process.env.NEXT_PUBLIC_API_URL||"http://localhost:3002")')"
  curl -fsS -m 10 "$app/api/auth/ok" >/dev/null 2>&1 && curl -fsS -m 10 "$api/health" >/dev/null 2>&1
}

if enabled e2e; then
  if ! stack_up; then
    echo "ENV dev stack not reachable (app /api/auth/ok, api /health): start it, or pass --only without e2e"
    SUMMARY="$SUMMARY
FAIL  e2e (dev stack not reachable)"
    STATUS=2
  else
    SPECS="$(grep -E '^e2e/.*\.spec\.ts$' "$CHANGED" | tr '\n' ' ') $EXTRA_SPECS"
    SPECS="$(echo "$SPECS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
    if [ -n "$SPECS" ]; then
      # shellcheck disable=SC2086
      run_gate "e2e changed/related specs ($(echo $SPECS | wc -w | tr -d ' '))" e2e-changed \
        npx playwright test --reporter=list $SPECS
    else
      skip "e2e changed specs (none)"
    fi
    if [ "$SMOKE" = 1 ]; then
      run_gate "e2e @smoke suite (regression)" e2e-smoke \
        npx playwright test --reporter=list --grep @smoke
    fi
  fi
fi

echo
echo "== summary ($(git rev-parse --short "$BASE")..HEAD) =="
echo "$SUMMARY" | sed '/^$/d'
exit "$STATUS"
