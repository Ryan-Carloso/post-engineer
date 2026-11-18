# Analysis — faceless video v9

**Score: 8.5 / 10**

Video: `daily-dose-weight-regain-faceless-v9.mp4` — 54.30s, 1080×1920, 14,193,827 bytes, task `5e878127-86ab-4ed9-bf58-e8f7bb2e16c7` (attempt 2; attempt 1 failed `images_do_not_cover_audio`: 27 photos covered 53.9s of 55.0s audio). Script: 169 words, 12 segments. Voice: `chatterbox:phonon_everly`. 28 photos: 27 × exactly 2.0s + the 28th (`v7-save-phone`) 0.37s (53.93–54.30).

Same number as v8 (8.5), different composition: v9 fixed v8's one real miss and added a real before/after body story, but the headline body rule leaked in 4 photos (including the opening 2 seconds), the CTA still bursts at 1.65× hook pace, and the 2.0s metronome did not move at all.

## 1. What the v9 design fixed (measured)

**"Water before coffee" — fixed.** The v8 miss is gone. `c7b` ("Water before coffee.") runs 40.84–41.84, fully inside the `v9-water-coffee` photo (40–42s). The split-take design worked here: `c7a` and `c7b` are separate 3-word segments, each with its own photo.

**"notebook." — holds.** `notebook.` lands 34.80–35.12 on the `v6-notebook` close-up (34–36s). Two versions in a row now.

**Fridge brands — fixed.** `v9-fridge-clean` (28–30s) has no readable text anywhere — plain containers, vegetables, one unlabeled milk bottle. The v8 "big / Cheez / EVERSWEET" nit is gone.

**Front zipper in the floor shot — fixed.** The `v9-floor-wide` redo (12–14s) has a plain lace front; the zipper is on the back only. The v8 front-gold-zipper defect is gone.

**Barefoot wedding dance — fixed.** Nude heels are visible on both feet at 48s (`dance-wide-shoes`, 48–50s). `danced` (47.92–48.18) straddles the 48s cut but its bulk lands on the wide-shoes photo.

**Dress silhouette — consistent.** Straight midi in every dress shot (bed-dress, zipper, mirror, floor, dance, hug). No flared spinning shot, so the v8 silhouette nit cannot recur.

**Body contrast — real, for 32 of 54 seconds.** The 9 new heavier photos (`v9-zipper`, `v9-mirror-defeated`, `v9-mirror-back`, `v9-floor-wide`, `v9-floor`, `v9-floor-face`, `v9-bed-phone`, `v9-reading-relief`, `v9-notebook-writing`) are visibly heavier — same face, same hair, fuller torso and arms — and they cover the whole low point (4–36s). Against the slim comeback (dance 46–48, wide-shoes 48–50, hug 50–52, sunrise 52–54, save-phone 53.93–54.30), the before/after IS visible in the body now, not only in props. Compare frame 25s (reading-relief, heavier) with frame 46s (dance, slim): two different bodies, same person. That is the v9 headline rule working — where it was applied.

**Subtitles clean.** All 14 sampled frames + direct checks at 43/44/46/48/54s show no dashes, commas, or periods (PR #637 cleanup live). The CTA subtitle line spans the whole CTA segment, so "Save this for when you quit" shows over both the sunrise and the save-phone selfie.

## 2. What did NOT move (structural ceilings)

**The 2.0s metronome is unchanged.** 27 of 28 photos run exactly 2.0s. Scene cuts at 2, 4, 6, 8, 10, 12, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, then 45.97, 53.93. (No cut at 14s — floor-wide → floor are similar warm bedroom shots; the cut at 45.97 is walk-night → dance, 0.03s early.) The first 44 seconds are a rigid 2.0s grid, exactly as in v8. The photo-count formula changed WHICH photo appears, never WHEN — same as v7/v8. Only `SegmentMedia.duration` (PR #652, open, awaiting tap) changes the grid itself.

**The CTA still bursts.** Merged into one 6-word segment, the CTA runs 52.32–53.38 = 1.06s for 6 words = **340 wpm**, vs the hook's 206 wpm — **1.65× hook pace**. v8's split CTA was 355 wpm (1.7×). The merge + shorten guard bought 15 wpm, not a fix. The burst is a TTS property of short takes, not a split artifact: the data shows no word-count → pace law (c7a 3 words = 265 wpm, cta 6 words = 340 wpm, c10 22 words = 267 wpm, c7b 3 words = 180 wpm). Pace across takes spans 180–340 wpm (1.9×). No script-side guard can guarantee CTA pace.

**The drift mechanism is unchanged.** 11 inter-take gaps total 7.44s (0.42–0.84s each, mean 0.68s) and the grid counts none of them. Segment-start offsets vs the grid swing −0.48s to +1.60s: c2 starts 0.48s EARLY (17.52 vs grid 18), c5 starts 1.58s LATE (33.58 vs grid 32), c7a starts 1.60s LATE (39.60 vs grid 38). The v9 formula added +0.25s per boundary for pauses; the real gaps average 0.68s, so the estimate undercounts by ~0.43s per boundary and the error accumulates to ~1.6s by c7a.

**The same spills recur, from the same drift:**
- "weaker." (32.54–32.82) spills 0.82s onto `notebook-writing` (32–34s), c5's photo — same as v8.
- "time." (~38.5–38.8) spills 0.8s onto `eggs` (38–40s) — same as v8.
- "breakfast," (39.94–40.28) straddles into `water-coffee` (40–42s): the eggs photo carries "Eggs for" for 0.4s and the last 0.28s of "breakfast" plays over the water photo. Better than v8 (whole clause on the wrong photo), not clean.
- "Too ashamed" (17.52–18.08) starts 0.48s early on `floor-face` (16–18s), c1's last photo. The tearful face over "Too ashamed to tell my sister" works emotionally — but it is the wrong segment's photo.

Beat count: ~10.5/12 segments fully clean (hook carries the mirror nit, c2 the early start, c4 the "weaker" spill, c6 the "time" spill, c7a the "breakfast" straddle). Same as v8's 11/13.

## 3. The one real miss: the body rule leaked in 4 photos

The headline v9 rule — two body states, same person, the difference visible IN THE BODY — was applied to the 9 new photos and NOT to 4 reused pre-v9 photos. I never visually checked `v7-bed-dress` or `v4-shoes` or the v6 walk photos for body state before reusing them; the plan said "reuse after visual check" and the check did not happen for these four. All four show the slim base body inside the heavier phase:

1. **`v7-bed-dress`, 0–2s (hook opening) — the worst one.** Full body, slim. The video OPENS on the wrong body: she is slim at 0–2s, then becomes heavier at 4s (zipper). The first thing any viewer sees contradicts the story (the dress does not fit because she regained weight).
2. **`v4-shoes`, 36–38s (c6, "So I started again").** Full body, slim — narrow waist, slim arms. She has only just restarted; the weight loss comes three months later (46.8s). The slim body appears 10 seconds too early.
3. **`v6-mara-walk-day`, 42–44s + `v6-mara-walk-night`, 44–46s (c9).** Full body, slim, in both. Same problem as the shoes: the restart is days old, the body is already slim.

Net body timeline as shot: slim (0–2) → heavier (4–36) → slim (36–38) → objects (38–42) → slim (42–46) → slim (46–54). The body flips twice. The contrast the rule wanted is real (heavier 4–36s vs slim 46–54s), but the leaks break phase consistency at 0–2s, 36–38s, and 42–46s — 8 seconds of wrong body, including the opening shot.

Borderline, not counted as a leak: `v7-hem-detail` (20–22s) shows legs only — slim calves, no torso or face, so body state is unreadable. `v6-notebook` (34–36s) is a hands close-up, body unreadable. The v3 phone, chart, fridge, small-plate, eggs, water-coffee photos are objects, no body.

## 4. Per-segment pace and alignment (base-model word timestamps, 169/169 words matched)

| seg | audio | dur | wpm | gap after | grid start | offset |
|---|---|---|---|---|---|---|
| hook | 0.00–11.64 | 11.64s | 206 | 0.84s | 0 | +0.00 |
| c1 | 12.48–16.70 | 4.22s | 242 | 0.82s | 12 | +0.48 |
| c2 | 17.52–21.58 | 4.06s | 236 | 0.60s | 18 | −0.48 |
| c3 | 22.18–25.70 | 3.52s | 188 | 0.64s | 22 | +0.18 |
| c4 | 26.34–32.82 | 6.48s | 204 | 0.76s | 26 | +0.34 |
| c5 | 33.58–36.28 | 2.70s | 244 | 0.42s | 32 | +1.58 |
| c6 | 36.70–38.80 | 2.10s | 200 | 0.80s | 36 | +0.70 |
| c7a | 39.60–40.28 | 0.68s | 265 | 0.56s | 38 | +1.60 |
| c7b | 40.84–41.84 | 1.00s | 180 | 0.64s | 40 | +0.84 |
| c9 | 42.48–46.02 | 3.54s | 186 | 0.78s | 42 | +0.48 |
| c10 | 46.80–51.74 | 4.94s | 267 | 0.58s | 46 | +0.80 |
| cta | 52.32–53.38 | 1.06s | **340** | — | 52 | +0.32 |

Speech 45.94s + gaps 7.44s = 53.38s (last word "quit." 53.16–53.38); 0.92s trailing music to 54.30s. Key words: "zipper" 4.98–5.18 on zipper (4–6) ✓; "mirror," 8.64–8.98 on sleeve-detail (8–10) — no mirror on screen ✗; "gone." 11.38–11.64 on mirror-back (10–12) — back view for the payoff line; "floor" 13.76–14.08 on floor-wide ✓; "read" 24.28–24.44 on reading-relief ✓ (the word lands as the relief photo appears); "study" 26.60–26.90 on chart ✓; "hunger" 30.20–30.50 on small-plate ✓; "notebook." 34.80–35.12 on the close-up ✓✓; "walk" 42.76–42.98 on walk-day ✓; "weather." 45.78–46.02 on walk-night ✓; "hold." 51.40–51.74 on sisters-hug ✓; "Save" 52.32–52.50 / "quit." 53.16–53.38 on sunrise (52–54) ✓.

The 28th photo (`v7-save-phone`, 53.93–54.30, 0.37s) carries no words — it exists only because attempt 1 failed the fail-fast check with 27 photos (53.9s < 55.0s audio). The video's last frame is the selfie, not the sunrise. The CTA subtitle line covers it, so it reads as a deliberate end card, not a glitch — but it is a coverage photo, not a story photo.

## 5. Music

Speech RMS −25.3 dB. Inter-segment gaps −40.3 to −50.1 dB; tail after "quit." −49.8 dB. A bed is present in the gaps (15–25 dB below speech), same level as v6–v8. Not verifiable as audible music from levels alone.

## 6. Nits

- "mirror," lands on the sleeve close-up (no mirror) — same as v8.
- "gone." lands on the mirror-back shot (back view, no face) for the hook's payoff line.
- Sister's dress is red velvet in the hug (50–52s); the v8 satin-vs-velvet nit is moot — there is no second sister shot in v9.
- No dark frames. No repeated photos. No readable brand text anywhere.
- The f-frame sample set (`frames-v9/`) is offset ~+1s from the nominal 4s grid (verified by MSE against the 1fps frames: f-01=1s, f-02=5s, …, f-11=41s, f-12=46s, f-13=50s, f-14≈54s). Alignment claims above use the 1fps map + word timestamps, not the f-frame filenames.

## 7. What the next version needs

1. **Regenerate the 4 leaked photos as heavier** (bed-dress, shoes, walk-day, walk-night) — or replace them with v9-heavier versions. Reuse rule, learned the hard way: if a body is visible in a reused photo, it must match the phase; "no body visible" (close-up, object, legs-only) is the only safe reuse. The opening photo is the one that matters most.
2. **CTA pace: stop trusting the merge.** 340 wpm after merging proves the burst is a TTS property of short takes, not a split artifact. The v10 lever is a LONGER CTA (10–12 words over 2 photos, expecting ~220–260 wpm) — or accept the burst and give it room. No script-side word-count guard can guarantee pace; the data (180–340 wpm across takes with no word-count law) proves it.
3. **Count the real gaps in the photo formula.** The v9 formula used +0.25s per boundary; the measured gaps average 0.68s. Use +0.7s per boundary (or the measured mean gap of the actual render) — the +0.25 estimate is why c5/c7a drifted 1.6s late and why "weaker", "time", and "breakfast" spilled. This is the only drift lever available until PR #652 (`SegmentMedia.duration`) merges.
4. **Nothing else changes.** Same script, same archetype, same 28-photo structure. The grid itself (2.0s) is a ceiling until #652 lands — the maker cannot fix it from the script.

## Method

- Base-model faster-whisper (`base`, CPU int8) on `audio-v9.wav`: 169/169 words with timestamps (tiny model returned 0 words with `word_timestamps=True`; its segment transcript misheard "quit" as "put" and "Too" as "Two" — the base model got "quit." right and "Too" as "Two", a homophone the alignment normalizes).
- 1fps frame extraction + 32×32 RGB MSE against the 28 source photos (`photo-map-v9.json`): 27 photos × exactly 2.0s; the 28th appears only in the scene-cut data (cut at 53.93) and in the 54.1s frame.
- Scene cuts: `select='gt(scene,0.4)'` (`cuts-v9.txt`).
- All 14 f-frames + direct `-ss` frames at 43/44/46/48/54.1s read visually; subtitles, body state, shoes, brands, and dress continuity checked per frame.
- Music RMS via numpy on `audio-v9.wav` (16 kHz) in the 11 inter-segment gaps vs all word spans.
- Task `audio_duration: 55` is the engine's rounded value; measured audio is 54.31s.

## Files

- Video: `daily-dose-weight-regain-faceless-v9.mp4`
- This analysis: `analysis-v9.md`
- Evidence: `transcript-v9.json`, `words-v9.json` (base model, 169 words), `cuts-v9.txt`, `photo-map-v9.json`, `frames-v9/`, `frames-v9-1fps/`, `audio-v9.wav`
- Driver/log: `drive_v9.py`, `drive_v9.log`, `drive_v9-attempt1.log`, `task-v9.json`, `task-v9-final.json`, `manifest-v9.json`
- Images: `images-v9/` (15 new, 3 redos) + reused v3/v4/v5/v6/v7 photos per `manifest-v9.json`
