#!/usr/bin/env bash

set -Eeuo pipefail

: "${SMOKE_API_TOKEN:?SMOKE_API_TOKEN is required}"
: "${VPS_API_URL:?VPS_API_URL is required}"
: "${INSTAGRAM_ACCOUNT_ID:?INSTAGRAM_ACCOUNT_ID is required}"

API_URL="${VPS_API_URL%/}"
PHOTO_URL="${RYAN_PHOTO_URL:-${API_URL}/ryan-me.png}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-3600}"
POLL_SECONDS="${POLL_SECONDS:-10}"
USER_ID="${SMOKE_USER_ID:-test-prod-ryan-video}"

SUBJECT="Cascais e a Praia da Ribeira do Cavalo: dois lugares incríveis para conhecer em Portugal"
AUTH_ARGS=(-H "Authorization: Bearer ${SMOKE_API_TOKEN}" -H "x-user-id: ${USER_ID}")

SCRIPT_RESPONSE="$(curl -fsS --max-time 120 -X POST "${API_URL}/api/v1/scripts" \
  "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' \
  --data-raw "$(SUBJECT="$SUBJECT" python3 - <<'PY'
import json
import os

print(json.dumps({
    "video_subject": os.environ["SUBJECT"],
    "video_language": "pt",
    "paragraph_number": 1,
}))
PY
)")"
VIDEO_SCRIPT="$(printf '%s' "$SCRIPT_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["video_script"])')"

METADATA_RESPONSE="$(VIDEO_SCRIPT="$VIDEO_SCRIPT" SUBJECT="$SUBJECT" curl -fsS --max-time 120 -X POST "${API_URL}/api/v1/social-metadata" \
  "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' \
  --data-raw "$(VIDEO_SCRIPT="$VIDEO_SCRIPT" SUBJECT="$SUBJECT" python3 - <<'PY'
import json
import os

print(json.dumps({
    "video_subject": os.environ["SUBJECT"],
    "video_script": os.environ["VIDEO_SCRIPT"],
    "language": "pt",
    "platform": "instagram",
}))
PY
)")"
CAPTION="$(printf '%s' "$METADATA_RESPONSE" | python3 -c 'import json,sys; data=json.load(sys.stdin)["data"]; print(data.get("caption") or data.get("description") or "")')"
if [[ -z "$CAPTION" ]]; then
  printf 'LLM returned no Instagram caption\n' >&2
  exit 1
fi

PAYLOAD="$(PHOTO_URL="$PHOTO_URL" ACCOUNT_ID="$INSTAGRAM_ACCOUNT_ID" SUBJECT="$SUBJECT" VIDEO_SCRIPT="$VIDEO_SCRIPT" CAPTION="$CAPTION" python3 - <<'PY'
import json
import os

print(json.dumps({
    "video_subject": os.environ["SUBJECT"],
    "video_script": os.environ["VIDEO_SCRIPT"],
    "video_language": "pt",
    "voice_name": "pt-BR-AntonioNeural",
    "subtitle_enabled": True,
    "persona": {
        "id": "test-prod-ryan-video",
        "name": "Ryan",
        "photo_url": os.environ["PHOTO_URL"],
        "voice_id": "pt-BR-AntonioNeural",
        "language": "pt-BR",
        "niche": "viagens em Portugal",
        "speaking_style": "narrativa, natural e informativa",
        "audience": "pessoas interessadas em viagens",
    },
    "lipsync_enabled": True,
    "video_quality": "ok",
    "publish": {
        "providers": ["instagram"],
        "instagram": {
            "caption": os.environ["CAPTION"],
            "account_ids": [os.environ["ACCOUNT_ID"]],
        },
    },
}))
PY
)"

RESPONSE="$(curl -fsS --max-time 30 -X POST "${API_URL}/api/v1/videos" \
  -H "Authorization: Bearer ${SMOKE_API_TOKEN}" \
  -H "x-user-id: ${USER_ID}" \
  -H 'Content-Type: application/json' \
  --data-raw "$PAYLOAD")"
TASK_ID="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["task_id"])')"
STARTED="$(date +%s)"

while true; do
  STATUS="$(curl -fsS --max-time 30 "${API_URL}/api/v1/tasks/${TASK_ID}" \
    -H "Authorization: Bearer ${SMOKE_API_TOKEN}" \
    -H "x-user-id: ${USER_ID}")"
  STATE="$(printf '%s' "$STATUS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"].get("state"))')"
  PROGRESS="$(printf '%s' "$STATUS" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"].get("progress", 0))')"
  printf 'task=%s state=%s progress=%s\n' "$TASK_ID" "$STATE" "$PROGRESS"

  if [[ "$STATE" == "1" ]]; then
    printf '%s\n' "$STATUS" > "${TASK_ID}.json"
    printf 'published successfully: task=%s\n' "$TASK_ID"
    exit 0
  fi
  if [[ "$STATE" == "-1" ]]; then
    printf '%s\n' "$STATUS" >&2
    exit 1
  fi
  if (( $(date +%s) - STARTED >= MAX_WAIT_SECONDS )); then
    printf 'timed out: task=%s\n' "$TASK_ID" >&2
    exit 1
  fi
  sleep "$POLL_SECONDS"
done
