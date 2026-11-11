#!/usr/bin/env bash
# Refuses a release version lower than the one npm's `latest` already has.
#
# The release patch is the PR number of the last merge touching apps/mcp/,
# and PR numbers follow creation order, not merge order: when an older
# apps/mcp/ PR (#570) merges after a newer one (#571) was published, the
# computed 1.52.570 is lower than npm's 1.52.571. Publishing it would move
# `latest` back to older code and the deploy would pin the web to it, so the
# release fails loudly instead. The fix is any new apps/mcp/ merge: its
# higher PR number yields a version above 1.52.571 that carries both PRs.
#
# Usage: bash .github/scripts/mcp-release-not-older.sh <version> <published-latest>
# An empty <published-latest> (nothing published yet) passes.
set -euo pipefail

version="${1:-}"
published="${2:-}"
[ -n "$published" ] || exit 0

parse() {
  [[ "$1" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  printf '%s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}
version_parts="$(parse "$version")" || { echo "::error::Release version \"$version\" is not MAJOR.MINOR.PATCH." >&2; exit 1; }
published_parts="$(parse "$published")" || { echo "::error::npm latest \"$published\" is not MAJOR.MINOR.PATCH." >&2; exit 1; }
read -r v1 v2 v3 <<< "$version_parts"
read -r p1 p2 p3 <<< "$published_parts"

if [ "$v1" -lt "$p1" ] ||
  { [ "$v1" -eq "$p1" ] && [ "$v2" -lt "$p2" ]; } ||
  { [ "$v1" -eq "$p1" ] && [ "$v2" -eq "$p2" ] && [ "$v3" -lt "$p3" ]; }; then
  echo "::error::Release version ${version} is lower than npm latest ${published}: an older apps/mcp/ PR merged after a newer one was published. Merge any apps/mcp/ change to publish a version above ${published}." >&2
  exit 1
fi
