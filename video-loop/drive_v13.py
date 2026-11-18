#!/usr/bin/env python3
"""Drive the v13 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v12 (NOTAS-v13): duration contrast is now MANDATORY,
not timid. v12 proved duration works (metronome dead after 10s) but the
first 10s and much of the video still sat near 2s. v13 hard rules:
- never more than 2 consecutive photos with the same duration;
- low point holds 3.5-5s (tears, bedroom floor);
- study runs fast (1-1.5s/photo); dance holds 4-6s total;
- one photo, one beat: the c6 mirror no longer covers two clauses
  (new small-plate photo for "smaller this time"), the c5a notebook
  no longer arrives 1.5s early (new writing-hand photo for the first
  clause, notebook close-up lands on the word "notebook");
- last frame is the dance (new SLIM dance photo replaces the zipper
  buffer as the 2nd CTA photo).
- Every photo carries an explicit duration, so the timeline is purely
  cumulative — requested durations are honored absolutely, the next
  photo starts when the previous one ends.
- Duration only redistributes time INSIDE a segment: photo count still
  covers audio on the 2s-per-photo counting base (30 photos, 58s grid),
  so a no-duration build would still cover. Duration never plugs a
  coverage hole.
- Durations anchored on v11/v12 MEASURED per-take audio (Whisper base,
  all 177 words aligned; audio 56.28s; v11 and v12 timings identical to
  0.01s) + the measured inter-take gaps (mean 0.71s, total ~7.8s).
  Segment audio windows (v12 audio):
  hook 0.00-11.64, c1c2 12.48-21.34, c3 22.06-25.74, c4 26.50-33.00,
  c5a 33.58-35.42, c5b 35.98-36.66, c6 37.44-39.72, c7a 40.44-41.14,
  c7b 41.80-42.76, c9 43.40-46.90, c10 47.52-52.28, cta 53.06-55.50.
  Segment ends (photo start times): hook 11.64, c1c2 22.06, c3 26.50,
  c4 33.58, c5a 35.98, c5b 37.44, c6 40.44, c7a 41.80, c7b 43.40,
  c9 47.52, c10 53.06, cta 58.26.
  ONE deviation from the v12 convention: the hook window ends at 11.64
  (hook audio end), so c1c2's first photo starts at 11.64, 0.84s before
  c1c2 audio — that 0.84s is SILENCE between takes, so no audio bleeds;
  it buys the two transitional low-point photos ~1s each instead of
  0.75s flashes. Every other segment starts exactly on its audio start.
- "It was not me" (36.00-36.66) falls on the realization face
  (35.98-37.44): the phrase starts 0.02s after the face starts, and
  the face holds 1.46s.
- "notebook." (35.12-35.42) falls on the notebook close-up
  (35.10-35.98): the photo starts 0.02s before the word. The first
  clause ("I wrote four words down in my", 33.64-34.98) has its own
  writing-hand photo (33.58-35.10).
- c6 split on the word gap: "So I started again," ends 38.44,
  "smaller" starts 38.88 — mirror-resolve 37.44-38.66, small-plate
  38.66-40.44.

Photo changes vs v12 (NOTAS-v13 + full-size verification this round):
- hook: DROPPED v10-mirror-full (5 photos now; the mirror-defeated
  holds 2.8s and the mirror-face 2.14s cover the defeat words).
- c5a 1st: NEW v13-writing-hand (HEAVY, pen + blank notebook) —
  notebook close-up now lands on the word "notebook".
- c6 2nd: NEW v13-small-plate (HEAVY, small portion, determined) —
  one photo per clause.
- cta 2nd: NEW v13-cta-dance2 (SLIM, laughing, navy lace, heels) —
  the last frame is the dance, not the zipper buffer.
- All other reused photos were verified full-size in v12 (same files,
  same phases) and spot-checked again this round (tears face,
  mirror face): same face (green eyes, freckles, low bun), correct
  body state (HEAVY 0-46s, SLIM 46-56s), navy lace dress with short
  sleeves. Known nit persists: v10-mirror-face shows a deep V
  neckline in the reflection vs round neck on the body.

Facts: Sumithran et al. 2011 NEJM 365:1597-604, PMID 22029981,
re-verified by web search this round — qualitative only (hunger still
louder, fullness still weaker a full year later).

Subtitles lag ~1s in 3-4 points in v12 (engine-side SRT timing,
NOT drift — photo/audio drift is zero). NOT fixable from the script;
do not burn this round on it.

No valid Pexels API key (dev keys give 401) — photos only this round,
no b-roll; recorded in the analysis.

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
V13 = os.path.join(ROOT, "images-v13")
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v13.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file, duration) in screen order. One segment per beat;
# each segment's photos show ONLY what that segment says. Duration is
# SegmentMedia.duration (0.5-6.0s); the segment's durations sum to the
# segment window (see docstring), so the next segment starts on time.
PHOTOS = [
    # hook — the dress will not zip (40w, 5 photos; HEAVY; ends 11.64)
    ("hook", V10, "v10-bed-dress.jpg", 2.5),
    ("hook", V7, "v7-dress-hanger.jpg", 1.5),
    ("hook", V9, "v9-zipper.jpg", 2.7),
    ("hook", V9, "v9-mirror-defeated.jpg", 2.8),
    ("hook", V10, "v10-mirror-face.jpg", 2.14),
    # c1c2 — on the floor, too ashamed to tell her sister (33w, 5 photos;
    # floor holds 3.5s, tears hold 3.5s; window 11.64-22.06)
    ("c1c2", V9, "v9-floor-wide.jpg", 3.5),
    ("c1c2", V9, "v9-floor.jpg", 1.5),
    ("c1c2", V9, "v9-floor-face.jpg", 3.5),
    ("c1c2", V12, "media-generation-v12-bed-no-phone-0-fc243be0-d745-44c6-9c67-fd8e90d03a7b.webp", 1.0),
    ("c1c2", V10, "v10-dress-floor.jpg", 0.92),
    # c3 — one morning I read, over coffee (11w, 2 photos; ends 26.50)
    ("c3", V12, "media-generation-v12-phone-heavy-0-d41c97c1-f241-4893-bb1a-a5ef219b57ef.webp", 2.0),
    ("c3", V9, "v9-reading-relief.jpg", 2.44),
    # c4 — the study (22w, 4 photos; fast 1-1.5s; ends 33.58)
    ("c4", V8, "v8-study-chart.jpg", 1.5),
    ("c4", V10, "v10-chart-laptop.jpg", 1.2),
    ("c4", V12, "v12-chart-labeled.jpg", 1.5),
    ("c4", REAL6, "real-small-plate.jpg", 2.88),
    # c5a — four words in my notebook (8w, 2 photos; notebook close-up
    # lands on the word "notebook." at 35.12; ends 35.98)
    ("c5a", V13, "media-generation-v13-writing-hand-0-d12106af-ce5f-482c-ad56-f7a3b300f0f9.webp", 1.52),
    ("c5a", V9, "v9-notebook-writing.jpg", 0.88),
    # c5b — It was not me. (4w, 1 photo: the realization face; ends 37.44)
    ("c5b", V10, "v10-face-realization.jpg", 1.46),
    # c6 — started again (7w, 2 photos; split on the word gap 38.44-38.88;
    # mirror for "So I started again", small plate for "smaller this time")
    ("c6", V12, "media-generation-v12-mirror-resolve-0-edf97cf7-56c3-4b43-9596-c697668d8a57.webp", 1.22),
    ("c6", V13, "media-generation-v13-small-plate-0-3492a1fd-687e-42d5-8cea-174e66294af3.webp", 1.78),
    # c7a — eggs for breakfast (3w, 1 photo; ends 41.80)
    ("c7a", V9, "v9-eggs.jpg", 1.36),
    # c7b — water before coffee (3w, 1 photo; ends 43.40)
    ("c7b", V9, "v9-water-coffee.jpg", 1.60),
    # c9 — the walk (11w, 2 photos: day, night; HEAVY; ends 47.52)
    ("c9", V10, "v10-walk-day-heavy.jpg", 2.0),
    ("c9", V10, "v10-walk-night-heavy.jpg", 2.12),
    # c10 — dancing at the wedding (22w, 3 photos; SLIM, heels;
    # dance sequence holds 4.0s total; ends 53.06)
    ("c10", V9, "v9-dance.jpg", 2.54),
    ("c10", V9, "v9-dance-wide-shoes.jpg", 1.46),
    ("c10", V9, "v9-sisters-hug.jpg", 1.54),
    # cta — Save this for the day you want to quit and start again.
    # (12w, 2 photos; SLIM, at the wedding; the LAST frame is the dance)
    ("cta", V11, "v11-cta-dance.jpg", 1.70),
    ("cta", V13, "media-generation-v13-cta-dance2-0-8d2f03ce-1934-43b3-9b5e-def5bbb85413.webp", 3.50),
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

# Segment window ends (photo start times), from v11/v12 measured audio.
# Segment duration sums must equal (end - previous end); the first
# segment starts at 0. Exception: hook ends at 11.64 (hook audio end),
# so c1c2's first photo starts 0.84s before c1c2 audio — that 0.84s is
# silence between takes, so no audio bleeds (see docstring).
SEGMENT_END = {"hook": 11.64, "c1c2": 22.06, "c3": 26.50, "c4": 33.58,
               "c5a": 35.98, "c5b": 37.44, "c6": 40.44, "c7a": 41.80,
               "c7b": 43.40, "c9": 47.52, "c10": 53.06, "cta": 58.26}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"
ORDER = ["hook", "c1c2", "c3", "c4", "c5a", "c5b", "c6", "c7a", "c7b",
         "c9", "c10", "cta"]
COUNTS = {"hook": 5, "c1c2": 5, "c3": 2, "c4": 4, "c5a": 2, "c5b": 1,
          "c6": 2, "c7a": 1, "c7b": 1, "c9": 2, "c10": 3, "cta": 2}


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
    assert sum(COUNTS.values()) == len(PHOTOS) == 30, "photo plan mismatch"
    # Duration plan: each in [0.5, 6.0]; each segment's sum equals its
    # window; total nominal coverage >= v11/v12 measured audio (56.28s).
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
    # CONTRAST checks (NOTAS-v13 rule 3, hard): never more than 2
    # consecutive photos with the same duration; at most 4 photos at
    # exactly 2.0s in the first 46s (no 2s grid). Print the planned cut
    # list so the grid (or its absence) is visible before submitting.
    all_durs = [d for (_, _, _, d) in PHOTOS]
    run = 1
    for a, b in zip(all_durs, all_durs[1:]):
        run = run + 1 if a == b else 1
        assert run <= 2, f"3+ consecutive photos at {a}s"
    cuts = []
    t = 0.0
    for d in all_durs[:-1]:
        t = round(t + d, 2)
        cuts.append(t)
    print(f"  PLANNED CUTS: {cuts}", flush=True)
    two_s_first46 = sum(1 for d, c in zip(all_durs, cuts + [58.26])
                        if d == 2.0 and c <= 46.0)
    assert two_s_first46 <= 4, f"{two_s_first46} photos at exactly 2.0s in first 46s"
    print(f"  CONTRAST: max run of equal durations <= 2 OK; "
          f"{two_s_first46} photos at 2.0s in first 46s OK", flush=True)


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
    boundary = "----v13-upload-" + uuid.uuid4().hex
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
              open(os.path.join(ROOT, "task-v13.json"), "w"))

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
            json.dump(body, open(os.path.join(ROOT, "task-v13-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v13.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v13.py (task-v13-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
