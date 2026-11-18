# v8 — analysis (maker, harsh)

**File:** `daily-dose-weight-regain-faceless-v8.mp4`
**Specs:** 55.10 s, 1080×1920, h264 + aac, 14,653,904 bytes
**Task:** `33701e22-ebbc-46c8-813d-a7fce4055f6c` (state 1, 100%)
**Script:** 172 words, 12 segments (hook 40w + 11 content), archetype Inspirador,
same dress story as v6/v7. Render ~14:21–15:05 -03.
**Design tested:** mapping in the SCRIPT STRUCTURE — one segment per beat,
photos per segment ≈ audio seconds ÷ 2 (≈ words ÷ 6.3 at ~190 wpm),
within density `[ceil(w/8), floor(w/3)]`; hook one segment, 6 photos.

## Score: 8.5 / 10

v7 was 8.0. v8 fixes v7's headline defects (notebook word, barefoot wedding,
one-photo-forward slide) and the emotional beats are the strongest yet —
but the two structural ceilings v7 exposed did NOT move at all:
the 2.0 s photo grid still governs the first 44 s, and the CTA still bursts
at ~1.7× the hook's pace. One clause still lands on the wrong photo.
8.5 is a real step, not a 10.

## 1. What the design fixed (measured, not claimed)

### The notebook word lands — the v7 miss is gone
- Word "notebook." at **34.80–35.10 s**; photo `v6-mara-notebook.jpg`
  (notebook close-up) runs **34–36 s**. The word falls squarely on the
  close-up. v7 had the notebook word on the standing-with-phone photo.
- "study" at **26.6–26.9 s** on `v8-study-chart.jpg` (26–28 s) — chart with
  NO readable text, so no "12 Week" contradiction.
- "zipper" at **4.98–5.2 s** on `v7-zipper.jpg` (4–6 s) — the zipper word on
  the zipper photo.
- "danced" at **47.96–48.22 s** on `v8-dance-wide-shoes.jpg` (47–49 s) —
  frame at 48 s verified: full body, spinning, **nude high heels clearly
  visible on both feet**. The v7 barefoot wedding is fixed.
- Hook ends at "gone." **11.38–11.66 s** vs grid 12 s — offset +0.3 s,
  the best hook alignment of any version (v7: −2.2 s).

### Mapping: 11 of 13 beats clean
Per-second photo map (1 fps, 32×32 RGB MSE vs the 29 sources,
cross-checked with scene cuts in `cuts-v8.txt` and base-model word
timestamps in `words-v8.json`, 172 words = full script):

| beat | words on screen | verdict |
|---|---|---|
| hook (0–11.7 s) | bed / hanger / zipper / mirror-defeated / sleeve / mirror-back | 6/6 ✓ |
| c1 floor (12–17.5 s) | floor-wide / floor / floor-face | 3/3 ✓ |
| c2 shame (17.5–22.1 s) | bed-phone / hem-detail | 2/2 ✓ (swap worked) |
| c3 read (22.3–26.2 s) | content1-phone / reading-relief | 2/2 ✓ ("read" 24.28 s lands as relief photo appears) |
| c4 study (26.2–32.8 s) | chart / fridge / plate | 2.5/3 — "weaker." 32.52–32.84 spills 0.3 s onto the writing photo |
| c5 notebook (33–36.9 s) | notebook-writing / v6-notebook | 2/2 ✓✓ |
| c6 restart (37–38.8 s) | shoes | 0.5/1 — "time." 38.56–38.82 tail on the breakfast photo |
| c7 eggs/water (39.6–41.8 s) | breakfast-table | 0.5/1 — **"Water before coffee" (40.84–41.84 s) plays over the walk photo** |
| c9 walk (42–46 s) | walk-day / walk-dusk / walk-night | 2.5/3 — "weather." 45.78–46.04 tail on the dance photo |
| c10 wedding (47–52 s) | dance / dance-wide / dance-sister / hug | 4/4 ✓✓ |
| CTA (52.7–54.2 s) | sunrise / save-phone | 2/2 ✓ ("quit." 54.02 s on save-phone) |

The v7 one-photo-forward slide is gone. Cumulative offsets stayed within
±1.6 s (worst: c7, −1.6 s — see §4 for the mechanism).

### Emotion: the arc is visible
- Low point is genuinely low: tears at 16 s (`v7-floor-face.jpg`),
  dress pooled on the floor at 20 s (`v7-hem-detail.jpg`), subtitle
  "so I said nothing".
- Turning point HAS a visual moment: relief smile reading the phone
  at 24 s (`reading-relief`), subtitle "I read something that changed
  everything".
- Close is a win: dancing, laughing, heels (47–49 s), hug with the
  sister (50–52 s), sunrise selfie (52–54 s).
- Persona/outfit: same face, low bun, freckles, navy lace dress in every
  persona shot. No dark frames. No repeated photo. No stock photo with a
  visible date.

### Subtitles: clean everywhere
All 14 sampled frames (every 4 s): no `-`, no `,`, no `.` — the engine
cleanup (PR #637) is live in this build. Only `?` is allowed to survive
and none appears (no question in the script).

## 2. What did NOT move — the two structural ceilings

### Rhythm: the 2.0 s metronome still runs the first 44 s
Scene cuts (`cuts-v8.txt`, `select='gt(scene,0.4)'`): 2, 4, 6, 8, 10,
14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, then
46.9, 50.4, 52.13, 53.73. (No cut detected at 12 s — mirror-back →
floor-wide are similar warm bedroom shots; the 1 fps MSE map shows the
change at 12.)

Photo runs: **22 of 29 photos run exactly 2.0 s (0–44 s = 80% of the
video)**. The tail: walk-night ~1 s, dance 2 s, dance-wide 2 s,
dance-sister ~1 s, hug 2 s, sunrise 2 s, save-phone ~1 s.
29 photos × 2 s = 58 s > 55.1 s audio, so the engine squeezes the tail —
and the three 1 s photos make the END faster, not slower. The victory
rushes instead of lingering.

Conclusion, same as v7, now with a second measurement: the photo-count
rule fixed ALIGNMENT (which photo, when) but the grid still governs
WHEN. Structure changes WHICH photo appears, never WHEN. Only
`SegmentMedia.duration` (PR #652) changes the grid itself.

### CTA burst: the split produced ZERO pause
- "Save this for the day you want to quit" runs **52.68–54.20 s = 1.52 s
  for 9 words = 355 wpm** (v7: 378 wpm).
- Gap between "day" (53.38–53.54) and "you" (53.54): **0.0 s**.
  The two takes are joined with no gap at all.
- Hook pace: 40 words / 11.66 s = 206 wpm. The CTA is still **1.7× the
  hook's pace**.
- The split-into-2-takes guard FAILED as a pace guard: the engine joins
  takes without a pause. A real guard needs an actual pause — a longer
  lead-in take, or a silent beat — not a split.

## 3. The one real miss: "Water before coffee"
- "Eggs" at **39.6 s**; breakfast-table photo runs 38–40 s — only 0.4 s
  of eggs on the right photo.
- "breakfast," **39.94–40.28 s** straddles the cut.
- "Water before coffee" **40.84–41.84 s** plays over `v6-mara-walk-day.jpg`
  — frame at 40 s verified: her walking down a sunny street, subtitle
  "Water before coffee". No water, no coffee on screen.
- Cause: the merged take ("Eggs for breakfast. Water before coffee.",
  6 words, 1 photo) only works if the photo's 2 s window aligns with the
  words. The audio started 1.6 s late relative to the grid (see §4), so
  the photo was spent on the previous take's tail + the inter-take gap.

## 4. The mechanism behind the drift (for v9)
Inter-take pauses measured from the tiny-model chunks: 0.36, 0.30, 0.52,
0.56, 0.88, 0.72 s between segments. With 12 segments there are 11
boundaries ≈ 5 s of silence the photo-count rule never counted: it sized
photos from AUDIO seconds only, while the grid advances 2 s/photo
regardless of pauses. Each boundary pushes the words ~0.5 s later
relative to the grid. **v9 lever (still structure-only): size photos
from audio + ~0.5 s per segment boundary**, or equivalently carry a
+0.5 s cumulative offset per boundary. The c7 drift (−1.6 s vs planned
−0.8 s) is ~0.5 s of boundary pause + ~0.3 s of c5 running long.

## 5. Music
Bed present in the inter-sentence gaps (−30.4 to −43.7 dB RMS vs speech
−25.9 dB; tail after "quit." −47.5 dB) — a continuous bed, no silent
holes, but not verifiable as audible music from levels alone. Same
finding as v6/v7. `music_mood: calm` was set.

## 6. Nits (small, visible on close inspection)
- Front zipper in the floor shot vs back zipper in the zipper shot —
  the dress's zipper changes sides between photos.
- Dress silhouette: straight midi in the bedroom shots, flared/skirted
  when spinning at the wedding. Reads as the same dress in motion;
  a strict eye sees the cut change.
- Fridge photo (`real-fridge.jpg`) carries readable brand labels
  ("big", "Cheez", "EVERSWEET") — real-stock branding on screen.
- Sister's dress differs between `v7-dance-sister.jpg` (satin) and
  `v7-sisters-hug.jpg` (velvet). She is not the persona; minor.

## 7. What v9 needs (structure-only; engine changes are out of scope here)
1. Count the boundary pause: photos per segment ≈ (audio + 0.5 s ×
   boundaries so far) ÷ 2. This is the direct fix for the water clause.
2. Split the merged breakfast take, or give "Water before coffee" its
   own photo — two clauses, two photos, never one photo for two ideas
   that span a 2 s boundary.
3. CTA pace: the split does not create a pause. Either write the CTA
   as one take with a longer lead-in ("Three months later" style
   breathing room), or accept the burst and shorten the line to 5–6
   words so 355 wpm still lands. Do NOT split again expecting a pause.
4. Rhythm cannot be fixed by structure: the 2 s grid is an engine
   property. If v9 must vary rhythm without code, the only lever left
   is segment COUNT (more, shorter takes = more boundary pauses ≈
   slower effective pace) — untested, and it trades against the
   alignment gains.
5. The user's new body rule (2026-11-18 11:32, for v9): the before/after
   body difference must be VISIBLE IN THE BODY — two body states of the
   same persona (heavier vs slimmer, same face, same person), not only
   props (zipper, scale). v8 shows the dress not zipping, never the
   body change itself.

## Method
- `analyze_v8.py` (from `analyze_v7.py`): frames every 4 s
  (`frames-v8/f-01..f-14.jpg`), audio wav, scene cuts
  (`cuts-v8.txt`, `select='gt(scene,0.4)',showinfo`), faster-whisper
  tiny EN CPU int8 (`transcript-v8.json`).
- `map_photos_v8.py` (from `map_photos_v7.py`): 1 fps extraction,
  32×32 RGB MSE vs the 29 sources from `drive_v8.py` PHOTOS
  (`photo-map-v8.json`).
- Base-model word timestamps (`words-v8.json`, 172 words) — the tiny
  model returned 0 words with `word_timestamps=True`, same as v7.
- Music: RMS dB in the six inter-sentence gaps vs speech, numpy on
  `audio-v8.wav`.
- All 14 frames read visually; 1 fps frame at 48 s read to confirm heels.

## Files
- Video: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v8.mp4`
- This analysis: `~/workspace/video-selfhost/analysis-v8.md`
- Driver: `drive_v8.py`, log `logs/drive-v8.log`, `task-v8.json`,
  `task-v8-final.json`, `manifest-v8.json`
- Evidence: `transcript-v8.json`, `words-v8.json`, `cuts-v8.txt`,
  `photo-map-v8.json`, `frames-v8/`, `frames-v8-1fps/`, `audio-v8.wav`
- Download: endpoint 401 after archiving (same as v5/v6/v7); recovered
  direct from R2 dev bucket `videos` via `download_r2_v8.py`
  (14,653,904 bytes, key
  `dev-local/faceless/33701e22-ebbc-46c8-813d-a7fce4055f6c/final-1.mp4`).
