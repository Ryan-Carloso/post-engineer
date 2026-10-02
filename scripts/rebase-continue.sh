#!/usr/bin/env bash
# Resolve a rebase-version-conflict and advances the rebase.
#
# Every main commit bumps VERSION, so replaying main over a branch that
# already bumped it conflicts on the five version locations and nowhere
# else. This keeps the branch's (higher) version and continues with a
# non-interactive editor, then re-verifies what the AGENTS.md rules
# require: no duplicate keys, and the JSON still parses.
set -euo pipefail

cd "$(dirname "$0")/.."

FILES=(VERSION apps/engine/pyproject.toml apps/mcp/package.json apps/web/package.json apps/engine/uv.lock)

unmerged=$(git diff --name-only --diff-filter=U)
if [ -z "$unmerged" ]; then
  GIT_EDITOR=true git rebase --continue
  exit 0
fi

# Only the version files may be auto-resolved; anything else needs a human.
unexpected=$(printf '%s\n' "$unmerged" | grep -vxF -f <(printf '%s\n' "${FILES[@]}") || true)
if [ -n "$unexpected" ]; then
  echo "CONFLITOS NAO-VERSIONADOS (precisam de decisao manual):"
  printf '  %s\n' $unexpected
  exit 1
fi

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  python3 - "$f" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
# Keep the HEAD side (ours): during a rebase HEAD is the branch being
# replayed, which already carries the higher version.
resolved = re.sub(
    r'<<<<<<< HEAD\n(.*?)=======\n.*?\n?>>>>>>> [^\n]*\n',
    lambda m: m.group(1),
    text,
    flags=re.S,
)
open(path, 'w').write(resolved)
PY
done

# A sed-style resolution can silently leave a duplicate "version" key,
# which JSON.parse tolerates by keeping the last one — so assert, do not eyeball.
for f in apps/web/package.json apps/mcp/package.json; do
  count=$(grep -c '"version"' "$f" || true)
  if [ "$count" != "1" ]; then
    echo "CHAVE 'version' DUPLICADA em $f (count=$count) — abortando"
    exit 1
  fi
done
python3 -c "import json; json.load(open('apps/web/package.json')); json.load(open('apps/mcp/package.json'))" \
  || { echo "package.json invalido apos resolver — abortando"; exit 1; }

git add -A
GIT_EDITOR=true git rebase --continue