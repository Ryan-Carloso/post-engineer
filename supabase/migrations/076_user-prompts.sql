-- user_prompts: prompts written by users, private by default.
-- A private prompt is visible only to its owner; a public one is visible to
-- everybody, with no review while the product is in beta. Only the owner
-- writes to a prompt: anyone can create their own, nobody edits another
-- user's. When the beta ends, a review status is added in a later migration.
--
-- Public slugs are globally unique (first come, first served), so a slug
-- names one public prompt. Private slugs are unique per owner.
--
-- Only the service role touches the table, after the route proves ownership
-- (same pattern as user_tool_configs, migration 070). No foreign key to
-- auth.users: like every other user_id in this schema (migration 001), the
-- column is a bare uuid.

create table if not exists public.user_prompts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  body text not null check (char_length(body) between 1 and 20000),
  visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_prompts_owner_slug_unique unique (owner_id, slug)
);

create unique index if not exists user_prompts_public_slug_unique
  on public.user_prompts (slug)
  where visibility = 'public';

create index if not exists user_prompts_owner_created_idx
  on public.user_prompts (owner_id, created_at desc);

create index if not exists user_prompts_public_created_idx
  on public.user_prompts (created_at desc)
  where visibility = 'public';

create or replace function public.user_prompts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_prompts_touch_updated_at on public.user_prompts;
create trigger user_prompts_touch_updated_at
  before update on public.user_prompts
  for each row execute function public.user_prompts_touch_updated_at();

alter table public.user_prompts enable row level security;

-- Defense in depth (migration 066 pattern for service-role-only tables):
-- RLS with no policies already denies every session query, and the revoke
-- below also takes the table grants away from anon/authenticated.
-- service_role is not revoked.
revoke all on table public.user_prompts from anon, authenticated;
