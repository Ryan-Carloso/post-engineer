-- ============================================================================
-- 054 — 'images' is the only scheduled_posts faceless_material (issue #542).
--
-- Stock B-roll and SVG are deleted from the product: every video renders
-- from the agent's own segment images (or full lip sync, which leaves media
-- optional). Stored rows that still say 'broll' or 'svg' are backfilled to
-- 'images' — those videos were already rendered from whatever material the
-- engine had, and 'images' is the only material the engine accepts now, so
-- the stored value must name it. The column default moves from 'broll' to
-- 'images', and the check drops the two dead values. Idempotent: rerunning
-- backfills nothing new and re-adds the same check.
-- ============================================================================

update public.scheduled_posts
  set faceless_material = 'images'
  where faceless_material in ('broll', 'svg');

alter table public.scheduled_posts
  alter column faceless_material set default 'images';

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_faceless_material_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_faceless_material_check
  check (faceless_material in ('images'));
