#!/bin/bash
#---------------
# Regression tests for the relay_decision logic in
# .github/workflows/openbot-notify.yml.
#
# - Decision cases: failure-family conclusions send; success/skipped send
#   only when no other run for the head sha is pending (the last finisher
#   wakes the Babysit); the 60s retry observes a completion and sends; a
#   transient pending-query failure fails OPEN (send); unknown
#   conclusion/event skips; pull_request events send without querying.
# - Sync guard: the workflow must still contain the same decision lines —
#   this copy is the reference.
#
# Runs standalone: bash .github/scripts/openbot-notify/relay.test.sh
#---------------
set -euo pipefail
cd "$(dirname "$0")/../../.."

fail=0
YML=.github/workflows/openbot-notify.yml

# --- Sync guard: the reference lines must exist verbatim in the workflow. ---
sync_line() { grep -qF -- "$1" "$YML" || { echo "SYNC FAIL: not found in $YML: $1"; fail=1; }; }
sync_line 'failure|timed_out|cancelled|action_required) echo send; return ;;'
sync_line 'success|skipped) ;;'
sync_line 'pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA" '
sync_line 'in_progress\"))] | length") || pending=0'
sync_line 'if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi'

# --- Decision cases ---------------------------------------------------------
# A stub gh serves the pending count from a state file: assignments inside
# $(...) command substitutions do not persist across calls.
relay_decision() {
  case "$1" in
    pull_request) echo send; return ;;
    workflow_run) ;;
    *) echo skip; return ;;
  esac
  case "$2" in
    failure|timed_out|cancelled|action_required) echo send; return ;;
    success|skipped) ;;
    *) echo skip; return ;;
  esac
  # Fail OPEN on a transient query failure: a broken/limited API call must
  # not abort the relay before the send (2 events is acceptable, 0 is not).
  pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA" \
    --jq "[.workflow_runs[] | select(.id != $3 and .name != \"openbot-notify\" and (.status == \"queued\" or .status == \"in_progress\"))] | length") || pending=0
  if [ "$pending" -gt 0 ]; then
    # One late retry: a run that completes while another's completion
    # event is still in flight must not be missed by both.
    sleep 60
    pending=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA" \
      --jq "[.workflow_runs[] | select(.id != $3 and .name != \"openbot-notify\" and (.status == \"queued\" or .status == \"in_progress\"))] | length") || pending=0
  fi
  if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi
}
export HEAD_SHA=deadbeef GITHUB_REPOSITORY=Ryan-Carloso/post-engineer
sleep() { return 0; } # the 60s retry must not slow the test
gh() { # 'F' in the state simulates a transient API failure (exit 1)
  local n; n=$(head -c1 .pending_state)
  [ "$n" = "F" ] && return 1
  printf '%s' "$n"
  tail -c +2 .pending_state > .pending_state.rest; mv .pending_state.rest .pending_state
}
trap 'rm -f .pending_state .pending_state.rest' EXIT

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

printf '%s' 1 > .pending_state
expect send "$(relay_decision workflow_run failure 42)" "failure sends"
printf '%s' 1 > .pending_state
expect send "$(relay_decision workflow_run timed_out 42)" "timed_out sends"
printf '%s' 1 > .pending_state
expect send "$(relay_decision workflow_run cancelled 42)" "cancelled sends"
printf '%s' 1 > .pending_state
expect send "$(relay_decision workflow_run action_required 42)" "action_required sends"
# success with others pending: both queries see 1 -> skip.
printf '%s' 11 > .pending_state
expect skip "$(relay_decision workflow_run success 42)" "success with pending skips"
# success as the last finisher: nothing pending -> send.
printf '%s' 00 > .pending_state
expect send "$(relay_decision workflow_run success 42)" "success last sends"
# The 60s retry observes the other run's completion: 1 then 0 -> send.
printf '%s' 10 > .pending_state
expect send "$(relay_decision workflow_run success 42)" "retry sees completion"
# A transient query failure fails OPEN: gh fails -> || pending=0 -> send.
printf '%s' F > .pending_state
expect send "$(relay_decision workflow_run success 42)" "query failure fails open"
# Unknown conclusion and unknown event never relay.
printf '%s' 0 > .pending_state
expect skip "$(relay_decision workflow_run startup_failure 42)" "unknown conclusion skips"
expect skip "$(relay_decision cron success 42)" "unknown event skips"
# pull_request events send without consulting the stub: consume the state
# afterwards to prove nothing was read.
expect send "$(relay_decision pull_request synchronize 42)" "pull_request sends"
[ "$(head -c1 .pending_state)" = "0" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
