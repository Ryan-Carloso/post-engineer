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
sync_line 'pending=$(printf '"'"'%s'"'"' "$_pending_json" | python3 .github/scripts/openbot-notify/pending_runs.py) || {'
sync_line 'sleep 60'
sync_line 'if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi'

# --- The counter is a real file and it WORKS on sample JSON (0 and >0). -----
# Regression: the historic inline python was indented inside the workflow's
# `run: |` block, so the interpreter died with IndentationError on every
# call and the fail-open mask turned the last-finisher guard into
# send-always. The guard executes the SAME file this block exercises.
SCRIPT=.github/scripts/openbot-notify/pending_runs.py
[ -f "$SCRIPT" ] || { echo "FAIL: $SCRIPT missing"; fail=1; }
python3 - "$SCRIPT" <<'PY' || { echo "FAIL: script does not compile"; fail=1; }
import py_compile, sys
py_compile.compile(sys.argv[1], doraise=True)
PY
PENDING_DOC='{"workflow_runs": [{"name": "CI", "status": "in_progress", "id": 1}]}'
EMPTY_DOC='{"workflow_runs": []}'
export RELAYED_WORKFLOWS='CI,mutation,opencode-review,file-size,api-naming,parity-exclusion-guard,CodeQL Advanced,Deploy,Release MCP (auto)'
count() { printf '%s' "$2" | RELAYED_WORKFLOWS="$1" python3 "$SCRIPT"; }
[ "$(count 'CI,mutation' "$PENDING_DOC")" = 1 ] || { echo "FAIL [script counts >0 pending]"; fail=1; }
[ "$(count 'CI,mutation' "$EMPTY_DOC")" = 0 ] || { echo "FAIL [script counts 0 pending]"; fail=1; }
[ "$(count 'CI,mutation' 'FAIL')" = 0 ] || { echo "FAIL [script counts invalid json as 0]"; fail=1; }
[ "$(count 'CI' '')" = 0 ] || { echo "FAIL [script counts empty stdin as 0]"; fail=1; }

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
# Mirror of the workflow's relay_decision, with the SAME pending-count shape
# (`gh api` piped into the real counter; script crash = warn + fail-open).
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
  # A counter crash warns loudly and fails OPEN as well.
  _pending_json=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100") || {
    echo '::warning::last-finisher pending query failed (gh api); failing OPEN' >&2
    pending=0
  }
  if [ -n "${_pending_json:-}" ]; then
    pending=$(printf '%s' "$_pending_json" | python3 "$SCRIPT") || {
      echo '::warning::pending_runs.py crashed; failing OPEN (see its traceback above)' >&2
      pending=0
    }
  fi
  if [ "$pending" -gt 0 ]; then
    # One late retry: a run that completes while another's completion
    # event is still in flight must not be missed by both.
    sleep 60
    _pending_json=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$HEAD_SHA&per_page=100") || {
      echo '::warning::last-finisher pending retry query failed (gh api); failing OPEN' >&2
      pending=0
    }
    if [ -n "${_pending_json:-}" ]; then
      pending=$(printf '%s' "$_pending_json" | python3 "$SCRIPT") || {
        echo '::warning::pending_runs.py crashed on retry; failing OPEN (see its traceback above)' >&2
        pending=0
      }
    fi
  fi
  if [ "$pending" -gt 0 ]; then echo skip; else echo send; fi
}
export HEAD_SHA=deadbeef GITHUB_REPOSITORY=Ryan-Carloso/post-engineer
STATE="$(mktemp)"
sleep() { return 0; } # the 60s retry must not slow the test
# Stub gh: serves one JSON doc per call from the state file. A bare FAIL
# line makes gh itself exit non-zero with empty stdout — the real
# transient-failure path the visible ::warning covers.
gh() {
  local line
  line=$(head -n1 "$STATE")
  tail -n +2 "$STATE" > "$STATE.rest"
  mv "$STATE.rest" "$STATE"
  if [ "$line" = "FAIL" ]; then return 1; fi
  printf '%s\n' "$line"
}
unlisted_doc='{"workflow_runs": [{"name": "release-mcp", "status": "in_progress", "id": 2}]}'

expect() { # expect <want> <got> <case name>
  [ "$2" = "$1" ] || { echo "FAIL [$3]: expected $1, got $2"; fail=1; }
}

# Failure family: query never consulted (a FAIL doc proves it).
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run failure 42)" "failure sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run timed_out 42)" "timed_out sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run cancelled 42)" "cancelled sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run action_required 42)" "action_required sends"
printf '%s\n' FAIL > "$STATE"
expect send "$(relay_decision workflow_run startup_failure 42)" "startup_failure sends"
# success with a relayed run pending: both queries see 1 -> skip.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run success 42)" "success with pending skips"
# success as the last finisher: nothing pending -> send.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42)" "success last sends"
# A run that completes during the 60s retry: 1 then 0 -> send.
printf '%s\n%s\n' "$PENDING_DOC" "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42)" "retry sees completion"
# Unlisted workflows do not gate the send: only release-mcp pending -> send.
printf '%s\n%s\n' "$unlisted_doc" "$unlisted_doc" > "$STATE"
expect send "$(relay_decision workflow_run success 42)" "unlisted run does not gate"
# A transient query failure fails OPEN: gh fails -> || pending=0 -> send.
printf 'FAIL\n%s\n' "$EMPTY_DOC" > "$STATE"
expect send "$(relay_decision workflow_run success 42)" "query failure fails open"
# Unknown conclusion and unknown event never relay.
printf '%s\n%s\n' "$EMPTY_DOC" "$EMPTY_DOC" > "$STATE"
expect skip "$(relay_decision workflow_run neutral 42)" "neutral conclusion skips"
expect skip "$(relay_decision cron success 42)" "unknown event skips"
# pull_request events send without consulting the stub: the state file
# keeps both docs, proving no query ran.
printf '%s\n%s\n' "$PENDING_DOC" "$PENDING_DOC" > "$STATE"
expect send "$(relay_decision pull_request synchronize 42)" "pull_request sends"
[ "$(head -c1 "$STATE")" = "{" ] || { echo "FAIL [pull_request bypasses the pending query]: state was consumed"; fail=1; }

[ "$fail" = 0 ] && echo "relay.test.sh: ALL PASS" || { echo "relay.test.sh: FAILURES"; exit 1; }
