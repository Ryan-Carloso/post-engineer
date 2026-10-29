-- 031: scheduled_posts gains a title label and loses the topic column.
--
-- BREAKING (beta): the multi-video topics input is gone — one request
-- creates one video with a title and a segments script. The title column
-- carries the slot label the topic column used to carry; existing rows
-- keep their label via a one-time backfill, then the topic column is
-- dropped. Rows created before segments existed (segments NULL) have no
-- script: the engine's generic scriptless rule fails them with a
-- segments error instead of generating from a label.
--
-- Idempotency: the backfill + drop run only while the topic column still
-- exists, so re-applying this file after the drop is a no-op (a bare
-- UPDATE referencing a dropped column would fail the whole chain).
alter table public.scheduled_posts
  add column if not exists title text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scheduled_posts'
      and column_name = 'topic'
  ) then
    update public.scheduled_posts
      set title = topic
      where title is null and topic is not null;
    execute 'alter table public.scheduled_posts drop column topic';
  end if;
end $$;
