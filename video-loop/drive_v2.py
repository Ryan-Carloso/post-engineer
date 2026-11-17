#!/usr/bin/env python3
"""Drive the v2 faceless video on the LOCAL dev engine (direct API, no web).

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
IMAGES_DIR = os.path.expanduser("~/workspace/video-selfhost/images-v2")
OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
MANIFEST = os.path.join(OUT_DIR, "manifest-v2.json")
BASE = "http://127.0.0.1:8080/api/v1"

BASE_FILE = "media-generation-persona-base-0-dedd67eb-0643-486b-825e-6aa61f40f011.jpg"

# (segment, file) in order. Base photo is hook photo 1.
PHOTOS = [
    ("hook", BASE_FILE),
    ("hook", "media-generation-02-hook-jeans-0-dea579c0-e537-4492-a084-21542796d423.jpg"),
    ("hook", "media-generation-03-hook-waistband-0-3052344d-642a-4b63-a6c9-a750d89874c5.jpg"),
    ("hook", "media-generation-04-hook-kitchen-door-0-292f7ea9-9aca-417c-9bf0-db0524ddc016.jpg"),
    ("hook", "media-generation-05-hook-mirror-0-a0e31e98-6fc3-45bf-a2fe-1122287c888e.jpg"),
    ("hook", "media-generation-10-hook-bed-0-03458188-b12b-411b-92cd-b94c5242ac4e.jpg"),
    ("hook", "media-generation-11-hook-scale-feet-0-348e146b-0889-4b4e-ad6d-7fb09890e487.jpg"),
    ("content", "media-generation-06-content1-diary-0-128cb98d-fe40-4928-a1dc-8a82aa4f1a7f.jpg"),
    ("content", "media-generation-07-content1-counter-0-c9cbe757-74cd-4085-91b2-ff0efc26361c.jpg"),
    ("content", "media-generation-08-content1-spoon-0-3eb6dc66-ea47-49f8-ad5f-af255bdd68ef.jpg"),
    ("content", "media-generation-09-content1-nuts-0-ba30e120-19e4-44a5-979a-c01b22ce0214.jpg"),
    ("content", "media-generation-12-content1-dinner-0-84ca8fa5-dd41-47b4-bf43-b93ee82f1166.jpg"),
    ("content", "media-generation-13-content1-fridge-0-88e177ca-a26f-455c-87e7-01bc405830ff.jpg"),
    ("content", "media-generation-21-content1-taste-0-22d1acec-763d-47b5-abbd-5390f526d60c.jpg"),
    ("content", "media-generation-14-content2-cup-0-97d40de8-fec0-433a-a0ef-249150560fa3.jpg"),
    ("content", "media-generation-15-content2-plate-0-a21be38e-bee5-4037-9c3e-c7b01abefd77.jpg"),
    ("content", "media-generation-16-content2-eating-0-a2c187b0-4eda-4894-949e-51cb4123f4a4.jpg"),
    ("content", "media-generation-17-content2-diary-close-0-6a8dd632-a8e6-482a-941e-79d4b7401d05.jpg"),
    ("content", "media-generation-18-content2-phone-0-859860fc-989a-46f5-932d-a44a44c816e8.jpg"),
    ("content", "media-generation-19-close-smile-0-a2a34caf-e82e-43c5-a5d1-0e78abe7cfeb.jpg"),
    ("content", "media-generation-20-close-walk-0-af4a518f-7bcb-4f26-b463-b30082f251ca.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Three weeks after my diet ended, I stepped on the scale on a Tuesday morning, and the number was back. Same jeans, same mirror \u2014 and I had no idea how it happened so fast.",
    "content1": "That Tuesday I opened my food diary for the first time since the diet. Nothing looked dramatic \u2014 but the portions had crept back. One extra spoon of rice at dinner, a handful of nuts while I cooked.",
    "content2": "So that night I put the measuring cup back on the counter. Same plate, same portions, every night this week. Save this for your week three \u2014 that's when it matters most.",
}

TITLE = "Three weeks after my diet, the scale told the truth"
DESCRIPTION = ("The Tuesday morning I stepped on the scale and the number was back. "
               "It wasn't willpower \u2014 the portions had crept back. "
               "Same plate, same portions, every night this week.")
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
              open(os.path.join(OUT_DIR, "task-v2.json"), "w"))

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
            json.dump(body, open(os.path.join(OUT_DIR, "task-v2-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 25 min")

    # 5. Download final mp4.
    out_path = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v2.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
