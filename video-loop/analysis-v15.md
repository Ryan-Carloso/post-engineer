# analysis-v15 — Daily Dose, Inspirador (maker self-score)

- Video: `daily-dose-weight-regain-faceless-v15.mp4` — 56.40s, 1080×1920, 30 fps,
  14,827,196 bytes, task `99679f90-85a3-48ac-b917-9c8c8c4f5818`
- Script: same 176 words / 12 segments as v12–v14. 29 photos, 0 clips.
  (All 5 Pexels candidates frame-checked and rejected — none matches the
  persona even from behind; photos-only for c9 per NOTAS-v15.)
- Audio: 177 words (Whisper base), first word 0.00s, last word ends 55.48s.
- Render: second submission attempt not needed; single task ran
  10% script → 20% script → 40% subtitle → 50% render → 75% → 100%.
  Endpoint download 401'd as usual; recovered from R2 (`download_r2_v15.py`).

## Method (and two traps)

- Cut list = 4 fps signature match against the 29 sources
  (`map_photos_v15_4fps.py`, 32×32 RGB MSE). Every planned cut reproduced
  within ±0.25s; the MSE curve inside each hold rises with the Ken Burns
  zoom drift, which is why scdet alone is unreliable.
- Trap 1: `map_photos_v15.py` (1 fps) first produced a doubled timeline
  (112 entries): `analyze_v15.py` wrote `s-%02d.jpg` and the mapper wrote
  `s-%03d.jpg` into the same dir. Deleted the `%02d` files, re-ran clean.
- Trap 2: the `fps=1/4` grid frames (`frames-v15/f-01..f-14`) run ~2s LATE
  vs their nominal time (verified: f-11 nominal 40s shows the water photo
  that the 4 fps map + `-ss` probe place at 41.75–43.50s; f-01 nominal 0s
  shows a ~2s subtitle). Never use the fps grid for timing. All timing
  claims below come from `-ss` probes + the signature maps, which agree.

## Cut list (measured, 4 fps) vs plan — all within ±0.25s

| photo | planned | measured | dur |
|---|---|---|---|
| v10-bed-dress | 0–2.50 | 0.00–2.50 | 2.50 |
| v7-dress-hanger | 2.50–4.00 | 2.50–4.00 | 1.50 |
| v9-zipper | 4.00–6.70 | 4.00–6.75 | 2.75 |
| v9-mirror-defeated | 6.70–9.50 | 6.75–9.50 | 2.75 |
| s15-mirror-face (NEW) | 9.50–11.64 | 9.50–11.75 | 2.25 |
| v9-floor-wide | 11.64–14.14 | 11.75–14.25 | 2.50 |
| v9-floor | 14.14–15.14 | 14.25–15.25 | 1.00 |
| v9-floor-face (tears) | 15.14–19.14 | 15.25–19.25 | 4.00 |
| v12-bed-no-phone | 19.14–20.14 | 19.25–20.25 | 1.00 |
| v10-dress-floor | 20.14–22.06 | 20.25–22.00 | 1.75 |
| v12-phone-heavy | 22.06–24.06 | 22.00–24.00 | 2.00 |
| v9-reading-relief | 24.06–26.50 | 24.00–26.50 | 2.50 |
| v12-chart-labeled | 26.50–29.00 | 26.50–29.00 | 2.50 |
| s15-study-paper-v2 (NEW) | 29.00–31.00 | 29.00–31.00 | 2.00 |
| s15-reading-paper (NEW) | 31.00–33.58 | 31.00–33.50 | 2.50 |
| s15-pen-closeup (NEW) | 33.58–35.10 | 33.50–35.00 | 1.50 |
| v9-notebook-writing | 35.10–35.98 | 35.00–36.00 | 1.00 |
| v10-face-realization | 35.98–37.44 | 36.00–37.50 | 1.50 |
| v12-mirror-resolve | 37.44–38.66 | 37.50–38.75 | 1.25 |
| v14-small-plate-comparison | 38.66–40.44 | 38.75–40.50 | 1.75 |
| v9-eggs | 40.44–41.80 | 40.50–41.75 | 1.25 |
| v9-water-coffee | 41.80–43.40 | 41.75–43.50 | 1.75 |
| v10-walk-day-heavy | 43.40–45.40 | 43.50–45.50 | 2.00 |
| v10-walk-night-heavy | 45.40–47.52 | 45.50–47.50 | 2.00 |
| v9-dance | 47.52–50.06 | 47.50–50.00 | 2.50 |
| v9-dance-wide-shoes | 50.06–51.52 | 50.00–51.50 | 1.50 |
| v9-sisters-hug | 51.52–53.06 | 51.50–53.00 | 1.50 |
| v11-cta-dance | 53.06–54.76 | 53.00–54.75 | 1.75 |
| v13-cta-dance2 | 54.76–58.26 | 54.75–56.50 | 1.75* |

*video ends 56.40s. Total nominal coverage 58.26s vs 56.28s audio — no
coverage failure, no filler photo.

## Text / image mapping — 13/13 beats exact (word times from words-v15.json)

- "It was not me" 36.02–36.66 — realization face 36.00–37.50, fully inside.
  Probe at 36.3s: same face, eyes up, slight smile; subtitle lags (below)
  but the IMAGE is right.
- "notebook." 35.12–35.42 — notebook photo 35.00–36.00, fully inside.
  Probe at 35.3s: persona writing in an open notebook, coffee steaming.
- "smaller this time" 38.86–39.76 — two-plate photo 38.75–40.50, fully
  inside. Probe at 39.5s: LITERAL — big plate piled high (left) vs small
  plate, salad + chicken (right). Subtitle "smaller this time" exact.
- "Three months later" 47.52–48.24 — dance photo starts 47.50, 0.02s
  BEFORE the word. v14's 2.3s-early defect is GONE. Probe at 47.6s:
  SLIM, laughing, navy lace dress, string lights; subtitle "Three months
  later I danced" in sync.
- "Eggs for breakfast" 40.44–41.16 — eggs photo 40.50–41.75 (0.06s bleed
  on "Eggs", negligible). Probe at 40.5s: two fried eggs, subtitle exact.
- "Water before coffee" 41.72–42.76 — water photo 41.75–43.50, exact.
- Walk take 43.40–46.90 — walk-day 43.50–45.50 + walk-night 45.50–47.50,
  fully covered, no clip (no Pexels candidate matched the persona).
- Study take: chart 26.50–29.00 (2.5s, legible, labeled "Hunger stayed
  high. Fullness stayed low.", axes "Relative to before the diet" /
  "Months after the diet ended" 0–12, legend Hunger/Fullness, no invented
  numbers) covers "A study had followed people for a full year"
  26.26–28.74; study-paper-v2 29.00–31.00 covers "after their diet, and
  their hunger was still louder"; reading-paper 31.00–33.50 covers "their
  fullness still weaker" (probe at 33.0s: HEAVY, same face, paper titled
  "EFFECTS OF METABOLIC ADAPTATION ON WEIGHT MANAGEMENT", notebook prop
  on the table edge); pen close-up 33.50–35.00 covers "I wrote four words
  down in my" (probe at 34.0s: freckled hand + pen + blank sheet, NO
  notebook visible, sage sleeve).
- Tears hold 4.00s (15.25–19.25); probe at ~17s: tear track visible on
  the cheek, defeated, HEAVY. Dress-floor hold 1.75s (20.25–22.00);
  "so I said nothing" 20.54–21.30 fully inside; probe at 21.0s: navy lace
  dress crumpled alone on the wooden floor.
- "So I started again" 37.46–38.44 — mirror-resolve 37.50–38.75, inside.
- CTA "Save this for the day you want to quit and start again"
  53.04–55.48 — cta-dance 53.00–54.75 + cta-dance2 54.75–56.40.
  Last frame (probe 55.8s) IS the dance: SLIM, laughing, heels, string
  lights, subtitle "want to quit and start again".

## Body / face

- HEAVY 0–47.5s, SLIM 47.5–56.4s. Zero leaks in all 14 grid frames +
  12 `-ss` probes: opening mirror HEAVY, tears HEAVY, phone HEAVY,
  study/reading/notebook/realization HEAVY, walk-day + walk-night HEAVY
  (suburban street, dusk lamps), dance + hug + CTA SLIM.
- Same face in every frame viewed: green eyes, freckles, low bun.
- Mirror V-neckline nit (v10–v14): FIXED in the source. The new
  s15-mirror-face (9.50–11.75s) has a ROUND neckline on BOTH body and
  reflection (verified on the source file full-size; the 4 fps MSE switch
  at 9.50s, 21.9, confirms it plays). Note: it is visually near-identical
  to v9-mirror-defeated (same scene, same pose) — the hook shows the same
  mirror composition twice in a row for 5.25s total (6.75–11.75).
  Reads as one long mirror moment, not two distinct beats. Cosmetic.

## Rhythm — metronome dead

- Durations in the first 46s: 2.5, 1.5, 2.75, 2.75, 2.25, 2.5, 1.0, 4.0,
  1.0, 1.75, 2.0, 2.5, 2.5, 2.0, 2.5, 1.5, 1.0, 1.5, 1.25, 1.75, 1.25,
  1.75, 2.0, 2.0. Range 1.0–4.0s. Four photos at exactly 2.0s in the
  first 46s (phone, study-paper-v2, walk-day, walk-night); max 2
  consecutive equal durations. No 2s grid anywhere.

## Subtitles — clean text, lag persists in TWO windows (engine-side)

- Text is clean everywhere probed: no dashes, commas or periods, only
  "?"-safe words (engine cleanup #637 live).
- In sync at 8.0s ("Same dress"), 28.0s ("A study had followed people
  for"), 33.0s ("their fullness still weaker"), 47.6s ("Three months
  later I danced").
- LAG ~1s in the 33–37s window (same as v12/v13/v14): at 34.0s audio
  says "I wrote four words" while the subtitle still shows "their
  fullness still weaker"; at 35.3s audio is on "notebook." while the
  subtitle shows "I wrote four words"; at 36.3s audio says "not me"
  while the subtitle shows "down in my notebook". Catches up at 37.0s
  ("It was not me").
- NEW second window, same mechanism: at 21.0s audio says "so I said
  nothing" (20.54–21.30) while the subtitle still shows "the dress did
  not fit anymore" (audio ended 20.16). So the lag is not confined to
  33–37s — it appears wherever speech runs fast across a sentence
  boundary. Engine-side SRT timing; not fixable by script. (This is the
  engine issue already proposed to the user, still unanswered.)

## CTA pace / music (TTS- and engine-side, unchanged)

- CTA: 12 words in 2.44s = 295 wpm vs hook 40 words in 11.64s = 206 wpm
  (1.43×). Identical to v12/v13 (293–295 wpm). TTS property of the
  final take; length experiments (v10–v13) never moved it.
- Per-take pace 147–295 wpm with no law (c10 277 wpm, c6c7 147 wpm).
- Music bed: gaps mean −35.0 to −42.5 dB vs narration −24.4 to −25.5 dB
  → 11–17 dB below voice, peaks −24.4 to −27.7 dB in gaps. Present but
  faint, same as v12–v14. Engine-side level.

## What v15 fixed vs v14 (NOTAS-v15 checklist)

1. Clip must match the persona even from behind — 5 Pexels candidates
   frame-checked, all rejected; photos-only c9. The v14 defect (clip is
   ANOTHER PERSON) is gone by omission. The motion goal itself is
   unmet: the walk take is still two stills.
2. 30 fps re-encode — moot, no clips.
3. Every take covered for all its audio; dance only with "Three months
   later" — FIXED (dance 47.50 vs "Three" 47.52).
4. Study literal — FIXED (labeled chart 2.5s, clean study-paper-v2 with
   no invented n=, notebook exactly on "notebook").
5. Kept: dress-floor hold (1.75s, phrase inside), literal "smaller this
   time", tears 4.0s hold.

## Score: 9.5/10

Every maker-fixable defect from v14 is fixed, and v13's level is matched
or bettered (study literalness, dance entry, mirror neckline). Text/image
13/13 exact, rhythm varied, body holds with zero leaks, same face
throughout, last frame is the dance, subtitles clean.

The −0.5 is entirely outside the maker's reach: subtitles ~1s behind in
two windows (21s + 33–37s, engine SRT timing), CTA 295 wpm vs 206 hook
(TTS), music bed 11–17 dB under the voice (engine level), and the walk
take still has no motion (no stock clip matches the persona — the b-roll
goal from NOTAS-v15 was attempted and correctly dropped, not achieved).

## For v16 (findings, not a brief)

- Nothing maker-side is left except: (a) retry b-roll with different
  Pexels queries (a from-behind walk in sage + jeans on a suburban
  street may simply not exist in stock — low expected value); (b) the
  mirror double-beat (6.75–11.75s, same composition twice) could take a
  distinct second beat, but every current mapping is exact, so any
  change risks breaking exactness for a cosmetic gain.
- The subtitle lag (now two windows), CTA burst and music level need an
  engine/TTS change, not another script round.
