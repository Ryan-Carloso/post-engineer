#!/usr/bin/env python3
"""Drive the v15 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v14 (NOTAS-v15): same script (176 words, 12 segments),
same segment windows, same durations everywhere EXCEPT:
- c1c2: tears hold restored to 4.0s (v13/v14 measured it working; v14's
  plan had trimmed it to 3.0s). Paid for by trimming floor-wide 3.0->2.5
  and floor 1.5->1.0; dress-on-floor stays 1.92s covering "so I said
  nothing" (20.52-21.34). Window 11.64-22.06 unchanged.
- c4 STUDY — fully rebuilt, literal only, no metaphor: the blueberry
  plate (metaphor for hunger) and the unlabeled laptop chart are GONE.
  New: v12 labeled chart holds 2.5s (was 1.5s), NEW v15 study-paper
  (open book, Hunger rising / Fullness falling, Months 0-12, no caption,
  no invented numbers) 2.0s, NEW v15 reading-paper (the persona, HEAVY,
  sage t-shirt + jeans, reading the study at the kitchen table) 2.58s.
  Window 26.50-33.58 unchanged.
- c5a: notebook only on its phrase. NEW v15 pen close-up (hand + pen +
  blank sheet, NO notebook visible) 1.52s, then v9-notebook-writing
  0.88s so the word "notebook" (35.12) lands on the notebook photo.
- c9: NO CLIP. Five Pexels walk candidates were frame-checked and ALL
  rejected (37658334 long ponytail + pink sweats; 34980556 long loose
  hair + plaid shirt, Greek street sign; 13783812 loose hair + black
  graphic tee, face visible; 7578123 face visible, curly hair, puffer
  jacket; 7681927 face visible, white shirt + beige trousers, monumental
  building). None matches the persona (low bun, sage t-shirt + jeans,
  suburban street at dusk) even from behind — per NOTAS-v15, never force
  a clip that is not her. Back to v13's photos: walk-day 2.0s +
  walk-night 2.12s. Dance still starts 47.52 with "Three months later".
- hook photo 5: NEW v15 mirror-face — same face, defeated, HEAVY,
  navy lace dress round neck on BOTH body and reflection. Fixes the
  v10-v14 nit (deep V neckline in the reflection).
- Every photo re-verified full-size against the base photo this round
  (face: green eyes, freckles, low bun; body HEAVY 0-46s, SLIM 46-56s;
  navy lace dress, short sleeves, round neck, back zip; sage t-shirt
  + jeans in everyday scenes; nude heels at the wedding). No drift
  found. New v15 images: study-paper-v2 (clean labeled chart, no
  invented numbers — v1 was discarded for its "n = 120 participants"
  caption), reading-paper (HEAVY, same face), pen close-up (freckled
  hand, no notebook), mirror-face (round neck both sides).
- 29 photos, 0 clips (v14 had 30 items incl. 1 clip). Total nominal
  coverage 58.26s vs v14 measured audio 56.28s.

Facts: Sumithran et al. 2011 NEJM 365:1597-604, PMID 22029981,
qualitative only (hunger still louder, fullness still weaker a full
year later). No numbers in the script.

Subtitles lag ~1s in the 33-37s window in v12/v13/v14 (engine-side SRT
timing, NOT drift — photo/audio drift is zero). NOT fixable from the
script; do not burn this round on it. CTA pace and music bed are
TTS/engine side too; recorded, not chased.

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
V7 = os.path.join(ROOT, "images-v7")
V9 = os.path.join(ROOT, "images-v9")
V10 = os.path.join(ROOT, "images-v10")
V11 = os.path.join(ROOT, "images-v11")
V12 = os.path.join(ROOT, "images-v12")
V13 = os.path.join(ROOT, "images-v13")
V14 = os.path.join(ROOT, "images-v14")
V15 = os.path.join(ROOT, "images-v15")
MANIFEST = os.path.join(ROOT, "manifest-v15.json")
BASE = "http://127.0.0.1:8080/api/v1"

S15_PAPER_V2 = "media-generation-s15-study-paper-v2-0-b896dd8f-d7b8-4826-9acb-7c3596a2734c.jpg"
S15_READING = "media-generation-s15-reading-paper-0-e3cc0f0f-2e19-4ee0-81c9-1bba286caec4.jpg"
S15_PEN = "media-generation-s15-pen-closeup-0-ec20229f-73b0-439f-8eeb-afbec3d2a417.jpg"
S15_MIRROR = "media-generation-s15-mirror-face-0-32d8c09e-ba69-4f9e-bd75-342a6d357526.jpg"

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
    ("hook", V15, S15_MIRROR, 2.14),
    # c1c2 — on the floor, too ashamed to tell her sister (33w, 5 photos;
    # tears hold 4.0s; dress-on-floor 1.92s covers "so I said nothing";
    # window 11.64-22.06)
    ("c1c2", V9, "v9-floor-wide.jpg", 2.5),
    ("c1c2", V9, "v9-floor.jpg", 1.0),
    ("c1c2", V9, "v9-floor-face.jpg", 4.0),
    ("c1c2", V12, "media-generation-v12-bed-no-phone-0-fc243be0-d745-44c6-9c67-fd8e90d03a7b.webp", 1.0),
    ("c1c2", V10, "v10-dress-floor.jpg", 1.92),
    # c3 — one morning I read, over coffee (11w, 2 photos; ends 26.50)
    ("c3", V12, "media-generation-v12-phone-heavy-0-d41c97c1-f241-4893-bb1a-a5ef219b57ef.webp", 2.0),
    ("c3", V9, "v9-reading-relief.jpg", 2.44),
    # c4 — the study, literal only (22w, 3 photos; labeled chart holds
    # 2.5s; study paper 2.0s; reading the paper 2.58s; ends 33.58)
    ("c4", V12, "v12-chart-labeled.jpg", 2.5),
    ("c4", V15, S15_PAPER_V2, 2.0),
    ("c4", V15, S15_READING, 2.58),
    # c5a — four words in my notebook (8w, 2 photos; pen close-up has NO
    # notebook; notebook photo lands on the word "notebook." at 35.12;
    # ends 35.98)
    ("c5a", V15, S15_PEN, 1.52),
    ("c5a", V9, "v9-notebook-writing.jpg", 0.88),
    # c5b — It was not me. (4w, 1 photo: the realization face; ends 37.44)
    ("c5b", V10, "v10-face-realization.jpg", 1.46),
    # c6 — started again (7w, 2 photos; split on the word gap 38.44-38.88;
    # mirror for "So I started again", small plate for "smaller this time")
    ("c6", V12, "media-generation-v12-mirror-resolve-0-edf97cf7-56c3-4b43-9596-c697668d8a57.webp", 1.22),
    ("c6", V14, "media-generation-v14-small-plate-comparison-0-b07cde65-18bc-4bd7-84b6-b7baec8ca893.jpg", 1.78),
    # c7a — eggs for breakfast (3w, 1 photo; ends 41.80)
    ("c7a", V9, "v9-eggs.jpg", 1.36),
    # c7b — water before coffee (3w, 1 photo; ends 43.40)
    ("c7b", V9, "v9-water-coffee.jpg", 1.60),
    # c9 — the walk, photos only (11w, 2 photos: day, night; HEAVY;
    # no clip — no Pexels candidate matched the persona; ends 47.52)
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
COUNTS = {"hook": 5, "c1c2": 5, "c3": 2, "c4": 3, "c5a": 2, "c5b": 1,
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
        # Density rule: min ceil(words/8), max floor(words/3). Photos only
        # this round — no clips.
        lo = (wc + 7) // 8
        hi = max(1, wc // 3)
        n = COUNTS[key]
        assert lo <= n <= hi, (
            f"{key}: {n} items outside density [{lo}, {hi}] for {wc} words")
        print(f"  {key} ({kind}): {wc} words, {n} items, "
              f"density [{lo}, {hi}] OK", flush=True)
    content_total = total - word_count(SEGMENT_TEXT["hook"])
    assert content_total >= 30, "content total < 30 words"
    assert 60 <= total <= 200, f"total word count {total} outside 60-200"
    print(f"  TOTAL: {total} words, {len(ORDER)} segments OK", flush=True)
    assert sum(COUNTS.values()) == len(PHOTOS) == 29, "photo plan mismatch"
    # Photos only by design this round (no Pexels clip matched the persona).
    assert not any(name.lower().endswith(".mp4") for (_, _, name, _) in PHOTOS), "clip in plan"
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
    # CONTRAST checks (NOTAS rule 3, hard): never more than 2
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
    boundary = "----v15-upload-" + uuid.uuid4().hex
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
              open(os.path.join(ROOT, "task-v15.json"), "w"))

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
            json.dump(body, open(os.path.join(ROOT, "task-v15-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v15.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v15.py (task-v15-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
