-- 029: per-post video material choice on scheduled_posts.
--
-- What fills a video, with or without a face: 'broll' (stock footage only)
-- or 'svg' (catalog illustrations only); the two never mix. The web writes
-- it at slot creation next to `faceless`, and the engine's batch pipeline
-- (fill_schedule) forwards it as `faceless_material`, exactly like the web's
-- direct dispatch. Existing rows default to 'broll', which is what every
-- video rendered before this choice already was.

alter table public.scheduled_posts
  add column if not exists faceless_material text not null default 'broll';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_faceless_material_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      add constraint scheduled_posts_faceless_material_check
      check (faceless_material in ('broll', 'svg'));
  end if;
end $$;
