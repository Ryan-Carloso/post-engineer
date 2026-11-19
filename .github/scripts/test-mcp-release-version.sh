#!/usr/bin/env bash
# Tests .github/scripts/mcp-release-version.sh, mcp-release-stamp.sh and
# mcp-release-not-older.sh against a throwaway git repo (offline):
#   - the version is VERSION MAJOR.MINOR + the ordinal of the LAST commit
#     touching apps/mcp/ in history, not its PR number and not HEAD
#   - an apps/mcp/ PR with a low number merged LAST still yields a version
#     above the previous merge, and every new apps/mcp/ commit increments it
#   - a new release line changes MAJOR.MINOR and leaves the patch alone
#   - a shallow checkout, an empty apps/mcp/ history and a malformed VERSION
#     file fail loudly instead of inventing a version
#   - mcp-release-not-older.sh refuses a version below npm's latest
#   - the stamp writes the version into package.json and both server.json
#     fields, and refuses a malformed version
# Usage: bash .github/scripts/test-mcp-release-version.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION_SCRIPT="$ROOT/.github/scripts/mcp-release-version.sh"
STAMP_SCRIPT="$ROOT/.github/scripts/mcp-release-stamp.sh"
GUARD="$ROOT/.github/scripts/mcp-release-not-older.sh"
SIM="$(mktemp -d /tmp/mcp-release-version-test.XXXXXX)"
trap 'rm -rf "$SIM"' EXIT

PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- throwaway repo: two apps/mcp/ commits around web-only commits ----------
# The last apps/mcp/ commit carries the LOWEST PR number of the three, which
# is exactly the merge order that used to produce a version below npm latest.
REPO="$SIM/repo"
mkdir -p "$REPO/apps/mcp" "$REPO/apps/web"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
printf '1.52\n' > "$REPO/VERSION"
printf '{\n  "name": "post-engineer-mcp",\n  "version": "1.0.0"\n}\n' > "$REPO/apps/mcp/package.json"
printf '{\n  "version": "1.52.0",\n  "packages": [{ "version": "1.52.0" }]\n}\n' > "$REPO/apps/mcp/server.json"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "mcp change (#672)"
echo "first" > "$REPO/apps/mcp/first.txt"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "mcp change (#661)"
echo "web" > "$REPO/apps/web/file.txt"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "web change (#700)"
MCP_SHA="$(git -C "$REPO" rev-parse HEAD)"

echo "--- ordinal of the last MCP commit, not its PR number and not HEAD ---"
out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"
if [ "$out" = "1.52.2" ]; then pass "version is MAJOR.MINOR + the ordinal of the last apps/mcp/ commit"; else fail "expected 1.52.2, got: $out"; fi

echo "--- an older PR number merged last does not lower the version ---"
if [ "$out" != "1.52.661" ]; then pass "the patch is the history ordinal, not the PR of that commit"; else fail "the patch fell back to the PR number: $out"; fi

echo "--- every new MCP merge increments the patch ---"
echo "second" > "$REPO/apps/mcp/second.txt"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "mcp change (#10)"
out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"
if [ "$out" = "1.52.3" ]; then pass "a later merge with a lower PR number still moves the version up"; else fail "expected 1.52.3, got: $out"; fi

echo "--- a new release line keeps the patch ---"
printf '1.53\n' > "$REPO/VERSION"
out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"
if [ "$out" = "1.53.3" ]; then pass "VERSION moves MAJOR.MINOR and the ordinal stays the patch"; else fail "expected 1.53.3, got: $out"; fi
printf '1.52\n' > "$REPO/VERSION"

echo "--- an empty apps/mcp/ history is not a version ---"
NO_MCP="$SIM/no-mcp"
mkdir -p "$NO_MCP/apps/web"
git -C "$NO_MCP" init -q -b main
git -C "$NO_MCP" config user.email test@example.com
git -C "$NO_MCP" config user.name test
printf '1.52\n' > "$NO_MCP/VERSION"
echo "web" > "$NO_MCP/apps/web/file.txt"
git -C "$NO_MCP" add -A && git -C "$NO_MCP" commit -qm "web change"
if out="$(bash "$VERSION_SCRIPT" "$NO_MCP" 2>&1)"; then fail "an empty apps/mcp/ history must fail, got: $out"; else
  if grep -q "::error::No commit touches apps/mcp/" <<< "$out"; then pass "an empty apps/mcp/ history fails loudly"; else fail "empty history error text: $out"; fi
fi

echo "--- a shallow checkout is not a version ---"
SHALLOW="$SIM/shallow"
git clone -q --depth 1 "file://$REPO" "$SHALLOW"
printf '1.52\n' > "$SHALLOW/VERSION"
if out="$(bash "$VERSION_SCRIPT" "$SHALLOW" 2>&1)"; then fail "a shallow checkout must fail, got: $out"; else
  if grep -q "::error::The checkout is shallow" <<< "$out"; then pass "a shallow checkout fails loudly"; else fail "shallow checkout error text: $out"; fi
fi

echo "--- stamp writes all three version fields ---"
if bash "$STAMP_SCRIPT" 1.52.560 "$REPO" > /dev/null 2>&1; then
  stamped="$(cd "$REPO" && node -p "const p=require('./apps/mcp/package.json'), s=require('./apps/mcp/server.json'); [p.version, s.version, s.packages[0].version].join(' ')")"
  if [ "$stamped" = "1.52.560 1.52.560 1.52.560" ]; then pass "stamp sets package.json, server.json and packages[0]"; else fail "stamp wrote: $stamped"; fi
else
  fail "stamp exits 0 on a valid version"
fi

echo "--- stamp refuses a malformed version ---"
if bash "$STAMP_SCRIPT" latest "$REPO" > /dev/null 2>&1; then fail "stamp must refuse 'latest'"; else pass "stamp refuses a malformed version"; fi

echo "--- a malformed VERSION fails ---"
printf 'next\n' > "$REPO/VERSION"
if out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"; then fail "malformed VERSION must fail, got: $out"; else
  if grep -q 'is not MAJOR.MINOR' <<< "$out"; then pass "malformed VERSION fails loudly"; else fail "malformed VERSION error text: $out"; fi
fi
printf '1.52\n' > "$REPO/VERSION"

echo "--- never publish below npm latest ---"
if bash "$GUARD" 1.52.571 1.52.570 > /dev/null 2>&1; then pass "a higher version passes"; else fail "a higher version must pass"; fi
if bash "$GUARD" 1.52.571 "" > /dev/null 2>&1; then pass "nothing published yet passes"; else fail "an empty latest must pass"; fi
if bash "$GUARD" 1.53.1 1.52.900 > /dev/null 2>&1; then pass "a new release line passes despite a lower patch"; else fail "1.53.1 must beat 1.52.900"; fi
if out="$(bash "$GUARD" 1.52.570 1.52.571 2>&1)"; then fail "a lower version must fail"; else
  if grep -q "::error::Release version 1.52.570 is lower than npm latest 1.52.571" <<< "$out"; then pass "a lower version fails loudly"; else fail "lower version error text: $out"; fi
fi
if out="$(bash "$GUARD" latest 1.52.1 2>&1)"; then fail "a malformed version must fail"; else
  if grep -q 'Release version "latest" is not MAJOR.MINOR.PATCH' <<< "$out"; then pass "a malformed version fails loudly"; else fail "malformed guard text: $out"; fi
fi
if bash "$GUARD" 1.52.99 1.52.100 > /dev/null 2>&1; then fail "comparison must be numeric"; else pass "comparison is numeric, not text"; fi

echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
