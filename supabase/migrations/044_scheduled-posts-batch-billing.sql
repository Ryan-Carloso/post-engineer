-- ============================================================================
-- 044 — scheduled_posts.charged_tokens: what each slot was charged.
--
-- Every refund path (engine generate/reconcile/publish, web schedule cancel)
-- used to recompute a slot's price from its faceless/full-lip-sync flags and
-- the schedule's face quality. That breaks as soon as a slot is charged
-- anything other than its list price (issue #487: the free video of a
-- batch), and it burned the tokens of any failed slot whose identity could
-- no longer be resolved. From now on the web writes the charged amount on
-- the slot at creation and every refund reads it.
--
-- Backfill: existing rows get the list price they were charged under, the
-- same formula as web computeVideoTokens (apps/web/lib/tokens.ts; the sync
-- test pins these literals): faceless 1; full lip-sync 8 (ok) / 15
-- (very_good); face 2 (ok) / 3 (very_good). The face quality is the
-- schedule snapshot first, then the persona; anything else prices as ok.
--
-- Idempotent: add column if not exists, the backfill only touches NULL rows,
-- and the NOT NULL / check steps are guarded.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists charged_tokens integer;

update public.scheduled_posts sp
set charged_tokens = case
  when sp.faceless is true then 1
  when sp.full_lipsync is true and q.face_quality = 'very_good' then 15
  when sp.full_lipsync is true then 8
  when q.face_quality = 'very_good' then 3
  else 2
end
from (
  select s.id as schedule_id,
    coalesce(nullif(s.post_face_quality, ''), p.face_quality::text) as face_quality
  from public.schedules s
  left join public.personas p on p.id = s.persona_id
) q
where q.schedule_id = sp.schedule_id
  and sp.charged_tokens is null;

-- A slot whose schedule row is gone has no face quality to read: price it
-- as ok, the same default every refund path used.
update public.scheduled_posts sp
set charged_tokens = case
  when sp.faceless is true then 1
  when sp.full_lipsync is true then 8
  else 2
end
where sp.charged_tokens is null;

alter table public.scheduled_posts
  alter column charged_tokens set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_charged_tokens_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      add constraint scheduled_posts_charged_tokens_check
      check (charged_tokens >= 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Batch discount (issue #487): videos created together through the MCP
-- batch tool share a batch_id, and every 6th face video of a batch (the
-- cheapest) is free. POST /api/videos/batch-discount credits the free
-- video's charge back and records it here: charged_tokens drops to 0 and
-- discount_tokens holds the credited amount. A cancel that leaves the batch
-- below the threshold claws the discount back from its own refund (moves
-- discount_tokens back into charged_tokens), so cancelling the paid videos
-- never leaves a free one behind.
-- ----------------------------------------------------------------------------

alter table public.scheduled_posts
  add column if not exists batch_id uuid;

alter table public.scheduled_posts
  add column if not exists discount_tokens integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_discount_tokens_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      add constraint scheduled_posts_discount_tokens_check
      check (discount_tokens >= 0);
  end if;
end $$;

create index if not exists scheduled_posts_batch_id_idx
  on public.scheduled_posts (batch_id)
  where batch_id is not null;
