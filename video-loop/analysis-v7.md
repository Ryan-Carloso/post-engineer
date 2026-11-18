# v7 — analysis (maker's own score, stays in this file until the panel closes)

- File: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v7.mp4`
- Task: `786fa5fa-60a6-41ea-ab72-fe125d675c9b` (local engine, dev)
- Duration: 52.57 s, 1080×1920, h264 + aac, 14,034,909 bytes
- Audio: 53 s (engine), speech ends ~51.7 s, 0.85 s music-only tail
- Script: 166 words, 12 segments (hook 40w + 11 content takes), archetype Inspirador
- Design under test: one segment per sentence/beat (structure, not prompt procedure).
  Rhythm by sentence length, never by photo count.
- Download: endpoint 401 after archiving (same as v5/v6); recovered via direct R2
  (`download_r2_v7.py`, key `dev-local/faceless/786fa5fa-60a6-41ea-ab72-fe125d675c9b/final-1.mp4`).
- **Score: 8/10**

## Verdict in one line

v7 proves the structure change fixes the **mapping** (text/image 11/13, best yet)
but NOT the **pacing**: the first 40 s are still a perfect 2.0 s metronome, and the
ending still rushes. The engine's photo layout is a global 2 s queue, blind to
segments — the segment structure changes WHICH photo appears, never WHEN.

## 1. Script spoken word-for-word

faster-whisper tiny (full audio) + base (tail 45–53 s, word timestamps).
Transcription matches the 166-word script exactly. The tiny model cut the last
three words ("want to quit") — a transcription artifact, not a render defect:
base-model word timestamps confirm all nine CTA words:

```
50.22 Save  50.44 this  50.64 for  50.80 the  50.90 day
51.08 you   51.26 want  51.38 to   51.50 quit.
```

Caveat inside that confirmation: the CTA words run in 1.43 s (~378 wpm burst),
nearly twice the hook's pace (~197 wpm). The line viewers must catch to save the
video is the fastest line in it. There is a 0.7 s pause before "Save" (49.5–50.22),
which helps, but the burst itself rushes.

## 2. The photo map — ground truth (per-second matching)

Every second of the video was matched against the 29 source photos by downscaled
RGB distance (MSE), cross-checked against ffmpeg scene-cut timestamps. Result:
**the photos play in submission order, 2.0 s each, on a grid anchored at 0.**

| photo run | seconds | duration |
|---|---|---|
| v7-bed-dress | 0–2 | 2.0 s |
| v7-dress-hanger | 2–4 | 2.0 s |
| v7-zipper | 4–6 | 2.0 s |
| v7-mirror-defeated | 6–8 | 2.0 s |
| v7-sleeve-detail | 8–10 | 2.0 s |
| v7-floor-wide | 10–12 | 2.0 s |
| v7-floor | 12–14 | 2.0 s |
| v7-floor-face | 14–16 | 2.0 s |
| v7-hem-detail | 16–18 | 2.0 s |
| v7-bed-phone | 18–20 | 2.0 s |
| v3 content1-phone | 20–22 | 2.0 s |
| v5 reading-relief | 22–24 | 2.0 s |
| v7-study-chart | 24–26 | 2.0 s |
| real-fridge | 26–28 | 2.0 s |
| real-small-plate | 28–30 | 2.0 s |
| v6-mara-notebook | 30–32 | 2.0 s |
| v5 looking-up | 32–34 | 2.0 s |
| v4 shoes | 34–36 | 2.0 s |
| real-eggs | 36–38 | 2.0 s |
| real-water | 38–40 | 2.0 s |
| v6 walk-day | ~39.7–40.8 | ~1.1 s |
| v6 walk-dusk | ~40.8–42 | ~1.2 s |
| v6 walk-night | ~42–43.5 | ~1.5 s |
| v7-dance | ~43.5–45 | ~1.5–2.0 s |
| v7-dance-wide | ~45–46.7 | ~1.7 s |
| v7-dance-sister | ~46.7–48.4 | ~1.7 s |
| v7-sisters-hug | ~48.4–50.1 | ~1.7 s |
| v5 smile-sunrise | ~50.1–51.6 | ~1.4 s |
| v7-save-phone | ~51.6–52.6 | ~1.0 s |

(Tail durations ±0.5 s: the scene detector misses cuts between similar shots,
e.g. walk-night→dance and dance→dance-wide. The direction is certain: the tail
runs SHORTER than 2 s, not longer.)

**Engine behavior, measured, not inferred.** 29 photos at 2.0 s would need 58 s;
the audio is 52.57 s. The engine lays 2.0 s photos until the remaining photos
can no longer fit at 2 s, then squeezes the tail: 20 photos × 2.0 s = 40 s,
then 9 photos in the remaining 12.57 s (~1.4 s each). Segment boundaries play no
role: cut timestamps are at 2, 4, 6, … 38 s, a grid anchored at 0, not at the
segment starts (hook audio ends 12.2 s, c1 ends 17.3 s — neither is a cut).

This also re-reads v6: its "2.53 → 1.37 s/photo" numbers were take-seconds divided
by photo counts, not on-screen durations. v6 almost certainly had the same 2 s
grid; v7 is the first version measured per second.

## 3. Rhythm — the design hypothesis, refuted by measurement

Segment audio boundaries (interpolated from transcript chunks; base-model word
timestamps for the tail) vs the photo grid:

| segment | words | audio | photos | photo span | offset* |
|---|---|---|---|---|---|
| hook | 40 | 0–12.2 | 5 | 0–10 | 0.0 s |
| c1 | 17 | 12.2–17.3 | 3 | 10–16 | −2.2 s |
| c2 | 12 | 17.3–20.9 | 2 | 16–20 | −1.3 s |
| c3 | 9 | 20.9–24.0 | 2 | 20–24 | −0.9 s |
| c4 | 22 | 24.0–31.1 | 3 | 24–30 | 0.0 s |
| c5 | 11 | 31.1–34.2 | 2 | 30–34 | −1.1 s |
| c6 | 7 | 34.2–36.9 | 1 | 34–36 | −0.2 s |
| c7 | 3 | 36.9–38.1 | 1 | 36–38 | −0.9 s |
| c8 | 3 | 38.1–39.2 | 1 | 38–40 | −0.1 s |
| c9 | 11 | 39.2–44.6 | 3 | 39.7–43 | +0.5 s |
| c10 | 22 | 44.6–49.5 | 4 | 43–50.1 | −1.6 s |
| c11 | 9 | 49.5–51.7 | 2 | 50.1–52.6 | +0.6 s |

\* offset = photo-span start − audio start. Negative = photos ahead of the words.

Findings:

- **0–40 s: zero rhythm contrast.** Every photo is exactly 2.0 s. The hook does
  not linger, the low point does not linger, the short takes do not snap. The
  sentence-length design changed nothing in the first 40 s — the queue governs.
- **The ending accelerates, the opposite of the intent.** The victory (c10/c11)
  gets the fastest cuts (~1.4 s/photo) and the fastest TTS (c10 ~269 wpm, CTA
  burst ~378 wpm). v6 had the same failure; v7 repeats it.
- **TTS pace swings 122–378 wpm across takes with no pattern the design
  controls** (c9 ~122 wpm, c10 ~269, CTA burst ~378, hook ~197). Pace is a
  property of the TTS per take, not of the sentence length.
- **The short takes re-sync the drift.** The offset never accumulates beyond
  ~2.2 s because the 1-photo short takes (c6–c8) act as anchors: a ~2 s take
  with 1 photo matches the 2 s grid. The worst offset (c1, −2.2 s) comes
  straight from the hook: 5 photos = 10 s of photo time vs 12.2 s of audio.
  The drift is arithmetic, and it is fixable in the structure — see §7.

## 4. Text/image — frame-by-frame (13 samples, every 4 s)

| t | photo on screen | subtitle on screen | verdict |
|---|---|---|---|
| 0 s | bed-dress | "I tried on the dress I" | MATCH |
| 4 s | zipper | "and the zipper stopped" | MATCH |
| 8 s | sleeve-detail (her hand on the lace sleeve) | "and I felt like everything I" | MATCH |
| 12 s | floor (sitting, lamp-lit, hugging knees) | "bedroom floor in the dress" | MATCH — the low point is visible |
| 16 s | hem-detail (dress pooled on the floor, bare feet) | "Too ashamed to tell my sister" | SOFT — dress on the floor reads as defeat, but no face, no phone; bed-phone follows at 18 s under the same sentence's tail |
| 20 s | content1-phone (reading at the kitchen table, coffee) | "Then one morning I read" | MATCH — the turning point is visible |
| 24 s | study-chart (her hands, printed pages, rising line) | "A study had followed people for" | MATCH |
| 28 s | small-plate (one blueberry on a white plate) | "and their hunger was still louder" | SOFT MATCH — the plate arrives ~1 s before "fullness still weaker"; one blueberry also reads as hunger/emptiness, so it works for both clauses |
| 32 s | looking-up (sage tee, smiling up, phone in hand) | "in my notebook" | **MISS** — the notebook photo ran 30–32 s; the word "notebook" lands ~32.7 s on the relief photo |
| 36 s | real-eggs (three fried eggs) | "Eggs for breakfast" | MATCH — exact; the v6 failure (water on eggs) is fixed |
| 40 s | walk-dusk | "every single night" | MATCH |
| 44 s | dance (spinning at the wedding, laughing, navy lace dress) | "all night at the" | MATCH |
| 48 s | sisters-hug | "why it would hold" | MATCH |

**11/13 match, 1 soft, 1 miss.** v6 was 10/13 with 3 misses. The v6 failure
modes are gone (no water-on-eggs, no calendar, no wrong-subject photo). The one
miss is a TIMING miss, not a subject miss: the notebook photo is the right photo
and it leaves 0.7 s before its word arrives — the 2 s grid again (§2).

## 5. Story, persona, subtitles, music

- **Story / arc: strong.** Same dress story as v6. Real, concrete, first-person,
  plausible. Low point genuinely low (floor, 12 s, face down, lamp-lit). Turning
  point has a visual moment (phone at 20 s, chart at 24 s). Close joyful
  (dance 44 s, hug 48 s). Archetype Inspirador is obvious throughout.
- **Fact: verified.** Sumithran et al. 2011, NEJM 365:1597–604, PMID 22029981 —
  one year after weight loss, leptin still low, ghrelin still high, hunger still
  elevated. Qualitative only in the script. One nit: the chart on screen reads
  "Weight Trend — 12 Week Study" while the narration says "a full year" —
  readable at full size, a glance at video speed.
- **Persona: consistent.** Same face (brown hair low bun, freckles, green eyes),
  same navy-blue lace midi dress with short sleeves and round neckline in every
  dress shot. No dark frame (v6's ~16 s dark frame is gone). No anonymous hands
  (chart hands are hers: freckled, sage sleeve). No stock calendar.
  Nits: floor-wide shows a FRONT zipper while the zipper shot shows a BACK
  zipper; the sister's dress changes between hug (burgundy velvet) and
  dance-sister (burgundy satin wrap) — the sister is not the persona; the dance
  shot has her barefoot while the walk shots have sneakers (dancing barefoot at
  a wedding is plausible, but it is a continuity break).
- **Subtitles: clean, 13/13 frames.** No `-`, no `,`, no `.` visible anywhere.
  (Whether that is the engine cleanup or the renderer splitting at punctuation
  is not distinguishable from the frames; the visible result is clean.)
- **Music: bed audible in the gaps.** Full-audio mean −26.3 dB. Inter-sentence
  gaps: 4.46 s gap mean −42.1 dB (max −19.6), 15.80 s gap −35.8 dB (max −20.8),
  40.34 s gap −28.0 dB (max −12.2). The 40.3 s gap is nearly as loud as speech —
  the bed is clearly present there; the first two gaps sit 10–16 dB below speech.
  Same finding as v6, slightly louder. No silent holes.

## 6. Score — 8/10

| dimension | score | note |
|---|---|---|
| Story / arc | 9 | low point visible, turning point visible, joyful close |
| Text / image | 8.5 | 11/13; one timing miss (notebook), one soft (hem) |
| Rhythm / pacing | 5 | 2.0 s flat for 40 s; ending faster, opposite of intent |
| Persona / visuals | 9 | same dress, same face, no dark frame; small nits |
| Voice / music | 7 | one voice 52 s; bed audible; CTA burst ~378 wpm |
| Subtitles | 10 | clean in 13/13 frames |
| Fact accuracy | 9 | Sumithran verified; "12 Week Study" vs "a full year" nit |

v6 (maker) was 8/10. v7 ties it: better mapping (11/13 vs 10/13, no dark
frame, eggs exact) against the same pacing failure, now measured precisely, plus
a rushed CTA. The design change bought mapping, not pacing. Not a 9 — the
metronome is still the whole first 40 s, and the closing line is the fastest
line in the video.

## 7. What v8 must change (notes for the next maker)

The v7 structure (one segment per sentence) is necessary but not sufficient.
The missing structural lever is the **photo count per segment**, because the
engine's queue is 2 s/photo and blind to segments. The alignment rule, in the
structure:

- **Cumulative alignment: photos before any sentence ≈ audio seconds before
  that sentence ÷ 2.** A segment's photos must cover its own audio:
  `photos ≈ round(segment_audio_seconds / 2)`, with TTS ~190 wpm that is
  `≈ words / 6.3` — inside the density range `[ceil(words/8), floor(words/3)]`.
- Concretely, the hook is the leak: 40 words ≈ 12.2 s of audio needs **6 photos**,
  not 5. The −2.2 s deficit at the hook is what puts every later segment ~1–2 s
  off. c4 (22 words ≈ 7.1 s) needs 4 photos, not 3. Short takes already self-
  align (1 photo ≈ 2 s take) and should stay at 1 photo.
- The notebook miss disappears under this rule: with the hook fixed to 6
  photos, the cumulative offset at c5 drops from −1.5 s to ~0, and the notebook
  photo is on screen when the word "notebook" is spoken.
- The CTA needs a pace guard in the structure: it is 9 words in 1.43 s because
  the TTS rushes short final takes. Either split the CTA across two segments
  ("Save this for the day" / "you want to quit.") or give it a longer lead-in
  so the burst is not the whole take.
- Engine-side (not a prompt change): PR #652 `SegmentMedia.duration` would make
  photo durations segment-aware and end the 2 s queue entirely. Until it lands,
  the photo-count rule above is the only structural way to align photo and word.

## 8. Method notes (for the parent, not the score)

- Photo mapping: `map_photos_v7.py` (1 fps frames vs 29 sources, 32×32 RGB MSE),
  `photo-map-v7.json`, cross-checked with `cuts-v7.txt` (ffmpeg scdet 0.4).
- Word timestamps for the full audio failed (tiny + `word_timestamps=True`
  returned 0 words); segment boundaries are interpolated from the tiny
  transcript chunks, tail words from the base model — boundary estimates ±0.5 s.
  The 2.0 s photo grid itself is exact (cuts + per-second map agree).
- This score stays in this file only until the panel closes (process lesson
  from v5: the maker's score must not reach shared memory before judging).
