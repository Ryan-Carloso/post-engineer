-- ============================================================================
-- 043 — 'images' in the scheduled_posts faceless_material check.
--
-- The "images" material (issue #481) renders a video only from the images
-- the agent sends on its segments: no stock, no drawings. generate-and-
-- schedule writes the choice on every slot and the engine's batch pipeline
-- (fill_schedule.slot_material) forwards it, so the check from 029 must
-- accept it or an images post fails its slot insert. Drop and re-add the
-- constraint with the full list. Idempotent: rerunning drops and re-adds
-- the same check. Every existing row holds 'broll' or 'svg', both still
-- allowed.
-- ============================================================================

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_faceless_material_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_faceless_material_check
  check (faceless_material in ('broll', 'svg', 'images'));
