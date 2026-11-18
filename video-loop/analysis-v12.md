# v12 — analysis (maker, harsh)

**Score: 9.5 / 10**

File: `daily-dose-weight-regain-faceless-v12.mp4` — 56.40s, 1080×1920, 30fps,
14,411,065 bytes. Task `2dd22a24-777c-44b7-aad7-c6af95ef5fc1`, `video_quality: ok`.
Script 176 words, 12 segments, 29 photos, all with `SegmentMedia.duration`.
Audio 56.28s (subtitle log; task body rounds to 57). Whisper base aligned all
177 words; timings are IDENTICAL to v11 to the 0.01s (same voice, same text,
same TTS) — the duration plan's anchor held exactly.

## 1. Rhythm — THE fix worked. The metronome is dead.

- 25 of 28 photo transitions detected by scene detection within ±0.03s of the
  planned start (`photo-map-v12.json`). The 3 undetected cuts (19.48, 49.52,
  51.52) are all verified present by direct `-ss` frame probes: tears→bed
  between 19.0–19.5s, dance→wide-shoes visually continuous (near-identical
  framing, no visible defect), hug present by 51.5s.
- Photo durations now range 1.08–3.50s. Only 12/29 photos sit at exactly 2.0s,
  and the longest run of consecutive 2.0s photos is the hook's first 5 (0–10s).
  After 10s no run exceeds 2. Tears hold 3.0s (16.48–19.48), the study runs
  1.5s photos (26.50–31.00), the mirror resolve holds 3.0s (37.44–40.44).
- v11 judge's "rigid 2.0s grid first 40s (71%)" is gone.

## 2. Text / image — 12.5 / 13 beats clean

- **"It was not me" is finally exact**: face photo 35.98–37.44, words
  36.00–36.66 — the whole phrase on the realization face (verified by `-ss`
  probe at 36.0s: face + "down in my notebook" subtitle, see §5).
- Phone appears exactly at the turning point (22.06) and never before:
  bed-no-phone verified no-phone at 19.5/20.0/20.5s.
- Labeled chart is legible and self-explanatory: "Hunger stayed high.
  Fullness stayed low.", axes + legend, portrait fills the frame.
- Eggs (40.44–41.80) under "Eggs for breakfast" exact. Walk day→night
  (43.40–47.52) literally shows "every single night". Dance + heels + hug
  under the wedding close. Notebook under "I wrote four words" exact.
- Partial: the blueberry (31.00–33.58) lands on "their fullness still weaker"
  (31.90–33.02) rather than "hunger was still louder" — an almost-empty plate
  reads as "still hungry", the opposite pole of the same mechanism. The labeled
  chart immediately before states both lines, so the viewer is not misled.
- "Water" starts 0.08s before its photo (41.72 vs 41.80) — negligible.
- Shoes-tying motif: ZERO appearances in v12 (removed, not repeated).

## 3. Body + persona — zero leaks

- HEAVY 0–46s, SLIM 46–56s, verified in all 14 four-second frames plus ~15
  probes. The v11 slim-phone leak is fixed (new HEAVY phone photo, clearly
  heavier, same face). The v11 sleeveless CTA zipper is fixed (short lace
  sleeves visible at 55s and 56s). Same face everywhere: green eyes, freckles,
  brown low bun, navy lace dress with short sleeves.
- Known nit persists: `v10-mirror-face` shows a deep V neckline in the
  reflection vs round neck on the body (visible at 0s and 8s).

## 4. Subtitles — the v12 hypothesis is DISPROVEN. Lag persists.

- Text is clean (no dashes; engine cleanup #637 live). But the subtitles
  still lag the spoken words by ~1s at 4 of 7 points probed with exact `-ss`
  frames (fps-filter frames are unreliable: `fps=1/4` runs up to ±2s late,
  `fps=1` ±0.5s — all measurements below are `-ss` probes):
  - 21.0s: "the dress did not fit anymore" (words ended 20.16) while "said
    nothing" is spoken — lag ~1s.
  - 32.0s: "and their hunger was still louder" (ended 31.48) while "their
    fullness still weaker" is spoken — lag ~0.5s.
  - 34.0s: "their fullness still weaker" (ended 33.02) while "I wrote four
    words" is spoken — lag ~1s.
  - 36.0s: "down in my notebook" (ended 35.42) while "It was not me" is
    spoken — lag ~0.6–1s.
  - In sync at 31.0s, 50.0s, 55.0s (probe fell inside the phrase's own window).
- Pattern: each subtitle line is held ~1s past its words, so it bleeds into
  the next phrase. Photo/audio drift is ZERO (transitions within 0.03s), so
  the lag is NOT drift — it is engine-side SRT item timing. **Not fixable
  from the script.** Needs an engine fix/issue, not a v13 script change.
- Same defect class as v11 ("1–2s off in 3 points"), slightly smaller (~1s).

## 5. Audio

- One voice, all 177 words intelligible (Whisper aligned every word; its one
  slip, "to a shame" for "too ashamed", is a transcription artifact — the
  subtitle shows the correct text and v11's judge flagged no mispronunciation).
- CTA is still the fastest take: 12 words in 53.04–55.50 = 293 wpm over the
  spoken span (224 wpm gap-inclusive) vs hook 206 wpm. TTS property of the
  final take; the 12-word CTA did not fix the pace. Intelligibility intact.
- Music bed measurable in every inter-take gap: -40.0 to -43.7 dB (mean ~-41)
  vs voice -25.7/-24.7 dB — ~15 dB under the voice, present but not prominent.
  One gap reads -29.8 dB (39.76–40.44, likely TTS tail).

## 6. Ending — substance fixed, literal target missed

- Last frame is the zipper payoff (54.76–56.40), NOT the dance. The notes'
  "last frame is the dance" conflicts with the plan's own buffer design (dance
  1.70s, zipper 3.50s buffer). The v11 failure is fixed in substance — the
  0.9s tail sits on a wedding image (hand on the closed zipper, smiling), not
  a pre-wedding hanger — but the literal target was not met. The CTA splits
  across two photos: dance under "Save this for the day you", zipper under
  "want to quit and start again" (the zipper is arguably the right image for
  those words).

## 7. Artifacts / non-defects (verified, do NOT "fix")

- The dark frame at 1fps s-20 is an EXTRACTION ARTIFACT, not in the video:
  2fps probe shows the bed photo present at 19.5/20.0/20.5s. Same class as
  the v10 "flashes".
- No dark frames, no anonymous hands, no repeated photo, no coverage filler
  (29 photos cover 58.26s nominal vs 56.28s audio; the 29th photo is a real
  buffer, clipped at video end).

## Verdict

v12 delivers everything the notes asked for except the two engine/TTS-side
items: the subtitle lag (~1s, same class as v11, drift hypothesis disproven)
and the CTA pace (still fastest take, 293 wpm spoken-span). The rhythm fix is
the biggest single improvement in the loop, alignment is near-perfect, body
and persona are clean. One step from 10 — and the remaining step is not in
the maker's hands.

## What v13 needs (for the parent, not the maker)

1. Subtitle lag: engine-side SRT timing (each line held ~1s past its words).
   Open an engine issue; no script change fixes it.
2. CTA pace: TTS property of the final take. Options: accept it (intelligible,
   reads as urgent), or shorten/split the CTA take.
3. Last frame: if the dance must literally be the last frame, drop the zipper
   buffer — but the zipper under "want to quit and start again" is the better
   image for those words; consider keeping the split and rewriting the target.
