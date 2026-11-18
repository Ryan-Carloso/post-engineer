# Analysis v6 — daily-dose-weight-regain-faceless-v6.mp4

Maker's own harsh score: **8/10** (v5 was 7.5/10). This score lives ONLY here
until the blind panel closes — do not copy it into shared MEMORY.md.

## File

- `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v6.mp4`
- 52.97 s, 1080×1920, h264 + aac, 14,347,642 bytes
- Task `217b92ee-71cc-4a24-a3e3-6d7d5fb3ad1b`, state 1, `video_quality: ok`,
  `music_mood: calm`, audio 53 s. Voice `chatterbox:phonon_everly`, one voice.
- Archetype: **Inspirador**. Script 167 words, mechanically validated.
- Photos: 29 (18 new Mara AI + 4 reused Mara + 2 reused v3 + 5 real Pexels).
- Transcript `transcript-v6.json`, word timings `words-v6.json`, frames
  `frames-v6/f-01..f-13.jpg` (one every 4 s).

## Script (as spoken — full transcription matches the script)

hook: "Six months after my diet ended, I tried on the dress I wore to my
sister's wedding, and the zipper stopped halfway up my back. Same dress,
same mirror, and I felt like everything I had worked for was gone."
c1: "That night I sat on the bedroom floor in the dress, half zipped,
staring at the wall, too ashamed to tell my sister the dress did not fit
anymore."
c2: "Then one morning I read something that changed everything. A study
had followed people for a full year after their diet, and their hunger
was still louder, their fullness still weaker. I wrote three words in my
notebook. It was not me."
c3: "So I started again, smaller this time. Eggs for breakfast, water
before coffee, and a walk after dinner, every single night, no matter the
weather."
c4: "Three months later I danced all night at the wedding in that dress,
and this time I knew why it would hold. Save this for the day you want to
quit."
CTA confirmed by a second transcription pass (base model): "Save this for
the day you want to quit." (tiny had misheard it as "wear"/"play".)

Facts: Sumithran et al. 2011, NEJM 365:1597–604, PMID 22029981 — qualitative
only in the script (hunger still louder, fullness still weaker a year
later). No invented numbers.

## Measured timing (word timestamps, faster-whisper)

| take | words | seconds | wpm | photos | s/photo | plan |
|------|-------|---------|-----|--------|---------|------|
| hook | 40 | 12.64 | 190 | 5 | 2.53 | slow |
| c1   | 29 | 8.20  | 212 | 4 | 2.05 | slowest |
| c2   | 42 | 14.26 | 177 | 8 | 1.78 | fast |
| c3   | 25 | 10.26 | 146 | 7 | 1.47 | fastest |
| c4   | 31 | 6.84  | 272 | 5 | 1.37 | slow |

## Frame-by-frame check (13 samples, photo + on-screen subtitle)

| t | photo on screen | subtitle on screen | verdict |
|---|-----------------|--------------------|---------|
| 0s | bed-dress | "I tried on the dress I" | match |
| 4s | zipper (her back, hand at stuck zipper) | "and the zipper stopped" | match — best frame of the video |
| 8s | sleeve-detail (her freckled hand in the lace) | "and I felt like everything I" | match |
| 12s | floor (sitting, lamp-lit) | "bedroom floor in the dress" | match |
| 16s | hem-detail (lace pooling at bare feet) | "too ashamed to tell my sister" | match |
| 20s | content1-phone (reading phone, coffee) | "Then one morning I read" | match — the turning moment IS visible |
| 24s | real-calendar (October) | "A study had followed people for" | match |
| 28s | real-small-plate (one blueberry) | "and their hunger was still louder" | MISS — one photo ahead; fridge was the planned hunger image |
| 32s | looking-up (hopeful, phone in hand) | "in my notebook" | MISS — one photo ahead; notebook shot belongs here |
| 36s | real-water (glass) | "Eggs for breakfast" | MISS — one photo ahead; eggs belong here |
| 40s | walk-night (streetlight, determined) | "every single night" | match (drift accidentally lands the right photo) |
| 44s | dance-wide (spinning, laughing) | "all night at the" | match — victory lands |
| 48s | sisters-hug (laughing embrace) | "why it would hold" | match |

10/13 match. The 3 misses are all the same failure: **photos run ~one
photo ahead of the words through c2–c3**. The engine falls back to
proportional intervals when its word walk mismatches (the warning appears
in the engine log for every version), and TTS speed varies inside the take,
so proportional placement drifts from the real words. The misses are mild
— an empty plate under "hunger" is not nonsense, water under "eggs" is
only slightly off — but the planned pairings (fridge→hunger,
notebook→notebook, eggs→eggs) are not what shows.

## Rhythm — the plan half-worked

Per-photo time falls 2.53 → 2.05 → 1.78 → 1.47 → 1.37 s: a steady
acceleration with **no slowdown at the end**. The photo-count lever moved
the numbers in the right direction for hook→c3, but TTS speed (146–272 wpm
across takes) dominates it: c4 ran at 272 wpm, so the take meant to be
triumphant-slow is the FASTEST in the video (5 cuts in 6.84 s). The victory
and the CTA flash by instead of breathing. c1, meant slowest, came out
2.05 s/photo — the low point does not linger either. Same failure mode as
v5, now measured: **photo count cannot control rhythm while TTS speed per
take is uncontrolled.** (This is what PR #652's `SegmentMedia.duration`
exists to fix — per-take durations, not counts.)

## Music

Audible bed in the inter-take gaps: mean −35 to −43 dB vs speech mean
−26.7 dB (digital silence would be <−70 dB). Gap levels RISE into the
next take (−44.8 → −41.8 dB, −36.4 → −33.9 dB across gap halves), which
reads as a music bed, not a decaying reverb tail. First version where the
`music_mood: calm` bed is actually present (v5: none audible). Levels
alone cannot prove it is music rather than room tone — noted as observed,
not proven.

## Subtitles

Clean in all 13 frames. No `-`, no `,`, no `.` visible anywhere — only
words and `?` would survive, and there is no `?` in this script. (The
prompt-only version of the rule; PR #637's engine script is not merged
yet.)

## Image quality / persona

- No dark frames. The floor scene is lamp-lit and readable (fixes v5's
  ~16 s dark frame). Walk-night is night but streetlit, face lit.
- No anonymous hands: notebook is her own freckled hand, sage sleeve;
  sleeve-detail is her hand in the lace.
- One persona throughout (brown low bun, freckles, sage t-shirt/jeans in
  day scenes, navy lace at the wedding/bedroom). No barefoot walks (shoes
  fixed in the re-generation).
- Dress continuity varies: long-sleeve lace (bed), backless lace top
  (zipper), thin-strap dress (floor), off-shoulder lace (dance),
  short-sleeve lace (hug). Same navy lace family, same woman — a casual
  viewer reads "the navy dress"; a careful viewer sees the cut change.
  Minor, same class as v5.
- One rejected generation: the hands-clutching close-up v1 came back with
  a t-shirt under the dress and a front zipper; the re-generation attempt
  was refused by the media tool (integrity check) and was NOT retried.
  Replaced by sleeve-detail (her hand in the lace), which works.

## Strengths

1. The story lands. The dress that will not zip is concrete, personal,
   and visual from frame 1; the arc (defeat → study → small plan →
   dancing at the wedding) is visible without the audio.
2. The turning point HAS a visual moment: at ~20 s she reads the phone,
   coffee on the table, "Then one morning I read" — the exact beat.
3. The close is joyful: spinning dance + sisters laughing + (final photo)
   sunrise smile. The hug over "why it would hold" carries the line.
4. Music bed finally audible (v5 had none).
5. Text/image 10/13 on sampled frames, all hook and c1 frames correct,
   no wrong-subject images (v5 had 3 wrong-subject sentences).
6. No dark frame, no anonymous hands, no barefoot walks, persona
   consistent, CTA spoken correctly.

## Weaknesses (harsh)

1. **The ending rushes.** c4 is the fastest take (1.37 s/photo, 272 wpm)
   instead of the slowest. The victory + CTA get under 7 seconds and 5
   cuts. The video accelerates to the end instead of landing.
2. **c2–c3 photos sit one beat ahead of the words** (3/13 samples).
   Fridge burns on the neutral "full year" clause; notebook arrives after
   its line; water arrives on "Eggs". The plan was right per sentence —
   the engine's proportional placement slipped it at render time.
3. **c1 does not linger.** The low point (floor, shame) passes at
   2.05 s/photo — barely slower than the fast takes. The emotional low
   deserves the slowest pace and does not get it.
4. Dress cut changes between shots (5 variants of the navy lace dress).
5. The calendar still says October 2020 (real photo, unreadable at video
   speed — negligible, but noted).

## Incidents

- **First submission failed task creation (422 masked as 500).** The
  engine density rule (`image_density.py`: min `ceil(words/8)` photos per
  segment, max `floor(words/3)`) rejected the 3/2/7/6/3 plan: hook 40w
  needs ≥5, c1 29w ≥4, c4 31w ≥4. This is the known issue #638 bug
  (`SegmentValidationError is not JSON serializable` in
  `validation_exception_handler`). Re-planned to 5/4/8/7/5 = 29 photos
  (cap 30), regenerated 7 new photos + reused the v3 diary shot for c2,
  resubmitted. Lesson: the density floor caps how slow a take can be —
  rhythm-by-count lives between `ceil(words/8)` and `floor(words/3)`.
- **Endpoint download 401 after completion** (task files archived to R2
  dev, local task dir empty). Recovered via direct R2 fetch
  (`download_r2_v6.py`, engine venv boto3). Same as v5.
- **media.generate_image refused one re-generation** (hands-clutching v2,
  integrity check). Not retried. No b-roll video was fetched: the current
  engine build accepts photos only, so clips would have nowhere to go.

## Score: 8/10

Clear step up from v5 (7.5): story concrete, turning point visible,
close joyful, music present, no dark frame, 10/13 text/image. Not a 10:
the ending rushes instead of landing, and the middle drifts one photo
ahead of the words. Both are engine-side (TTS speed variance,
proportional placement) — a prompt procedure cannot fix them, because the
plan was already right per sentence and the render slipped it. That is the
mechanism the next round should attack: bind each photo to its sentence's
own time (one segment per sentence) instead of verifying a plan the
engine then re-times, and give the closing take real duration so it can
breathe.
