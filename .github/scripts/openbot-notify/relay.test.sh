#!/bin/bash
#---------------
# Regression tests for the relay_decision logic in
# .github/workflows/openbot-notify.yml.
#
# The decision function below mirrors the workflow's relay_decision
# (sync guard pins the reference lines stay in the yml); the `gh api`
# call is stubbed with JSON docs served from a state file, one per call,
# so the real runs-API parsing (the inline python) executes unchanged.
#
# Cases: failure-family conclusions send; success/skipped send only when
# no relayed workflow run is still pending for the head sha (last
# finisher wakes the Babysit); the 60s retry observes a completion; a
# transient query failure fails OPEN (send); unknown conclusion/event
# skips; pull_request events send without querying. The single-source
# guard asserts the trigger block's workflows list matches the
# RELAYED_WORKFLOWS env line.
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
sync_line 'pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" | python3 -c '
sync_line ') || pending=0'
sync_line 'sleep 60'
sync_line 'if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi'

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
  # Fail OPEN on a transient query failure: a broken/limited API call must
  # not abort the relay before the send (2 events is acceptable, 0 is not).
  pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" | python3 -c '
import json, os, sys
names = [n.strip() for n in os.environ.get("RELAYED_WORKFLOWS", "").split(",") if n.strip()]
try:
  data = json.loads(sys.stdin.read())
except ValueError:
  data = {"workflow_runs": []}
print(sum(1 for r in data.get("workflow_runs", []) if r.get("name") in names and r.get("status") in ("queued", "in_progress")))') || pending=0
  if [ "$pending" -gt 0 ]; then
    # One late retry: a run that completes while another's completion
    # event is still in flight must not be missed by both.
    sleep 60
    pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100" | python3 -c '
import json, os, sys
names = [n.strip() for n in os.environ.get("RELAYED_WORKFLOWS", "").split(",") if n.strip()]
try:
  data = json.loads(sys.stdin.read())
except ValueError:
  data = {"workflow_runs": []}
print(sum(1 for r in data.get("workflow_runs", []) if r.get("name") in names and r.get("status") in ("queued", "in_progress")))') || pending=0
  fi
  if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi
}
export HEAD_SHA=deadbeef GITHUB_REPOSITORY=Ryan-Carloso/post-engineer
export RELAYED_WORKFLOWS='CI,mutation,opencode-review,file-size,api-naming,parity-exclusion-guard,CodeQL Advanced,Deploy,Release MCP (auto)'
sleep() { return 0; } # the 60s retry must not slow the test
# Stub gh: serves one JSON doc per call from the state file; a bare FAIL
# line makes the downstream python's json.load fail, which the pipeline's
# `|| pending=0` (fail-open) absorbs — the real transient-failure path.
gh() {
  head -n1 .pending_state
  tail -n +2 .pending_state > .pending_state.rest
  mv .pending_state.rest .pending_state
}
PENDING_DOC='{"workflow_runs": [{"name": "CI", "status": "in_progress", "id": 1}]}'
EMPTY_DOC='{"workflow_runs": []}'
unlisted_doc='{"workflow_runs": [{"name": "release-mcp", "status": "in_progress", "id": 2}]}'

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

# Failure family: query never consulted (a FAIL doc proves it).
printf '%s\n' FAIL > .pending_state
expect send "$(relay_decision workflow_run failure 42)" "failure sends"
printf '%s\n' FAIL > .pending_state
expect send "$(relay_decision workflow_run timed_out 42)" "timed_out sends"
printf '%s\n' FAIL > .pending_state
expect send "$(relay_decision workflow_run cancelled 42)" "cancelled sends"
printf '%s\n' FAIL > .pending_state
expect send "$(relay_decision workflow_run action_required 42)" "action_required sends"
printf '%s\n' FAIL > .pending_state
expect send "$(relay_decision workflow_run startup_failure 42)" "startup_failure sends"
# success with a relayed run pending: both queries see 1 -> skip.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > .pending_state
expect skip "$(relay_decision workflow_run success 42)" "success with pending skips"
# success as the last finisher: nothing pending -> send.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > .pending_state
expect send "$(relay_decision workflow_run success 42)" "success last sends"
# A run that completes during the 60s retry: 1 then 0 -> send.
printf '%s\n%s\n' "$PENDING_DOC" "$EMPTY_DOC" > .pending_state
expect send "$(relay_decision workflow_run success 42)" "retry sees completion"
# Unlisted workflows do not gate the send: only release-mcp pending -> send.
printf '%s\n%s\n' "$unlisted_doc" "$unlisted_doc" > .pending_state
expect send "$(relay_decision workflow_run success 42)" "unlisted run does not gate"
# A transient query failure fails OPEN: gh fails -> || pending=0 -> send.
printf 'FAIL\n%s\n' "$EMPTY_DOC" > .pending_state
expect send "$(relay_decision workflow_run success 42)" "query failure fails open"
# Unknown conclusion and unknown event never relay.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > .pending_state
expect skip "$(relay_decision workflow_run neutral 42)" "neutral conclusion skips"
expect skip "$(relay_decision cron success 42)" "unknown event skips"
# pull_request events send without consulting the stub: the state file
# keeps both docs, proving no query ran.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > .pending_state
expect send "$(relay_decision pull_request synchronize 42)" "pull_request sends"
[ "$(head -c1 .pending_state)" = "{" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
