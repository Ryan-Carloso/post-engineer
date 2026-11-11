#!/usr/bin/env bash
# Prints the npm version of post-engineer-mcp for the checked-out commit:
#
#   MAJOR.MINOR  from the repo-root VERSION file — the same release line the
#                web and engine deploy versions use, so a PR that touches
#                apps/mcp/ ships web, engine and MCP as one number
#   PATCH        the number of the merged PR that introduced the LAST commit
#                touching apps/mcp/ (resolved through the GitHub API for that
#                exact commit, never "the latest PR")
#
# e.g. 1.52.560. Nothing is committed: release-mcp.yml stamps this version
# into package.json/server.json only inside the publish job.
#
# The VPS deploy computes REQUIRED_MCP_VERSION for the web with the SAME
# rule (deployment repo, deploy-version.sh resolve_required_mcp_version) and
# deploys the web only once npm serves that version. If the two rules ever
# disagree, the web waits for a version this workflow never publishes —
# change both together.
#
# Needs a full-history checkout (git log over apps/mcp/), gh authenticated
# through GH_TOKEN, and GITHUB_REPOSITORY (owner/name). Any failure exits
# non-zero with a ::error:: line: an unidentified release is worse than none.
#
# Usage: bash .github/scripts/mcp-release-version.sh [repo-root]
set -euo pipefail

cd "${1:-.}"

fail() {
  echo "::error::$1" >&2
  exit 1
}

[ -n "${GITHUB_REPOSITORY:-}" ] || fail "GITHUB_REPOSITORY is not set (expected owner/name)."

[ -f VERSION ] || fail "The repo-root VERSION file is missing."
release_line="$(tr -d '[:space:]' < VERSION)"
if [[ ! "$release_line" =~ ^([0-9]+)\.([0-9]+)(\.[0-9]+)?$ ]]; then
  fail "VERSION \"$release_line\" is not MAJOR.MINOR."
fi
base="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"

sha="$(git log -1 --format=%H -- apps/mcp/)" || fail "git log over apps/mcp/ failed."
[ -n "$sha" ] || fail "No commit touches apps/mcp/ (shallow checkout? use fetch-depth: 0)."

pr="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${sha}/pulls" \
  --jq '[.[] | select(.merged_at != null)][0].number // empty')" ||
  fail "GitHub API lookup of the PR for ${sha} failed."
[[ "$pr" =~ ^[0-9]+$ ]] || fail "Commit ${sha} has no merged PR, so it has no release version."

printf '%s.%s\n' "$base" "$pr"
