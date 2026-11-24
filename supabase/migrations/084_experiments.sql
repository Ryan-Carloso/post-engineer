create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  persona_id uuid not null references public.personas(id) on delete cascade,
  prompt_version_ids uuid[] not null,
  videos_per_prompt integer not null check (videos_per_prompt between 5 and 10),
  posts_per_day integer not null check (posts_per_day between 1 and 5),
  video_type text not null check (video_type in ('full_lipsync', 'hook_lipsync', 'voiceover')),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists experiments_user_idx on public.experiments (user_id, created_at desc);

alter table public.scheduled_posts add column if not exists experiment_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_experiment_id_fkey') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_experiment_id_fkey
      foreign key (experiment_id) references public.experiments(id) on delete set null;
  end if;
end $$;

create index if not exists scheduled_posts_experiment_idx on public.scheduled_posts (experiment_id)
  where experiment_id is not null;

alter table public.experiments enable row level security;

drop policy if exists experiments_owner on public.experiments;
create policy experiments_owner on public.experiments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
