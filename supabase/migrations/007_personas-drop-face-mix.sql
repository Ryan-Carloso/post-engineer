-- ============================================================================
-- Migration 007 — Personas are always faced: drop the face mix
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 005_persona-visual-identity.sql. Safe to re-run (idempotent).
--
-- WHY: persona creation used to carry a "faceless" mode and a face-mix
-- percentage (face_mix_percent: 0 = 100% stock, 100 = the persona's face).
-- Both are gone from the product: a persona is always faced, and "no face"
-- is a per-post choice made when creating a post
-- (POST /api/videos/generate-and-schedule options.faceless), where the
-- persona's voice, niche and script prompt still apply.
--
-- The column was never just a knob: it was also the "is this persona
-- faceless?" MARKER, read by the web (image-library gate, post pricing) and
-- by the engine's batch pipeline (the per-video token cost used to refund a
-- failed slot). With the mix gone, the marker has to live where the choice
-- actually is — the slot — so step 1 adds it there and step 2 drops the
-- persona column. Order matters: the engine reads scheduled_posts.faceless
-- the moment this migration lands.
--
-- SCOPE / TRADEOFF — a persona created WITHOUT a face (no photo_path, no
-- avatar_url) is not repaired by this migration; it has nothing to repair
-- from. It is still a faced persona as far as the app is concerned, so
-- generating a post for it (with the face ON) fails with photo_missing —
-- a per-slot terminal state with an automatic refund — until the user edits
-- the persona and adds a photo or a character/AI avatar. The persona editor
-- is the recovery path, and its image library is what feeds it.
-- ============================================================================

-- 1. The per-post choice, on the row that owns it. `not null default false`
--    means every existing row is a faced post (the only value that existed
--    before this migration). The engine's batch pipeline reads it to price a
--    slot instead of joining the persona's face mix.
alter table public.scheduled_posts
  add column if not exists faceless boolean not null default false;

-- 2. The persona face mix itself. Idempotent (`if exists`) so re-running on
--    a database where a previous attempt already dropped it is a no-op.
alter table public.personas
  drop column if exists face_mix_percent;