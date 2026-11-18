#!/usr/bin/env python3
"""Drive the v9 faceless video (INSPIRADOR) on the LOCAL dev engine.

Design change vs v8 (NOTAS-v9): TWO BODY STATES of the same persona.
- HEAVIER version (from the same base photo, same face/hair, visibly
  heavier body): hook dress scenes, floor low point, shame, reading,
  notebook. SLIM version (base photo body): the final dance + hug.
- The before/after difference must be visible IN THE BODY, not only in
  props. Every photo showing her body was checked visually; 3 images
  were regenerated for outfit continuity (floor-wide had a front zipper,
  floor-face wore the sage t-shirt instead of the dress, bed-phone was
  sleeveless with a V-neck) — all dress shots are now the same navy blue
  lace midi dress, short sleeves, round neckline, BACK zipper only.
- CTA is ONE 6-word segment ("Save this for when you quit.") — the v8
  split produced ZERO pause between the halves and the CTA still ran at
  355 wpm. One short segment cannot burst the same way.
- Breakfast is TWO 3-word segments (eggs / water) with one photo each:
  the v8 merged take put "Water before coffee" over the walk photo.
  Each 3-word take is ~1.1-1.5 s of audio; the 2 s grid slot covers it,
  and the cumulative math below keeps the drift inside +/-1.0 s.

Photo counts follow the CUMULATIVE method (NOTAS-v9 rule 3): photos
before any sentence ~= (audio seconds before that sentence + ~0.5 s
boundary pauses) / 2, computed from v8's MEASURED segment audio (same
voice, nearly same script). Offsets at every boundary stay within
+/-1.0 s (hook +0.3, c1 +0.5, c2 -0.1, c3 -0.2, c4 -0.8, c5 -0.9,
c6 -0.8, c7a -0.7, c7b -0.3, c9 -0.5, c10 -0.5, cta -0.2). Grid 54 s vs
audio ~54.2 s, so the tail squeeze is nearly eliminated (v8: 58 s grid
vs 55.1 s audio).

- hook 40w/12.2s -> 6 photos, c1 17w/5.1s -> 3, c2 16w/~4.8s -> 2,
  c3 11w/~3.8s -> 2, c4 22w/7.1s -> 3, c5 11w/3.1s -> 2, c6 7w/2.7s -> 1,
  c7a 3w/~1.2s -> 1, c7b 3w/~1.2s -> 1, c9 11w/5.4s -> 2, c10 22w/4.9s -> 3,
  cta 6w/~1.5s -> 2. Total 28 photos.
- RETRY (first task a169b942 failed at materials): the TTS audio measured
  55.0 s, so 27 photos covered only 53.9 s and the engine fail-fast
  refused ("images_do_not_cover_audio: need 1 more photo"). The CTA
  takes a 2nd photo (v7-save-phone, the v8 cta2 shot — her smiling
  selfie, same face, post-restart outfit) so the grid is 55.9 s >= 55.0 s.
  Nothing before the CTA moves; the CTA stays ONE 6-word segment, and
  2 photos is inside its density [1, 2].
- c9 drops the dusk walk (2 photos: day, night) — the c7 split adds one
  grid slot, and day->night is the stronger contrast for "every night".
- c10 keeps 3 photos (dance, dance-wide-SHOES with nude heels, hug);
  the 4th v8 photo (dance-sister) is dropped — the hug carries the
  sister beat and the c7 split costs one slot.
- c4 fridge is a NEW photo with NO readable text/brands (v8's fridge
  photo showed "big", "Cheez", "EVERSWEET").
- Hook photo order kept from v8 (validated there): bed-dress, hanger,
  zipper close-up, mirror-defeated, sleeve-detail, mirror-back.
- c2 photo order: bed-phone first, hem-detail second ("too ashamed to
  tell my sister" over the phone; "the dress did not fit anymore" over
  the pooled dress hem).
- c5 photos: new heavier writing shot first, notebook close-up second,
  so the word "notebook" lands on the close-up.

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
REAL6 = os.path.join(ROOT, "media-v6")
MANIFEST = os.path.join(ROOT, "manifest-v9.json")
BASE = "http://127.0.0.1:8080/api/v1"

# (segment, dir, file) in screen order. One segment per beat; each
# segment's photos show ONLY what that segment says.
PHOTOS = [
    # hook — the dress will not zip (40w, 6 photos; HEAVIER version)
    ("hook", V7, "v7-bed-dress.jpg"),
    ("hook", V7, "v7-dress-hanger.jpg"),
    ("hook", V9, "v9-zipper.jpg"),
    ("hook", V9, "v9-mirror-defeated.jpg"),
    ("hook", V7, "v7-sleeve-detail.jpg"),
    ("hook", V9, "v9-mirror-back.jpg"),
    # c1 — on the floor (17w, 3 photos; HEAVIER version)
    ("c1", V9, "v9-floor-wide.jpg"),
    ("c1", V9, "v9-floor.jpg"),
    ("c1", V9, "v9-floor-face.jpg"),
    # c2 — too ashamed to tell her sister (16w, 2 photos)
    ("c2", V9, "v9-bed-phone.jpg"),
    ("c2", V7, "v7-hem-detail.jpg"),
    # c3 — one morning I read, over coffee (11w, 2 photos)
    ("c3", V3, "media-generation-08-content1-phone-0-f0238fe3-2274-4b27-bdd7-62280689e196.jpg"),
    ("c3", V9, "v9-reading-relief.jpg"),
    # c4 — the study (22w, 3 photos; chart has NO readable text)
    ("c4", V8, "v8-study-chart.jpg"),
    ("c4", V9, "v9-fridge-clean.jpg"),
    ("c4", REAL6, "real-small-plate.jpg"),
    # c5 — three words in my notebook (11w, 2 photos)
    ("c5", V9, "v9-notebook-writing.jpg"),
    ("c5", V6, "v6-mara-notebook.jpg"),
    # c6 — started again (7w, 1 photo)
    ("c6", V4, "media-generation-v4-mara-shoes-0-8b2b1de7-72e7-4928-ae7e-78d952a1b5b3.jpg"),
    # c7a — eggs for breakfast (3w, 1 photo)
    ("c7a", V9, "v9-eggs.jpg"),
    # c7b — water before coffee (3w, 1 photo)
    ("c7b", V9, "v9-water-coffee.jpg"),
    # c9 — the walk (11w, 2 photos: day, night)
    ("c9", V6, "v6-mara-walk-day.jpg"),
    ("c9", V6, "v6-mara-walk-night.jpg"),
    # c10 — dancing at the wedding (22w, 3 photos; SLIM version, heels)
    ("c10", V9, "v9-dance.jpg"),
    ("c10", V9, "v9-dance-wide-shoes.jpg"),
    ("c10", V9, "v9-sisters-hug.jpg"),
    # cta — Save this for when you quit. (6w, 2 photos)
    ("cta", V5, "media-generation-v5-mara-smile-sunrise-0-b919693e-331a-444f-af53-cb5e3ea55f92.jpg"),
    ("cta", V7, "v7-save-phone.jpg"),
]

SEGMENT_TEXT = {
    "hook": "Six months after my diet ended, I tried on the dress I wore to my sister's wedding, and the zipper stopped halfway up my back. Same dress, same mirror, and I felt like everything I had worked for was gone.",
    "c1": "That night I sat on the bedroom floor in the dress, half zipped, staring at the wall.",
    "c2": "Too ashamed to tell my sister the dress did not fit anymore, so I said nothing.",
    "c3": "Then one morning, over coffee, I read something that changed everything.",
    "c4": "A study had followed people for a full year after their diet, and their hunger was still louder, their fullness still weaker.",
    "c5": "I wrote three words in my notebook. It was not me.",
    "c6": "So I started again, smaller this time.",
    "c7a": "Eggs for breakfast.",
    "c7b": "Water before coffee.",
    "c9": "A walk after dinner, every single night, no matter the weather.",
    "c10": "Three months later I danced all night at the wedding in that dress, and this time I knew why it would hold.",
    "cta": "Save this for when you quit.",
}

TITLE = "Six months after my diet, the dress would not zip"
DESCRIPTION = ("I tried on the dress for my sister's wedding and the zipper "
               "stopped halfway. Then I learned my hunger was biology, not "
               "weakness, and I started again, smaller this time.")
VOICE = "chatterbox:phonon_everly"
ORDER = ["hook", "c1", "c2", "c3", "c4", "c5", "c6", "c7a", "c7b",
         "c9", "c10", "cta"]
COUNTS = {"hook": 6, "c1": 3, "c2": 2, "c3": 2, "c4": 3, "c5": 2, "c6": 1,
          "c7a": 1, "c7b": 1, "c9": 2, "c10": 3, "cta": 2}


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
    assert sum(COUNTS.values()) == len(PHOTOS) == 28, "photo plan mismatch"


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
    boundary = "----v9-upload-" + uuid.uuid4().hex
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
              open(os.path.join(ROOT, "task-v9.json"), "w"))

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
            json.dump(body, open(os.path.join(ROOT, "task-v9-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out after 3h")

    # 5. Download final mp4.
    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v9.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code} {e.read()[:300]}", flush=True)
        print("use download_r2_v9.py adapted to v9 (task-v9-final.json) instead", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
