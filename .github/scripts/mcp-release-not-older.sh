#!/usr/bin/env bash
# Refuses a release version lower than the one npm's `latest` already has.
#
# The release patch is the ordinal of the last commit touching apps/mcp/ in
# main's history (mcp-release-version.sh), so it only grows: an out-of-order
# merge cannot produce a lower version any more. This guard now protects the
# one remaining way to go backwards — VERSION edited to an older release line,
# or main's apps/mcp/ history rewritten — and the deploy pins the web to the
# version this workflow publishes, so a lower release must fail loudly instead
# of waiting for a version that will never exist. The fix is a new release
# line in VERSION (MAJOR.MINOR), which beats the published patch by design.
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
  echo "::error::Release version ${version} is lower than npm latest ${published}: the release line in VERSION is behind the one already published, or main's apps/mcp/ history was rewritten. Cut a new release line in VERSION (MAJOR.MINOR) to publish above ${published}." >&2
  exit 1
fi
