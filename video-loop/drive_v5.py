#!/usr/bin/env python3
"""Drive the v5 faceless video (INSPIRADOR) on the LOCAL dev engine.

Fixes for every v4 failure (NOTAS-v5):
- Visible emotional beats: low point genuinely low (cold blue light,
  defeated sitting), turning point opens its segment with the phone,
  rise ends in golden sunrise.
- Rhythm contrast by segment size: hook 37w/7 photos (~1.7s),
  low 28w/5 (~1.8s), turning 41w/8 (~1.65s), plan 27w/7 (~1.24s),
  victory 25w/6 (~1.33s). First half slow/heavy, second half fast cuts.
- Text/image per SENTENCE: 5 segments (one per beat), photos ordered to
  match the sentence playing when they show.
- Mixed media: 5 new Mara AI photos (from the original v2 base) + reused
  v2/v3/v4 shots + 6 real Pexels photos (media-v4) + 2 real photos
  (media-v5, Pexels/Openverse, sources-v5.json).
- Facts researched, not invented: Sumithran et al. 2011 NEJM, qualitative
  only (hunger still louder, fullness still weaker a full year later).

Uploads via POST /api/v1/temp_assets, media-checks, creates the task,
polls, downloads the final mp4. Never touches prod.
"""
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.request
import uuid

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
ROOT = os.path.expanduser("~/workspace/video-selfhost")
V2 = os.path.join(ROOT, "images-v2")
V3 = os.path.join(ROOT, "images-v3")
V4 = os.path.join(ROOT, "images-v4")
V5 = os.path.join(ROOT, "images-v5")
REAL4 = os.path.join(ROOT, "media-v4")
REAL5 = os.path.join(ROOT, "media-v5")
MANIFEST = os.path.join(ROOT, "manifest-v5.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order.
PHOTOS = [
    # hook — slow, heavy (37w, 7 photos)
    ("hook", REAL4, "real-scale.jpg"),
    ("hook", V3, "media-generation-01-hook-scale-0-c4014fbd-f92d-457a-88b1-acb0b1488ce6.jpg"),
    ("hook", V3, "media-generation-02-hook-jeans-0-16f5bbca-56f0-4e92-9392-0522199f263d.jpg"),
    ("hook", REAL4, "real-jeans.jpg"),
    ("hook", V3, "media-generation-03-hook-mirror-0-eb109511-5bec-460e-b064-530784d6844b.jpg"),
    ("hook", V3, "media-generation-05-hook-bed-0-485195a8-d717-41cb-8950-ffe754a29e11.jpg"),
    ("hook", V2, "media-generation-03-hook-waistband-0-3052344d-642a-4b63-a6c9-a750d89874c5.jpg"),
    # c1 — low point (28w, 5 photos)
    ("c1", V5, "media-generation-v5-mara-defeated-sitting-0-4d48298c-6a23-4274-97a7-76f1a591798d.jpg"),
    ("c1", V2, "media-generation-02-hook-jeans-0-dea579c0-e537-4492-a084-21542796d423.jpg"),
    ("c1", V5, "media-generation-v5-mara-ceiling-0-ef222d57-88b3-43fa-94ba-42153c678af5.jpg"),
    ("c1", REAL5, "real-night-window.jpg"),
    ("c1", V2, "media-generation-10-hook-bed-0-03458188-b12b-411b-92cd-b94c5242ac4e.jpg"),
    # c2 — turning point (41w, 8 photos; phone FIRST = the turning moment)
    ("c2", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("c2", V5, "media-generation-v5-mara-reading-relief-0-82b54ffe-c761-4862-b497-042877058fdf.jpg"),
    ("c2", REAL5, "real-study.jpg"),
    ("c2", V3, "media-generation-09-content1-diary-0-53b136c7-5619-48fd-81b9-6564b5ae4051.jpg"),
    ("c2", V5, "media-generation-v5-mara-looking-up-0-d2d55a77-3504-4627-9d35-a3be98accc66.jpg"),
    ("c2", REAL4, "real-sunrise.jpg"),
    ("c2", V2, "media-generation-17-content2-diary-close-0-6a8dd632-a8e6-482a-941e-79d4b7401d05.jpg"),
    # c3 — plan, faster cuts (27w, 6 photos)
    ("c3", V4, "media-generation-v4-mara-cook-0-14dbb9ce-7138-415a-9a98-4b22e9199379.jpg"),
    ("c3", REAL4, "real-eggs.jpg"),
    ("c3", V3, "media-generation-17-content2-breakfast-0-1491ccf5-4ee0-46b6-b08b-0d6cf50c7cda.jpg"),
    ("c3", REAL4, "real-shoes.jpg"),
    ("c3", V4, "media-generation-v4-mara-shoes-0-8b2b1de7-72e7-4928-ae7e-78d952a1b5b3.jpg"),
    ("c3", V3, "media-generation-15-content2-cup-0-680769ae-13be-4497-93d5-c68deb90a089.jpg"),
    # c4 — victory, fastest cuts (25w, 5 photos)
    ("c4", V4, "media-generation-v4-mara-mirror-win-0-bd154271-8b45-45b8-ae4d-ddf67722127d.jpg"),
    ("c4", V3, "media-generation-20-close-smile-0-b7ed6d6f-4bc3-48f3-b0f7-d7ec2aa0ea01.jpg"),
    ("c4", V4, "media-generation-v4-mara-run-0-b230020a-8d5a-4d3d-9b35-e93c8a9d48cb.jpg"),
    ("c4", V3, "media-generation-21-close-walk-0-9cf1b96b-e99b-4b68-9ce0-3495c65d7daf.jpg"),
    ("c4", V5, "media-generation-v5-mara-smile-sunrise-0-b919693e-331a-444f-af53-cb5e3ea55f92.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Three weeks after my diet ended, I stood on the scale in my kitchen, and the number was back. Same jeans, same mirror, and I felt like I had failed at the one thing I promised myself.",
    "c1": "That night I sat on the edge of the bed in my jeans, staring at the ceiling, too ashamed to tell anyone I was back at the start.",
    "c2": "Then one morning I read something that changed everything. A study had followed people for a full year after their diet, and their hunger was still louder, their fullness still weaker. My body was not betraying me. It was protecting me.",
    "c3": "So I started again, smaller this time. Protein at breakfast, a walk after dinner, and the measuring cup back on the counter where I could see it.",
    "c4": "Three months later the jeans fit again, and this time I knew why it would hold. Save this for the day you want to quit.",
}

TITLE = "Three weeks after my diet, I thought I had failed"
DESCRIPTION = ("The morning the scale showed the number was back, I thought I "
               "had failed my diet. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"


def word_count(text):
    return len(text.split())


def validate_script():
    """Mechanical segment rules (no validate-script endpoint in this build)."""
    order = ["hook", "c1", "c2", "c3", "c4"]
    assert len(order) <= 12, "too many segments"
    total = 0
    seen = set()
    for i, key in enumerate(order):
        text = SEGMENT_TEXT[key]
        kind = "hook" if i == 0 else "content"
        wc = word_count(text)
        total += wc
        assert text not in seen, f"repeated segment text: {key}"
        seen.add(text)
        assert text[-1] in ".!?", f"{key} lacks terminal punctuation"
        assert "—" not in text and "[" not in text and "]" not in text, f"{key} has forbidden chars"
        assert "http" not in text and "://" not in text, f"{key} has a link"
        if i == 0:
            assert 25 <= wc <= 40, f"hook word count {wc} outside 25-40"
        print(f"  {key} ({kind}): {wc} words OK", flush=True)
    content_total = total - word_count(SEGMENT_TEXT["hook"])
    assert content_total >= 30, "content total < 30 words"
    assert 60 <= total <= 200, f"total word count {total} outside 60-200"
    print(f"  TOTAL: {total} words OK", flush=True)


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
    boundary = "----v5-upload-" + uuid.uuid4().hex
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
    print("validating script (mechanical rules):", flush=True)
    validate_script()

    # Sanity: every photo exists, no file used twice.
    seen_files = set()
    for kind, d, name in PHOTOS:
        path = os.path.join(d, name)
        assert os.path.exists(path), f"missing photo: {path}"
        assert path not in seen_files, f"photo used twice: {path}"
        seen_files.add(path)
    print(f"photos: {len(PHOTOS)} distinct files OK", flush=True)

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
    order = ["hook", "c1", "c2", "c3", "c4"]
    by_kind = {k: [] for k in order}
    for kind, d, name in PHOTOS:
        by_kind[kind].append({"mediaId": manifest[f"{os.path.basename(d)}/{name}"]})
    segments = [
        {"kind": "hook" if k == "hook" else "content",
         "text": SEGMENT_TEXT[k], "media": by_kind[k]}
        for k in order
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
              open(os.path.join(ROOT, "task-v5.json"), "w"))

    # 4. Poll until terminal.
    deadline = time.time() + 60 * 60
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
            json.dump(body, open(os.path.join(ROOT, "task-v5-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 60 min")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v5.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v4.py adapted to v5 (task-v5-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
