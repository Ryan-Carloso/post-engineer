# v13 — maker analysis (harsh)

**File:** `daily-dose-weight-regain-faceless-v13.mp4`
**Task:** `debfc1c3-4ea5-43bf-ae51-dffe10e146a3` · **Duration:** 56.40s · **Size:** 14,431,076 bytes · 1080×1920, h264/aac
**Script:** same 176 words / 12 segments as v12 · **Photos:** 30, all with `SegmentMedia.duration`
**Whisper base:** 177 words, duration 56.4s — max word-start delta vs v12 is 0.34s (one word, Whisper jitter); audio timing is effectively identical to v12 again.
**Download:** endpoint 401 after archiving (as usual) — fetched from R2 dev via `download_r2_v13.py`, key `dev-local/faceless/debfc1c3-4ea5-43bf-ae51-dffe10e146a3/final-1.mp4`.

## Maker score: 9.5/10

v13 fixes every maker-fixable defect on v12's list. The remaining −0.5 is not in the maker's hands: subtitle lag (engine SRT timing) and CTA pace (TTS property of the final take). The blueberry straddle is the only remaining maker-side quibble and it is small. The video is as good as the current engine + TTS allow.

## 1. Rhythm — metronome dead, plan executed to the frame

- Planned cuts: [2.5, 4.0, 6.7, 9.5, 11.64, 15.14, 16.64, 20.14, 21.14, 22.06, 24.06, 26.5, 28.0, 29.2, 30.7, 33.58, 35.1, 35.98, 37.44, 38.66, 40.44, 41.8, 43.4, 45.4, 47.52, 50.06, 51.52, 53.06, 54.76]
- Scene detection found 26 of 29, every one within ±0.03s of plan.
- The 3 undetected cuts were verified by exact `-ss` probes and ALL HAPPENED:
  - 20.14 tears → bed-no-phone (p20.0 tears close-up vs p20.5 sitting on the bed, hands clasped, no phone — same dark bedroom, similar framing, so the detector missed it; the cut is real).
  - 50.06 dance → dance-wide (p49.5 arms-out dance vs p50.5 wider framing, nude heels visible, wooden floor — different photo).
  - 51.52 dance-wide → hug (p51.0 dance-wide vs p52.0 hug with sister in red dress).
- Durations 0.88–3.50s. Only 2 photos at exactly 2.0s in the first 46s (24.06, 45.4). No run of equal durations anywhere — including the hook, whose first 5 are 2.5, 1.5, 2.7, 2.8, 2.14 (v12's hook was five 2.0s in a row, 0–10s — that run is gone).
- Holds land: tears 3.5s (16.64–20.14), mirror resolve 3.0s (37.44–40.44), study fast 1.5/1.2/1.5s (26.50–30.70).
- Photo/audio drift is ZERO (transitions within 0.03s of plan; word timings identical to v12).

## 2. Text / image — 12 of 13 beats land exactly

Verified by exact `-ss` probes against Whisper word timings:

| Time | Words | Photo on screen | Verdict |
|---|---|---|---|
| 1.0 | "Six months after my diet ended" | mirror-full, HEAVY, distressed | exact |
| 4–6.7 | "and the zipper stopped halfway" | zipper from behind, hand on zip | exact |
| 9.5–11.6 | "and I felt like everything…" | mirror-face close-up | exact |
| 11.6–15.1 | "That night I sat on the bedroom floor" | sitting on the floor, dress on | exact |
| 16.6–20.1 | "too ashamed to tell my sister" | tears close-up, tear visible | exact |
| 21.1–22.1 | "so I said nothing" | dress alone on the floor, no feet | exact (v9/v10 bare-feet defect gone) |
| 22.1–26.5 | "Then one morning, over coffee, I read…" | phone at window, HEAVY, relief smile | exact — phone ONLY at the turning point, never before |
| 26.5–31.0 | "A study had followed people for a full year" | labeled chart, legible, self-explanatory | exact |
| 31.0–33.6 | "their hunger was still louder, their fullness still weaker" | single blueberry, almost-empty plate | PARTIAL (see §5) |
| 35.1–35.98 | "I wrote four words down in my notebook." | NEW writing-hand photo, hand + pen in notebook | exact — close-up starts 35.10, word "notebook." at 35.12 |
| 35.98–37.44 | "It was not me." | realization face, eyes up, slight smile | EXACT (face 35.98–37.44, words 36.00–36.66) |
| 37.44–38.66 | "So I started again," | mirror resolve, hands on hips, determined | exact |
| 38.66–40.44 | "smaller this time." | NEW small-plate photo (grilled chicken, salad, water) | exact — split lands on the word gap 38.44–38.88 |
| 40.44–41.8 | "Eggs for breakfast." | two fried eggs | exact |
| 41.8–43.4 | "Water before coffee." | water glass + coffee cup | exact |
| 43.4–47.5 | "A walk after dinner, every single night" | walk day (43.4) → walk night (45.4), HEAVY | exact — day→night literally shows "every single night" |
| 47.5–53.1 | "Three months later I danced all night at the wedding…" | dance → dance-wide (heels) → hug with sister in red | exact — climax stays at the wedding |
| 53.1–56.4 | CTA "Save this for the day you want to quit and start again." | dance (53.06) → NEW cta-dance2 (54.76), SLIM, laughing, heels | exact — LAST FRAME IS THE DANCE (p56.2 probe) |

## 3. Body + persona — zero leaks

- HEAVY 0–46s, SLIM 46–56s, verified at every sampled second (0, 1, 4, 8, 12, 16, 20, 20.5, 24, 26, 28, 32, 35.3, 36.3, 39.5, 41, 44, 47.5, 49.5, 50.5, 51, 52, 56.2). No slim photo inside the heavy phase, no heavy photo inside the slim phase.
- Heavy walk at 44s → slim dance at 47.5s is a stark immediate contrast; the before/after is visible with the sound off.
- Same face in all 14 four-second frames + 13 exact probes: green eyes, freckles, low bun. Navy lace midi dress, short sleeves, round neck on the body, consistent throughout. Nude heels, both feet, dancing. No anonymous hands. No dark frames. No repeated photo. No coverage filler (30 photos, 58.26s nominal vs 56.40s video).
- The 3 new v13 photos all pass at full size: writing-hand (HEAVY, sage sleeve, pen in notebook), small-plate (HEAVY, determined, modest portion), cta-dance2 (SLIM, laughing, string lights, heels).

## 4. Subtitles — clean text, still ~1s late at 4 points (engine-side)

- Text is clean: no dashes, no commas, no periods — only `?` survives. Engine cleanup (#637) confirmed live again.
- BUT the subtitle lines still lag the words at 4 of 11 probed points (measured from on-screen subtitles at exact-seek probes — the SRT file was deleted after archiving, so this is the viewer's ground truth):
  - 32.0s: subtitle shows "and their hunger was still louder" while the words have moved to "their fullness still weaker" (~1s behind).
  - 35.3s: subtitle shows "I wrote four words" while the word is "notebook." (~0.4–1s behind).
  - 36.3s: subtitle shows "down in my notebook" while the words are "It was not me" (~0.9s behind).
  - 56.2s: subtitle still shows "want to quit and start again" 0.7s after the last word ended (55.5s).
  - In sync at 1.0, 20.0, 49.5, 50.5, 51.0, 52.0.
- Same pattern as v12 (4 of 7 points then). Photo/audio drift is zero, so the lag is engine-side SRT item timing, NOT fixable from the script. Needs an engine fix/issue — recorded, not treated as a script failure.

## 5. Remaining defects

1. **CTA still the fastest take (TTS-side).** 12 words in 53.04–55.50 = 293 wpm spoken-span vs hook 206 wpm (1.42×). Identical to v12 (293 wpm). Doubling the CTA length (6→12 words, v10) did not fix it; splitting it across two dance photos (v13) does not fix it either — it is a TTS property of the final take. Per-take pace overall: hook 206, c1c2 230, c3 163, c4 194, c5a 261, c5b 364 (4 words / 0.66s — reads as a punchy realization, not a rush), c6 158, c7a 250, c7b 375 (2 words / 0.32s), c9 189, c10 277, CTA 293 wpm.
2. **Blueberry straddles both clauses.** Photo 31.00–33.58 covers "louder," (ends ~31.5) for ~0.5s and "their fullness still weaker." (31.9–33.0) for ~1.1s. The almost-empty plate's clear pole is hunger; most of its screen time is over the fullness clause, where the empty plate is the wrong pole. Mitigated: the labeled chart immediately before states both lines ("Hunger stayed high. Fullness stayed low."), so the viewer is not misled. Same partial as v12.
3. **Music bed present but not prominent.** True gaps measure −40.8 / −41.2 dB vs voice −24.8 / −21.1 dB (~16 dB under). Same as v12. One voice throughout; no second voice, no audible music over narration.
4. **Nit (persists):** `v10-mirror-face` shows a deep V neckline in the reflection vs round neck on the body (visible at 0s and 8s). The mirror-resolve reflection at ~39s shows her face front-on while her body is in profile — reads fine at speed.

## 6. What v13 fixed vs v12

- Last frame is the dance (v12 ended on the zipper payoff; v13 drops the zipper buffer, CTA splits across dance + dance2).
- "smaller this time." now has its own literal photo (new small-plate) instead of sharing the mirror resolve.
- Hook has no 2.0s run at all (v12: five 2.0s, 0–10s).
- CTA is over two dance photos, not dance + zipper.

## 7. What is left for v14 (if the loop continues)

- Nothing maker-fixable remains on this video except the blueberry straddle (move the blueberry to start ~30.0 so it sits fully on the hunger clause, or split c4 so each clause gets its own photo). Everything else blocking 10/10 is engine/TTS-side: subtitle SRT timing (~1s lag at 4 points) and CTA TTS pace (293 wpm vs 206 hook). Both need engine/TTS work, not a new script.
- Pexels: still blocked — no valid API key, photos only. No b-roll in v13 (per notes).
