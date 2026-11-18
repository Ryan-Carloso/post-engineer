#!/usr/bin/env python3
"""Drive the v8 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v7 (NOTAS-v8): the text/image mapping lives in the
SCRIPT STRUCTURE, and the photo counts follow CUMULATIVE alignment:
photos before any sentence ~= audio seconds before that sentence / 2
(the engine lays photos on a global 2 s queue anchored at 0, blind to
segments). Counts below were computed from v7's MEASURED segment audio
(same voice, nearly same script), not from the words/6.3 estimator alone:

- hook 40w/12.2s -> 6 photos (v7's 5 left a -2.2 s deficit).
- c1 17w/5.1s -> 3, c2 16w/~4.8s -> 2, c3 11w/~3.8s -> 2, c4 22w/7.1s -> 3,
  c5 11w/3.1s -> 2, c6 7w/2.7s -> 1, c7 6w/~1.9s -> 1, c9 11w/5.4s -> 3,
  c10 22w/4.9s -> 4, cta1 5w -> 1, cta2 4w -> 1. Total 29 photos.
- Cumulative offsets at every pre-squeeze segment boundary stay within
  +/-1.0 s (hook -0.2, c1 -0.2, c2 +0.7, c3 -0.1, c4 +0.1, c5 -1.0,
  c6 -0.1, c7 -0.8, c9 -0.7, c10 -0.1).

Documented deviations from the notes' words/6.3 rounded-up estimator
(estimator gives c4=4, c6=2):
- c4 = 3, not 4: with 4, the cumulative offset at c5 is +2.9 s and the
  notebook photo arrives 1.3 s AFTER the word "notebook" (the v7 miss,
  worse). With 3, the offset at c5 is -1.0 s and "notebook" lands on the
  notebook close-up. The estimator is rough; the cumulative principle
  (the notes' own lesson-2 rule) governs.
- c6 = 1, not 2: 7 words ~= 2.7 s of audio ~= 1 photo on the 2 s grid;
  2 photos would add +1.8 s of surplus before the breakfast take.
- c2 lengthened 12 -> 16 words ("..., so I said nothing") and c3 9 -> 11
  ("..., over coffee, ...") so their audio covers their density-floor
  photos; this pulls the c4 start offset from +2.0 to +0.1.
- c7+c8 (eggs + water, two 3-word takes) merged into ONE 6-word segment
  with ONE photo showing both (fried eggs + glass of water): two 3-word
  takes would each burn a 2 s grid slot for ~1.15 s of audio.
- CTA split into 2 segments ("Save this for the day" / "you want to
  quit.") as the pace guard: v7's 9-word CTA ran at ~378 wpm burst.
- c2 photo order swapped vs v7 (bed-phone first, hem-detail second):
  the phone fits "too ashamed to tell my sister", the pooled dress fits
  "the dress did not fit anymore".
- c5 photos: new writing shot first, notebook close-up second, so the
  word "notebook" lands on the close-up.
- c10 keeps 4 photos (dance, dance-wide-SHOES, dance-sister, hug):
  v7's dance-wide was barefoot; the new wide shot wears nude heels.
  dance-sister / hug are cropped at the knees (feet invisible) and are
  reused; the sister's dress differs between them (satin vs velvet) but
  she is not the persona.
- c4 chart is a NEW photo with NO readable text (v7's read "12 Week
  Study" against narration saying "a full year").

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
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v8.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order. One segment per beat; each
# segment's photos show ONLY what that segment says.
PHOTOS = [
    # hook — the dress will not zip (40w, 6 photos)
    ("hook", V7, "v7-bed-dress.jpg"),
    ("hook", V7, "v7-dress-hanger.jpg"),
    ("hook", V7, "v7-zipper.jpg"),
    ("hook", V7, "v7-mirror-defeated.jpg"),
    ("hook", V7, "v7-sleeve-detail.jpg"),
    ("hook", V8, "v8-mirror-back.jpg"),
    # c1 — on the floor (17w, 3 photos)
    ("c1", V7, "v7-floor-wide.jpg"),
    ("c1", V7, "v7-floor.jpg"),
    ("c1", V7, "v7-floor-face.jpg"),
    # c2 — too ashamed to tell her sister (16w, 2 photos; order swapped)
    ("c2", V7, "v7-bed-phone.jpg"),
    ("c2", V7, "v7-hem-detail.jpg"),
    # c3 — one morning I read, over coffee (11w, 2 photos)
    ("c3", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("c3", V5, "media-generation-v5-mara-reading-relief-0-82b54ffe-c761-4862-b497-042877058fdf.jpg"),
    # c4 — the study (22w, 3 photos; chart has NO readable text)
    ("c4", V8, "v8-study-chart.jpg"),
    ("c4", REAL6, "real-fridge.jpg"),
    ("c4", REAL6, "real-small-plate.jpg"),
    # c5 — three words in my notebook (11w, 2 photos)
    ("c5", V8, "v8-notebook-writing.jpg"),
    ("c5", V6, "v6-mara-notebook.jpg"),
    # c6 — started again (7w, 1 photo)
    ("c6", V4, "media-generation-v4-mara-shoes-0-8b2b1de7-72e7-4928-ae7e-78d952a1b5b3.jpg"),
    # c7 — eggs + water, one take (6w, 1 photo: eggs AND water glass)
    ("c7", V8, "v8-breakfast-table.jpg"),
    # c9 — the walk (11w, 3 photos: day, dusk, night)
    ("c9", V6, "v6-mara-walk-day.jpg"),
    ("c9", V6, "v6-mara-walk-dusk.jpg"),
    ("c9", V6, "v6-mara-walk-night.jpg"),
    # c10 — dancing at the wedding (22w, 4 photos; wide shot WITH heels)
    ("c10", V7, "v7-dance.jpg"),
    ("c10", V8, "v8-dance-wide-shoes.jpg"),
    ("c10", V7, "v7-dance-sister.jpg"),
    ("c10", V7, "v7-sisters-hug.jpg"),
    # cta1 — Save this for the day (5w, 1 photo)
    ("cta1", V5, "media-generation-v5-mara-smile-sunrise-0-b919693e-331a-444f-af53-cb5e3ea55f92.jpg"),
    # cta2 — you want to quit. (4w, 1 photo)
    ("cta2", V7, "v7-save-phone.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Six months after my diet ended, I tried on the dress I wore to my sister's wedding, and the zipper stopped halfway up my back. Same dress, same mirror, and I felt like everything I had worked for was gone.",
    "c1": "That night I sat on the bedroom floor in the dress, half zipped, staring at the wall.",
    "c2": "Too ashamed to tell my sister the dress did not fit anymore, so I said nothing.",
    "c3": "Then one morning, over coffee, I read something that changed everything.",
    "c4": "A study had followed people for a full year after their diet, and their hunger was still louder, their fullness still weaker.",
    "c5": "I wrote three words in my notebook. It was not me.",
    "c6": "So I started again, smaller this time.",
    "c7": "Eggs for breakfast. Water before coffee.",
    "c9": "A walk after dinner, every single night, no matter the weather.",
    "c10": "Three months later I danced all night at the wedding in that dress, and this time I knew why it would hold.",
    "cta1": "Save this for the day",
    "cta2": "you want to quit.",
}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"
ORDER = ["hook", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c9",
         "c10", "cta1", "cta2"]
COUNTS = {"hook": 6, "c1": 3, "c2": 2, "c3": 2, "c4": 3, "c5": 2, "c6": 1,
          "c7": 1, "c9": 3, "c10": 4, "cta1": 1, "cta2": 1}


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
        # Engine requires terminal punctuation ONLY on the hook
        # (script_segments.py:342); cta1 is the first half of a split CTA
        # and deliberately ends without it.
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
    boundary = "----v8-upload-" + uuid.uuid4().hex
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
              open(os.path.join(ROOT, "task-v8.json"), "w"))

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
            json.dump(body, open(os.path.join(ROOT, "task-v8-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v8.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v7.py adapted to v8 (task-v8-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
