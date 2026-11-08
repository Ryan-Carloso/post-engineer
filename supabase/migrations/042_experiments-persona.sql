-- ============================================================================
-- Migration 042 — Experiments link their videos' persona, not one schedule
-- ----------------------------------------------------------------------------
-- WHY: migration 041 made an experiment own exactly one schedule. Videos
-- are created by POST /api/videos/generate-and-schedule, which creates one
-- schedule per video (one call = one video), so an experiment's videos live
-- in many schedules and `experiments.schedule_id` could never be filled.
--
-- WHAT:
--   1. Drop experiments.schedule_id (its FK and unique key go with it).
--   2. Add experiments.persona_id (nullable: a faceless experiment has no
--      persona). generate-and-schedule rejects a video linked to an
--      experiment when its persona differs, and persona-scoped API keys
--      see only their personas' (and persona-less) experiments.
--      No FK to personas: deleting a persona never deletes experiment
--      results (same rule as post_metrics.persona_id).
--   3. public.create_experiment() — the experiment and both variants in
--      one transaction (POST /api/experiments).
--
-- The table holds no rows in production yet (no route wrote it before this
-- change), so dropping the column loses nothing.
--
-- Idempotent: safe to re-run (if exists / if not exists / create or
-- replace / guarded grants).
-- ============================================================================

alter table public.experiments drop column if exists schedule_id;

alter table public.experiments add column if not exists persona_id uuid;

-- create_experiment — the experiment and its two variants in one
-- transaction (POST /api/experiments). The CHECK constraints from 041
-- validate every value; a violation aborts the whole call, so a half
-- experiment (row without variants) can never exist. p_variants is a
-- JSON array of {variant_id, name, description}; array order is the
-- variant position (0, 1). Service role only, same convention as 033.
create or replace function public.create_experiment(
  p_user_id uuid,
  p_name text,
  p_variable text,
  p_persona_id uuid,
  p_target_pairs integer,
  p_variants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) <> 2 then
    raise exception 'create_experiment: exactly two variants are required' using errcode = '22023';
  end if;
  insert into public.experiments (user_id, name, variable, persona_id, target_pairs)
  values (p_user_id, p_name, p_variable, p_persona_id, p_target_pairs)
  returning id into v_id;
  insert into public.experiment_variants (experiment_id, variant_id, position, name, description)
  select v_id, v.value ->> 'variant_id', (v.ordinality - 1)::integer, v.value ->> 'name', v.value ->> 'description'
  from jsonb_array_elements(p_variants) with ordinality as v(value, ordinality);
  return v_id;
end;
$$;

revoke execute on function public.create_experiment(uuid, text, text, uuid, integer, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.create_experiment(uuid, text, text, uuid, integer, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.create_experiment(uuid, text, text, uuid, integer, jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_experiment(uuid, text, text, uuid, integer, jsonb) to service_role;
  end if;
end $$;
