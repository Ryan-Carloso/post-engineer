#!/usr/bin/env bash
# Usage: review-race.sh <prompt-file> <title> <prefix> <models-csv> <file>...
#
# Starts `opencode run --agent reviewer` on every model at once, each capped
# at 12 minutes, in its own process group and OpenCode data dirs. The first
# attempt that ends with a Verdict line wins; the others are stopped. Free
# models hang for whole runs at random, so one hung model costs nothing
# while another answers.
#
# Writes <prefix>-<i>.md and <prefix>-<i>.stderr.txt per attempt and, on
# success, <prefix>-winner.txt (the model id), <prefix>-winner.md and
# <prefix>-winner.stderr.txt. Exits 1 when no attempt produced a review.
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "usage: $0 <prompt-file> <title> <prefix> <models-csv> <file>..." >&2
  exit 2
fi
prompt_file="$1"
title="$2"
prefix="$3"
models_csv="$4"
shift 4
file_args=()
for file in "$@"; do
  file_args+=(--file "$file")
done
work_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

start_attempt() {
  local i="$1"
  local model="$2"
  (
    set +e
    XDG_DATA_HOME="$work_root/opencode-$prefix-$i/data" \
    XDG_CACHE_HOME="$work_root/opencode-$prefix-$i/cache" \
    XDG_STATE_HOME="$work_root/opencode-$prefix-$i/state" \
    setsid timeout 12m opencode run \
      --agent reviewer \
      --model "$model" \
      "${file_args[@]}" \
      --title "$title" \
      "$(cat "$prompt_file")" < /dev/null > "$prefix-$i.md" 2> "$prefix-$i.stderr.txt" &
    echo $! > "$prefix-$i.pid"
    wait "$!"
    echo $? > "$prefix-$i.rc"
  ) &
}

# The fallback marker is read from stderr only: a review that quotes this
# script contains the phrase. A bold **Verdict: ...** line is normalized to
# the plain form the grounding verifier expects.
attempt_ok() {
  local i="$1"
  local model="$2"
  local rc
  rc=$(cat "$prefix-$i.rc")
  echo "$model: exit $rc, $(wc -c < "$prefix-$i.md") bytes of review output" >&2
  if grep -q 'Falling back to default agent' "$prefix-$i.stderr.txt"; then
    echo "OpenCode fell back to the default agent for $model; discarding this attempt." >&2
    return 1
  fi
  [ "$rc" -eq 0 ] && [ -s "$prefix-$i.md" ] || return 1
  sed -i -E 's/^\*\*Verdict: (APPROVE|REQUEST_CHANGES)\*\*[[:space:]]*$/Verdict: \1/' "$prefix-$i.md"
  if ! grep -qE '^Verdict: (APPROVE|REQUEST_CHANGES)' "$prefix-$i.md"; then
    echo "$model wrote no Verdict line; discarding this attempt." >&2
    return 1
  fi
}

attempts=()
IFS=',' read -r -a requested <<< "$models_csv"
for model in "${requested[@]}"; do
  model="${model// /}"
  [ -n "$model" ] && attempts+=("$model")
done
if [ "${#attempts[@]}" -eq 0 ]; then
  echo "No review model to run" >&2
  exit 1
fi

for i in "${!attempts[@]}"; do
  echo "Starting $prefix with ${attempts[$i]} (timeout 12m) ..."
  start_attempt "$i" "${attempts[$i]}"
done

chosen=""
chosen_index=""
declare -A done_attempts=()
while [ -z "$chosen" ] && [ "${#done_attempts[@]}" -lt "${#attempts[@]}" ]; do
  sleep 5
  for i in "${!attempts[@]}"; do
    [ -n "${done_attempts[$i]:-}" ] && continue
    [ -f "$prefix-$i.rc" ] || continue
    done_attempts[$i]=1
    if attempt_ok "$i" "${attempts[$i]}"; then
      chosen="${attempts[$i]}"
      chosen_index="$i"
      echo "$prefix completed with $chosen."
      break
    fi
    echo "$prefix with ${attempts[$i]} failed." >&2
    tail -c 2000 "$prefix-$i.stderr.txt" >&2 || true
  done
done

for i in "${!attempts[@]}"; do
  if [ ! -f "$prefix-$i.rc" ] && [ -f "$prefix-$i.pid" ]; then
    echo "Stopping ${attempts[$i]}." >&2
    kill -- "-$(cat "$prefix-$i.pid")" 2>/dev/null || true
  fi
done

if [ -z "$chosen" ]; then
  echo "OpenCode produced no $prefix from any model" >&2
  exit 1
fi
echo "$chosen" > "$prefix-winner.txt"
cp "$prefix-$chosen_index.md" "$prefix-winner.md"
cp "$prefix-$chosen_index.stderr.txt" "$prefix-winner.stderr.txt"
