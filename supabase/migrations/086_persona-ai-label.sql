alter table public.personas
  add column if not exists ai_label boolean not null default false;
