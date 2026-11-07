#!/usr/bin/env bash
# Tests the "Wait for npm propagation" step of .github/workflows/release-mcp.yml.
#
# Extracts the step VERBATIM from the workflow file and runs it with small
# overrides (REGISTRY_WAIT_ATTEMPTS / REGISTRY_WAIT_SLEEP):
#   - a version that exists on npm resolves immediately (exit 0)
#   - a version that does not exist exhausts its attempts (exit 1)
# Usage:
#   bash .github/scripts/test-release-mcp-registry-wait.sh [workflow-file]
# With no argument it tests the workflow file in this checkout.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$ROOT/.github/workflows/release-mcp.yml}"
SIM="$(mktemp -d /tmp/mcp-registry-wait-test.XXXXXX)"
trap 'rm -rf "$SIM"' EXIT

# --- extract the wait step verbatim from the workflow file ---
python3 -c "
import yaml
d = yaml.safe_load(open('$WORKFLOW'))
steps = d['jobs']['publish']['steps']
wait = [s for s in steps if s.get('name') == 'Wait for npm propagation']
assert len(wait) == 1, 'expected exactly one Wait for npm propagation step'
open('$SIM/wait.sh', 'w').write(wait[0]['run'])
"
bash -n "$SIM/wait.sh" || { echo "FAIL: wait step syntax"; exit 1; }

PASS=0; FAIL=0
check() { # check <label> <condition...>
  local label="$1"; shift
  if "$@"; then echo "PASS: $label"; PASS=$((PASS+1)); else echo "FAIL: $label"; FAIL=$((FAIL+1)); fi
}

echo "--- existing version resolves ---"
if PKG_VERSION=1.42.0 REGISTRY_WAIT_ATTEMPTS=3 REGISTRY_WAIT_SLEEP=1 bash "$SIM/wait.sh" > "$SIM/exists.log" 2>&1; then
  echo "PASS: existing version exits 0"
  PASS=$((PASS+1))
else
  echo "FAIL: existing version exits 0"; cat "$SIM/exists.log"; FAIL=$((FAIL+1))
fi
check "existing version resolves on first attempt" grep -q "attempt 1/3" "$SIM/exists.log"

echo "--- missing version exhausts attempts ---"
if PKG_VERSION=0.0.0-does-not-exist REGISTRY_WAIT_ATTEMPTS=2 REGISTRY_WAIT_SLEEP=1 bash "$SIM/wait.sh" > "$SIM/missing.log" 2>&1; then
  echo "FAIL: missing version exits 1"; FAIL=$((FAIL+1))
else
  echo "PASS: missing version exits 1"
  PASS=$((PASS+1))
fi
check "missing version tried both attempts" grep -q "attempt 2/2" "$SIM/missing.log"
check "missing version reports a loud error" grep -q "::error::npm still does not serve" "$SIM/missing.log"

echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
