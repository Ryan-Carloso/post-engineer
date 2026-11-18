#!/usr/bin/env python3
"""Drive the v6 faceless video (INSPIRADOR) on the LOCAL dev engine.

Fixes for every v5 failure (NOTAS-v6):
- Rhythm by NUMBER OF PHOTOS per take (take size does NOT control rhythm;
  TTS speed varies per take and cancels it). hook 40w/5 photos (slow),
  c1 29w/4 (slowest allowed), c2 42w/8 (fast), c3 25w/7 (fastest),
  c4 31w/5 (slow, triumphant). Never two adjacent takes with the same
  photo count. Engine density rule caps how slow a take can go:
  min ceil(words/8) photos per segment (image_density.py); the first
  3/2/7/6/3 plan failed task creation with a 422 masked as 500.
- Text/image per SENTENCE: shot list written before generating; every
  photo shows what its sentence says, never the previous sentence's image.
- No dark frames (floor scene lit by a warm lamp), no anonymous hands
  (notebook shot is her own freckled hand, sage sleeve).
- New story: the dress that stopped zipping (sister's wedding), not the
  scale/jeans again. Mixed media, 29 photos: 18 new Mara AI photos (from
  the original v2 base) + 4 reused Mara shots + 2 reused v3 shots
  (phone, diary) + 5 real Pexels photos (calendar, fridge, small plate,
  water, eggs).
- Facts researched, not invented: Sumithran et al. 2011 NEJM, qualitative
  only (hunger still louder, fullness still weaker a full year later).

Uploads via POST /api/v1/temp_assets, media-checks, creates the task,
polls (3h deadline, v5 hit the 60-min poll limit), downloads the final
mp4. Never touches prod.
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
V5 = os.path.join(ROOT, "images-v5")
V6 = os.path.join(ROOT, "images-v6")
REAL4 = os.path.join(ROOT, "media-v4")
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v6.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order.
# Rhythm plan: hook 5 (slow) / c1 4 (slowest allowed) / c2 8 (fast) /
# c3 7 (fastest) / c4 5 (slow). Never two adjacent takes with the same
# photo count. Engine density rule (image_density.py): min ceil(words/8),
# max floor(words/3) per segment; 29 photos total (cap 30).
PHOTOS = [
    # hook — slow, heavy (40w, 5 photos)
    ("hook", V6, "v6-mara-bed-dress.jpg"),
    ("hook", V6, "v6-mara-dress-hanger.jpg"),
    ("hook", V6, "v6-mara-zipper.jpg"),
    ("hook", V6, "v6-mara-mirror-defeated.jpg"),
    ("hook", V6, "v6-mara-sleeve-detail.jpg"),
    # c1 — low point, slowest (29w, 4 photos)
    ("c1", V6, "v6-mara-floor-wide.jpg"),
    ("c1", V6, "v6-mara-floor.jpg"),
    ("c1", V6, "v6-mara-floor-face.jpg"),
    ("c1", V6, "v6-mara-hem-detail.jpg"),
    # c2 — turning point, fast (42w, 8 photos)
    ("c2", V5, "media-generation-v5-mara-reading-relief-0-82b54ffe-c761-4862-b497-042877058fdf.jpg"),
    ("c2", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("c2", V3, "media-generation-09-content1-diary-0-53b136c7-5619-48fd-81b9-6564b5ae4051.jpg"),
    ("c2", REAL6, "real-calendar.jpg"),
    ("c2", REAL6, "real-fridge.jpg"),
    ("c2", REAL6, "real-small-plate.jpg"),
    ("c2", V6, "v6-mara-notebook.jpg"),
    ("c2", V5, "media-generation-v5-mara-looking-up-0-d2d55a77-3504-4627-9d35-a3be98accc66.jpg"),
    # c3 — plan, fastest cuts (25w, 7 photos)
    ("c3", V4, "media-generation-v4-mara-shoes-0-8b2b1de7-72e7-4928-ae7e-78d952a1b5b3.jpg"),
    ("c3", REAL4, "real-eggs.jpg"),
    ("c3", REAL6, "real-water.jpg"),
    ("c3", V6, "v6-mara-walk-day.jpg"),
    ("c3", V6, "v6-mara-walk-dusk.jpg"),
    ("c3", V6, "v6-mara-walk-night.jpg"),
    ("c3", V6, "v6-mara-walk-rain.jpg"),
    # c4 — victory, slow and triumphant (31w, 5 photos)
    ("c4", V6, "v6-mara-dance.jpg"),
    ("c4", V6, "v6-mara-dance-wide.jpg"),
    ("c4", V6, "v6-mara-dance-sister.jpg"),
    ("c4", V6, "v6-mara-sisters-hug.jpg"),
    ("c4", V5, "media-generation-v5-mara-smile-sunrise-0-b919693e-331a-444f-af53-cb5e3ea55f92.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Six months after my diet ended, I tried on the dress I wore to my sister's wedding, and the zipper stopped halfway up my back. Same dress, same mirror, and I felt like everything I had worked for was gone.",
    "c1": "That night I sat on the bedroom floor in the dress, half zipped, staring at the wall, too ashamed to tell my sister the dress did not fit anymore.",
    "c2": "Then one morning I read something that changed everything. A study had followed people for a full year after their diet, and their hunger was still louder, their fullness still weaker. I wrote three words in my notebook. It was not me.",
    "c3": "So I started again, smaller this time. Eggs for breakfast, water before coffee, and a walk after dinner, every single night, no matter the weather.",
    "c4": "Three months later I danced all night at the wedding in that dress, and this time I knew why it would hold. Save this for the day you want to quit.",
}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"


def word_count(text):
    return len(text.split())


def validate_script():
    """Mechanical segment rules (validate-script endpoint 405s in this build)."""
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
    counts = {"hook": 5, "c1": 4, "c2": 8, "c3": 7, "c4": 5}
    assert sum(counts.values()) == len(PHOTOS) == 29, "photo plan mismatch"
    # Engine density rule: min ceil(words/8), max floor(words/3).
    words = {"hook": 40, "c1": 29, "c2": 42, "c3": 25, "c4": 31}
    for k, n in counts.items():
        lo = (words[k] + 7) // 8
        hi = max(1, words[k] // 3)
        assert lo <= n <= hi, f"{k}: {n} photos outside density [{lo}, {hi}]"
    assert all(counts[k] != counts[o] for k, o in
           zip(["hook", "c1", "c2", "c3"], ["c1", "c2", "c3", "c4"])), \
        "adjacent takes share a photo count"
    print(f"  RHYTHM PLAN: {counts} OK (no adjacent equal counts, density OK)", flush=True)


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
    boundary = "----v6-upload-" + uuid.uuid4().hex
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
              open(os.path.join(ROOT, "task-v6.json"), "w"))

    # 4. Poll until terminal (3h deadline; v5 hit the 60-min limit).
    deadline = time.time() + 3 * 60 * 60
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
            json.dump(body, open(os.path.join(ROOT, "task-v6-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v6.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v5.py adapted to v6 (task-v6-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
