#!/bin/bash
#---------------
# Regression tests for the relay_decision logic in
# .github/workflows/openbot-notify.yml.
#
# The decision function below mirrors the workflow's relay_decision
# (sync guards pin the reference lines stay in the yml); the `gh api`
# call is stubbed with JSON docs served from a state file, one per call,
# and the STUB evaluates the JQ_FILTER extracted from the yml (one
# source — a drift fails this test).
#
# Cases: exactly one PR-CI failure wake per head SHA (lowest-id real
# failure; concurrent finishers; cancelled does not suppress); later
# failures skip; run_attempt>1 skips; scheduled test-flight pool is
# separate; success/skipped send only when the pool has no pending and
# every latest is success/skipped; 60s retry; query/--jq fail OPEN;
# pull_request sends without querying. Trigger workflows == RELAYED_WORKFLOWS.
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
sync_line 'if [ "${WORKFLOW_RUN_ATTEMPT:-1}" -gt 1 ]; then echo skip; return; fi'
sync_line 'if [ "${is_winner:-0}" -eq 1 ]; then echo send; else echo skip; fi'
sync_line 'if [ "${pending:-0}" -gt 0 ] || [ "${all_ok:-0}" -eq 0 ]; then echo skip; else echo send; fi'

# --- The counting expression: extracted from the yml (one source). ---------
JQ_FILTER=$(sed -n "s/^[[:space:]]*JQ_FILTER='\\(.*\\)'$/\\1/p" "$YML" | head -n1)
[ -n "$JQ_FILTER" ] || { echo "FAIL: could not extract JQ_FILTER from $YML"; fail=1; }
sync_line "--jq \"\$JQ_FILTER\""
grep -qF "JQ_FILTER='$JQ_FILTER'" "$YML" || { echo "FAIL: extracted JQ_FILTER does not appear in $YML"; fail=1; }
[ "$(command -v jq)" ] || { echo "FAIL: jq not installed"; fail=1; }

PENDING_DOC='{"workflow_runs": [{"name": "CI", "status": "in_progress", "id": 1, "run_attempt": 1}]}'
EMPTY_DOC='{"workflow_runs": []}'
FIRST_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
SECOND_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
CONCURRENT_FAIL_DOC="$SECOND_FAIL_DOC"
RERUN_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 2}]}'
CANCEL_AND_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "cancelled", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
ALL_GREEN_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "success", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
GREEN_WITH_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
FIXED_GREEN_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 1, "run_attempt": 1}, {"name": "CI", "status": "completed", "conclusion": "success", "id": 99, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}]}'
FLIGHT_PENDING_GREEN_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "success", "id": 1, "run_attempt": 1}, {"name": "mutation", "status": "completed", "conclusion": "success", "id": 42, "run_attempt": 1}, {"name": "test-flight", "status": "in_progress", "id": 99, "run_attempt": 1}]}'
MIXED_POOL_FAIL_DOC='{"workflow_runs": [{"name": "CI", "status": "completed", "conclusion": "failure", "id": 10, "run_attempt": 1}, {"name": "test-flight", "status": "completed", "conclusion": "failure", "id": 42, "run_attempt": 1}]}'
export RELAYED_WORKFLOWS='CI,mutation,opencode-review,file-size,api-naming,parity-exclusion-guard,CodeQL Advanced,Deploy,Release MCP (auto),test-flight-faceless,test-flight'
export SCHEDULED_RELAYED_WORKFLOWS='test-flight-faceless,test-flight'
export WORKFLOW_RUN_ID=42
export WORKFLOW_RUN_ATTEMPT=1
export WORKFLOW_NAME=mutation
export CONCLUSION=success
count() { # count <workflows> <json> -> "pending is_winner all_ok"
  printf '%s' "$2" | RELAYED_WORKFLOWS="$1" SCHEDULED_RELAYED_WORKFLOWS="$SCHEDULED_RELAYED_WORKFLOWS" \
    WORKFLOW_RUN_ID="$WORKFLOW_RUN_ID" WORKFLOW_RUN_ATTEMPT="$WORKFLOW_RUN_ATTEMPT" \
    WORKFLOW_NAME="$WORKFLOW_NAME" CONCLUSION="$CONCLUSION" jq -r "$JQ_FILTER"
}
[ "$(count 'CI,mutation' "$PENDING_DOC")" = "1 1 0" ] || { echo "FAIL [jq pending] got $(count 'CI,mutation' "$PENDING_DOC")"; fail=1; }
# Empty pool is intentional fail-open send (all() on [] is true; jq min on [] is null, not a throw).
[ "$(count 'CI,mutation' "$EMPTY_DOC")" = "0 1 1" ] || { echo "FAIL [jq empty all_ok] got $(count 'CI,mutation' "$EMPTY_DOC")"; fail=1; }
WORKFLOW_NAME=CI
CONCLUSION=failure
[ "$(count 'CI,mutation' "$FIRST_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq first fail winner] got $(count 'CI,mutation' "$FIRST_FAIL_DOC")"; fail=1; }
[ "$(count 'CI,mutation' "$SECOND_FAIL_DOC")" = "0 0 0" ] || { echo "FAIL [jq higher-id concurrent fail] got $(count 'CI,mutation' "$SECOND_FAIL_DOC")"; fail=1; }
WORKFLOW_RUN_ID=1
[ "$(count 'CI,mutation' "$CONCURRENT_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq lower-id concurrent fail] got $(count 'CI,mutation' "$CONCURRENT_FAIL_DOC")"; fail=1; }
WORKFLOW_RUN_ID=42
WORKFLOW_NAME=mutation
[ "$(count 'CI,mutation' "$CANCEL_AND_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq cancelled does not win] got $(count 'CI,mutation' "$CANCEL_AND_FAIL_DOC")"; fail=1; }
WORKFLOW_NAME=CI
CONCLUSION=success
[ "$(count 'CI,mutation' "$ALL_GREEN_DOC")" = "0 1 1" ] || { echo "FAIL [jq all green] got $(count 'CI,mutation' "$ALL_GREEN_DOC")"; fail=1; }
[ "$(count 'CI,mutation' "$GREEN_WITH_FAIL_DOC")" = "0 0 0" ] || { echo "FAIL [jq green with leftover fail] got $(count 'CI,mutation' "$GREEN_WITH_FAIL_DOC")"; fail=1; }
WORKFLOW_RUN_ID=99
[ "$(count 'CI,mutation' "$FIXED_GREEN_DOC")" = "0 1 1" ] || { echo "FAIL [jq latest success after new run] got $(count 'CI,mutation' "$FIXED_GREEN_DOC")"; fail=1; }
WORKFLOW_RUN_ID=42
[ "$(count "$RELAYED_WORKFLOWS" "$FLIGHT_PENDING_GREEN_DOC")" = "0 1 1" ] || { echo "FAIL [jq scheduled pending does not gate PR] got $(count "$RELAYED_WORKFLOWS" "$FLIGHT_PENDING_GREEN_DOC")"; fail=1; }
CONCLUSION=failure
WORKFLOW_NAME=CI
WORKFLOW_RUN_ID=10
[ "$(count "$RELAYED_WORKFLOWS" "$MIXED_POOL_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq PR fail ignores scheduled fail] got $(count "$RELAYED_WORKFLOWS" "$MIXED_POOL_FAIL_DOC")"; fail=1; }
WORKFLOW_NAME=test-flight
WORKFLOW_RUN_ID=42
[ "$(count "$RELAYED_WORKFLOWS" "$MIXED_POOL_FAIL_DOC")" = "0 1 0" ] || { echo "FAIL [jq scheduled fail ignores PR fail] got $(count "$RELAYED_WORKFLOWS" "$MIXED_POOL_FAIL_DOC")"; fail=1; }
WORKFLOW_NAME=CI
jq "$JQ_FILTER" <<< 'FAIL' >/dev/null 2>&1 && { echo "FAIL [jq must reject invalid json, it exited 0]"; fail=1; }
count 'CI' 'FAIL' >/dev/null 2>&1 || : # invalid json exits nonzero (the fail-open input)

# --- Single-source guard: RELAYED_WORKFLOWS == the trigger's workflows list. --
env_list=$(grep -E '^ *RELAYED_WORKFLOWS: ' "$YML" | sed 's/^ *RELAYED_WORKFLOWS: //')
sched_list=$(grep -E '^ *SCHEDULED_RELAYED_WORKFLOWS: ' "$YML" | sed 's/^ *SCHEDULED_RELAYED_WORKFLOWS: //')
python3 - "$YML" "$env_list" "$sched_list" <<'PY' || fail=1
import sys, yaml
yml, env_list, sched_list = sys.argv[1], sys.argv[2], sys.argv[3]
trigger = yaml.safe_load(open(yml))[True]["workflow_run"]["workflows"]
env_names = [n.strip() for n in env_list.split(",") if n.strip()]
sched = [n.strip() for n in sched_list.split(",") if n.strip()]
assert sorted(trigger) == sorted(env_names), f"workflow list drift: trigger={trigger} env={env_names}"
assert set(sched) <= set(env_names), f"scheduled names must be in RELAYED_WORKFLOWS: {sched}"
PY

# --- Decision cases ---------------------------------------------------------
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
    summary="0 1 1"
  }
  read pending is_winner all_ok <<< "$summary"
  if [ "$kind" = "success" ] && [ "${pending:-0}" -gt 0 ]; then
    sleep 60
    summary=$(summarize_runs) || {
      echo '::warning::last-finisher pending retry query failed (gh api/--jq); failing OPEN' >&2
      summary="0 1 1"
    }
    read pending is_winner all_ok <<< "$summary"
  fi
  if [ "$kind" = "failure" ]; then
    if [ "${WORKFLOW_RUN_ATTEMPT:-1}" -gt 1 ]; then echo skip; return; fi
    if [ "${is_winner:-0}" -eq 1 ]; then echo send; else echo skip; fi
    return
  fi
  if [ "${pending:-0}" -gt 0 ] || [ "${all_ok:-0}" -eq 0 ]; then echo skip; else echo send; fi
}
export HEAD_SHA=deadbeef GITHUB_REPOSITORY=Ryan-Carloso/post-engineer
export WORKFLOW_RUN_ID=42 WORKFLOW_RUN_ATTEMPT=1 WORKFLOW_NAME=CI CONCLUSION=failure
STATE="$(mktemp)"
sleep() { return 0; } # the 60s retry must not slow the test
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
    *) printf '%s' "$line" | RELAYED_WORKFLOWS="$RELAYED_WORKFLOWS" SCHEDULED_RELAYED_WORKFLOWS="$SCHEDULED_RELAYED_WORKFLOWS" \
         WORKFLOW_RUN_ID="$WORKFLOW_RUN_ID" WORKFLOW_RUN_ATTEMPT="$WORKFLOW_RUN_ATTEMPT" \
         WORKFLOW_NAME="$WORKFLOW_NAME" CONCLUSION="$CONCLUSION" jq -r "$jq_filter" ;;
  esac
}
unlisted_doc='{"workflow_runs": [{"name": "release-mcp", "status": "in_progress", "id": 2, "run_attempt": 1}]}'

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

# Query failure fails OPEN (send) — 2 events ok, 0 not.
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "failure query-fail sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "first failure sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run timed_out 2>/dev/null)" "first timed_out sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
CONCLUSION=cancelled
expect send "$(relay_decision workflow_run cancelled 2>/dev/null)" "solo cancelled sends"
CONCLUSION=failure
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run action_required 2>/dev/null)" "first action_required sends"
printf '%s\n' "$FIRST_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run startup_failure 2>/dev/null)" "first startup_failure sends"
# Concurrent failures: higher id skips, lower id sends (exactly one wake).
WORKFLOW_NAME=mutation
printf '%s\n' "$CONCURRENT_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run failure 2>/dev/null)" "higher-id concurrent failure skips"
WORKFLOW_NAME=CI
WORKFLOW_RUN_ID=1
printf '%s\n' "$CONCURRENT_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "lower-id concurrent failure sends"
WORKFLOW_RUN_ID=42
# Cancelled sibling does not suppress the real failure.
WORKFLOW_NAME=mutation
printf '%s\n' "$CANCEL_AND_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "cancelled does not suppress real failure"
WORKFLOW_NAME=CI
# Later failure of the same SHA (higher id, other already failed) -> skip.
WORKFLOW_NAME=mutation
printf '%s\n' "$SECOND_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run failure 2>/dev/null)" "second workflow failure skips"
WORKFLOW_NAME=CI
# Same run id, attempt>1: GitHub rerun, old attempt not in the list -> skip.
WORKFLOW_RUN_ATTEMPT=2
printf '%s\n' "$RERUN_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run failure 2>/dev/null)" "rerun attempt>1 skips"
WORKFLOW_RUN_ATTEMPT=1
# success with a relayed PR run pending: both queries see 1 -> skip.
CONCLUSION=success
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 2>/dev/null)" "success with pending skips"
printf '%s\n' "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "success last sends"
printf '%s\n' "$GREEN_WITH_FAIL_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 2>/dev/null)" "success with leftover failure skips"
WORKFLOW_RUN_ID=99
printf '%s\n' "$FIXED_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "success after new run sends"
WORKFLOW_RUN_ID=42
printf '%s\n' "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run skipped 2>/dev/null)" "skipped last sends"
printf '%s\n%s\n' "$PENDING_DOC" "$ALL_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "retry sees completion"
printf '%s\n' "$FLIGHT_PENDING_GREEN_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "scheduled pending does not gate PR green"
printf '%s\n' "$unlisted_doc" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "unlisted run does not gate"
# Scheduled vs PR failure pools are independent: both send.
CONCLUSION=failure
WORKFLOW_NAME=CI
WORKFLOW_RUN_ID=10
printf '%s\n' "$MIXED_POOL_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "PR failure sends beside scheduled failure"
WORKFLOW_NAME=test-flight
WORKFLOW_RUN_ID=42
printf '%s\n' "$MIXED_POOL_FAIL_DOC" > "$STATE"
expect send "$(relay_decision workflow_run failure 2>/dev/null)" "scheduled failure sends beside PR failure"
WORKFLOW_NAME=CI
printf 'FAIL\n%s\n' "$EMPTY_DOC" > "$STATE"
CONCLUSION=success
expect send "$(relay_decision workflow_run success 2>/dev/null)" "query failure fails open"
printf 'GARBAGE\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 2>/dev/null)" "unparseable body fails open"
printf '%s\n' "$EMPTY_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run neutral 2>/dev/null)" "neutral conclusion skips"
expect skip "$(relay_decision cron success 2>/dev/null)" "unknown event skips"
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect send "$(relay_decision pull_request synchronize 2>/dev/null)" "pull_request sends"
[ "$(head -c1 "$STATE")" = "{" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
