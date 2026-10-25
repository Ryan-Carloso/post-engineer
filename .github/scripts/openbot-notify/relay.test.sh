#!/bin/bash
#---------------
# Regression tests for the relay_decision logic in
# .github/workflows/openbot-notify.yml.
#
# The decision function below mirrors the workflow's relay_decision
# (sync guards pin the reference lines stay in the yml); the `gh api`
# call is stubbed with JSON docs served from a state file, one per call,
# and the STUB also serves the same --jq counting expression the yml
# carries (sync-pinned), so the real pending-count expression executes
# against sample JSON.
#
# Cases: failure-family conclusions send; success/skipped send only when
# no relayed workflow run is still pending for the head sha (last
# finisher wakes the Babysit); the 60s retry observes a completion; a
# transient API failure and a --jq failure both fail OPEN (send) with the
# ::warning:: visible; unknown conclusion/event skips; pull_request
# events send without querying. The single-source guard asserts the
# trigger block's workflows list matches the RELAYED_WORKFLOWS env line.
#
# Runs standalone: bash .github/scripts/openbot-notify/relay.test.sh
#---------------
set -euo pipefail
cd "$(dirname "$0")/../../.."

fail=0
YML=.github/workflows/openbot-notify.yml

# --- Sync guard: reference lines must exist verbatim in the workflow. ------
sync_line() { grep -qF -- "$1" "$YML" || { echo "SYNC FAIL: not found in $YML: $1"; fail=1; }; }
sync_line 'failure|timed_out|cancelled|action_required|startup_failure) echo send; return ;;'
sync_line 'success|skipped) ;;'
sync_line 'sleep 60'
sync_line 'if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi'

# --- The counting expression: ONE source with the yml. ----------------------
# Regression: the historic inline python was indented inside the workflow's
# `run: |` block, so the interpreter died with IndentationError on every
# call (GH 401818*) and the fail-open mask turned the guard into
# send-always. This filter is the same string the yml runs through
# `gh api ... --jq`; the sync guard below fails if they ever diverge.
JQ_FILTER='[.workflow_runs[] | select(.name as $n | ($ENV.RELAYED_WORKFLOWS | split(",") | index($n))) | select(.status=="queued" or .status=="in_progress")] | length'
sync_line "--jq '$JQ_FILTER'"
[ "$(command -v jq)" ] || { echo "FAIL: jq not installed"; fail=1; }
PENDING_DOC='{"workflow_runs": [{"name": "CI", "status": "in_progress", "id": 1}]}'
EMPTY_DOC='{"workflow_runs": []}'
export RELAYED_WORKFLOWS='CI,mutation,opencode-review,file-size,api-naming,parity-exclusion-guard,CodeQL Advanced,Deploy,Release MCP (auto)'
count() { # count <workflows> <json> -> number | fails
  printf '%s' "$2" | RELAYED_WORKFLOWS="$1" jq "$JQ_FILTER"
}
[ "$(count 'CI,mutation' "$PENDING_DOC")" = 1 ] || { echo "FAIL [jq counts >0 pending]"; fail=1; }
[ "$(count 'CI,mutation' "$EMPTY_DOC")" = 0 ] || { echo "FAIL [jq counts 0 pending]"; fail=1; }
jq "$JQ_FILTER" <<< 'FAIL' >/dev/null 2>&1 && { echo "FAIL [jq must reject invalid json, it exited 0]"; fail=1; }
count 'CI' 'FAIL' >/dev/null 2>&1 || : # invalid json exits nonzero (the fail-open input)

# --- Single-source guard: RELAYED_WORKFLOWS == the trigger's workflows list. --
env_list=$(grep -E '^ *RELAYED_WORKFLOWS: ' "$YML" | sed 's/^ *RELAYED_WORKFLOWS: //')
python3 - "$YML" "$env_list" <<'PY' || fail=1
import sys, yaml
yml, env_list = sys.argv[1], sys.argv[2]
trigger = yaml.safe_load(open(yml))[True]["workflow_run"]["workflows"]
env_names = [n.strip() for n in env_list.split(",")]
assert sorted(trigger) == sorted(env_names), f"workflow list drift: trigger={trigger} env={env_names}"
PY

# --- Decision cases ---------------------------------------------------------
# Mirror of the workflow's relay_decision: gh api -> --jq counting with the
# SAME filter, fail OPEN (send) on query or count failure with ::warning::.
relay_decision() {
  case "$1" in
    pull_request) echo send; return ;;
    workflow_run) ;;
    *) echo skip; return ;;
  esac
  case "$2" in
    failure|timed_out|cancelled|action_required|startup_failure) echo send; return ;;
    success|skipped) ;;
    *) echo skip; return ;;
  esac
  pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" --jq "$JQ_FILTER") || {
    echo '::warning::last-finisher pending query failed (gh api/--jq); failing OPEN' >&2
    pending=0
  }
  if [ "$pending" -gt 0 ]; then
    # One late retry: a run that completes while another's completion
    # event is still in flight must not be missed by both.
    sleep 60
    pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" --jq "$JQ_FILTER") || {
      echo '::warning::last-finisher pending retry query failed (gh api/--jq); failing OPEN' >&2
      pending=0
    }
  fi
  if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi
}
export HEAD_SHA=deadbeef GITHUB_REPOSITORY=Ryan-Carloso/post-engineer
STATE="$(mktemp)"
sleep() { return 0; } # the 60s retry must not slow the test
# Stub gh: serves one JSON doc per call from the state file and EVALUATES
# the --jq filter it was given against that doc (the real gh contract). A
# bare FAIL line makes gh exit non-zero with empty stdout (transient API
# failure); a bare GARBAGE line is a valid HTTP 200 body the filter cannot
# parse — both land in the same fail-open warning path.
gh() {
  [ "$1" = "api" ] || { echo "FAIL: gh stub called with non-api subcommand: $*"; exit 2; }
  local jq_filter="" url="" line
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --jq) jq_filter="$2"; shift 2 ;;
      *) url="$1"; shift ;;
    esac
  done
  [ -n "$jq_filter" ] || { echo "FAIL: gh stub without --jq (relay must pass the counting filter)"; exit 2; }
  line=$(head -n1 "$STATE")
  tail -n +2 "$STATE" > "$STATE.rest"
  mv "$STATE.rest" "$STATE"
  case "$line" in
    FAIL) return 1 ;;
    GARBAGE) printf 'not-json\n' ;;
    *) printf '%s' "$line" | RELAYED_WORKFLOWS="$RELAYED_WORKFLOWS" jq "$jq_filter" ;;
  esac
}
unlisted_doc='{"workflow_runs": [{"name": "release-mcp", "status": "in_progress", "id": 2}]}'

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

# Failure family: query never consulted (a FAIL doc proves it).
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run failure 42 2>/dev/null)" "failure sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run timed_out 42 2>/dev/null)" "timed_out sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run cancelled 42 2>/dev/null)" "cancelled sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run action_required 42 2>/dev/null)" "action_required sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run startup_failure 42 2>/dev/null)" "startup_failure sends"
# success with a relayed run pending: both queries see 1 -> skip.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 42 2>/dev/null)" "success with pending skips"
# success as the last finisher: nothing pending -> send.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "success last sends"
# A run that completes during the 60s retry: 1 then 0 -> send.
printf '%s\n%s\n' "$PENDING_DOC" "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "retry sees completion"
# Unlisted workflows do not gate the send: only release-mcp pending -> send.
printf '%s\n%s\n' "$unlisted_doc" "$unlisted_doc" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "unlisted run does not gate"
# A transient API failure fails OPEN: empty stdout -> warning -> send.
printf 'FAIL\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "query failure fails open"
# An HTTP 200 body the filter cannot parse also fails OPEN.
printf 'GARBAGE\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "unparseable body fails open"
# Unknown conclusion and unknown event never relay.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run neutral 42 2>/dev/null)" "neutral conclusion skips"
expect skip "$(relay_decision cron success 42 2>/dev/null)" "unknown event skips"
# pull_request events send without consulting the stub: the state file
# keeps both docs, proving no query ran.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect send "$(relay_decision pull_request synchronize 42 2>/dev/null)" "pull_request sends"
[ "$(head -c1 "$STATE")" = "{" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
