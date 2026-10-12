"""Submit the 720p LongCat job directly, with a long cold-container timeout.

The engine client's submit timeout is 120s, which a cold H200 container cannot
meet (image boot + GPU attach). This drives the same HTTP contract with a
generous timeout and reports cost exactly like the client does.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

import requests

APP = "joaodev904-tech"
SUBMIT = f"https://{APP}--longcat-http-server-submit.modal.run"
STATUS = f"https://{APP}--longcat-http-server-status.modal.run"
DOWNLOAD = f"https://{APP}--longcat-http-server-download.modal.run"

image, audio, out, secret_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
secret = Path(secret_file).read_text().strip()
headers = {"Authorization": f"Bearer {secret}"}
out = Path(out)
out.parent.mkdir(parents=True, exist_ok=True)

started = time.monotonic()
print("submitting (timeout 30min for cold container) ...", flush=True)
with open(image, "rb") as img, open(audio, "rb") as aud:
    r = requests.post(
        SUBMIT,
        files={"image": ("ref.jpg", img, "image/jpeg"), "audio": ("a.mp3", aud, "audio/mpeg")},
        data={"quality": sys.argv[5] if len(sys.argv)>5 else "very-good", "num_segments": "3"},
        headers=headers, timeout=1800,
    )
print(f"submit -> {r.status_code}", flush=True)
if r.status_code >= 300:
    print(r.text[:600], flush=True)
    raise SystemExit(1)
job_id = r.json()["job_id"]
print(f"job_id={job_id}  submit_wall={time.monotonic()-started:.0f}s", flush=True)

payload = {}
while time.monotonic() - started < 5400:
    s = requests.post(STATUS, data={"job_id": job_id}, headers=headers, timeout=120)
    payload = s.json()
    print(f"  [{time.strftime('%H:%M:%S')}] {payload.get('status')} "
          f"{payload.get('phase')} {payload.get('progress')}%", flush=True)
    if payload.get("status") in ("done", "failed"):
        break
    time.sleep(10)

if payload.get("status") != "done":
    print("FAILED:", json.dumps(payload)[:400], flush=True)
    raise SystemExit(1)

d = requests.post(DOWNLOAD, data={"job_id": job_id}, headers=headers, timeout=600)
out.write_bytes(d.content)

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=noprint_wrappers=1:nokey=1", str(out)],
    capture_output=True, text=True,
)
rendered = round(float(probe.stdout.strip()), 3) if probe.returncode == 0 else None
report = {
    "model": "longcat-video-avatar-1.5", "resolution": sys.argv[5] if len(sys.argv)>5 else "very-good",
    "quality": sys.argv[5] if len(sys.argv)>5 else "very-good", "job_id": job_id,
    "num_segments": 3, "rendered_seconds": rendered,
    "cost_usd": payload.get("cost_usd"),
    "wall_seconds": round(time.monotonic() - started, 1),
    "video": str(out), "status_payload": payload,
}
print(json.dumps({k: v for k, v in report.items() if k != "status_payload"}, indent=2), flush=True)
out.with_suffix(".json").write_text(json.dumps(report, indent=2))