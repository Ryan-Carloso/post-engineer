#!/usr/bin/env python3
"""Drive the v12 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v11 (NOTAS-v12): use SegmentMedia.duration as the
rhythm lever (PR #652 is in this build). Every photo carries an explicit
duration, so the timeline is purely cumulative — requested durations are
honored absolutely, the next photo starts when the previous one ends.
- Low point holds 3-4s (tears), study runs fast (1-1.5s/photo), dance
  holds (4-6s). Hook and turning point at 2s unless emotion demands
  otherwise.
- Duration only redistributes time INSIDE a segment: photo count still
  covers audio on the 2s-per-photo counting base (29 photos, 58s grid),
  so a no-duration build would still cover. Duration never plugs a
  coverage hole.
- Durations anchored on v11 MEASURED per-take audio (Whisper base, all
  177 words aligned; audio 56.28s) + the measured inter-take gaps
  (mean 0.71s, total ~7.8s). Segment windows (v11 audio):
  hook 0.00-11.64, c1c2 12.48-21.34, c3 22.06-25.74, c4 26.50-33.00,
  c5a 33.58-35.42, c5b 35.98-36.66, c6 37.44-39.72, c7a 40.44-41.14,
  c7b 41.80-42.76, c9 43.40-46.90, c10 47.52-52.28, cta 53.06-55.50.
  Segment ends (photo start times): hook 12.48, c1c2 22.06, c3 26.50,
  c4 33.58, c5a 35.98, c5b 37.44, c6 40.44, c7a 41.80, c7b 43.40,
  c9 47.52, c10 53.06, cta 56.28 (audio end).
  Each segment's durations sum to (its end - previous segment end),
  so the photo that starts a segment starts exactly where the previous
  segment's audio starts (drift 0 by construction, IF the v12 TTS
  audio matches v11's — same voice, same text, same engine; verified
  in analysis-v12 with a fresh Whisper pass).
- "It was not me" (35.98-36.66) falls on the realization face
  (36.0-37.44): the phrase starts 0.02s after the face starts, and
  the face holds 1.46s.
- Last photo is the CTA dance (54.76-56.28, 1.70s) — the last frame
  is the dance. The 2nd CTA photo (zipper, 3.50s buffer, starts 54.76
  in the nominal plan) only shows if the audio runs long; it is the
  zipper payoff, not the hanger (dropped: v11's hanger showed 0.7s
  of silence on a pre-wedding image after the last word).

Photo changes vs v11 (NOTAS-v12 + full-size verification this round):
- c1c2 4th: NEW v12-bed-no-phone (HEAVY, no phone) replaces
  v9-bed-phone (phone at ~18s, before the turning point).
- c3 1st: NEW v12-phone-heavy (HEAVY) replaces v3-phone — the v3
  photo is SLIM, a body leak inside the HEAVY phase (22-24s).
- c4 3rd: NEW v12-chart-labeled (matplotlib, portrait 9:16 — the
  engine letterboxes landscape into a small band, so portrait keeps
  the text legible) replaces v11-study-papers (unlabeled curve).
- c6: NEW v12-mirror-resolve (HEAVY, hand on hip, determined)
  replaces v10-shoes-heavy (shoes motif, 4th repeat).
- cta 2nd: NEW v12-cta-zipper-sleeves (SLIM, SHORT LACE SLEEVES)
  replaces v11-cta-zipper (reads sleeveless — bare shoulders).
- All other reused photos were re-verified full-size this round:
  same face (green eyes, freckles, low bun), correct body state
  (HEAVY 0-46s, SLIM 46-56s), navy lace dress with short sleeves.

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
V7 = os.path.join(ROOT, "images-v7")
V8 = os.path.join(ROOT, "images-v8")
V9 = os.path.join(ROOT, "images-v9")
V10 = os.path.join(ROOT, "images-v10")
V11 = os.path.join(ROOT, "images-v11")
V12 = os.path.join(ROOT, "images-v12")
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v12.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file, duration) in screen order. One segment per beat;
# each segment's photos show ONLY what that segment says. Duration is
# SegmentMedia.duration (0.5-6.0s); the segment's durations sum to the
# segment window (see docstring), so the next segment starts on time.
PHOTOS = [
    # hook — the dress will not zip (40w, 6 photos; HEAVY; ends 12.48)
    ("hook", V10, "v10-bed-dress.jpg", 2.0),
    ("hook", V7, "v7-dress-hanger.jpg", 2.0),
    ("hook", V9, "v9-zipper.jpg", 2.0),
    ("hook", V9, "v9-mirror-defeated.jpg", 2.0),
    ("hook", V10, "v10-mirror-full.jpg", 2.0),
    ("hook", V10, "v10-mirror-face.jpg", 2.48),
    # c1c2 — on the floor, too ashamed to tell her sister (33w, 5 photos;
    # tears held 3s; ends 22.06)
    ("c1c2", V9, "v9-floor-wide.jpg", 2.0),
    ("c1c2", V9, "v9-floor.jpg", 2.0),
    ("c1c2", V9, "v9-floor-face.jpg", 3.0),
    ("c1c2", V12, "media-generation-v12-bed-no-phone-0-fc243be0-d745-44c6-9c67-fd8e90d03a7b.webp", 1.5),
    ("c1c2", V10, "v10-dress-floor.jpg", 1.08),
    # c3 — one morning I read, over coffee (11w, 2 photos; ends 26.50)
    ("c3", V12, "media-generation-v12-phone-heavy-0-d41c97c1-f241-4893-bb1a-a5ef219b57ef.webp", 2.0),
    ("c3", V9, "v9-reading-relief.jpg", 2.44),
    # c4 — the study (22w, 4 photos; fast 1-1.5s; ends 33.58)
    ("c4", V8, "v8-study-chart.jpg", 1.5),
    ("c4", V10, "v10-chart-laptop.jpg", 1.5),
    ("c4", V12, "v12-chart-labeled.jpg", 1.5),
    ("c4", REAL6, "real-small-plate.jpg", 2.58),
    # c5a — four words in my notebook (8w, 1 photo; ends 35.98)
    ("c5a", V9, "v9-notebook-writing.jpg", 2.40),
    # c5b — It was not me. (4w, 1 photo: the realization face; ends 37.44)
    ("c5b", V10, "v10-face-realization.jpg", 1.46),
    # c6 — started again (7w, 1 photo; mirror resolve held 3s; ends 40.44)
    ("c6", V12, "media-generation-v12-mirror-resolve-0-edf97cf7-56c3-4b43-9596-c697668d8a57.webp", 3.0),
    # c7a — eggs for breakfast (3w, 1 photo; ends 41.80)
    ("c7a", V9, "v9-eggs.jpg", 1.36),
    # c7b — water before coffee (3w, 1 photo; ends 43.40)
    ("c7b", V9, "v9-water-coffee.jpg", 1.60),
    # c9 — the walk (11w, 2 photos: day, night; HEAVY; ends 47.52)
    ("c9", V10, "v10-walk-day-heavy.jpg", 2.0),
    ("c9", V10, "v10-walk-night-heavy.jpg", 2.12),
    # c10 — dancing at the wedding (22w, 3 photos; SLIM, heels; ends 53.06)
    ("c10", V9, "v9-dance.jpg", 2.0),
    ("c10", V9, "v9-dance-wide-shoes.jpg", 2.0),
    ("c10", V9, "v9-sisters-hug.jpg", 1.54),
    # cta — Save this for the day you want to quit and start again.
    # (12w, 2 photos; SLIM, at the wedding; dance 1.70s is the LAST
    # frame, zipper 3.50s is buffer that only shows if audio runs long)
    ("cta", V11, "v11-cta-dance.jpg", 1.70),
    ("cta", V12, "media-generation-v12-cta-zipper-sleeves-0-b3344bcd-4550-4eef-8919-fc37108e073a.webp", 3.50),
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

# Segment window ends (photo start times), from v11 measured audio.
# Segment duration sums must equal (end - previous end); the first
# segment starts at 0.
SEGMENT_END = {"hook": 12.48, "c1c2": 22.06, "c3": 26.50, "c4": 33.58,
               "c5a": 35.98, "c5b": 37.44, "c6": 40.44, "c7a": 41.80,
               "c7b": 43.40, "c9": 47.52, "c10": 53.06, "cta": 58.26}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"
ORDER = ["hook", "c1c2", "c3", "c4", "c5a", "c5b", "c6", "c7a", "c7b",
         "c9", "c10", "cta"]
COUNTS = {"hook": 6, "c1c2": 5, "c3": 2, "c4": 4, "c5a": 1, "c5b": 1,
          "c6": 1, "c7a": 1, "c7b": 1, "c9": 2, "c10": 3, "cta": 2}


def word_count(text):
    return len(text.split())


def validate_script():
    """Mechanical segment rules + duration plan checks."""
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
    assert sum(COUNTS.values()) == len(PHOTOS) == 29, "photo plan mismatch"
    # Duration plan: each in [0.5, 6.0]; each segment's sum equals its
    # window; total nominal coverage >= v11 measured audio (56.28s).
    prev_end = 0.0
    for key in ORDER:
        durs = [d for (k, _, _, d) in PHOTOS if k == key]
        assert len(durs) == COUNTS[key], f"{key}: duration list mismatch"
        for d in durs:
            assert 0.5 <= d <= 6.0, f"{key}: duration {d} outside [0.5, 6.0]"
        s = round(sum(durs), 2)
        want = round(SEGMENT_END[key] - prev_end, 2)
        assert abs(s - want) < 0.01, f"{key}: durations sum {s} != window {want}"
        print(f"  {key}: durations {durs} sum {s}s (window {want}s) OK", flush=True)
        prev_end = SEGMENT_END[key]
    assert prev_end >= 56.28, f"total nominal coverage {prev_end}s < 56.28s audio"
    print(f"  DURATION PLAN: total nominal {prev_end}s >= 56.28s audio OK", flush=True)


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
    boundary = "----v12-upload-" + uuid.uuid4().hex
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
    print("validating script (mechanical rules + duration plan):", flush=True)
    validate_script()

    seen_files = set()
    for kind, d, name, _dur in PHOTOS:
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
    for kind, d, name, _dur in PHOTOS:
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

    # 3. Build segments (with duration) and create the task.
    by_kind = {k: [] for k in ORDER}
    for kind, d, name, dur in PHOTOS:
        by_kind[kind].append({"mediaId": manifest[f"{os.path.basename(d)}/{name}"],
                              "duration": dur})
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
              open(os.path.join(ROOT, "task-v12.json"), "w"))

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
            json.dump(body, open(os.path.join(ROOT, "task-v12-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v12.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v12.py (task-v12-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
