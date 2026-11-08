# Background music (BGM) — licensed tracks

Videos render with background music again (issue #489). The engine
picks a track from `catalog.toml` for the requested `music_mood`
(`VideoParams.music_mood`; omitted = first catalogued mood,
`"none"` = explicit no-music choice).

## License

Every track in `catalog.toml` is **CC0 1.0** (public domain
dedication): free for commercial use, no attribution required,
redistribution allowed. Each catalog entry records its `license` and
`source` URL so the claim is checkable.

Sourced 2026-11-08 via the Openverse API (Freesound origin), all
verified as CC0 1.0 with a live Freesound source page. Never add a
track without verifying its license allows commercial use **and**
redistribution first — the unlicensed MP3s removed in the 2026-09-26
public-release cleanup must not come back.

## Tracks (7, 4 moods, ~18 MB)

| Mood | Track | Creator |
|---|---|---|
| upbeat | Upbeat loop (58s) | mistermender |
| upbeat | Free Uplifting Music (160s) | Seth_Makes_Sounds |
| calm | Soft piano (59s) | Johnnie_Holiday |
| calm | mellow_chill_song23 (117s) | bainmack |
| inspiring | April Showers (119s) | kjartan_abel |
| energetic | NovaTrax - Wave Length (127s) | NovaTrax |
| energetic | Upbeat Acoustic Guitar With Orchestra (141s) | guitarman213 |

## Deploy note

`deploy.sh` replaces `resource/songs` on the VPS checkout with the
private licensed set from `secrets/prod/engine/resource/songs` — prod
plays that set, this public set ships in the image for self-hosters
and dev. The Dockerfile copies `resource/songs` into the image (same
pattern as `resource/fonts`); `resource/` stays gitignored except for
`songs/` (see `apps/engine/.gitignore`).
