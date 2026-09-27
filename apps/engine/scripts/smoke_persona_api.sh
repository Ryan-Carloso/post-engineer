#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://127.0.0.1:8080}"
SMOKE_BACKEND="${SMOKE_BACKEND:-local}"
MODAL_API_URL="${MODAL_API_URL:-}"
VPS_API_URL="${VPS_API_URL:-}"
SKIP_MODAL_DEPLOY="${SKIP_MODAL_DEPLOY:-0}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-3600}"
NO_PROGRESS_TIMEOUT_SECONDS="${NO_PROGRESS_TIMEOUT_SECONDS:-900}"
POLL_SECONDS="${POLL_SECONDS:-5}"
SMOKE_USER_ID="${SMOKE_USER_ID:-smoke-test-user}"
# Smoke auth = shared API secret, same contract the web proxy uses in
# production. Fails fast when unset — the API rejects everything otherwise.
: "${MONEYPRINT_API_SECRET:?MONEYPRINT_API_SECRET is required for the smoke run}"
SMOKE_API_TOKEN="$MONEYPRINT_API_SECRET"
# Overrides manuais (vazio = sorteio a cada run):
SMOKE_LANGUAGE="${SMOKE_LANGUAGE:-}"   # pt | es | en
SMOKE_VOICE="${SMOKE_VOICE:-}"         # edge-tts voice name
VIDEO_SUBJECT="${VIDEO_SUBJECT:-}"     # assunto do vídeo
SMOKE_SUBTITLES="${SMOKE_SUBTITLES:-true}"  # "false" desliga legendas
SMOKE_PUBLISH_JSON="${SMOKE_PUBLISH_JSON:-}" # JSON publish metadata for VPS smoke

case "$SMOKE_BACKEND" in
  local)
    ;;
  vps)
    if [[ -z "$VPS_API_URL" ]]; then
      printf 'VPS_API_URL is required when SMOKE_BACKEND=vps\n' >&2
      printf 'Example: VPS_API_URL=https://engine.example.com\n' >&2
      exit 1
    fi
    API_URL="${VPS_API_URL%/}"
    if [[ -z "$SMOKE_PUBLISH_JSON" ]]; then
      printf 'SMOKE_PUBLISH_JSON is required when SMOKE_BACKEND=vps\n' >&2
      printf 'Example: {"providers":["youtube"],"youtube":{"title":"Smoke","description":"Smoke","tags":["smoke"],"privacy_status":"private","account_ids":["account-id"]}}\n' >&2
      exit 1
    fi
    ;;
  *)
    printf 'SMOKE_BACKEND must be one of: local, vps (got: %s)\n' "$SMOKE_BACKEND" >&2
    exit 1
    ;;
esac
AUTH_HEADER=(-H "Authorization: Bearer $SMOKE_API_TOKEN" -H "x-user-id: $SMOKE_USER_ID")

#---------------
# Cenários (nicho + estilo/ponto de vista) em INGLÊS — são instruções de
# roteiro; o idioma de saída vem de video_language. Inspirados nos perfis
# de scripts/channels.yaml, para variar o ângulo do vídeo a cada run.
#---------------
SCENARIO_NICHES=(
  "gym workouts, muscle building, fitness motivation, and nutrition tips"
  "sales, expenses, profit, margins and financial control for small restaurants and local shops"
  "European motorhome adventures, scenic routes, vanlife tips and hidden travel gems"
  "programming, app building, indie hacking, AI tools and making money with software"
  "quick everyday recipes, budget cooking and kitchen time-savers"
  "surprising history stories and curious facts most people never learned in school"
)
SCENARIO_CONTEXTS=(
  "The creator is an energetic, no-nonsense fitness coach who drops practical training and nutrition tips."
  "The creator is a direct, practical business advisor focused on real results for small business owners."
  "The creator is a storytelling travel vlogger exploring Europe by motorhome, sharing authentic experiences and personal reflections."
  "The creator is a sharp developer who teaches app building with simple, practical, highly actionable steps."
  "The creator is a warm home-cooking creator who makes simple recipes feel achievable for anyone."
  "The creator is a curious storyteller who reveals the surprising human side of historical events."
)
# Assuntos por cenário e idioma (mesmo índice dos arrays acima), para que
# assunto e nicho continuem coerentes em qualquer combinação sorteada.
SCENARIO_SUBJECTS_PT=(
  "Um hábito de treino que muda tudo|O erro de treino que quase todo mundo comete|Como começar a treinar sem desistir na primeira semana"
  "Onde o dinheiro do seu negócio está escapando|Três hábitos simples para o lucro do seu negócio crescer|Por que vender mais não significa lucrar mais"
  "Uma manhã tranquila numa aldeia de montanha da Europa|O que ninguém te conta sobre viajar de motorhome na Europa|Três rotas escondidas que valem a viagem"
  "Como um app simples pode gerar sua primeira renda|O erro que atrasou meu primeiro app em meses|Do zero ao primeiro usuário em uma semana"
  "Uma receita de 10 minutos que salva o dia|Três truques de cozinha para quem não sabe cozinhar|O jantar barato que parece de restaurante"
  "A história estranha que ninguém te contou na escola|Um costume antigo que parece inventado|O detalhe esquecido que mudou a história"
)
SCENARIO_SUBJECTS_ES=(
  "Un hábito de entrenamiento que lo cambia todo|El error de entrenamiento que casi todos cometen|Cómo empezar a entrenar sin rendirte la primera semana"
  "Dónde se escapa el dinero de tu negocio|Tres hábitos simples para aumentar el lucro de tu negocio|Por qué vender más no significa ganar más"
  "Una mañana tranquila en un pueblo de montaña de Europa|Lo que nadie te cuenta sobre viajar en autocaravana por Europa|Tres rutas escondidas que valen el viaje"
  "Cómo una app simple puede generar tus primeros ingresos|El error que retrasó mi primera app durante meses|De cero al primer usuario en una semana"
  "Una receta de 10 minutos que salva el día|Tres trucos de cocina para quien no sabe cocinar|La cena barata que parece de restaurante"
  "La historia extraña que nadie te contó en la escuela|Una costumbre antigua que parece inventada|El detalle olvidado que cambió la historia"
)
SCENARIO_SUBJECTS_EN=(
  "One training habit that changes everything|The workout mistake almost everyone makes|How to start training without quitting in week one"
  "Where your small business money is leaking|Three simple habits to grow your business profit|Why selling more doesn't mean earning more"
  "A quiet morning in a European mountain village|What nobody tells you about motorhome life in Europe|Three hidden routes worth the drive"
  "How a simple app can pay your first dollar|The mistake that delayed my first app by months|From zero to first user in one week"
  "A 10-minute recipe that saves dinner|Three kitchen tricks for people who can't cook|The cheap dinner that tastes like a restaurant"
  "The strange story school never taught you|An ancient custom that sounds made up|The forgotten detail that changed history"
)
# Vozes edge-tts por idioma (todas presentes em app/services/data/azure_voices.json).
VOICES_PT=(pt-BR-AntonioNeural pt-BR-FranciscaNeural pt-BR-ThalitaMultilingualNeural)
VOICES_ES=(es-ES-AlvaroNeural es-ES-ElviraNeural es-ES-XimenaNeural es-MX-DaliaNeural es-MX-JorgeNeural)
VOICES_EN=(en-US-AndrewNeural en-US-EmmaNeural en-US-AriaNeural en-US-GuyNeural en-GB-RyanNeural en-GB-SoniaNeural)

#---------------
# Sorteio do run: idioma -> vozes/assuntos do idioma; cenário independente.
#---------------
if [[ -z "$SMOKE_LANGUAGE" ]]; then
  LANGUAGES=(pt es en)
  SMOKE_LANGUAGE="${LANGUAGES[RANDOM % ${#LANGUAGES[@]}]}"
fi
case "$SMOKE_LANGUAGE" in
  pt) VOICES=("${VOICES_PT[@]}"); SUBJECTS=("${SCENARIO_SUBJECTS_PT[@]}") ;;
  es) VOICES=("${VOICES_ES[@]}"); SUBJECTS=("${SCENARIO_SUBJECTS_ES[@]}") ;;
  en) VOICES=("${VOICES_EN[@]}"); SUBJECTS=("${SCENARIO_SUBJECTS_EN[@]}") ;;
  *)
    printf 'SMOKE_LANGUAGE must be one of: pt, es, en (got: %s)\n' "$SMOKE_LANGUAGE" >&2
    exit 1
  ;;
esac

SCENARIO_INDEX=$(( RANDOM % ${#SCENARIO_NICHES[@]} ))
NICHE="${SCENARIO_NICHES[$SCENARIO_INDEX]}"
CONTEXT="${SCENARIO_CONTEXTS[$SCENARIO_INDEX]}"

if [[ -z "$SMOKE_VOICE" ]]; then
  SMOKE_VOICE="${VOICES[RANDOM % ${#VOICES[@]}]}"
fi
if [[ -z "$VIDEO_SUBJECT" ]]; then
  IFS='|' read -r -a SUBJECT_OPTIONS <<< "${SUBJECTS[$SCENARIO_INDEX]}"
  VIDEO_SUBJECT="${SUBJECT_OPTIONS[RANDOM % ${#SUBJECT_OPTIONS[@]}]}"
fi

RUN_ID="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="${LOG_DIR:-$PROJECT_DIR/logs/persona-smoke-$RUN_ID}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/smoke.log"
VIDEO_SLUG="$(printf '%s' "$VIDEO_SUBJECT" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-*//; s/-*$//')"
RESULT_FILE="$LOG_DIR/${VIDEO_SLUG:-video}.mp4"
API_LOG="$LOG_DIR/api.log"
MUSIC_LOG="$LOG_DIR/music.log"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

cleanup() {
  local exit_code=$?
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  log "finished with exit_code=$exit_code; artifacts=$LOG_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

#---------------
# Local starts the engine. No local OmniRoute setup: the gateway runs on the
# VPS and is reached via config.toml (omniroute_base_url).
#---------------
if [[ "$SMOKE_BACKEND" == "local" ]]; then
  if curl -fsS --max-time 5 "$API_URL/docs" >/dev/null 2>&1; then
    log "using already-running API at $API_URL"
  else
    log "starting API at $API_URL"
    MPT_PERSONA_BATCH_ENABLED=false uv run python main.py >"$API_LOG" 2>&1 &
    API_PID=$!
    API_READY=false
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "$API_URL/docs" >/dev/null 2>&1; then
        API_READY=true
        break
      fi
      if ! kill -0 "$API_PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if [[ "$API_READY" != true ]]; then
      log "API failed to become ready at $API_URL"
      if [[ -s "$API_LOG" ]]; then
        sed 's/\x1b\[[0-9;]*[mK]//g' "$API_LOG" >&2
      fi
      exit 1
    fi
  fi
else
  log "using remote CPU engine API at $API_URL"
  API_READY=false
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 10 "$API_URL/docs" >/dev/null 2>&1; then
      API_READY=true
      break
    fi
    sleep 2
  done
  if [[ "$API_READY" != true ]]; then
    log "remote CPU engine API failed to become ready at $API_URL"
    exit 1
  fi
fi

curl -fsS --max-time 5 "$API_URL/docs" "${AUTH_HEADER[@]}" >/dev/null

log "random pick: language=$SMOKE_LANGUAGE voice=$SMOKE_VOICE scenario=$SCENARIO_INDEX niche=\"$NICHE\""
log "subject=\"$VIDEO_SUBJECT\""

PAYLOAD_FILE="$LOG_DIR/request.json"
cat >"$PAYLOAD_FILE" <<JSON
{
  "video_subject": "$VIDEO_SUBJECT",
  "video_language": "$SMOKE_LANGUAGE",
  "voice_name": "$SMOKE_VOICE",
  "video_script_prompt": "The content niche is: $NICHE. $CONTEXT",
  "subtitle_enabled": "$SMOKE_SUBTITLES"
}
JSON
if [[ "$SMOKE_BACKEND" == "vps" ]]; then
  SMOKE_PUBLISH_JSON="$SMOKE_PUBLISH_JSON" PAYLOAD_FILE="$PAYLOAD_FILE" uv run python - <<'PY'
import json
import os
from pathlib import Path

payload_path = Path(os.environ["PAYLOAD_FILE"])
payload = json.loads(payload_path.read_text())
publish = json.loads(os.environ["SMOKE_PUBLISH_JSON"])
if not isinstance(publish, dict):
    raise SystemExit("SMOKE_PUBLISH_JSON must be a JSON object")
payload["publish"] = publish
payload_path.write_text(json.dumps(payload), encoding="utf-8")
PY
fi
log "payload saved to $PAYLOAD_FILE"
printf '\n===== PAYLOAD PREVIEW =====\n'
cat "$PAYLOAD_FILE"
printf '===== END PAYLOAD PREVIEW =====\n\n'

CREATE_RESPONSE_FILE="$LOG_DIR/create-response.json"
curl -fsS --max-time 30 -X POST "$API_URL/api/v1/videos" \
  "${AUTH_HEADER[@]}" \
  -H 'Content-Type: application/json' \
  --data-binary "@$PAYLOAD_FILE" \
  -o "$CREATE_RESPONSE_FILE"

TASK_ID="$(uv run python - "$CREATE_RESPONSE_FILE" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
if payload.get("status") != 200:
    raise SystemExit(f"create request failed: {payload}")
print(payload["data"]["task_id"])
PY
)"
log "task_id=$TASK_ID"

STARTED_AT="$(date +%s)"
LAST_PROGRESS=""
LAST_PROGRESS_AT="$STARTED_AT"
STATUS_FILE="$LOG_DIR/last-status.json"

while true; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - STARTED_AT))
  if (( ELAPSED >= MAX_WAIT_SECONDS )); then
    log "timeout after ${ELAPSED}s; stopping immediately"
    exit 1
  fi

  if ! curl -fsS --max-time 30 "${AUTH_HEADER[@]}" "$API_URL/api/v1/tasks/$TASK_ID" -o "$STATUS_FILE"; then
    log "status request failed; stopping immediately"
    exit 1
  fi
  STATUS_SUMMARY="$(uv run python - "$STATUS_FILE" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
data = payload.get("data", {})
state = data.get("state")
progress = data.get("progress", 0)
error = data.get("error", "")
music_mood = data.get("music_mood", "pending")
print(f"{state}|{progress}|{music_mood}|{error}")
PY
)"
  IFS='|' read -r STATE PROGRESS MUSIC_MOOD ERROR <<<"$STATUS_SUMMARY"
  log "elapsed=${ELAPSED}s state=$STATE progress=$PROGRESS music_mood=$MUSIC_MOOD${ERROR:+ error=$ERROR}"

  if [[ "$STATE" == "-1" ]]; then
    log "task failed; stopping immediately"
    exit 1
  fi
  if [[ "$STATE" == "3" ]]; then
    log "task is queued for the daily persona batch; use MPT_PERSONA_BATCH_ENABLED=false or wait for the next batch"
    exit 2
  fi
  if [[ "$PROGRESS" != "$LAST_PROGRESS" ]]; then
    LAST_PROGRESS="$PROGRESS"
    LAST_PROGRESS_AT="$NOW"
  elif (( NOW - LAST_PROGRESS_AT >= NO_PROGRESS_TIMEOUT_SECONDS )); then
    log "no progress for $NO_PROGRESS_TIMEOUT_SECONDS seconds; stopping immediately"
    exit 1
  fi
  if [[ "$STATE" == "1" ]]; then
    break
  fi
  sleep "$POLL_SECONDS"
done

if [[ "$SMOKE_BACKEND" == "vps" ]]; then
  uv run python - "$STATUS_FILE" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
data = payload.get("data", {})
results = data.get("publish_results") or []
if not results:
    raise SystemExit(f"completed VPS task has no publish results: {payload}")
if not all(result.get("success") is True for result in results):
    raise SystemExit(f"VPS task has failed publication result: {results}")
print(f"remote publication validated: {len(results)} result(s)")
PY
else
  VIDEO_URL="$(uv run python - "$STATUS_FILE" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
data = payload.get("data", {})
urls = data.get("videos") or data.get("combined_videos") or []
if not urls:
    raise SystemExit(f"completed task has no video URL: {payload}")
print(urls[0])
PY
  )"

  if [[ "$VIDEO_URL" != http://* && "$VIDEO_URL" != https://* ]]; then
    VIDEO_URL="${API_URL%/}${VIDEO_URL}"
  fi
  log "downloading video from $VIDEO_URL"
  curl -fL --retry 2 --max-time 300 "${AUTH_HEADER[@]}" "$VIDEO_URL" -o "$RESULT_FILE"
  if [[ ! -s "$RESULT_FILE" ]]; then
    log "downloaded video is empty"
    exit 1
  fi

  if command -v ffprobe >/dev/null 2>&1; then
    FFPROBE_OUTPUT="$(ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=noprint_wrappers=1 "$RESULT_FILE")"
    printf '%s\n' "$FFPROBE_OUTPUT" >>"$LOG_FILE"
    log "video validated with ffprobe"
  else
    log "ffprobe not installed; skipped media validation"
  fi
fi

MUSIC_SUMMARY=""
if [[ -f "$API_LOG" ]]; then
  MUSIC_SUMMARY="$(uv run python - "$API_LOG" <<'PY'
import re
import sys
from pathlib import Path

ansi_escape = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
for raw_line in Path(sys.argv[1]).read_text().splitlines():
    line = ansi_escape.sub("", raw_line)
    match = re.search(r"BGM selection: mood='([^']+)', .*selected='([^']+)'", line)
    if match:
        print(f"mood={match.group(1)} music={match.group(2)}")
PY
)"
fi
if [[ -n "$MUSIC_SUMMARY" ]]; then
  printf '%s\n' "$MUSIC_SUMMARY" >"$MUSIC_LOG"
else
  printf '%s\n' "mood=$MUSIC_MOOD music=not-found" >"$MUSIC_LOG"
fi

if [[ "$SMOKE_BACKEND" == "vps" ]]; then
  log "smoke test passed; remote publication validated (video was not downloaded)"
else
  log "smoke test passed; video=$RESULT_FILE"
fi
