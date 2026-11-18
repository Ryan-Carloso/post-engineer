#!/usr/bin/env python3
"""Drive the v11 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v10 (NOTAS-v11): fix the drift with MEASURED per-take
audio (v10's word timestamps), not 190 wpm.
- c4 gets a 4th photo (22 words at 171 wpm = 7.42 s of audio+gap for a
  6 s slot is what broke everything downstream in v10: peak drift
  +2.22 s). New 4th photo: v11-study-papers (clean line chart, no text).
- c5a gains one word ("I wrote four words down in my notebook." — 8w;
  also fixes the old three-vs-four slip: "It was not me" is four words).
  The +~0.3 s pushes "It was not me" to ~36.2 s, fully inside the
  36–38 s face slot (v10: started 35.90, 0.1 s before the boundary).
- CTA keeps 12 words / 2 photos, but BOTH photos are new and stay at the
  wedding (v10's field + bathroom selfie are gone): v11-cta-dance
  (slim, laughing, string lights) then v11-cta-zipper (slim, hand on the
  fully closed back zipper — the payoff). Spare 3rd CTA photo
  (v11-cta-dress-hanger) exists for a fail-fast retry only.
- Photo counts from v10 MEASURED audio+gap per segment (cumulative):
  hook 12.50s->6, c1c2 9.58s->5, c3 4.40s->2, c4 7.42s->4, c5a 2.30s->1,
  c5b 1.48s->1, c6 2.84s->1, c7a 1.38s->1, c7b 1.62s->1, c9 4.16s->2,
  c10 5.58s->3, cta 2.36s->2. Total 29 photos, grid 58 s.
  Predicted drift (audio start minus grid start): hook 0, c1c2 +0.5,
  c3 +0.08, c4 +0.48, c5a -0.1, c5b +0.2, c6 -0.32, c7a +0.52, c7b -0.1,
  c9 -0.48, c10 -0.32, cta -0.74. Peak |drift| ~0.75 s (v10: 2.22 s).
  "It was not me" fully on the face photo; "Eggs for breakfast" fully
  on the eggs photo.
- Body timeline unchanged from v10 (verified there): HEAVY 0–46 s,
  SLIM 46–56 s. All reused photos were body-state verified in v10.
- Rhythm: the 2.0 s metronome is the engine's global queue (PR #652 not
  in this build) — not fixable from the script; accepted as the ceiling.
- CTA burst (305 wpm in v10) is a TTS property of the final take, not a
  length problem — 12 words kept, no further length experiments.

Facts: Sumithran et al. 2011 NEJM 365:1597-604, PMID 22029981,
re-verified by web search this round — qualitative only (hunger still
louder, fullness still weaker a full year later).

Uploads via POST /api/v1/temp_assets, media-checks, creates the task,
polls (3h deadline), downloads the final mp4. Never touches prod.
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
V3 = os.path.join(ROOT, "images-v3")
V4 = os.path.join(ROOT, "images-v4")
V5 = os.path.join(ROOT, "images-v5")
V6 = os.path.join(ROOT, "images-v6")
V7 = os.path.join(ROOT, "images-v7")
V8 = os.path.join(ROOT, "images-v8")
V9 = os.path.join(ROOT, "images-v9")
V10 = os.path.join(ROOT, "images-v10")
V11 = os.path.join(ROOT, "images-v11")
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v11.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order. One segment per beat; each
# segment's photos show ONLY what that segment says.
PHOTOS = [
    # hook — the dress will not zip (40w, 6 photos; HEAVIER version)
    ("hook", V10, "v10-bed-dress.jpg"),
    ("hook", V7, "v7-dress-hanger.jpg"),
    ("hook", V9, "v9-zipper.jpg"),
    ("hook", V9, "v9-mirror-defeated.jpg"),
    ("hook", V10, "v10-mirror-full.jpg"),
    ("hook", V10, "v10-mirror-face.jpg"),
    # c1c2 — on the floor, too ashamed to tell her sister (33w, 5 photos)
    ("c1c2", V9, "v9-floor-wide.jpg"),
    ("c1c2", V9, "v9-floor.jpg"),
    ("c1c2", V9, "v9-floor-face.jpg"),
    ("c1c2", V9, "v9-bed-phone.jpg"),
    ("c1c2", V10, "v10-dress-floor.jpg"),
    # c3 — one morning I read, over coffee (11w, 2 photos)
    ("c3", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("c3", V9, "v9-reading-relief.jpg"),
    # c4 — the study (22w, 4 photos; charts have NO readable text)
    ("c4", V8, "v8-study-chart.jpg"),
    ("c4", V10, "v10-chart-laptop.jpg"),
    ("c4", V11, "v11-study-papers.jpg"),
    ("c4", REAL6, "real-small-plate.jpg"),
    # c5a — three words in my notebook (6w, 1 photo)
    ("c5a", V9, "v9-notebook-writing.jpg"),
    # c5b — It was not me. (4w, 1 photo: the realization face)
    ("c5b", V10, "v10-face-realization.jpg"),
    # c6 — started again (7w, 1 photo; HEAVIER shoes, not the slim v4 one)
    ("c6", V10, "v10-shoes-heavy.jpg"),
    # c7a — eggs for breakfast (3w, 1 photo)
    ("c7a", V9, "v9-eggs.jpg"),
    # c7b — water before coffee (3w, 1 photo)
    ("c7b", V9, "v9-water-coffee.jpg"),
    # c9 — the walk (11w, 2 photos: day, night; HEAVIER, not the slim v6 ones)
    ("c9", V10, "v10-walk-day-heavy.jpg"),
    ("c9", V10, "v10-walk-night-heavy.jpg"),
    # c10 — dancing at the wedding (22w, 3 photos; SLIM version, heels)
    ("c10", V9, "v9-dance.jpg"),
    ("c10", V9, "v9-dance-wide-shoes.jpg"),
    ("c10", V9, "v9-sisters-hug.jpg"),
    # cta — Save this for the day you want to quit and start again. (12w, 2 photos; SLIM, at the wedding)
    ("cta", V11, "v11-cta-dance.jpg"),
    ("cta", V11, "v11-cta-zipper.jpg"),
    # 30th photo (RETRY: task a28e78c5 failed images_do_not_cover_audio —
    # 29 photos cover 56.1s of 57.0s. The squeeze is structural: c4's 4th
    # photo + c1c2/c10 density put more photos than span/2 in those
    # segments, so extend_over_gaps caps photos below 2s and the total
    # coverage is grid minus ~1.9s of squeeze. The 3rd CTA photo is the
    # only shift-free slot: it extends coverage to ~58.1s and only the
    # CTA moves. v11-cta-dress-hanger: SLIM, sage t-shirt + jeans,
    # holding the navy dress on a hanger, hopeful — verified full-size.
    # CTA density 3 photos for 12 words is inside [2, 4].)
    ("cta", V11, "v11-cta-dress-hanger.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Six months after my diet ended, I tried on the dress I wore to my sister's wedding, and the zipper stopped halfway up my back. Same dress, same mirror, and I felt like everything I had worked for was gone.",
    "c1c2": "That night I sat on the bedroom floor in the dress, half zipped, staring at the wall, too ashamed to tell my sister the dress did not fit anymore, so I said nothing.",
    "c3": "Then one morning, over coffee, I read something that changed everything.",
    "c4": "A study had followed people for a full year after their diet, and their hunger was still louder, their fullness still weaker.",
    "c5a": "I wrote four words down in my notebook.",
    "c5b": "It was not me.",
    "c6": "So I started again, smaller this time.",
    "c7a": "Eggs for breakfast.",
    "c7b": "Water before coffee.",
    "c9": "A walk after dinner, every single night, no matter the weather.",
    "c10": "Three months later I danced all night at the wedding in that dress, and this time I knew why it would hold.",
    "cta": "Save this for the day you want to quit and start again.",
}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"
ORDER = ["hook", "c1c2", "c3", "c4", "c5a", "c5b", "c6", "c7a", "c7b",
         "c9", "c10", "cta"]
COUNTS = {"hook": 6, "c1c2": 5, "c3": 2, "c4": 4, "c5a": 1, "c5b": 1,
          "c6": 1, "c7a": 1, "c7b": 1, "c9": 2, "c10": 3, "cta": 3}


def word_count(text):
    return len(text.split())


def validate_script():
    """Mechanical segment rules (validate-script endpoint 405s in this build)."""
    assert len(ORDER) <= 12, "too many segments"
    total = 0
    seen = set()
    for i, key in enumerate(ORDER):
        text = SEGMENT_TEXT[key]
        kind = "hook" if i == 0 else "content"
        wc = word_count(text)
        total += wc
        assert text not in seen, f"repeated segment text: {key}"
        seen.add(text)
        if i == 0:
            assert text[-1] in ".!?", f"{key} lacks terminal punctuation"
        assert "—" not in text and "[" not in text and "]" not in text, f"{key} has forbidden chars"
        assert "http" not in text and "://" not in text, f"{key} has a link"
        if i == 0:
            assert 25 <= wc <= 40, f"hook word count {wc} outside 25-40"
        # Density rule: min ceil(words/8), max floor(words/3).
        lo = (wc + 7) // 8
        hi = max(1, wc // 3)
        n = COUNTS[key]
        assert lo <= n <= hi, f"{key}: {n} photos outside density [{lo}, {hi}] for {wc} words"
        print(f"  {key} ({kind}): {wc} words, {n} photos, density [{lo}, {hi}] OK", flush=True)
    content_total = total - word_count(SEGMENT_TEXT["hook"])
    assert content_total >= 30, "content total < 30 words"
    assert 60 <= total <= 200, f"total word count {total} outside 60-200"
    print(f"  TOTAL: {total} words, {len(ORDER)} segments OK", flush=True)
    assert sum(COUNTS.values()) == len(PHOTOS) == 30, "photo plan mismatch"


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
    boundary = "----v11-upload-" + uuid.uuid4().hex
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
    by_kind = {k: [] for k in ORDER}
    for kind, d, name in PHOTOS:
        by_kind[kind].append({"mediaId": manifest[f"{os.path.basename(d)}/{name}"]})
    segments = [
        {"kind": "hook" if k == "hook" else "content",
         "text": SEGMENT_TEXT[k], "media": by_kind[k]}
        for k in ORDER
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
              open(os.path.join(ROOT, "task-v11.json"), "w"))

    # 4. Poll until terminal (3h deadline).
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
            json.dump(body, open(os.path.join(ROOT, "task-v11-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v11.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v11.py (task-v11-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
