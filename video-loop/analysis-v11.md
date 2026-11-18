# v11 — maker analysis

**Score: 9.0/10** (v10 maker: 8.5/10)

**File:** `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v11.mp4`
— 56.40 s, 1080×1920, 14,755,328 bytes, task `07d59816-b9cf-4587-a21a-55fd7f8e5bb7`
(retry; first attempt `a28e78c5` failed `images_do_not_cover_audio` — see §7).
Archetype: Inspirador. Script: 176 words, 12 segments, 30 photos.
Engine: local dev build (pre-#652/#656 — coverage check still says "at 2s each",
no `SegmentMedia.duration`).

## 1. What v11 fixed vs v10

1. **"It was not me" finally has its face.** The words "not me" (36.22–36.66)
   play over the realization face (photo 19, 36–38), verified by `-ss` probe
   at 36.4 s. v10's #1 miss is closed. Only "It was" (35.98–36.22, 0.24 s)
   still bleeds onto the notebook photo.
2. **The CTA stays at the wedding.** "Save this for the day you want to quit
   and start again" (53.06–55.50) plays over the CTA dance (52.03–54) and the
   closed-zipper payoff (54–55.7). v10's field + bathroom selfie are gone.
3. **c4 has its 4th photo.** The study now reads as a study: hands holding
   chart papers (26–28), laptop chart (28–30), NEW papers chart + pen + coffee
   (30–32), blueberry on the empty plate (32–34) — the blueberry lands exactly
   on "their fullness still weaker" (32.02–33.00).
4. **Eggs and water are exact.** "Eggs for breakfast" (40.44–41.14) is fully
   inside the eggs photo (40–41.57). "Water before coffee" (41.80–42.76) is on
   the water photo except the last 0.26 s of "coffee.", which crosses the 42.5
   cut onto the walk photo.

## 2. Body timeline — holds, zero leaks

HEAVY 0–46 s, SLIM 46–56 s. All 30 photos viewed first-hand (14 fps=1/4 frames
+ 56 1fps frames + 12 `-ss` probes). Transition is immediate: walk-night HEAVY
(44.3–46.07) → dance SLIM (46.07–48). Same face, same bun, same freckles,
same navy lace dress throughout; the sister (red dress, hug at 51 s) is
correctly a different person. Direct before/after: heavy mirror-full at 8–10 s
vs slim dance at 46–48 s — without sound the weight story reads.

## 3. Per-segment audio (Whisper base, word timestamps, all 177 words aligned)

| seg | words | audio | dur | wpm | own-photo start | drift |
|---|---|---|---|---|---|---|
| hook | 40 | 0.00–11.64 | 11.64 | 206 | 0.00 | 0 |
| c1c2 | 33 | 12.48–21.34 | 8.86 | 223 | 12.00 | +0.48 |
| c3 | 11 | 22.06–25.74 | 3.68 | 179 | 22.00 | +0.06 |
| c4 | 22 | 26.50–33.00 | 6.50 | 203 | 26.00 | +0.50 |
| c5a | 8 | 33.58–35.42 | 1.84 | 261 | 34.00 | −0.42 |
| c5b | 4 | 35.98–36.66 | 0.68 | 353 | 36.00 | −0.02 |
| c6 | 7 | 37.44–39.72 | 2.28 | 184 | 38.00 | −0.56 |
| c7a | 3 | 40.44–41.14 | 0.70 | 257 | 40.00 | +0.44 |
| c7b | 3 | 41.80–42.76 | 0.96 | 187 | 41.57 | +0.23 |
| c9 | 11 | 43.40–46.90 | 3.50 | 189 | 42.50 | +0.90 |
| c10 | 22 | 47.52–52.28 | 4.76 | 277 | 46.07 | +1.45 |
| cta | 12 | 53.06–55.50 | 2.44 | 295 | 52.03 | +1.03 |

Inter-take gaps (11): 0.56–0.84 s, mean 0.71 s, total ~7.8 s — same as v10.
TTS is remarkably stable run-to-run: audio 56.28 s in BOTH attempts, per-segment
within ±0.3 s of v10 except c4 (6.50 vs 6.78, 203 vs 171 wpm) and c5a
(1.84 vs 1.48 — the +1 word made it FASTER per word, 261 wpm, not slower).
Note: Whisper hears "too ashamed" as "to a shame" (split word); the engine
subtitle shows "too ashamed" correctly, so this is a transcription artifact,
not a TTS error.

## 4. Photo timeline (measured: 1fps frame-diff + scdet 0.4 + `-ss` probes)

Photos 1–20 are exactly on the 2 s grid (0–40 s). The tail is squeezed:
c7a 1.57 s, c7b 0.93 s, c9 1.80 + 1.77 s, c10 ~1.93 s each, cta 1.97 + 1.70 s,
hanger 0.70 s.

| # | time | photo | body | words on it |
|---|---|---|---|---|
| 1 | 0–2 | v10-bed-dress | HEAVY | "Six months after my diet ended" |
| 2 | 2–4 | v7-dress-hanger | — | "I tried on the dress" |
| 3 | 4–6 | v9-zipper | HEAVY | "and the zipper stopped" ✓ |
| 4 | 6–8 | v9-mirror-defeated | HEAVY | "halfway up my back" |
| 5 | 8–10 | v10-mirror-full | HEAVY | "Same dress, same mirror" ✓ |
| 6 | 10–12 | v10-mirror-face | HEAVY | "everything I had worked for was gone" ✓ |
| 7 | 12–14 | v9-floor-wide | HEAVY | "That night I sat on the bedroom floor" ✓ |
| 8 | 14–16 | v9-floor | HEAVY | "in the dress, half zipped" |
| 9 | 16–18 | v9-floor-face | HEAVY | tears at ~16 s ✓ |
| 10 | 18–20 | v9-bed-phone | HEAVY | "too ashamed to tell my sister" ✓ |
| 11 | 20–22 | v10-dress-floor | — | "so I said nothing" (dress alone, no feet) ✓ |
| 12 | 22–24 | v3-phone | HEAVY | "Then one morning, over coffee" ✓ |
| 13 | 24–26 | v9-reading-relief | HEAVY | "I read something that changed everything" ✓ |
| 14 | 26–28 | v8-study-chart | hands | "A study had followed people" ✓ |
| 15 | 28–30 | v10-chart-laptop | — | "for a full year after their diet" ✓ |
| 16 | 30–32 | v11-study-papers NEW | — | "a full year after their diet" ✓ |
| 17 | 32–34 | real-small-plate | — | "their hunger was still louder, their fullness still weaker" ✓ |
| 18 | 34–36 | v9-notebook-writing | HEAVY | "I wrote four words down in my notebook." ✓ |
| 19 | 36–38 | v10-face-realization | HEAVY | "It was not me." ✓ ("not me" on the face) |
| 20 | 38–40 | v10-shoes-heavy | HEAVY | "So I started again, smaller this time." (straddles 38) |
| 21 | 40–41.57 | v9-eggs | — | "Eggs for breakfast." ✓ |
| 22 | 41.57–42.5 | v9-water-coffee | — | "Water before coffee." ("coffee." splits at 42.5) |
| 23 | 42.5–44.3 | v10-walk-day-heavy | HEAVY | "A walk after dinner," ✓ |
| 24 | 44.3–46.07 | v10-walk-night-heavy | HEAVY | "every single night, no matter the weather." |
| 25 | 46.07–48 | v9-dance | SLIM | "Three months later I danced" (starts 47.52; 1.45 s early) |
| 26 | 48–50 | v9-dance-wide-shoes | SLIM | "all night at the wedding" ✓, heels both feet |
| 27 | 50–52.03 | v9-sisters-hug | SLIM | "in that dress, and this time I knew why it would hold." ✓ |
| 28 | 52.03–54 | v11-cta-dance NEW | SLIM | "Save this for the day you want to quit" ✓ |
| 29 | 54–55.7 | v11-cta-zipper NEW | SLIM | "and start again." ✓ (closed zipper = payoff) |
| 30 | 55.7–56.4 | v11-cta-dress-hanger NEW | SLIM | silent tail (0.7 s, no words) |

Beat score: 11/13 clean. Misses are all sub-second bleeds: c5a's first words
("I wrote four words down in my", 33.58–34.98) play over the blueberry plate
for 0.42 s; "It was" (0.24 s) on the notebook; "coffee." (0.26 s) on the walk
photo; "weather." (46.62–46.90) on the dance photo; "hold." (52.08–52.28) on
the CTA dance photo.

## 5. What still fails (why not 10)

1. **Metronome: 20/30 photos exactly 2.0 s (67% of the video).** The first 40 s
   are a perfect 2,4,6…40 s grid. Better than v10 (82%) only because the tail
   now varies. Engine ceiling in this build — PR #652 (`SegmentMedia.duration`)
   is merged on main but not in this build.
2. **CTA still the fastest take: 295 wpm** (12 words / 2.44 s; v10: 305, v9: 340,
   v8: 355). Length changes don't fix it — it is a TTS property of the final
   take. The CTA fires ~1.5× the hook's pace (206 wpm).
3. **Tail photos run 0.9–1.45 s early.** c9 +0.90, c10 +1.45, cta +1.03. The
   v11 drift prediction was right for the first 8 segments (within 0.3 s) but
   wrong for the tail: it assumed a 2 s grid through c9/c10/cta, while the
   tail squeeze (short takes → short photos) pulls every tail photo ~1–2.3 s
   early. Same defect class and magnitude as v10's "3 images ~1.5 s early",
   moved from the middle to the tail.
4. **Sleeveless nit (NEW).** The CTA zipper photo (54–55.7) reads sleeveless —
   bare shoulders, lace only at the top edge — while every other dress shot has
   short lace sleeves. Same dress otherwise. The hanger photo's dress also
   reads sleeveless on the hanger.
5. **Hanger tail.** The 30th photo (55.7–56.4) shows after the last word ends
   (55.50): 0.7 s of silence on a pre-wedding image (her in sage t-shirt
   holding the dress). The last frame the viewer sees is not the dance.
   It was a coverage photo, not a story beat — and it reads as one.

## 6. Polish checks — all pass

- Subtitles: clean in ~20 sampled renderings — no `-`, `.`, `,` anywhere
  (engine cleanup #637 live). Only `?` would survive; this script has none.
- No dark frames (no 1fps frame mean luminance < 40).
- No anonymous hands: the chart hands (26–28) are hers (freckles, sage sleeve).
- No blank flashes: the 1fps frame-diff signature is regular (alternating
  small/large diffs, no isolated 1-frame outlier) — v10's flashes were an
  extraction artifact and there is nothing like them here.
- Audio: one voice, clear, peak 0.531 (no clipping). Music bed present in the
  gaps (RMS ~0.011 vs speech 0.055, −14 dB) but the gaps are 0.56–0.84 s —
  too short to register as music. Not chased.
- Subtitle timing nit: subtitles are per-take, not per-word, so they switch
  ±0.5 s around the words — at 36.4 s the subtitle still shows c5a's text
  while the audio is on "not me"; at 46.5 s it already shows c10's text during
  the c9→c10 gap. Engine-side, cosmetic.
- Mirror nit (recurring): the mirror reflection's neckline diverges from the
  real dress (deep V in the reflection at 10 s vs round neck on the body).

## 7. Render incidents (for the record)

- **Attempt 1 failed** (`a28e78c5`, 18:21–18:56): `images_do_not_cover_audio:
  29 photos cover 56.1s of 57.0s at 2s each; need 1 more photo`. Root cause,
  read in the engine code (`image_coverage.py:extend_over_gaps`): each photo's
  end is `min(next panel start, start + 2s)`, so segments denser than 1 photo
  per 2 s squeeze the total below n×2. c4's 4th photo added ~0.6–0.9 s of
  squeeze vs v10 (which passed at ~57.2 s). The engine also logged
  "proportional intervals (word walk mismatched)" — the word walk failed, so
  segment intervals were proportional, as in v6–v10.
- **Fix:** 30th photo in the CTA (density [2,4] for 12 words — inside the
  limit), the only shift-free slot. Retry task `07d59816` (18:58–19:44)
  passed coverage and rendered. Audio identical across attempts (56.28 s).
  `media_warnings: []`, `music_mood: calm`, `video_quality: ok`.
- Endpoint download 401'd as usual; file fetched from R2 dev
  (`dev-local/faceless/07d59816-.../final-1.mp4`, 14,755,328 bytes).

## 8. For v12

1. **Tail squeeze is now the top alignment lever.** Size tail photo counts from
   the SQUEEZED span (segment interval, not audio span): a 1-photo short take
   (c7a/c7b) yields a ~1 s photo, and every photo after it starts early by the
   accumulated squeeze. With #652 merged, `SegmentMedia.duration` can hold tail
   photos at 2 s — the next build should use it; until then, don't trust a
   2 s grid past the first short take.
2. **Face-verify every photo against the base photo full-size before
   submitting; regenerate drifters; never reuse without the check** (user rule,
   2026-11-18 16:42). v11 reused v10 photos without re-verification — the
   sleeveless zipper and the mirror-neckline divergence are exactly the drift
   this rule targets. Applies to v12.
3. **Licensed b-roll video in the prompt** (user rule, 2026-11-18 16:42): the
   prompt must tell the agent to fetch Pexels b-roll and place video where it
   makes sense, verifying by extracting frames vs the segment phrase, like
   photos. #656 is merged; needs the Pexels API key for the agent. Prompt PR
   only after #656 merged (it is) — but the b-roll path is a prompt change,
   not a v12 maker change.
4. **"It was not me" needs 0.3 s more.** The face photo must start ~0.3 s
   earlier (or c5a ~0.3 s shorter) for the whole line to sit on the face.
   With #652 durations this is tunable.
5. **Drop or move the hanger tail.** A coverage photo that lands after the last
   word should not be the final frame — it ends the video on a pre-wedding
   image. Either put the coverage photo mid-CTA (where words cover it) or
   accept the video ending on the zipper/dance.
6. **CTA burst has no script-side fix.** 295 wpm at 12 words after 305/340/355
   in v10/v9/v8 — length changes don't move it. Only a slower final take (or
   an engine pause before the CTA) would. Don't burn another round on CTA
   length.
7. **Don't chase music.** Gaps are 0.56–0.84 s at −14 dB — inaudible as music
   by construction. Same finding for the 4th version running.

## 9. Score rationale

v10 maker 8.5 → v11 maker **9.0**. The two most visible v10 defects landed
(the face for "not me", the wedding ending for the CTA words), the c4 study
sequence and the eggs/water beats are exact, and the body arc is unchanged and
leak-free. The remaining 1.0 is the metronome (0.4), the CTA burst (0.3), and
the tail-early images + sleeveless/hanger nits (0.3) — all of them structural
(engine rhythm / TTS pace) except the two nits, which are fixable in v12.
