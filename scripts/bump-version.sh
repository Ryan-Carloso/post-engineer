#!/usr/bin/env bash
# Bump the platform version everywhere at once.
#
# The repo-root VERSION file is the single source of truth; these locations
# must always agree with it (the MCP advertises its package.json version in
# the protocol handshake, so it stays in sync too; uv.lock records the
# engine project version and is patched the same way):
#   VERSION
#   package.json (repo root)
#   apps/mcp/package.json
#   apps/web/package.json
#   apps/engine/pyproject.toml
#   apps/engine/uv.lock
#
# Usage:
#   scripts/bump-version.sh [patch|minor|major|<x.y.z>]  Bump all locations (explicit kind required)
#   scripts/bump-version.sh check                        Verify all locations agree
#
# CI runs `check` on every PR plus a "VERSION changed in this PR" gate, so no
# agent (human or AI) can forget the bump or leave locations diverged.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCATIONS=(VERSION package.json apps/mcp/package.json apps/web/package.json apps/engine/pyproject.toml apps/engine/uv.lock)

version_of() {
  case "$1" in
    VERSION)
      tr -d '[:space:]' < VERSION
      ;;
    package.json | apps/mcp/package.json | apps/web/package.json)
      python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$1"
      ;;
    apps/engine/pyproject.toml)
      python3 -c "
import re, sys
m = re.search(r'^version\s*=\s*\"([^\"]+)\"', open(sys.argv[1]).read(), re.M)
sys.exit(1) if not m else print(m.group(1))
" "$1"
      ;;
    apps/engine/uv.lock)
      python3 -c "
import re, sys
text = open(sys.argv[1]).read()
m = re.search(r'\[\[package\]\]\nname = \"moneyprinterturbo\"\nversion = \"([^\"]+)\"', text)
sys.exit(1) if not m else print(m.group(1))
" "$1"
      ;;
  esac
}

set_version_in() {
  local file="$1" new="$2"
  case "$file" in
    VERSION)
      printf '%s\n' "$new" > VERSION
      ;;
    apps/mcp/package.json | apps/web/package.json | package.json)
      python3 -c "
import json, re, sys
path, new = sys.argv[1], sys.argv[2]
text = open(path).read()
text2, n = re.subn(r'^(\s*\"version\"\s*:\s*\")[^\"]+(\")', lambda m: m.group(1) + new + m.group(2), text, count=1, flags=re.M)
assert n == 1, 'version field not found'
open(path, 'w').write(text2)
" "$file" "$new"
      ;;
    apps/engine/pyproject.toml)
      python3 -c "
import re, sys
path, new = sys.argv[1], sys.argv[2]
text = open(path).read()
text2, n = re.subn(r'^(version\s*=\s*\")[^\"]+(\")', lambda m: m.group(1) + new + m.group(2), text, count=1, flags=re.M)
assert n == 1, 'version field not found'
open(path, 'w').write(text2)
" "$file" "$new"
      ;;
    apps/engine/uv.lock)
      # Patch only the root-package stanza (other packages have their own
      # versions that must not be touched).
      python3 -c "
import re, sys
path, new = sys.argv[1], sys.argv[2]
text = open(path).read()
pat = r'(\[\[package\]\]\nname = \"moneyprinterturbo\"\nversion = \")[^\"]+(\")'
text2, n = re.subn(pat, lambda m: m.group(1) + new + m.group(2), text, count=1)
assert n == 1, 'moneyprinterturbo stanza not found'
open(path, 'w').write(text2)
" "$file" "$new"
      ;;
  esac
}

cmd_check() {
  local expected="" v loc failed=0
  for loc in "${LOCATIONS[@]}"; do
    v="$(version_of "$loc")"
    if [[ -z "$expected" ]]; then
      expected="$v"
    elif [[ "$v" != "$expected" ]]; then
      echo "MISMATCH: $loc is $v, expected $expected" >&2
      failed=1
    fi
  done
  if [[ "$failed" -eq 1 ]]; then
    echo "Run 'scripts/bump-version.sh [patch|minor|major]' to fix." >&2
    return 1
  fi
  echo "All version locations agree on $expected."
}

bump_semver() {
  local current="$1" kind="$2"
  if [[ "$kind" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' "$kind"
    return
  fi
  local major minor patch
  IFS=. read -r major minor patch <<< "$current"
  if ! [[ "$major$minor$patch" =~ ^[0-9]+$ ]]; then
    echo "Current version '$current' is not semver; pass an explicit <x.y.z>." >&2
    return 1
  fi
  case "$kind" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
    *)
      echo "Unknown bump kind '$kind'. Use patch|minor|major|<x.y.z>." >&2
      return 1
      ;;
  esac
  printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

cmd_bump() {
  local kind="${1:?Usage: scripts/bump-version.sh [patch|minor|major|<x.y.z>|check]}"
  local current new loc
  current="$(version_of VERSION)"
  new="$(bump_semver "$current" "$kind")"
  # Always rewrite every location (idempotent): an explicit version equal
  # to the current one still repairs diverged locations.
  for loc in "${LOCATIONS[@]}"; do
    set_version_in "$loc" "$new"
  done
  cmd_check
}

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

case "${1:-}" in
  check) cmd_check ;;
  patch | minor | major | [0-9]*.[0-9]*.[0-9]*) cmd_bump "$1" ;;
  *) usage ;;
esac
