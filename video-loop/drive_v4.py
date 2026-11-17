#!/usr/bin/env python3
"""Drive the v4 faceless video (INSPIRADOR) on the LOCAL dev engine.

Mixed media: Mara AI photos (new in images-v4 + reused v3 shots, all from
the same original base) + real CC photos (media-v4, Openverse).
Rhythm contrast by design: hook 6 photos (~1.8s each, slow/heavy),
content1 7 (~1.7s), content2 8 (~1.4s, faster cuts).
Uploads via POST /api/v1/temp_assets, media-checks, creates the task,
polls, downloads the final mp4. Never touches prod.
"""
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
import uuid

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
ROOT = os.path.expanduser("~/workspace/video-selfhost")
V2 = os.path.join(ROOT, "images-v2")
V3 = os.path.join(ROOT, "images-v3")
V4 = os.path.join(ROOT, "images-v4")
REAL = os.path.join(ROOT, "media-v4")
MANIFEST = os.path.join(ROOT, "manifest-v4.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order.
PHOTOS = [
    # hook — low point, slow
    ("hook", V3, "media-generation-01-hook-scale-0-c4014fbd-f92d-457a-88b1-acb0b1488ce6.jpg"),
    ("hook", V3, "media-generation-02-hook-jeans-0-16f5bbca-56f0-4e92-9392-0522199f263d.jpg"),
    ("hook", V3, "media-generation-05-hook-bed-0-485195a8-d717-41cb-8950-ffe754a29e11.jpg"),
    ("hook", REAL, "real-scale.jpg"),
    ("hook", V3, "media-generation-03-hook-mirror-0-eb109511-5bec-460e-b064-530784d6844b.jpg"),
    ("hook", REAL, "real-jeans.jpg"),
    # content1 — turning point
    ("content1", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("content1", REAL, "real-eggs.jpg"),
    ("content1", V3, "media-generation-09-content1-diary-0-53b136c7-5619-48fd-81b9-6564b5ae4051.jpg"),
    ("content1", V3, "media-generation-10-content1-spoon-0-41738072-580e-47fa-af2b-2ba00c21f420.jpg"),
    ("content1", V3, "media-generation-13-content1-fridge-0-c8e6b82c-e5b5-4b6e-9ef8-ad61e0cfcbd8.jpg"),
    ("content1", V4, "media-generation-v4-mara-cook-0-14dbb9ce-7138-415a-9a98-4b22e9199379.jpg"),
    ("content1", REAL, "real-sunrise.jpg"),
    # content2 — rise, faster cuts
    ("content2", V3, "media-generation-15-content2-cup-0-680769ae-13be-4497-93d5-c68deb90a089.jpg"),
    ("content2", V4, "media-generation-v4-mara-shoes-0-8b2b1de7-72e7-4928-ae7e-78d952a1b5b3.jpg"),
    ("content2", REAL, "real-shoes.jpg"),
    ("content2", V4, "media-generation-v4-mara-run-0-b230020a-8d5a-4d3d-9b35-e93c8a9d48cb.jpg"),
    ("content2", V3, "media-generation-16-content2-plate-0-114ab8ec-b303-42a2-80b2-5f34279e2795.jpg"),
    ("content2", REAL, "real-bowl.jpg"),
    ("content2", V4, "media-generation-v4-mara-mirror-win-0-bd154271-8b45-45b8-ae4d-ddf67722127d.jpg"),
    ("content2", V3, "media-generation-21-close-walk-0-9cf1b96b-e99b-4b68-9ce0-3495c65d7daf.jpg"),
]

SEGMENT_TEXT = {
    "hook": "I stood on the scale in my kitchen, and the number was back. Same jeans, same mirror, and I felt like I had failed at the one thing I promised myself I would never do again.",
    "content1": "Then that week I learned it was not willpower. A study followed people for a full year after their diet, and the hunger was still louder, the fullness signal still weaker. My body was not betraying me, it was protecting me.",
    "content2": "So I started again, smaller this time. Protein at breakfast, a walk after dinner, the measuring cup back on the counter. Three months later the jeans fit again, and this time I knew why it would hold. Save this for the day you want to quit.",
}

TITLE = "I thought I had failed my diet. Then I started again"
DESCRIPTION = ("The morning the scale showed the number was back, I thought I "
               "had failed. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
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
    boundary = "----v4-upload-" + uuid.uuid4().hex
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
    for kind, d, name in PHOTOS:
        key = f"{os.path.basename(d)}/{name}"
        if key in manifest:
            continue
        path = os.path.join(d, name)
        status, data = upload(headers, path)
        body = data.get("body", data)
        url = body.get("url", "") if isinstance(body, dict) else ""
        if status != 200 or not url:
            print(f"upload FAILED {name}: HTTP {status} {str(data)[:300]}", flush=True)
            json.dump(manifest, open(MANIFEST, "w"))
            raise SystemExit(1)
        manifest[key] = url.rsplit("/", 1)[-1]
        print(f"uploaded {name[:40]} -> mediaId {manifest[key][:20]}...", flush=True)
        json.dump(manifest, open(MANIFEST, "w"))
    print(f"uploaded {len(manifest)}/{len(PHOTOS)} images", flush=True)

    # 2. Media-check every mediaId.
    for key, media_id in manifest.items():
        status, data = req("POST", BASE + "/media/check", headers,
                           {"media_id": media_id, "video_aspect": "9:16"})
        body = data.get("body", data)
        ok = body.get("code") == "ok" if isinstance(body, dict) else False
        print(f"check {key[:50]}: HTTP {status} {json.dumps(body)[:200]}", flush=True)
        if status != 200 or not ok:
            raise SystemExit(f"media check FAILED for {key}")
    print("all media checks OK", flush=True)

    # 3. Build segments and create the task.
    by_kind = {"hook": [], "content1": [], "content2": []}
    for (kind, d, name), seg in zip(PHOTOS, ["hook"] * 6 + ["content1"] * 7 + ["content2"] * 8):
        by_kind[seg].append({"mediaId": manifest[f"{os.path.basename(d)}/{name}"]})
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
              open(os.path.join(ROOT, "task-v4.json"), "w"))

    # 4. Poll until terminal.
    deadline = time.time() + 45 * 60
    last = ""
    while time.time() < deadline:
        try:
            status, data = req("GET", BASE + f"/tasks/{task_id}", headers)
        except Exception as exc:
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
            json.dump(body, open(os.path.join(ROOT, "task-v4-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 45 min")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v4.mp4")
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
