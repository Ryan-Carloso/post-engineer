#!/usr/bin/env bash
# Tests .github/scripts/mcp-release-version.sh and mcp-release-stamp.sh
# against a throwaway git repo, with `gh` stubbed on PATH (offline):
#   - the version is VERSION MAJOR.MINOR + the PR of the LAST commit
#     touching apps/mcp/, not of HEAD
#   - an unmerged/missing PR, a malformed package.json version and a missing
#     GITHUB_REPOSITORY fail loudly instead of inventing a version
#   - the stamp writes the version into package.json and both server.json
#     fields, and refuses a malformed version
# Usage: bash .github/scripts/test-mcp-release-version.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION_SCRIPT="$ROOT/.github/scripts/mcp-release-version.sh"
STAMP_SCRIPT="$ROOT/.github/scripts/mcp-release-stamp.sh"
SIM="$(mktemp -d /tmp/mcp-release-version-test.XXXXXX)"
trap 'rm -rf "$SIM"' EXIT

PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- gh stub: answers /commits/<sha>/pulls from $SIM/pulls/<sha>.json ---
mkdir -p "$SIM/bin" "$SIM/pulls"
cat > "$SIM/bin/gh" << 'EOF'
#!/usr/bin/env bash
# gh api repos/<slug>/commits/<sha>/pulls --jq <filter>
[ "$1" = "api" ] || exit 2
sha="${2#*commits/}"; sha="${sha%/pulls}"
file="$GH_STUB_DIR/$sha.json"
[ -f "$file" ] || { echo "gh: not found" >&2; exit 1; }
jq -r "$4" "$file"
EOF
chmod +x "$SIM/bin/gh"
export PATH="$SIM/bin:$PATH" GH_STUB_DIR="$SIM/pulls"

# --- throwaway repo: an MCP commit (PR 560), then a web-only commit (PR 561) ---
REPO="$SIM/repo"
mkdir -p "$REPO/apps/mcp" "$REPO/apps/web"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
printf '1.52\n' > "$REPO/VERSION"
printf '{\n  "name": "post-engineer-mcp",\n  "version": "1.0.0"\n}\n' > "$REPO/apps/mcp/package.json"
printf '{\n  "version": "1.52.0",\n  "packages": [{ "version": "1.52.0" }]\n}\n' > "$REPO/apps/mcp/server.json"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "mcp change"
MCP_SHA="$(git -C "$REPO" rev-parse HEAD)"
echo "web" > "$REPO/apps/web/file.txt"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "web change"
WEB_SHA="$(git -C "$REPO" rev-parse HEAD)"
echo '[{"number": 560, "merged_at": "2026-11-11T10:00:00Z"}]' > "$SIM/pulls/$MCP_SHA.json"
echo '[{"number": 561, "merged_at": "2026-11-11T11:00:00Z"}]' > "$SIM/pulls/$WEB_SHA.json"
export GITHUB_REPOSITORY="Ryan-Carloso/post-engineer"

echo "--- version from the last MCP commit, not HEAD ---"
out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"
if [ "$out" = "1.52.560" ]; then pass "version is MAJOR.MINOR + the PR of the last apps/mcp/ commit"; else fail "expected 1.52.560, got: $out"; fi

echo "--- an unmerged PR is not a version ---"
echo '[{"number": 560, "merged_at": null}]' > "$SIM/pulls/$MCP_SHA.json"
if out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"; then fail "unmerged PR must fail, got: $out"; else
  if grep -q "::error::Commit $MCP_SHA has no merged PR" <<< "$out"; then pass "unmerged PR fails loudly"; else fail "unmerged PR error text: $out"; fi
fi
echo '[{"number": 560, "merged_at": "2026-11-11T10:00:00Z"}]' > "$SIM/pulls/$MCP_SHA.json"

echo "--- a failed API lookup is not a version ---"
mv "$SIM/pulls/$MCP_SHA.json" "$SIM/pulls/$MCP_SHA.json.off"
if out="$(bash "$VERSION_SCRIPT" "$REPO" 2>&1)"; then fail "failed lookup must fail, got: $out"; else
  if grep -q "::error::GitHub API lookup of the PR for $MCP_SHA failed." <<< "$out"; then pass "failed lookup fails loudly"; else fail "failed lookup error text: $out"; fi
fi
mv "$SIM/pulls/$MCP_SHA.json.off" "$SIM/pulls/$MCP_SHA.json"

echo "--- missing GITHUB_REPOSITORY ---"
if out="$(GITHUB_REPOSITORY='' bash "$VERSION_SCRIPT" "$REPO" 2>&1)"; then fail "missing GITHUB_REPOSITORY must fail"; else
  if grep -q "::error::GITHUB_REPOSITORY is not set" <<< "$out"; then pass "missing GITHUB_REPOSITORY fails loudly"; else fail "missing repo error text: $out"; fi
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

echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
