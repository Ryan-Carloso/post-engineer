-- ============================================================================
-- Migration 026 — Post metrics dimensions (persona, script angle)
-- ----------------------------------------------------------------------------
-- WHY: the metrics dashboard filters snapshots by persona, account, network
-- and script angle. Account and network are already on post_metrics; the
-- other two live elsewhere (persona on the post's schedule, angle only on
-- the engine task record) and would cost a join chain or an engine read on
-- every dashboard load.
--
-- WHAT: two nullable columns on public.post_metrics, filled at write time:
--   1. persona_id — set by a BEFORE INSERT trigger from scheduled_posts ->
--      schedules.persona_id (no FK between them, so no PostgREST embed).
--      Null for a faceless post (schedules.persona_id is null).
--   2. script_angle — written by the web collector from the engine task
--      record. Null when the engine recorded no angle.
-- A one-time backfill at the end fills persona_id for snapshots that
-- migration 025's hourly collector wrote before this trigger existed.
-- Snapshot values: editing or deleting a persona later never rewrites them.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / create or replace / guarded
-- trigger).
-- ============================================================================

alter table public.post_metrics add column if not exists persona_id uuid;
alter table public.post_metrics add column if not exists script_angle text;

-- The dashboard reads one user's snapshots filtered by persona.
create index if not exists post_metrics_user_persona_idx
  on public.post_metrics (user_id, persona_id);

create or replace function public.post_metrics_set_persona()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.persona_id is null then
    select s.persona_id into new.persona_id
    from public.scheduled_posts sp
    join public.schedules s on s.id = sp.schedule_id
    where sp.id = new.post_id;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'post_metrics_set_persona_trg'
      and tgrelid = 'public.post_metrics'::regclass
  ) then
    create trigger post_metrics_set_persona_trg
      before insert on public.post_metrics
      for each row execute function public.post_metrics_set_persona();
  end if;
end $$;

-- Backfill: snapshots written between migration 025 and this one have no
-- trigger-filled persona_id (and the collector's upsert never rewrites it),
-- so fill them from the same join the trigger uses. Rows whose post has no
-- persona stay null. Idempotent: only null rows are touched.
update public.post_metrics pm
set persona_id = s.persona_id
from public.scheduled_posts sp
join public.schedules s on s.id = sp.schedule_id
where pm.post_id = sp.id and pm.persona_id is null;
