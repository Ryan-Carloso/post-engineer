-- ============================================================================
-- Migration 012 — Let a post exist without a persona, and snapshot what the
--                  persona used to supply
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 011_schedules-drop-persona-owner-unique.sql. Safe to re-run
-- (idempotent): every statement is guarded on the object it needs.
--
-- WHY: a persona is not only a face. In faceless mode the engine reads
-- voice_id, script_prompt, niche, language, video_aspect and
-- paragraph_number off the persona embed (`build_persona_params`,
-- `generate._generate_slot`), and `PersonaParams` in the engine's schema
-- REJECTS a job with neither voice_id nor voice_audio_url. So "generate a
-- video without a persona" is not a matter of dropping a face — it is a
-- matter of carrying that editorial definition in the request instead.
--
-- TWO PARTS:
--
--   1. `schedules.persona_id` becomes nullable, so a post can be faceless
--      with only a voice id and a topic. The FK to personas (if any) is left
--      alone: deleting a persona still cascades its posts, which is the
--      behavior an owner expects from "my persona's posts".
--
--   2. The columns the engine needs at generation time are snapshotted onto
--      the schedule. This is what makes the post reproducible: editing a
--      persona afterwards must NOT rewrite the script, aspect ratio or
--      paragraph count of a video that is already scheduled — the same
--      reason the topic is stored on the slot rather than resolved at tick
--      time. A snapshot also removes the engine's last dependency on the
--      persona join for refunds, which is the "persona embed missing →
--      burned prepaid tokens" hole documented in `reconcile.py`.
--
-- face_quality is snapshotted too: it prices the refund. A faceless post
-- ignores it, but the column must exist so the pricing input is available to
-- every schedule regardless of mode.
--
-- NULL semantics: NULL on a snapshot column means "not provided", NOT
-- "inherit from the persona". The web writes the resolved value at creation
-- time, so an empty snapshot only ever appears on a schedule created before
-- this migration — and the engine keeps reading the persona embed for those,
-- which is why `post_identity` falls back rather than switching over.
-- ============================================================================

-- 1. Optional persona.
alter table public.schedules
  alter column persona_id drop not null;

-- 2. Identity snapshot (the columns the engine reads off the persona embed).
alter table public.schedules add column if not exists post_voice_id text;
alter table public.schedules add column if not exists post_script_prompt text;
alter table public.schedules add column if not exists post_niche text;
alter table public.schedules add column if not exists post_language text;
alter table public.schedules add column if not exists post_video_aspect text;
alter table public.schedules add column if not exists post_paragraph_number integer;
alter table public.schedules add column if not exists post_face_quality text;

comment on column public.schedules.persona_id is
  'Optional. NULL = a faceless post defined entirely by the post_* snapshot columns.';
comment on column public.schedules.post_voice_id is
  'Voice id snapshotted at creation: the engine needs exactly one of this or a voice audio url.';
comment on column public.schedules.post_script_prompt is
  'Script prompt snapshotted at creation, so editing the persona never rewrites a scheduled video.';
comment on column public.schedules.post_video_aspect is
  '''9:16'' or ''16:9'', snapshotted at creation.';
comment on column public.schedules.post_paragraph_number is
  'Paragraph count (1-10) snapshotted at creation; NULL lets the engine default.';
comment on column public.schedules.post_face_quality is
  'Persona face quality (''ok''/''very_good'') snapshotted at creation; prices a failed slot''s refund.';
