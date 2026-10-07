-- ============================================================================
-- Migration 013 — Snapshot the persona-less audio voice URL on the schedule
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): every statement is guarded on the object it
-- needs.
--
-- WHY: migration 012 snapshotted the identity columns the engine reads at
-- tick time, but missed one voice spelling. The web accepts
-- `options.audioUrl` for a persona-less post (validated + SSRF-checked) and
-- direct-dispatches it as the engine's `voice_audio_url` — yet the schedule
-- row had no column for it, so `post_voice_id` was written NULL and the
-- engine's `voice_for` pre-dispatch check failed every slot of such a post
-- with "post resolves no voice". The same gap affected audio-voice personas
-- the other way round (their `voice_audio_path` lives in the persona embed,
-- which `voice_for` now also accepts). This column closes the persona-less
-- side: the audio URL is written at creation and read back at tick time,
-- exactly like the other snapshot columns.
--
-- NULL semantics: NULL means "not provided" (the post uses a voice_id or an
-- audio-voice persona instead), NOT "inherit". The web writes the resolved
-- URL at creation time.
-- ============================================================================

alter table public.schedules add column if not exists post_voice_audio_url text;

comment on column public.schedules.post_voice_audio_url is
  'Custom voice audio URL snapshotted at creation for persona-less posts; the engine passes it to the job as voice_audio_url.';
