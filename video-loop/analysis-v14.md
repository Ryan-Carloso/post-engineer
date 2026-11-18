# v14 — maker analysis

**Score: 9.0/10**

Video: `daily-dose-weight-regain-faceless-v14.mp4` — 56.40s, 1080×1920, h264 + aac,
14,848,072 bytes. Task `1914c40b-fcea-420d-9ce1-2e33c95e58c7` (second submission;
first task `b2a2a735` died with the engine restart, in-memory state lost).
Script: same 12 segments / 177 words as v12/v13. 30 media items (29 photos + 1 clip).
Method: 14 fps-grid frames + 26 exact `-ss` probes + signature matching of every
tail frame against all 29 source photos + faster-whisper base word timestamps
(177 words) + scene detection (threshold 0.4) + sample-level audio measurement.

## What v14 fixed (vs v13)

1. **Dress-floor flash — FIXED.** The dress alone on the floor now holds
   20.13–22.07s (1.94s, planned 1.92s). "so I said nothing" (20.52–21.34) sits
   fully inside it with margin both sides. The v13 0.9s subliminal flash is gone.
   (Letter of the NOTAS rule said ≥2.0s; 1.94s is 0.06s short — rounding-level,
   the phrase is fully covered. Fixed in substance.)
2. **"smaller this time" — LITERAL now.** The new v14 photo (38.66–40.44) is a
   top-down two-plate comparison on the same wooden table: large plate piled high
   vs small plate with grilled chicken + salad. The contrast reads at a glance.
   Probe at 39.5s: subtitle "smaller this time" over the two plates, audio
   38.86–39.76 exact. The v13 generic salad-plate weakness is gone.
3. **B-roll exists and fits.** The Pexels walk clip (id 8045821, woman walking away
   down a road at sunset, back view, face never visible) plays 43.4–44.27s with
   real motion — her stride and hair change between the 43.6s and 44.0s probes.
   Subject/action/mood all match "A walk after dinner". No identity conflict:
   the persona never appears in a stock clip, the hook is still a photo.
   First real motion in the loop.

## The new defect: the clip plays short and drags the tail early

The trimmed clip file is exactly 2.000s, 50 frames, **25 fps** (ffprobe-verified).
The engine renders at 30 fps. What plays is **43.40–44.27s = 0.87s**, not 2.0s.
Prime suspect: the engine miscounts the clip's frames against a 30 fps timeline
(50 frames at 25 fps ≠ 50 frames at 30 fps). The clip check passed, the media
check passed, the render never errored — it just played short.

Consequences, all measured:

- "dinner," (44.32–44.62) lands on the walk-night photo, not on the clip —
  the clip covers "A walk after" only.
- The whole tail shifts **1.13s early**. Dance starts 46.40s (planned 47.52)
  while the narration still says "the weather." (46.46–46.88) — the dance photo
  covers the last 0.48s of the walk sentence.
- The c10 subtitle ("Three months later I danced") appears at 46.6s, ~1.1s
  BEFORE "Three months later" is spoken (47.56–48.24). Subtitles follow the
  photo grid, not the words — same mechanism as the lag below, opposite sign.
- cta-dance2 is truncated to 2.73s (planned 3.50s) because the video ends at
  56.40s. Invisible to the viewer (closing hold), but the plan's buffer is gone.
- The tail itself is otherwise exactly on plan, verified by signature matching:
  dance 46.40–48.90 (2.50s, planned 2.54), dance-wide 48.90–50.40 (1.50s,
  planned 1.46), hug 50.40–52.00 (1.60s, planned 1.54), cta-dance 52.00–53.67
  (1.67s, planned 1.70). No photo is missing — the hug and cta-dance are both
  there (probes at 50.5s and 52.0s confirm).

Fix for v15 (maker-side): re-encode any clip to **30 fps** before submitting
(or submit the full-length clip and let the engine trim), then verify the
clip's PLAYED length from the rendered cut list before calling it done.

## Rhythm — contrast holds

Measured durations, first 46s:
2.5, 1.5, 2.7, 2.8, 2.14, 3.0, 1.5, 3.0, 1.0, 1.92, 2.0, 2.44, 1.5, 1.2, 2.88,
1.5, 1.52, 0.88, 1.46, 1.22, 1.78, 1.36, 1.6, 0.87 (clip), 2.13.
Only ONE photo at exactly 2.0s in the first 46s (phone, 22.06–24.06). No two
consecutive photos share a duration anywhere in the first 46s. The hook is
2.5/1.5/2.7/2.8/2.14 — the 2s grid is dead. Tears hold 16.13–20.13s = 4.0s.
Low point holds 3.0s, study fast 1.2–1.5s, dance hold 4.0s (46.40–50.40 across
dance + dance-wide is 4.0s on the first dance photo alone: 46.40–48.90 = 2.50s;
the full dance beat runs 46.40–50.40).

## Text / image — 12/13 beats

- Hook (dress/zipper/mirror): exact. Zipper stopped halfway, literal.
- Floor night / "the dress did not fit anymore": exact (probe 19.5s, bed-no-phone).
- Tears / "too ashamed to tell my sister": exact, 4.0s hold, tears visible.
- Dress on floor / "so I said nothing": exact (see above).
- Phone / "I read something that changed everything": exact, phone ONLY at the
  turn (22.06s, never before).
- Study / "a full year": weak — chart-laptop (28.0–29.2s) is an unlabeled rising
  curve, says nothing without the narration. 1.2s only, same nit as v13.
  The labeled chart (32.08–33.58s) is legible: "Hunger stayed high. Fullness
  stayed low.", Hunger ~107–110%, Fullness ~70–75%, x-axis 0–12 months.
- Blueberry straddle: nearly fixed. Blueberry 29.2–32.08s covers "hunger was
  still louder" (30.38–31.48) fully and only 0.16s of "their fullness still
  weaker" (31.92–33.0) — was 0.5s/1.1s in v13.
- Notebook / "I wrote four words": exact. Word "notebook" (35.12–35.42) on the
  notebook photo (35.1–35.98).
- **"It was not me" keeps the face**: realization face 35.98–37.44s, words
  36.00–36.66 fully inside. Probe at 36.3s: eyes up, slight smile, same face.
- "smaller this time": literal (see above).
- Eggs / "Water before coffee": exact. Eggs photo 40.44–41.8s, word "Eggs"
  40.44–40.62 at its start; water glass + coffee cup 41.8–43.4s.
- Walk / dance / CTA: partial — clip shortfall (see above). Hug present
  (50.5s, sister in red, laughing). Last frame is the dance (56.2s probe:
  cta-dance2, SLIM, laughing, heels on both feet).

## Body, persona, dress — holds, zero leaks

HEAVY 0–~46s, SLIM ~46.4–56.4s (transition inside the dance photo). Same face
everywhere (brown hair low bun, green eyes, freckles) in all 14 grid frames +
26 probes. Navy lace dress (short sleeves, round neck, back zip) consistent;
sage-green t-shirt + jeans in everyday scenes; nude heels at the wedding.
No anonymous hands, no dark frames, no repeated photo, no coverage filler.
Known nit persists: `v10-mirror-face` deep V neckline in the reflection vs
round neck on the body (0s, 8s probes).

## Subtitles — lag window persists, now with an early flip

Clean everywhere: no dashes, commas or final periods in any probed frame
(#637 cleanup live again). Timing, measured against word timestamps:

- Aligned: ~17s, ~21.5s, ~40s, ~42s, 54.0s, 55.0s, 56.2s.
- **~1s BEHIND in 32.5–36.3s**: at 32.5s audio "their fullness still weaker"
  (31.92–33.0), subtitle "and their hunger was still louder" (ended 31.48);
  at 34.0s audio "I wrote four words" (33.62–34.86), subtitle "their fullness
  still weaker"; at 35.3s audio "down in my notebook" (34.6–35.42), subtitle
  "I wrote four words"; at 36.3s audio "not me" (36.22–36.44), subtitle "down
  in my notebook". The subtitle is one phrase behind through the whole
  notebook / key-phrase take, then catches up at 37s.
- **~1.1s AHEAD at 46.6s**: c10 subtitle over the dance photo before "Three
  months later" is spoken (clip shortfall pulled the photo early).
- Mechanism confirmed both ways: subtitles change on the photo grid, not on
  the words. Engine-side, not fixable by script. Same open issue as v13.

## CTA, music — unchanged, engine/TTS-side

- CTA still the fastest take: 12 words in 2.42s (53.06–55.48) ≈ **297 wpm**
  vs hook 242 wpm. Per-take pace ranges 148–300 wpm with no law. TTS property
  of the final take; splitting across two dance photos did not fix it. Don't chase.
- Music bed: present but imperceptible. Sample-level measurement (not the broken
  ffmpeg volumedetect windows): narration mean −25.7 dB; true gaps −42.7 dB
  (tail 55.6–56.4) to −48.2 dB (word pause 6.80–7.30) to −66/−74 dB (deep
  pauses) — i.e. 17–22 dB below the voice where it exists at all. Same as v13.
  Not script-controllable.

## New measurement finding: the engine slow-zooms every photo

Signature matching (54×96 grayscale vs each source photo) shows every still
drifting steadily across its hold: ~15–20 points of mean abs diff from one end
of a photo to the other (e.g. hug 1.8 → 19.4 over 50.4–51.9s; tears 18.1 → 6.4
over 16.5–18.5s; cta-dance 21.2 → 3.9 over 52.0–53.5s). Direction alternates
per photo (in/out). Visually a very slow Ken Burns zoom — it makes the stills
feel less static and is NOT a defect.

It DOES break scene-detection-based cut measurement: scdet (0.4) fired
mid-photo at 51.97s (zoom crossing threshold inside the hug) and MISSED real
cuts at 19.14s (bed-no-phone, probe-confirmed present) and 48.9s
(dance→dance-wide, signature-confirmed). Future analysis must use signature
matching against the sources, not scdet alone. The v13 "26/29 cuts within
±0.03s" claim was luck — the zoom was there too, unnoticed.

## Verdict

v14 keeps everything v13 had and fixes the two named items (dress-floor hold,
literal "smaller this time"), and the first b-roll clip fits its sentence with
real motion. But the clip plays less than half its planned length and drags the
climax 1.13s early — the dance arrives over the last half-second of the walk
sentence and the CTA subtitle jumps ahead a second. That is a visible sync slip
at the payoff, and it costs the half point v13 earned. The fix is concrete and
maker-side (30 fps re-encode + verify played length), the remaining −0.5 is
otherwise the same engine/TTS list as v13: subtitles in the 32.5–36.3s window,
CTA 297 wpm, music bed inaudible, plus the 1.2s unlabeled chart and the mirror
V-neckline nit.

**Next (v15): 30 fps clip, verify played length, keep everything else.**
