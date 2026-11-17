#!/usr/bin/env python3
"""Drive the v3 faceless video on the LOCAL dev engine (direct API, no web).

1. Uploads the 21 AI-generated photos via POST /api/v1/temp_assets.
2. Media-checks every mediaId (fail fast).
3. Creates the task via POST /api/v1/videos (faceless, segments, everly).
4. Polls GET /api/v1/tasks/{id} until terminal.
5. Downloads the final mp4.

Reads MONEYPRINT_API_SECRET from apps/engine/.env in-process; never
prints secret values. Never touches prod.
"""
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
IMAGES_DIR = os.path.expanduser("~/workspace/video-selfhost/images-v3")
OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
MANIFEST = os.path.join(OUT_DIR, "manifest-v3.json")
BASE = "http://127.0.0.1:8080/api/v1"

BASE_FILE = "media-generation-persona-base-0-dedd67eb-0643-486b-825e-6aa61f40f011.jpg"

# (segment, file) in order. Base photo is hook photo 1.
PHOTOS = [
    ("hook", "media-generation-01-hook-scale-0-c4014fbd-f92d-457a-88b1-acb0b1488ce6.jpg"),
    ("hook", "media-generation-02-hook-jeans-0-16f5bbca-56f0-4e92-9392-0522199f263d.jpg"),
    ("hook", "media-generation-03-hook-mirror-0-eb109511-5bec-460e-b064-530784d6844b.jpg"),
    ("hook", "media-generation-04-hook-kitchen-0-3eb4113c-c409-47eb-855b-81dd8b751821.jpg"),
    ("hook", "media-generation-05-hook-bed-0-485195a8-d717-41cb-8950-ffe754a29e11.jpg"),
    ("hook", "media-generation-06-hook-scalefeet-0-2a32cded-e2d2-4964-a435-9d48d5aa0e73.jpg"),
    ("hook", "media-generation-07-hook-scale-display-0-2fe7621b-8468-4f52-b21d-fde06c40a9f6.jpg"),
    ("content", "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("content", "media-generation-09-content1-diary-0-53b136c7-5619-48fd-81b9-6564b5ae4051.jpg"),
    ("content", "media-generation-10-content1-spoon-0-41738072-580e-47fa-af2b-2ba00c21f420.jpg"),
    ("content", "media-generation-11-content1-nuts-0-c24b2b4c-4bb7-4cc0-8f87-4b0510b02639.jpg"),
    ("content", "media-generation-12-content1-dinner-0-c7219d33-b475-4dad-a436-0d9e0f57ac3b.jpg"),
    ("content", "media-generation-13-content1-fridge-0-c8e6b82c-e5b5-4b6e-9ef8-ad61e0cfcbd8.jpg"),
    ("content", "media-generation-14-content1-taste-0-07c884de-e3f5-4bfd-af00-366f1b8fd373.jpg"),
    ("content", "media-generation-15-content2-cup-0-680769ae-13be-4497-93d5-c68deb90a089.jpg"),
    ("content", "media-generation-16-content2-plate-0-114ab8ec-b303-42a2-80b2-5f34279e2795.jpg"),
    ("content", "media-generation-17-content2-breakfast-0-1491ccf5-4ee0-46b6-b08b-0d6cf50c7cda.jpg"),
    ("content", "media-generation-18-content2-diary-close-0-16a1981f-a9c7-45b2-840b-d30b5a39b1bf.jpg"),
    ("content", "media-generation-19-content2-phone-save-0-1727cb95-ef65-44eb-9103-7298a1768590.jpg"),
    ("content", "media-generation-20-close-smile-0-b7ed6d6f-4bc3-48f3-b0f7-d7ec2aa0ea01.jpg"),
    ("content", "media-generation-21-close-walk-0-9cf1b96b-e99b-4b68-9ce0-3495c65d7daf.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Three weeks after my diet ended, I stepped on the scale on a Tuesday morning, and the number was back. Same jeans, same mirror — and I had no idea how it happened so fast.",
    "content1": "That week I found out it wasn't willpower. After a diet, your hunger hormone stays high for months, and the fullness signal stays low. My body was defending its old weight — the hunger was biology, not failure.",
    "content2": "So now I plan for it. Protein at breakfast, the measuring cup back on the counter, same plate every night. Save this for your week three — that's when the hunger hits hardest.",
}

TITLE = "Three weeks after my diet, my body fought back"
DESCRIPTION = ("The Tuesday morning I stepped on the scale and the number was back. "
               "It wasn't willpower — after a diet your hunger hormone stays high for months. "
               "Protein at breakfast, measuring cup out, same plate every night.")
VOICE = "chatterbox:phonon_everly"


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def req(method, url, headers, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"_raw": raw[:500].decode("utf-8", "replace")}


def upload(headers, path):
    boundary = "----v2-upload-" + uuid.uuid4().hex
    with open(path, "rb") as f:
        data = f.read()
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    r = urllib.request.Request(
        BASE + "/temp_assets", data=body, method="POST",
        headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"_raw": raw[:300].decode("utf-8", "replace")}


def main():
    secret = load_env(os.path.join(ENGINE_DIR, ".env")).get("MONEYPRINT_API_SECRET", "")
    if not secret:
        raise SystemExit("MONEYPRINT_API_SECRET missing from engine .env")
    headers = {"Authorization": f"Bearer {secret}",
               "x-user-id": "dev-local",
               "Content-Type": "application/json"}

    # 1. Upload all photos.
    manifest = {}
    if os.path.exists(MANIFEST):
        manifest = json.load(open(MANIFEST))
        print(f"resuming with {len(manifest)} already uploaded", flush=True)
    for kind, name in PHOTOS:
        if name in manifest:
            continue
        path = os.path.join(IMAGES_DIR, name)
        status, data = upload(headers, path)
        body = data.get("body", data)
        url = body.get("url", "") if isinstance(body, dict) else ""
        if status != 200 or not url:
            print(f"upload FAILED {name}: HTTP {status} {str(data)[:300]}", flush=True)
            json.dump(manifest, open(MANIFEST, "w"))
            raise SystemExit(1)
        manifest[name] = url.rsplit("/", 1)[-1]
        print(f"uploaded {name[:40]} -> mediaId {manifest[name][:20]}...", flush=True)
        json.dump(manifest, open(MANIFEST, "w"))
    print(f"uploaded {len(manifest)}/{len(PHOTOS)} images", flush=True)

    # 2. Media-check every mediaId.
    for name, media_id in manifest.items():
        status, data = req("POST", BASE + "/media/check", headers,
                           {"media_id": media_id, "video_aspect": "9:16"})
        body = data.get("body", data)
        ok = body.get("code") == "ok" if isinstance(body, dict) else False
        print(f"check {name[:40]}: HTTP {status} {json.dumps(body)[:200]}", flush=True)
        if status != 200 or not ok:
            raise SystemExit(f"media check FAILED for {name}")
    print("all media checks OK", flush=True)

    # 3. Build segments and create the task.
    by_kind = {"hook": [], "content1": [], "content2": []}
    order = ["hook"] * 7 + ["content1"] * 7 + ["content2"] * 7
    for (kind, name), seg in zip(PHOTOS, order):
        by_kind[seg].append({"mediaId": manifest[name]})
    segments = [
        {"kind": "hook", "text": SEGMENT_TEXT["hook"], "media": by_kind["hook"]},
        {"kind": "content", "text": SEGMENT_TEXT["content1"], "media": by_kind["content1"]},
        {"kind": "content", "text": SEGMENT_TEXT["content2"], "media": by_kind["content2"]},
    ]
    payload = {
        "video_title": TITLE,
        "video_description": DESCRIPTION,
        "video_type": "faceless",
        "video_aspect": "9:16",
        "video_language": "en-US",
        "voice_name": VOICE,
        "segments": segments,
    }
    status, data = req("POST", BASE + "/videos", headers, payload)
    print(f"create task: HTTP {status} {json.dumps(data)[:600]}", flush=True)
    if status != 200:
        raise SystemExit("task creation failed")
    task_id = (data.get("body") or {}).get("task_id") or data.get("task_id")
    if not task_id:
        raise SystemExit(f"no task_id in response: {str(data)[:300]}")
    print(f"task_id={task_id}", flush=True)
    json.dump({"task_id": task_id, "manifest": manifest},
              open(os.path.join(OUT_DIR, "task-v3.json"), "w"))

    # 4. Poll until terminal.
    deadline = time.time() + 25 * 60
    last = ""
    while time.time() < deadline:
        try:
            status, data = req("GET", BASE + f"/tasks/{task_id}", headers)
        except Exception as exc:  # engine busy rendering; retry next round
            print(f"poll timeout ({type(exc).__name__}), retrying", flush=True)
            time.sleep(20)
            continue
        body = data.get("body", data) if isinstance(data, dict) else {}
        state = body.get("state")
        progress = body.get("progress")
        msg = f"state={state} progress={progress}"
        if msg != last:
            print(f"poll: {msg} {json.dumps(body)[:300]}", flush=True)
            last = msg
        if state in (1, -1):
            print(f"TERMINAL state={state}", flush=True)
            print(json.dumps(body)[:2000], flush=True)
            json.dump(body, open(os.path.join(OUT_DIR, "task-v3-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 25 min")

    # 5. Download final mp4 via the resume-capable downloader
    # (signed R2 URL without Bearer header + Range resume).
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(OUT_DIR, "download_v3.py")])
    if r.returncode != 0:
        raise SystemExit("download_v3.py failed")
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
