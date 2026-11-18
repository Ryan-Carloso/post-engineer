# analysis-v10 — Daily Dose faceless v10 (Inspirador)

**Score: 8.5 / 10** (maker self-score — stays in this file only, until the blind panel closes)

## File

- `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v10.mp4`
- 56.23 s, 1080×1920, h264 + aac, 14,511,591 bytes
- Task `226b57ff-5dd5-408d-b35a-bf09da952adc` (2nd render attempt; see Render history)
- Script: 175 words, 12 segments, 29 photos. Voice `chatterbox:phonon_everly`. Music mood: calm.
- Engine-reported `audio_duration`: 57 s. Whisper (base) duration 56.24 s; last word ends 55.32 s.

## Render history (what it took to get this file)

1. First attempt, task `4d2fcdd4-dcca-4992-8408-8037efc75c1a`, reached 40% (subtitle stage) — then the VM restarted (~16:08), killing the engine, TTS and driver. In-memory task state lost.
2. Stack restarted via `start-stack.py` (TTS :4123 healthy, engine :8080 `/version` 200).
3. Retry, task `77dee065-9832-4216-af65-e664a42dd8e7`, FAILED at the materials stage: `images_do_not_cover_audio: 28 photos cover 56.0s of 57.0s at 2s each; need 1 more photo`. The same script measured 55.0 s of audio in v9 and 57.0 s here — TTS timing varies ~2 s run to run.
4. Fix: 29th photo added in the only shift-free slot — CTA, last position (`v5-mara-looking-up`, slim, hopeful, phone in hand, verified full-size 1152×2048). Grid 58 s ≥ 57 s. CTA density 3 photos for 12 words is inside [2, 4].
5. Second retry rendered to 100% (state=1). Endpoint download 401'd after R2 archiving (as usual); fetched via `download_r2_v10.py` — note: it needs the **engine venv python** (`boto3` is not in system python).
6. Render was slow: subtitle done 16:40, materials (background mp4 + 30 segment panels) until ~17:19, render 50%→75%→100% by ~17:39. Box load average was 7–17 (another agent's `next-server` + `tsc`); v9's whole render took ~19 min, v10's took ~60 min. Nothing was stuck — the engine renders frames in Python and the background mp4 alone took ~38 min.

## Method

- Frames every 4 s (`frames-v10/`, 14 frames) + 1 fps map (`frames-v10-1fps/`, 56 frames) + exact-timestamp `-ss` probes (`probe/`, `probe1s/` — ground truth; the `fps=` filter frames are offset ~1 s and must NOT be trusted for timing).
- Transcription: faster-whisper **base**, EN, CPU int8, word timestamps — 176 words (Whisper splits "too ashamed" into "to a shame", +1 word). NOTE: `analyze_v10.py` as first written produced an empty `words-v10.json` — the `segs` generator was consumed building `out` before `words` iterated it. Same bug existed in `analyze_v9.py` (that is why v9 "tiny returned 0 words" — it was the script, not the model). Fixed in `analyze_v10.py` (`segs = list(segs)`); `words-v10.json` was re-generated with the fix.
- Scene cuts: ffmpeg `scdet` 0.4 + per-second frame-difference signatures on `-ss` probes + 30 fps windows around boundaries.
- Music RMS measured on `audio-v10.wav` (16 kHz mono) in the 11 inter-take gaps.

## Measured timings

### Segment pace (word timestamps, Whisper base)

| segment | words | audio | wpm |
|---|---|---|---|
| hook | 40 | 0.00–11.64 | 206 |
| c1c2 | 33 | 12.50–21.32 | 232 |
| c3 | 11 | 22.08–25.74 | 157 |
| c4 | 22 | 26.48–33.26 | 171 |
| c5a | 7 | 33.90–35.38 | 198 |
| c5b ("It was not me") | 4 | 35.90–36.60 | 182 |
| c6 | 7 | 37.38–39.64 | 143 |
| c7a | 3 | 40.22–40.92 | 143 |
| c7b | 3 | 41.60–42.54 | 118 |
| c9 | 11 | 43.22–46.72 | 151 |
| c10 | 22 | 47.38–52.24 | 242 |
| cta | 12 | 52.96–55.32 | **305** |

Inter-take gaps (11 boundaries): 0.52–0.86 s, mean **0.69 s**, total ~7.6 s. The 0.7 s/boundary estimate in the v10 design was right — the drift comes from elsewhere (below).

### Drift: audio start minus photo-grid start (photos are a 2 s global queue from 0)

| segment | audio start | grid start | drift |
|---|---|---|---|
| hook | 0.00 | 0 | 0 |
| c1c2 | 12.50 | 12 | +0.5 |
| c3 | 22.08 | 22 | +0.08 |
| c4 | 26.48 | 26 | +0.48 |
| c5a | 33.90 | 32 | **+1.9** |
| c5b | 35.90 | 34 | **+1.9** |
| c6 | 37.38 | 36 | +1.38 |
| c7a | 40.22 | 38 | **+2.22** |
| c7b | 41.60 | 40 | +1.6 |
| c9 | 43.22 | 42 | +1.22 |
| c10 | 47.38 | 46 | +1.38 |
| cta | 52.96 | 52 | +0.96 |

Cause, measured: the photo counts assumed ~190 wpm uniformly, but the TTS pace varies 118–242 wpm per take. c4 runs slow (171 wpm: 22 words take 6.78 s of speech + 0.74 s gap = 7.52 s for a 6 s grid slot), so everything after c4 is ~1.5–1.9 s late; the short takes (c5a–c7b) each add a 0.5–0.8 s gap to a 2 s slot and never recover the drift. The first three segments are nearly perfect (+0.1–0.5 s); the middle is the worst it has ever been (v9 peak was +1.6 s; v10 peak is +2.22 s).

### Rhythm

- Photo changes at exactly every 2.0 s (verified by per-second frame-difference signatures on `-ss` probes: changes at 2, 4, …, 54, 56). **28 of 29 photos last exactly 2.0 s.** The 2 s metronome is unchanged — the engine's global queue, PR #652 not in this build.
- `scdet` (0.4) found only 24 cuts: it missed 14 s (floor-wide→floor, near-identical), 48/50/52 s (dance→dance-wide→hug→sunrise, similar warm wedding shots). Those are detector misses, not frozen frames — the `-ss` probes show the photos changing.
- **NEW render artifact — single blank frames:** exactly one frame (33 ms) of the plain neutral background at ~48.0, ~50.0, ~52.0 and ~54.0 s (grayscale std 12–16 vs ~50–70 for photos), i.e. the last frame before each of those four boundaries. No blank frame at 2, 12, 22, 32, 36, 46 or 56 s. All four are inside the c10/CTA zone. At normal playback speed this reads as a faint flicker in the climax, not as a visible freeze — but it is a real engine render defect, and it is new vs v9 (v9's frames were not probed this way, so it may have existed there too — unproven either way).

### Music

- Audible in the gaps: RMS 0.003–0.013 (mean ~0.008) vs speech RMS 0.053 — roughly −16 dB under the voice. Calm mood, present but quiet. No gap is silent.

### Subtitles

- Text is **clean in every frame viewed**: no `-`, `,`, `.` anywhere (PR #637 holding). No `?` in the script, so none expected.
- Timing drifts with the audio/grid gap: lines lag the spoken words by up to ~1.5 s in the 32–37 s zone (at 36.5 s the screen still reads "in my notebook" while the voice says "It was not me"; at 35 s it still reads "their fullness still weaker" while the voice is on "in my notebook"). Elsewhere lines lead by ~0.5–1 s (at 48.0 s "all night at the" appears ~0.9 s before the words). The line "It was not me" itself is barely displayed (the c5b audio is 1.32 s and the line changes fall on either side of it).

## Frame-by-frame (photo → audio at that second)

- **0 s** bed-dress (heavy, navy lace midi, back zipper, mirror in frame, worried) / "Six months after my diet ended". Opening is HEAVY — v9's opening leak fixed.
- **4 s** zipper close-up (heavy, hand pulling the stuck back zipper) / "and the zipper stopped". Literal.
- **8 s** mirror-full (heavy, full-length mirror + reflection, downcast) / "Same dress, same mirror". A real mirror in frame — v9's sleeve close-up fixed.
- **12 s** floor-wide (heavy, sitting on the bedroom floor in the dress) / "That night I sat on the…".
- **16 s** floor-face (heavy, tear on cheek) / "too ashamed to tell my sister". The low point is visibly low.
- **20 s** dress-floor (navy dress crumpled on the floor, NO person, NO feet) / "so I said nothing". v9's bare-feet-on-dress fixed.
- **24 s** v3-phone (heavy, sage t-shirt + jeans, reading phone by the window) / "I read something that changed everything". Body heavy ✓. Minor: no coffee in frame for "over coffee".
- **28 s** chart-laptop (clean line chart, NO text/numbers, coffee cup) / "a full year after their diet". A real study image, no fridge — v9's weakest image fixed. No brands, no legible text.
- **32 s** notebook-writing (heavy, writing in notebook, coffee cup) / "their fullness still weaker" — the notebook photo arrives 1.9 s early and spends its first ~2 s under c4's tail.
- **35 s** face-realization (heavy, eyes widening, relief/hopeful smile, sage t-shirt) / "their fullness still weaker" → "in my notebook". **The face EXISTS now** — but it shows 34–36 s while the words "It was not me" are spoken 35.90–36.60.
- **36 s** shoes-heavy (heavy, tying grey sneakers on the bed edge) / audio "It was not me" (35.90–36.60), subtitle "in my notebook". **The key phrase lands on the shoes photo.** The face got 1.9 s of screen time, entirely before the words. v9's failure, one step better: the image exists, the moment still misses.
- **38–40 s** eggs photo (slot 38–40) — but "Eggs for breakfast" is spoken 40.22–40.92, over the water photo (40–42). The split takes did not fix the swap; the drift moved it by one slot.
- **40–42 s** water-coffee (glass of water + coffee cup, no person) / "Water before coffee" spoken 41.60–42.54: 80% on the right photo, the last ~0.5 s ("coffee.") falls on walk-day.
- **42–44 s** walk-day-heavy (heavy, sunny street) / "A walk after dinner" ✓.
- **44–46 s** walk-night-heavy (heavy, dusk, streetlights) / "every single night, no matter the weather" ✓ (only "weather." at 46.72 spills onto the dance photo).
- **46–48 s** dance (SLIM, navy lace dress, laughing, string lights) / "Three months later I danced". **The body change is visible and immediate**: heavy walk at 44 s → slim dance at 47 s, same dress, same face, visibly different body. Nude heels visible in the wide shot at 50 s (both feet).
- **50–52 s** sisters-hug (slim, hugging her sister in red velvet, both laughing) / "and this time I knew why it would hold" ✓.
- **52–54 s** sunrise-smile (slim, golden field, smiling) / "Save this for the day you want" — CTA photo arrives 0.96 s before "Save".
- **54–56 s** save-phone (slim, selfie with phone, smiling) / "to quit and start again" ✓.
- **56–56.23 s** looking-up (slim, hopeful, phone in hand) — the 29th photo, on screen for ~0.13 s. It exists only to satisfy the fail-fast check; no viewer can register it. It is filler in effect, exactly what NOTAS-v10 warned against — but without it there is no render at all (57 s audio vs 56 s grid).

## Body timeline — the user's rule

HEAVY 0–46 s, SLIM 46–56 s. Verified at every sampled second: no leaks. The four v9 leaks are all gone (heavy opening, heavy shoes, heavy walks). Without sound, the story reads: woman in a dress that does not fit → floor, tears, dress on the floor → reading, notebook → small restarts → dancing slim at a wedding. **The before/after difference IS visible in the body now.** This was the single biggest fix, and it holds.

## Persona / outfit continuity

- Same face, low bun, freckles in every appearance. Navy lace midi dress (short sleeves, round neckline, back zipper only) in all dress scenes; sage t-shirt + jeans in all restart scenes. Shoes: grey sneakers for the restart, nude heels at the wedding. No brand logos legible anywhere. No anonymous hands. The sister (red velvet dress) appears only in the hug.

## What v9's failures became

| v9 failure | v10 |
|---|---|
| Body leaks in 4 reused photos (slim opening, slim shoes, slim walks) | FIXED — heavy 0–46, slim 46–56, verified |
| CTA burst 340 wpm (6 words / 1.06 s) | STILL BROKEN — 305 wpm (12 words / 2.36 s), 1.48× the hook (206 wpm), fastest take in the video. Doubling the CTA length did NOT fix it: the TTS rushes the final take regardless of length |
| Drift, peak +1.6 s (notebook, eggs, dance) | WORSE — peak +2.22 s (c7a), +1.9 s at c5a/c5b. The 0.7 s/boundary math was right; the per-take pace spread (118–242 wpm) was not modelled |
| "It was not me" without its own image | PARTIAL — the face exists (34–36 s) but the words (35.90–36.60) fall on the shoes photo |
| 3 weak images (sleeve for "same mirror", feet on dress, fridge for study) | FIXED — real mirror, dress alone on floor, clean chart |
| 28th photo 0.37 s, coverage-only | SAME, moved — 29th photo 0.13 s, coverage-only |
| 2.0 s metronome (27/28 photos) | UNCHANGED — 28/29 photos exactly 2.0 s (engine queue; PR #652 not in this build) |
| Subtitles clean | STILL CLEAN — no dash/comma/period in any frame |
| — | NEW — 4 single-frame blank flashes at ~48/50/52/54 s (33 ms each, climax zone) |

## Why not higher

The video now clears the bar the user set explicitly (the body change is visible without sound) and every image is on-theme and strong. What caps it: the emotional turn — "It was not me", the single most important phrase — still has no image under it (face 1.9 s early, words on shoes); the CTA still rushes (305 wpm); the middle drift is worse than v9 (peak +2.22 s) so eggs land on the water photo and the notebook arrives under the study's tail; and the climax has four 1-frame blank flashes. A 9 would need the turn to land and the drift under ~1 s.

## For v11 (measured, not guessed)

1. **Drift is a per-take pace problem, not a boundary-count problem.** Compute photo counts from THIS run's measured per-segment audio (table above), not from 190 wpm. c4 needs 4 photos (7.52 s of audio+gap for a 6 s slot is what broke everything downstream), c5a/c5b/c6/c7 need their counts from their measured 2.1–2.9 s takes + 0.5–0.8 s gaps.
2. **"It was not me" must start just after a 2 s boundary.** It starts at 35.90, 0.1 s before the 36.0 boundary, so no 2 s slot can ever hold it with its face. Shift the script so the phrase starts at ~36.2+ (trim ~1 word from c4/c5a, or add a beat before it) — or move the face photo into the 36–38 slot and accept c6 starting on the face's tail.
3. **The CTA burst is a TTS property of the final take, not a length problem.** 6 words → 340 wpm, 12 words → 305 wpm. More words does not fix it. Do not try a longer CTA again; the fix (if any) is on the TTS/engine side, or accept ~300 wpm and judge whether it reads as urgency rather than a glitch.
4. **The 29th photo problem is structural:** audio varies 55–57 s run to run for the same script, and the grid is exactly 2 s/photo. Any script whose audio lands at 56–57 s needs a 29th photo that will show for <1 s. Either size the script for ≤55 s of audio (so 28 photos always cover it) or accept a coverage photo.
5. **Blank flashes at 48/50/52/54 s** need an engine-side look (single background frame at the boundary, only in the c10/CTA zone in this render). Not a script problem.
6. **Do not trust `fps=` filter frames for timing** — they are offset ~1 s and they landed exactly on the blank boundary frames here, which briefly looked like the whole climax was missing. Use `-ss` probes + per-second signatures (as done above).
7. **Transcription tooling:** `analyze_v9.py`/`analyze_v10.py` had the generator-exhaustion bug (`words` empty). Fixed in `analyze_v10.py`; port the fix to any future analysis script.
