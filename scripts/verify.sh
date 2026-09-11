#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0
SKIPPED=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$1"; }

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "pass" ]; then
    green "  ✓ $name"
    PASS=$((PASS + 1))
  elif [ "$result" = "skip" ]; then
    yellow "  ⊘ $name (skipped)"
    SKIPPED=$((SKIPPED + 1))
  else
    red "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=========================================="
echo "  DSH Embedded — Verification Suite"
echo "=========================================="
echo ""

# ── 1. Build ───────────────────────────────
echo "[1/13] Build"

echo "  Building..."
cd "$REPO_ROOT"
if npm run build > /dev/null 2>&1; then
  check "npm run build succeeds" pass
else
  check "npm run build succeeds" fail
fi

if [ -f "$REPO_ROOT/main.js" ] && [ $(wc -c < "$REPO_ROOT/main.js") -gt 1000 ]; then
  check "main.js produced (>1KB)" pass
else
  check "main.js produced (>1KB)" fail
fi

if [ -f "$REPO_ROOT/manifest.json" ] && [ -f "$REPO_ROOT/styles.css" ]; then
  check "manifest.json + styles.css exist" pass
else
  check "manifest.json + styles.css exist" fail
fi

echo ""

# ── 2. TypeScript ──────────────────────────
echo "[2/13] TypeScript"
if npx tsc -noEmit -skipLibCheck > /dev/null 2>&1; then
  check "tsc type-check passes" pass
else
  check "tsc type-check passes" fail
fi
echo ""

# ── 3. Manifest compliance ─────────────────
echo "[3/13] Manifest compliance"

ID=$(node -e "console.log(require('./manifest.json').id)")
VERSION=$(node -e "console.log(require('./manifest.json').version)")
MINAPP=$(node -e "console.log(require('./manifest.json').minAppVersion)")
ISDESKTOP=$(node -e "console.log(require('./manifest.json').isDesktopOnly)")

if [[ "$ID" != *"obsidian"* ]]; then
  check "id does not contain 'obsidian' ($ID)" pass
else
  check "id does not contain 'obsidian' ($ID)" fail
fi

if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  check "version is semver ($VERSION)" pass
else
  check "version is semver ($VERSION)" fail
fi

if [ "$ISDESKTOP" = "true" ]; then
  check "isDesktopOnly is true" pass
else
  check "isDesktopOnly is true" fail
fi
echo ""

# ── 4. DSH binary detection ────────────────
echo "[4/13] DSH binary detection"

DSH_PATH=$(which dsh 2>/dev/null || true)
if [ -n "$DSH_PATH" ]; then
  check "dsh found on PATH ($DSH_PATH)" pass
  DSH_VERSION=$(dsh --version 2>/dev/null || echo "unknown")
  check "dsh --version works ($DSH_VERSION)" pass
else
  check "dsh found on PATH" skip
fi
echo ""

# ── 5. Node binary detection ───────────────
echo "[5/13] Node binary detection"

NODE_PATH=$(which node 2>/dev/null || true)
if [ -n "$NODE_PATH" ]; then
  check "node found on PATH ($NODE_PATH)" pass
  NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    check "node >= 22 ($NODE_VERSION)" pass
  else
    check "node >= 22 ($NODE_VERSION)" fail
  fi
else
  check "node found on PATH" fail
fi
echo ""

# ── 6. DSH web startup + API readiness ─────
echo "[6/13] DSH web startup + API readiness"

if [ -z "$DSH_PATH" ]; then
  check "dsh web startup test" skip
  check "API readiness (session.list probe)" skip
else
  TEST_PORT=18999
  cd /tmp
  dsh web --port $TEST_PORT --host 127.0.0.1 --no-open > /tmp/dsh-verify.log 2>&1 &
  DSH_PID=$!

  # Wait for dsh web to be ready (poll up to 60 seconds)
  HTTP_CODE="000"
  for i in $(seq 1 60); do
    sleep 1
    HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:$TEST_PORT/ 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      break
    fi
  done
  if [ "$HTTP_CODE" = "200" ]; then
    check "dsh web starts and serves HTTP 200" pass
  else
    check "dsh web starts and serves HTTP 200 (got $HTTP_CODE)" fail
  fi

  # Also poll for API readiness (up to 60 seconds)
  API_OK=false
  for i in $(seq 1 60); do
    sleep 1
    API_BODY=$(curl -sS -m 5 http://127.0.0.1:$TEST_PORT/api/session.list -X POST -H "Content-Type: application/json" -d '{"type":"client-request","rpcId":"verify","method":"session.list","payload":{"cursor":null,"limit":1}}' 2>/dev/null || echo "")
    if echo "$API_BODY" | grep -q "server-response" 2>/dev/null; then
      API_OK=true
      break
    fi
  done

  if [ "$API_OK" = "true" ]; then
    check "API readiness (session.list returns server-response)" pass
  else
    check "API readiness (session.list returns server-response)" fail
  fi

  kill $DSH_PID 2>/dev/null || true
  sleep 2
  pkill -f "dsh.*$TEST_PORT" 2>/dev/null || true
fi
echo ""

# ── 7. Process cleanup ─────────────────────
echo "[7/13] Process cleanup"

if [ -z "$DSH_PATH" ]; then
  check "process tree kill" skip
else
  dsh web --port $TEST_PORT --host 127.0.0.1 --no-open > /dev/null 2>&1 &
  DSH_PID=$!

  # Wait for startup
  for i in $(seq 1 20); do
    sleep 1
    if curl -sS -o /dev/null http://127.0.0.1:$TEST_PORT/ 2>/dev/null; then
      break
    fi
  done

  kill $DSH_PID 2>/dev/null

  # Wait for graceful shutdown (up to 10 seconds)
  for i in $(seq 1 10); do
    sleep 1
    if ! kill -0 $DSH_PID 2>/dev/null; then
      break
    fi
  done

  if kill -0 $DSH_PID 2>/dev/null; then
    kill -9 $DSH_PID 2>/dev/null
    check "process killed after SIGTERM (had to SIGKILL)" fail
  else
    check "process killed after SIGTERM" pass
  fi
fi

# Clean up any remaining dsh test processes
pkill -f "dsh.*$TEST_PORT" 2>/dev/null || true
sleep 1
echo ""

# ── 8. Orphan cleanup ──────────────────────
echo "[8/13] Orphan cleanup"

ORPHANS=$(pgrep -f "dsh/lib/bin.js web" 2>/dev/null || true)
if [ -z "$ORPHANS" ]; then
  check "no orphan dsh processes" pass
else
  check "no orphan dsh processes (found $(echo "$ORPHANS" | wc -l))" fail
  echo "$ORPHANS" | while read pid; do kill -9 $pid 2>/dev/null; done
fi
echo ""

# ── 9. Provider config — read ──────────────
echo "[9/13] Provider config — read"

DSH_HOME="$HOME/.dsh"
CRED_PATH="$DSH_HOME/.credentials.yaml"
PATCH_PATH="$DSH_HOME/profiles/web/cordis.patch.yml"

if [ -f "$PATCH_PATH" ]; then
  check "cordis.patch.yml exists" pass
  if grep -q "llm-pi-ai" "$PATCH_PATH" 2>/dev/null; then
    check "cordis.patch.yml has llm-pi-ai section" pass
  else
    check "cordis.patch.yml has llm-pi-ai section" fail
  fi
else
  check "cordis.patch.yml exists" skip
fi

if [ -f "$CRED_PATH" ]; then
  check "credentials.yaml exists" pass
  if grep -q "API_KEY" "$CRED_PATH" 2>/dev/null; then
    check "credentials.yaml has API_KEY entries" pass
  else
    check "credentials.yaml has API_KEY entries" fail
  fi
else
  check "credentials.yaml exists" skip
fi
echo ""

# ── 10. Agent detection ────────────────────
echo "[10/13] Agent detection"

OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
PI_CONFIG="$HOME/.pi/agent/models.json"
PRIME_CONFIG="$HOME/.prime/agent/models.json"

for agent_config in "opencode:$OPENCODE_CONFIG" "pi:$PI_CONFIG" "prime-agent:$PRIME_CONFIG"; do
  agent_name=$(echo "$agent_config" | cut -d: -f1)
  config_file=$(echo "$agent_config" | cut -d: -f2)
  if [ -f "$config_file" ]; then
    check "$agent_name config found ($config_file)" pass
  else
    check "$agent_name config found" skip
  fi
done
echo ""

# ── 11. Agent import — parse test ──────────
echo "[11/13] Agent import — parse test"

if [ -f "$OPENCODE_CONFIG" ]; then
  PROVIDER_COUNT=$(node -e "
    const d = require('$OPENCODE_CONFIG');
    console.log(Object.keys(d.provider || {}).length);
  " 2>/dev/null || echo "0")
  if [ "$PROVIDER_COUNT" -gt 0 ]; then
    check "opencode providers parseable ($PROVIDER_COUNT providers)" pass
  else
    check "opencode providers parseable" fail
  fi
else
  check "opencode providers parseable" skip
fi

if [ -f "$PI_CONFIG" ]; then
  PROVIDER_COUNT=$(node -e "
    const d = require('$PI_CONFIG');
    console.log(Object.keys(d.providers || {}).length);
  " 2>/dev/null || echo "0")
  if [ "$PROVIDER_COUNT" -gt 0 ]; then
    check "pi providers parseable ($PROVIDER_COUNT providers)" pass
  else
    check "pi providers parseable" fail
  fi
else
  check "pi providers parseable" skip
fi
echo ""

# ── 12. Installer functions ────────────────
echo "[12/13] Installer functions"

if [ -f "$REPO_ROOT/src/dsh-installer.ts" ]; then
  check "dsh-installer.ts exists" pass
  if grep -q "runFullInstall" "$REPO_ROOT/src/dsh-installer.ts"; then
    check "runFullInstall exported" pass
  else
    check "runFullInstall exported" fail
  fi
  if grep -q "runInstallWithNode" "$REPO_ROOT/src/dsh-installer.ts"; then
    check "runInstallWithNode exported" pass
  else
    check "runInstallWithNode exported" fail
  fi
  if grep -q "findNodeViaPowerShell" "$REPO_ROOT/src/dsh-installer.ts"; then
    check "findNodeViaPowerShell defined" pass
  else
    check "findNodeViaPowerShell defined" fail
  fi
else
  check "dsh-installer.ts exists" fail
fi
echo ""

# ── 13. Source code structure ──────────────
echo "[13/13] Source code structure"

REQUIRED_FILES=(
  "src/main.ts"
  "src/dsh-manager.ts"
  "src/dsh-view.ts"
  "src/dsh-install-modal.ts"
  "src/dsh-settings-tab.ts"
  "src/dsh-provider-config.ts"
  "src/dsh-installer.ts"
  "src/icons/dsh-logo.svg"
  "esbuild.config.mjs"
  "tsconfig.json"
  "manifest.json"
  "package.json"
  "styles.css"
  "LICENSE"
  "README.md"
  "README.zh-CN.md"
  ".gitignore"
  ".github/workflows/release.yml"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "$REPO_ROOT/$f" ]; then
    check "  $f exists" pass
  else
    check "  $f exists" fail
  fi
done
echo ""

# ── Summary ────────────────────────────────
echo "=========================================="
echo "  Summary: $PASS passed, $FAIL failed, $SKIPPED skipped"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
else
  exit 0
fi
