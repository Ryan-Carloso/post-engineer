# Video loop — Daily Dose, weight regain (Inspirador)

Local R&D loop for the Post Engineer Story-First Reels prompt. Working
files live here; the versioned record is the branch `loop/daily-dose`
in the post-engineer repo, under `video-loop/` — one commit per round,
never merged to main, no PR.

## The loop

- Fixed brief: HabitLoom, EN, "why you regain weight after a diet",
  archetype Inspirador, persona Mara (local test persona).
- Three separate agents, contexts never touching: maker, blind judge
  (Muse), and the prompt. The maker works only from its `NOTAS-vX.md`.
- Loop runs until a video scores 10/10 from all three blind judges
  (Muse, Wonder, Opus 5.5). Only the prompt changes between rounds.
- Proven lessons ship to the product as separate PRs
  (e.g. #636 archetypes, #646 real story, #652 rhythm, #656 clips,
  #660 obvious archetype). The winning prompt ships as one PR at 10/10.

## What a round commits

`NOTAS-vX.md` (the round's prompt version + what failed before),
`analysis-vX.md` (maker's self-score), `manifest-vX.json`,
task JSONs, transcript/words/cuts, the drive/download/analyze scripts,
and `images-vX/` + `media-vX/` (the photos and clips actually used,
minus the video files themselves).

The rendered videos NEVER leave the local machine: no `.mp4` is ever
committed to this branch — the videos stay in `~/workspace/video-selfhost/`
only. Same for downloaded stock clips: their ids live in the manifests,
the files stay local.

NOT committed: extracted frames (`frames-*/`), probe stills (`probe*/`),
extracted audio (`audio-*.wav`), run logs (`*.log`, `logs/`) — all
regenerable from the mp4. No secrets ever: drivers read the engine key
from the local stack's `.env` at runtime, never from this repo.

## Versions

| v | maker | Muse judge | note |
|---|-------|------------|------|
| 1 | — | — (user 3/10) | winning 9/10 script, 25 Pexels stock photos |
| 2 | 8 | — (user: too basic) | real first-person story, 21 AI photos |
| 3 | 8.5 | — (user: monotonous) | Informativo archetype (ghrelin/leptin) |
| 4 | 6.5 | — (no verdict) | Inspirador, mixed media |
| 5 | 7.5 | 7 | 5 lessons applied |
| 6 | 8 | 8 | script-structure design (one beat per segment) |
| 7 | 8 | 8 | structure v2 |
| 8 | 8.5 | 8 | photo-count rule; judge: body never changes |
| 9 | 8.5 | 8.5 | body rule (two body states) |
| 10 | 8.5 | 8.5 | body rule met, zero leaks |
| 11 | 9 | 9 | "It was not me" lands on the face |
| 12 | 9.5 | 9 | SegmentMedia.duration breaks the 2s grid |
| 13 | 9.5 | 9.5 | mandatory rhythm contrast, metronome dead |
| 14 | — | — | b-roll Pexels (in progress) |

## Stack (dev only, never prod)

Local engine on :8080 + local TTS on :4123, started with
`~/workspace/video-selfhost/start-stack.py` (stack lives in
`~/workspace/pe-local-selfhost`). Secrets come from the
`post-enginner-repos` `secrets/dev` tree. Never publish these videos.
