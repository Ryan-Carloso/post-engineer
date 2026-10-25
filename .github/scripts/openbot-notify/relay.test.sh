#!/bin/bash
#---------------
# Regression tests for the relay_decision logic in
# .github/workflows/openbot-notify.yml.
#
# The decision function below mirrors the workflow's relay_decision
# (sync guards pin the reference lines stay in the yml); the `gh api`
# call is stubbed with JSON docs served from a state file, one per call,
# and the STUB also serves the same --jq expression the yml carries
# (sync-pinned), so the real summarize filter executes against sample JSON.
#
# Cases: the first failure-family conclusion per head SHA sends; later
# failures of the same SHA skip; success/skipped send only when no
# relayed run is pending AND every latest relayed run is success/skipped
# (one green wake, including after a rerun that fixed an earlier
# failure); the 60s retry observes a completion; a transient API failure
# and a --jq failure both fail OPEN (send) with the ::warning:: visible;
# unknown conclusion/event skips; pull_request events send without
# querying. The single-source guard asserts the trigger block's
# workflows list matches the RELAYED_WORKFLOWS env line.
#
# Runs standalone: bash .github/scripts/openbot-notify/relay.test.sh
#---------------
set -euo pipefail
cd "$(dirname "$0")/../../.."

fail=0
YML=.github/workflows/openbot-notify.yml

# --- Sync guard: reference lines must exist verbatim in the workflow. ------
sync_line() { grep -qF -- "$1" "$YML" || { echo "SYNC FAIL: not found in $YML: $1"; fail=1; }; }
sync_line 'failure|timed_out|cancelled|action_required|startup_failure) kind=failure ;;'
sync_line 'success|skipped) kind=success ;;'
sync_line 'sleep 60'
sync_line 'if [ "${other_failed:-0}" -gt 0 ]; then echo skip; else echo send; fi'
sync_line 'if [ "${pending:-0}" -gt 0 ] || [ "${all_ok:-0}" -eq 0 ]; then echo skip; else echo send; fi'

# --- The counting expression: ONE source with the yml. ----------------------
# Counting stays inside `gh api ... --jq` (no indented python). The sync
# guard fails if the filter ever diverges from the yml.
JQ_FILTER='[.workflow_runs[] | select(.name as $n | ($ENV.RELAYED_WORKFLOWS | split(",") | index($n)))] as $runs | ($runs | group_by(.name) | map(max_by([.id, (.run_attempt // 0)]))) as $latest | ($runs | map(select((.id | tostring) != ($ENV.WORKFLOW_RUN_ID // ""))) | group_by(.name) | map(max_by([.id, (.run_attempt // 0)]))) as $other | [($latest | map(select(.status=="queued" or .status=="in_progress")) | length), (if ($other | map(select(.conclusion=="failure" or .conclusion=="timed_out" or .conclusion=="cancelled" or .conclusion=="action_required" or .conclusion=="startup_failure")) | length) > 0 then 1 else 0 end), (if (($latest | map(select(.status=="queued" or .status=="in_progress")) | length) == 0 and ($latest | all(.conclusion=="success" or .conclusion=="skipped"))) then 1 else 0 end)] | join(" ")'
sync_line "--jq \"\$JQ_FILTER\""
[ "$(command -v jq)" ] || { echo "FAIL: jq not installed"; fail=1; }
PENDING_DOC='{"workflow_runs": [{"name": "CI", "status": "in_progress", "id": 1, "run_attempt": 1}]}'
EMPTY_DOC='{"workflow_runs": []}'
FIRST_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
SECOND_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
RERUN_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 10, "run_attempt": 1}, {"name": "CI", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
ALL_GREEN_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "success", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
GREEN_WITH_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
FIXED_GREEN_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "CI", "status": "completed", "conclusion": "success", "id": 99, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
export RELAYED_WORKFLOWS='CI,mutation,opencode-review,file-size,api-naming,parity-exclusion-guard,CodeQL Advanced,Deploy,Release MCP (auto)'
export WORKFLOW_RUN_ID=42
count() { # count <workflows> <json> -> "pending other_failed all_ok"
  # gh api --jq prints strings raw; jq -r matches that contract.
  printf '%s' "$2" | RELAYED_WORKFLOWS="$1" WORKFLOW_RUN_ID="$WORKFLOW_RUN_ID" jq -r "$JQ_FILTER"
}
[ "$(count 'CI,mutation' "$PENDING_DOC")" = "1 0 0" ] || { echo "FAIL [jq pending]"; fail=1; }
[ "$(count 'CI,mutation' "$EMPTY_DOC")" = "0 0 1" ] || { echo "FAIL [jq empty all_ok]"; fail=1; }
[ "$(count 'CI,mutation' "$FIRST_FAIL_DOC")" = "0 0 0" ] || { echo "FAIL [jq first fail: exclude current, not all_ok]"; fail=1; }
[ "$(count 'CI,mutation' "$SECOND_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq second fail: other_failed]"; fail=1; }
[ "$(count 'CI,mutation' "$RERUN_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq rerun fail uses previous latest]"; fail=1; }
[ "$(count 'CI,mutation' "$ALL_GREEN_DOC")" = "0 0 1" ] || { echo "FAIL [jq all green]"; fail=1; }
[ "$(count 'CI,mutation' "$GREEN_WITH_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq green with leftover fail]"; fail=1; }
[ "$(count 'CI,mutation' "$FIXED_GREEN_DOC")" = "0 0 1" ] || { echo "FAIL [jq latest success after rerun]"; fail=1; }
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
# Mirror of the workflow's relay_decision: gh api -> --jq with the SAME
# filter, fail OPEN (send) on query or count failure with ::warning::.
relay_decision() {
  case "$1" in
    pull_request) echo send; return ;;
    workflow_run) ;;
    *) echo skip; return ;;
  esac
  case "$2" in
    failure|timed_out|cancelled|action_required|startup_failure) kind=failure ;;
    success|skipped) kind=success ;;
    *) echo skip; return ;;
  esac
  summarize_runs() {
    gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" --jq "$JQ_FILTER"
  }
  summary=$(summarize_runs) || {
    echo '::warning::last-finisher pending query failed (gh api/--jq); failing OPEN' >&2
    summary="0 0 1"
  }
  read pending other_failed all_ok <<< "$summary"
  if [ "$kind" = "success" ] && [ "${pending:-0}" -gt 0 ]; then
    sleep 60
    summary=$(summarize_runs) || {
      echo '::warning::last-finisher pending retry query failed (gh api/--jq); failing OPEN' >&2
      summary="0 0 1"
    }
    read pending other_failed all_ok <<< "$summary"
  fi
  if [ "$kind" = "failure" ]; then
    if [ "${other_failed:-0}" -gt 0 ]; then echo skip; else echo send; fi
    return
  fi
  if [ "${pending:-0}" -gt 0 ] || [ "${all_ok:-0}" -eq 0 ]; then echo skip; else echo send; fi
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
    GARBAGE) printf 'not-json\n' | jq -r "$jq_filter" ;;
    *) printf '%s' "$line" | RELAYED_WORKFLOWS="$RELAYED_WORKFLOWS" WORKFLOW_RUN_ID="$WORKFLOW_RUN_ID" jq -r "$jq_filter" ;;
  esac
}
unlisted_doc='{"workflow_runs": [{"name": "release-mcp", "status": "in_progress", "id": 2, "run_attempt": 1}]}'

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

# First failure-family: query consulted; no other failed latest -> send.
# FAIL docs fail OPEN (send) — 2 events ok, 0 not.
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run failure 42 2>/dev/null)" "failure query-fail sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 42 2>/dev/null)" "first failure sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run timed_out 42 2>/dev/null)" "first timed_out sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run cancelled 42 2>/dev/null)" "first cancelled sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run action_required 42 2>/dev/null)" "first action_required sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run startup_failure 42 2>/dev/null)" "first startup_failure sends"
# Later failure of the same SHA: another workflow already failed -> skip.
printf '%s\n' "$SECOND_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run failure 42 2>/dev/null)" "second workflow failure skips"
# Same workflow rerun still failed: previous latest of this name failed -> skip.
printf '%s\n' "$RERUN_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run failure 42 2>/dev/null)" "rerun failure skips"
# success with a relayed run pending: both queries see 1 -> skip.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 42 2>/dev/null)" "success with pending skips"
# success as the last finisher, all latest green -> send.
printf '%s\n' "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "success last sends"
# leftover failure on another workflow: skip the green wake.
printf '%s\n' "$GREEN_WITH_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 42 2>/dev/null)" "success with leftover failure skips"
# After a rerun fixed CI, latest per name are all success -> send.
printf '%s\n' "$FIXED_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "success after rerun sends"
# skipped conclusion follows the same all-green rule.
printf '%s\n' "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run skipped 42 2>/dev/null)" "skipped last sends"
# A run that completes during the 60s retry: 1 then all-green -> send.
printf '%s\n%s\n' "$PENDING_DOC" "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "retry sees completion"
# Unlisted workflows do not gate the send: only release-mcp pending -> send.
printf '%s\n' "$unlisted_doc" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "unlisted run does not gate"
# A transient API failure fails OPEN: empty stdout -> warning -> send.
printf 'FAIL\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "query failure fails open"
# An HTTP 200 body the filter cannot parse also fails OPEN.
printf 'GARBAGE\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42 2>/dev/null)" "unparseable body fails open"
# Unknown conclusion and unknown event never relay.
printf '%s\n' "$EMPTY_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run neutral 42 2>/dev/null)" "neutral conclusion skips"
expect skip "$(relay_decision cron success 42 2>/dev/null)" "unknown event skips"
# pull_request events send without consulting the stub: the state file
# keeps both docs, proving no query ran.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect send "$(relay_decision pull_request synchronize 42 2>/dev/null)" "pull_request sends"
[ "$(head -c1 "$STATE")" = "{" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
