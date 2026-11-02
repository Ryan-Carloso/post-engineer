-- 035: per-post full lip-sync choice on scheduled_posts.
-- Written by the web at slot creation next to faceless_material and
-- forwarded by fill_schedule like the direct dispatch. Without it, a
-- tick-dispatched or requeued slot silently renders intro-only b-roll
-- instead of full lip-sync. Existing rows default to false, the behaviour
-- every earlier video already had.

alter table public.scheduled_posts
  add column if not exists full_lipsync boolean not null default false;
