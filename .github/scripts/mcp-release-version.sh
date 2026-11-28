#!/usr/bin/env bash
# Prints the npm version of post-engineer-mcp for the checked-out commit:
#
#   MAJOR.MINOR  from the repo-root VERSION file — the same release line the
#                the web deploy version uses, so a PR that touches
#                apps/mcp/ ships web and MCP as one number
#   PATCH        the ordinal of the LAST commit touching apps/mcp/ in the
#                history main has: 1 for the first such commit, 2 for the
#                next, and so on (git rev-list --count <that sha> -- apps/mcp/)
#
# History order IS merge order, so the ordinal only grows along main. The PR
# number of the same commit does not: PRs are numbered at creation, and a
# long-lived apps/mcp/ PR merged after a newer one yields a LOWER patch than
# the version npm already serves. The not-older guard must then refuse it,
# which leaves the MCP code unpublished AND the deploy waiting for a version
# npm never gets — #655, #661 and #662 all stalled that way on 2026-11-19.
#
# e.g. 1.53.219. Nothing is committed: release-mcp.yml stamps this version
# into package.json/server.json only inside the build job (no OIDC token).
#
# The VPS deploy computes REQUIRED_MCP_VERSION for the web with the SAME rule
# (deployment repo, deploy-version.sh resolve_required_mcp_version) and
# deploys the web only once npm serves that version. If the two rules ever
# disagree, the web waits for a version this workflow never publishes —
# change both together.
#
# Needs a full-history checkout (git log/rev-list over apps/mcp/). Any failure
# exits non-zero with a ::error:: line: an unidentified release is worse than
# none.
#
# Usage: bash .github/scripts/mcp-release-version.sh [repo-root]
set -euo pipefail

cd "${1:-.}"

fail() {
  echo "::error::$1" >&2
  exit 1
}

[ -f VERSION ] || fail "The repo-root VERSION file is missing."
release_line="$(tr -d '[:space:]' < VERSION)"
if [[ ! "$release_line" =~ ^([0-9]+)\.([0-9]+)(\.[0-9]+)?$ ]]; then
  fail "VERSION \"$release_line\" is not MAJOR.MINOR."
fi
base="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"

[ "$(git rev-parse --is-shallow-repository 2>/dev/null || true)" = "false" ] ||
  fail "The checkout is shallow, so apps/mcp/ has no ordinals (use fetch-depth: 0)."

sha="$(git log -1 --format=%H -- apps/mcp/)" || fail "git log over apps/mcp/ failed."
[ -n "$sha" ] || fail "No commit touches apps/mcp/ (shallow checkout? use fetch-depth: 0)."

ordinal="$(git rev-list --count "$sha" -- apps/mcp/)" || fail "git rev-list over apps/mcp/ failed."
[[ "$ordinal" =~ ^[1-9][0-9]*$ ]] ||
  fail "Could not count the apps/mcp/ commits up to ${sha}."

printf '%s.%s\n' "$base" "$ordinal"
