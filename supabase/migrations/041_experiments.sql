-- ============================================================================
-- Migration 041 — Content experiments (paired A/B tests on one variable)
-- ----------------------------------------------------------------------------
-- WHY: issue #476. A user tests one variable of the script (v1: the hook)
-- with two variants. One video against one video proves nothing, so an
-- experiment is a set of PAIRS: inside a pair both videos share topic,
-- body and CTA and differ only in the tested segment; across pairs the
-- content changes like any calendar. Results compare A with B inside each
-- pair, per provider.
--
-- No visible "A"/"B" label exists anywhere: variants are identified by a
-- slug (`variant_id`, e.g. `hook-aggressive`) plus a human name.
--
-- WHAT:
--   1. public.experiments — one row per experiment. It owns exactly one
--      schedule (`schedule_id`, unique): persona, accounts, quality and
--      voice live on the schedule, so every slot of an experiment shares
--      them by construction. Deleting the schedule deletes the experiment.
--   2. public.experiment_variants — exactly two per experiment
--      (`position` 0 or 1), keyed by (experiment_id, variant_id).
--   3. public.scheduled_posts — experiment_id, variant_id, experiment_pair.
--      A composite FK to experiment_variants; both ids are null or both
--      set, and a linked slot carries its pair number. One slot per
--      (experiment, pair, variant).
--   4. public.post_metrics — the same three columns as snapshot values,
--      filled by a BEFORE INSERT trigger from scheduled_posts (same
--      pattern as persona_id in migration 026). No FK: editing or deleting
--      an experiment later never rewrites collected metrics.
--   5. RLS: owners read their own experiments and variants. Writes happen
--      only from web API routes with the service role.
--
-- Limits mirrored in apps/web/lib/experiments/limits.ts (pinned by
-- apps/web/lib/__tests__/experiments-migration.test.ts).
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded constraints,
-- policies and triggers / create or replace).
-- ============================================================================

create table if not exists public.experiments (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  schedule_id uuid not null,
  name text not null,
  variable text not null,
  target_pairs integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.experiment_variants (
  experiment_id uuid not null,
  variant_id text not null,
  position integer not null,
  name text not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (experiment_id, variant_id)
);

alter table public.scheduled_posts add column if not exists experiment_id uuid;
alter table public.scheduled_posts add column if not exists variant_id text;
alter table public.scheduled_posts add column if not exists experiment_pair integer;

alter table public.post_metrics add column if not exists experiment_id uuid;
alter table public.post_metrics add column if not exists variant_id text;
alter table public.post_metrics add column if not exists experiment_pair integer;

-- Constraints in pg_constraint-guarded blocks: `create table if not
-- exists` never adds a constraint to a table that already exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiments_schedule_id_fkey') then
    alter table public.experiments
      add constraint experiments_schedule_id_fkey
      foreign key (schedule_id) references public.schedules(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_schedule_id_key') then
    alter table public.experiments
      add constraint experiments_schedule_id_key unique (schedule_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_name_length_check') then
    alter table public.experiments
      add constraint experiments_name_length_check
      check (char_length(name) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_variable_check') then
    alter table public.experiments
      add constraint experiments_variable_check check (variable in ('hook'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiments_target_pairs_check') then
    alter table public.experiments
      add constraint experiments_target_pairs_check check (target_pairs between 3 and 20);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_experiment_id_fkey') then
    alter table public.experiment_variants
      add constraint experiment_variants_experiment_id_fkey
      foreign key (experiment_id) references public.experiments(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_position_key') then
    alter table public.experiment_variants
      add constraint experiment_variants_position_key unique (experiment_id, position);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_position_check') then
    alter table public.experiment_variants
      add constraint experiment_variants_position_check check (position between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_variant_id_format_check') then
    alter table public.experiment_variants
      add constraint experiment_variants_variant_id_format_check
      check (variant_id ~ '^[a-z0-9][a-z0-9-]{0,47}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_name_length_check') then
    alter table public.experiment_variants
      add constraint experiment_variants_name_length_check
      check (char_length(name) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'experiment_variants_description_length_check') then
    alter table public.experiment_variants
      add constraint experiment_variants_description_length_check
      check (char_length(description) between 1 and 500);
  end if;

  -- Deleting an experiment (with its schedule) unlinks any slot that
  -- survives: SET NULL clears both FK columns together.
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_experiment_variant_fkey') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_experiment_variant_fkey
      foreign key (experiment_id, variant_id)
      references public.experiment_variants(experiment_id, variant_id) on delete set null;
  end if;
  -- Both ids or neither; a linked slot has a pair number >= 1. The pair
  -- number may outlive an unlink (SET NULL does not clear it).
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_experiment_link_check') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_experiment_link_check
      check (
        (experiment_id is null) = (variant_id is null)
        and (experiment_id is null or experiment_pair is not null)
        and (experiment_pair is null or experiment_pair >= 1)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_experiment_pair_variant_key') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_experiment_pair_variant_key
      unique (experiment_id, experiment_pair, variant_id);
  end if;
end $$;

create index if not exists experiments_user_id_idx
  on public.experiments (user_id, created_at desc);

create index if not exists post_metrics_user_experiment_idx
  on public.post_metrics (user_id, experiment_id)
  where experiment_id is not null;

-- post_metrics_set_experiment — copies the slot's experiment link onto
-- each snapshot at insert (a trigger, not the collector, so every writer
-- gets it). Snapshot values: a later unlink never rewrites them.
create or replace function public.post_metrics_set_experiment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.experiment_id is null then
    select sp.experiment_id, sp.variant_id, sp.experiment_pair
      into new.experiment_id, new.variant_id, new.experiment_pair
    from public.scheduled_posts sp
    where sp.id = new.post_id and sp.experiment_id is not null;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'post_metrics_set_experiment_trg'
      and tgrelid = 'public.post_metrics'::regclass
  ) then
    create trigger post_metrics_set_experiment_trg
      before insert on public.post_metrics
      for each row execute function public.post_metrics_set_experiment();
  end if;
end $$;

-- RLS: owners read their own rows; the service role (web API) writes.
alter table public.experiments enable row level security;
alter table public.experiment_variants enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiments'
      and policyname = 'experiments_select_own'
  ) then
    create policy experiments_select_own on public.experiments
      for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'experiment_variants'
      and policyname = 'experiment_variants_select_own'
  ) then
    create policy experiment_variants_select_own on public.experiment_variants
      for select using (
        exists (
          select 1 from public.experiments e
          where e.id = experiment_variants.experiment_id and e.user_id = auth.uid()
        )
      );
  end if;
end $$;
