"""Generate the Option A avatar clip: ryan voice, 720p, LongCat HTTP service."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from app.config import config
from app.models.schema import LipSyncQuality
from app.services import longcat, voice

SCRIPT = (
    "Você tem uma ideia. O Post Engineer monta o vídeo inteiro sozinho: "
    "roteiro, voz sintética, um avatar falando e publicação automática nas redes."
)
IMAGE = sys.argv[1]
OUT = Path(sys.argv[2])

APP = "joaodev904-tech"
secret = Path(sys.argv[3]).read_text().strip()

# Live endpoints for this dev deployment.
config.chatterbox["base_url"] = f"https://{APP}--chatterbox.modal.run/v1"
os.environ["LONGCAT_SUBMIT_URL"] = f"https://{APP}--longcat-http-server-submit.modal.run"
os.environ["LONGCAT_STATUS_URL"] = f"https://{APP}--longcat-http-server-status.modal.run"
os.environ["LONGCAT_DOWNLOAD_URL"] = f"https://{APP}--longcat-http-server-download.modal.run"
os.environ["LONGCAT_HTTP_SECRET"] = secret

OUT.parent.mkdir(parents=True, exist_ok=True)
audio = OUT.parent / "ryan-narration.mp3"

if audio.is_file():
    print(f"[1/3] narration reused ({longcat.audio_duration_seconds(str(audio)):.2f}s)", flush=True)
else:
    print("[1/3] generating narration in ryan voice", flush=True)
    voice.tts(SCRIPT, "chatterbox:ryan", 1.0, str(audio))

# Trim to a whole segment boundary; the service bills by num_segments, which
# the client derives from duration_seconds.
narration_s = longcat.audio_duration_seconds(str(audio))
segments = longcat.segments_for_duration(narration_s)
clip_s = longcat.clip_seconds(segments)
trimmed = OUT.parent / "ryan-clip.mp3"
longcat.trim_audio(str(audio), str(trimmed), duration_seconds=clip_s, padding_seconds=0.0)
print(f"[2/3] trimmed to {longcat.audio_duration_seconds(str(trimmed)):.2f}s "
      f"({segments} segment(s) -> {clip_s:.2f}s rendered)", flush=True)

print("[3/3] submitting 720p job to LongCat ...", flush=True)
started = time.monotonic()
# The client's submit timeout is 120s, which a COLD container (booting the image
# and the GPU before the first byte of response) can exceed. Warm the endpoint
# first with a cheap probe so the real submit is not the one that times out.
import requests  # noqa: E402

probe_url = os.environ["LONGCAT_SUBMIT_URL"]
for attempt in range(1, 6):
    try:
        requests.post(
            probe_url, headers={"Authorization": f"Bearer {secret}"},
            files={"image": ("warm.png", open(IMAGE, "rb"), "image/png"),
                   "audio": ("warm.mp3", open(trimmed, "rb"), "audio/mpeg")},
            data={"quality": "ok", "num_segments": "1"}, timeout=600,
        )
        print(f"      warm-up submit ok (attempt {attempt})", flush=True)
        break
    except requests.exceptions.Timeout:
        print(f"      warm-up timed out (attempt {attempt}), retrying", flush=True)

path, cost = longcat.generate_intro(
    image_path=IMAGE,
    audio_path=str(trimmed),
    quality=LipSyncQuality("very-good"),
    output_path=str(OUT),
    duration_seconds=clip_s,
)
wall = time.monotonic() - started

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=noprint_wrappers=1:nokey=1", str(OUT)],
    capture_output=True, text=True,
)
rendered = round(float(probe.stdout.strip()), 3) if probe.returncode == 0 else None

report = {
    "model": "longcat-video-avatar-1.5",
    "resolution": "720p",
    "quality": "very-good",
    "voice": "chatterbox:ryan (cloned from 'Ryan voice.m4a')",
    "script": SCRIPT,
    "image": IMAGE,
    "num_segments": segments,
    "rendered_seconds": rendered,
    "cost_usd": cost,
    "cost_usd_per_video_second": round(cost / rendered, 6) if rendered else None,
    "wall_seconds": round(wall, 1),
    "video": str(OUT),
}
print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)
OUT.with_suffix(".json").write_text(json.dumps(report, indent=2, ensure_ascii=False))