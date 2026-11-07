#!/usr/bin/env bash
# Simulation test for the bump path in .github/workflows/release-mcp-auto.yml.
#
# Extracts the bump tail VERBATIM from the workflow file and runs it against
# scratch git remotes. Usage:
#   bash .github/scripts/test-release-mcp-auto-bump.sh [workflow-file]
# With no argument it tests the workflow file in this checkout; pass a file
# to test an older revision (e.g. the pre-fix tail from origin/main).
#
# Scenarios:
#   A: orphan bump branch exists (the 2026-11-04 case) -> reused, exit 0.
#   B: no remote bump branch -> fresh bump commit + push, exit 0.
#   C: remote bump branch with foreign content -> loud refusal, exit 1.
#   D: the OLD logic (plain push over an orphan branch) fails with
#      (fetch first)/(non-fast-forward) — proves the harness reproduces
#      the original failure.
#   E: bump + a non-version edit inside package.json -> refused, exit 1.
#   F: shallow checkout (fetch-depth: 2, like the workflow's checkout) of a
#      moved-forward main + orphan branch based on an older main tip ->
#      reused, exit 0. This is the regression test for the merge-base
#      failure: without --unshallow, merge-base has no common ancestor.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$ROOT/.github/workflows/release-mcp-auto.yml}"
SIM="$(mktemp -d /tmp/mcp-auto-bump-test.XXXXXX)"
trap 'rm -rf "$SIM"' EXIT
mkdir -p "$SIM/bin"

# --- stub gh: no open PR, pr create returns a fake URL, merge ok ---
cat > "$SIM/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/x/y/pull/999"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then exit 0; fi
echo "stub gh: unexpected call: $*" >&2; exit 1
EOF
chmod +x "$SIM/bin/gh"
export PATH="$SIM/bin:$PATH"

# --- extract the bump tail verbatim from the workflow file ---
python3 -c "
import yaml
d = yaml.safe_load(open('$WORKFLOW'))
step = d['jobs']['tag-and-release']['steps'][2]
assert step['name'] == 'Tag or auto-bump the MCP release', step['name']
s = step['run']
i = s.index('BRANCH=\"chore/mcp-auto-bump-')
open('$SIM/tail.sh', 'w').write('set -euo pipefail\n' + s[i:])
"
bash -n "$SIM/tail.sh" || { echo "FAIL: tail syntax"; exit 1; }

mk_repo() {
  local dir="$1"
  git init --bare -q "$SIM/$dir.git"
  git --git-dir="$SIM/$dir.git" symbolic-ref HEAD refs/heads/main
  git clone -q "$SIM/$dir.git" "$SIM/$dir" 2>/dev/null
  cd "$SIM/$dir" || exit 1
  git config user.name "test"
  git config user.email "test@test.local"
  git config commit.gpgsign false
  git checkout -qb main
  mkdir -p apps/mcp/src
  printf '{\n  "name": "post-engineer-mcp",\n  "version": "1.41.0"\n}\n' > apps/mcp/package.json
  printf '{\n  "name": "x",\n  "version": "1.41.0",\n  "packages": [{ "version": "1.41.0" }]\n}\n' > apps/mcp/server.json
  echo "v1" > apps/mcp/src/index.ts
  git add -A && git commit -qm "main base" && git push -q -u origin main
}

bump_files() {
  node -e "
    const fs = require('fs');
    const d = JSON.parse(fs.readFileSync('apps/mcp/package.json', 'utf8'));
    d.version = '1.42.0';
    fs.writeFileSync('apps/mcp/package.json', JSON.stringify(d, null, 2) + '\n');
    const s = JSON.parse(fs.readFileSync('apps/mcp/server.json', 'utf8'));
    s.version = '1.42.0'; s.packages[0].version = '1.42.0';
    fs.writeFileSync('apps/mcp/server.json', JSON.stringify(s, null, 2) + '\n');
  "
}

run_tail() {
  local dir="${1:-$SIM/$dir}"
  ( cd "$dir" || exit 1
    export VERSION=1.41.0 NEW_VERSION=1.42.0 NEW_TAG=mcp-v1.42.0
    bash "$SIM/tail.sh" > "$SIM/last.log" 2>&1
    echo $? > "$SIM/last.code" )
  grep -v '^Switched\|^branch ' "$SIM/last.log" | tail -n 6
  echo "exit=$(cat "$SIM/last.code")"
}

PASS=0; FAIL=0
check() { # check <label> <condition...>
  local label="$1"; shift
  if "$@"; then echo "PASS: $label"; PASS=$((PASS+1)); else echo "FAIL: $label"; FAIL=$((FAIL+1)); fi
}

# ================= Scenario A: orphan branch (2026-11-04 case) =================
mk_repo repoA
git checkout -qb chore/mcp-auto-bump-1.42.0
bump_files
git add -A && git commit -qm "chore(mcp): auto-bump to 1.42.0 for release"
ORPHAN_SHA="$(git rev-parse HEAD)"
git push -q origin chore/mcp-auto-bump-1.42.0
git checkout -q main
echo "v2" > apps/mcp/src/index.ts   # main moves forward (later merges)
git add -A && git commit -qm "feat: later MCP change" && git push -q origin main
echo "--- A: run tail with orphan branch present ---"
run_tail "$SIM/repoA"
check "A exits 0" test "$(cat "$SIM/last.code")" = "0"
check "A reuses orphan tip" test "$(git rev-parse HEAD)" = "$ORPHAN_SHA"
check "A says reusing" grep -q "already contains the 1.42.0 bump — reusing it" "$SIM/last.log"
check "A package.json is 1.42.0" test "$(node -p "require('./apps/mcp/package.json').version")" = "1.42.0"

# ================= Scenario D: OLD logic vs scenario A must fail =================
cd "$SIM/repoA" || exit 1
git checkout -q main
git fetch -q origin main
git checkout -qB chore/mcp-auto-bump-1.42.0 origin/main
bump_files
git add -A && git commit -qm "chore(mcp): auto-bump to 1.42.0 for release"
echo "--- D: old logic (plain push over orphan branch) ---"
git push origin chore/mcp-auto-bump-1.42.0 > "$SIM/d-push.log" 2>&1 || true
grep -E "rejected|error" "$SIM/d-push.log" | head -n 4
if grep -q -E "fetch first|non-fast-forward" "$SIM/d-push.log"; then
  echo "PASS: D old logic fails with rejection — harness reproduces the bug"
  PASS=$((PASS+1))
else
  echo "FAIL: D old logic did not fail as expected"; FAIL=$((FAIL+1))
fi

# ================= Scenario B: fresh, no remote branch =================
mk_repo repoB
echo "--- B: run tail with no remote branch ---"
run_tail "$SIM/repoB"
check "B exits 0" test "$(cat "$SIM/last.code")" = "0"
check "B branch exists on remote" git ls-remote --heads origin refs/heads/chore/mcp-auto-bump-1.42.0 | grep -q .
check "B commit message" test "$(git log -1 --format=%s)" = "chore(mcp): auto-bump to 1.42.0 for release"
check "B package.json is 1.42.0" test "$(node -p "require('./apps/mcp/package.json').version")" = "1.42.0"

# ================= Scenario C: foreign content on the branch =================
mk_repo repoC
git checkout -qb chore/mcp-auto-bump-1.42.0
bump_files
echo "foreign" > apps/mcp/src/index.ts
git add -A && git commit -qm "chore(mcp): auto-bump to 1.42.0 for release"
FOREIGN_SHA="$(git rev-parse HEAD)"
git push -q origin chore/mcp-auto-bump-1.42.0
git checkout -q main
echo "--- C: run tail with foreign-content branch ---"
run_tail "$SIM/repoC"
check "C exits 1" test "$(cat "$SIM/last.code")" = "1"
check "C refuses loudly" grep -q "refusing to overwrite it" "$SIM/last.log"
check "C remote tip untouched" test "$(git ls-remote origin refs/heads/chore/mcp-auto-bump-1.42.0 | awk '{print $1}')" = "$FOREIGN_SHA"

# ================= Scenario E: bump + non-version edit in package.json =================
mk_repo repoE
git checkout -qb chore/mcp-auto-bump-1.42.0
bump_files
node -e "
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('apps/mcp/package.json', 'utf8'));
  d.description = 'tampered';
  fs.writeFileSync('apps/mcp/package.json', JSON.stringify(d, null, 2) + '\n');
"
git add -A && git commit -qm "chore(mcp): auto-bump to 1.42.0 for release"
TAMPERED_SHA="$(git rev-parse HEAD)"
git push -q origin chore/mcp-auto-bump-1.42.0
git checkout -q main
echo "--- E: run tail with bump + description change ---"
run_tail "$SIM/repoE"
check "E exits 1" test "$(cat "$SIM/last.code")" = "1"
check "E refuses loudly" grep -q "refusing to overwrite it" "$SIM/last.log"
check "E remote tip untouched" test "$(git ls-remote origin refs/heads/chore/mcp-auto-bump-1.42.0 | awk '{print $1}')" = "$TAMPERED_SHA"

# ================= Scenario F: shallow checkout, orphan from older main =================
mk_repo repoF
git checkout -qb chore/mcp-auto-bump-1.42.0
bump_files
git add -A && git commit -qm "chore(mcp): auto-bump to 1.42.0 for release"
F_ORPHAN_SHA="$(git rev-parse HEAD)"
git push -q origin chore/mcp-auto-bump-1.42.0
git checkout -q main
echo "later1" > f1 && git add -A && git commit -qm "later 1"
echo "later2" > f2 && git add -A && git commit -qm "later 2"
echo "later3" > f3 && git add -A && git commit -qm "later 3" && git push -q origin main
git clone -q --depth 2 --branch main "file://$SIM/repoF.git" "$SIM/repoF-shallow" 2>/dev/null
cd "$SIM/repoF-shallow" || exit 1
git config user.name "test"
git config user.email "test@test.local"
git config commit.gpgsign false
echo "--- F: run tail in a depth-2 shallow clone ---"
echo "shallow=$(git rev-parse --is-shallow-repository)"
run_tail "$SIM/repoF-shallow"
check "F exits 0" test "$(cat "$SIM/last.code")" = "0"
check "F reuses orphan tip" test "$(git rev-parse HEAD)" = "$F_ORPHAN_SHA"
check "F says reusing" grep -q "already contains the 1.42.0 bump — reusing it" "$SIM/last.log"

echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
