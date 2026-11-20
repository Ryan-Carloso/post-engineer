-- user_prompts: prompts written by users, private by default.
-- A prompt is visible to its owner in every status and to everybody only
-- while status = 'approved'. Publishing is a manual review: the owner asks
-- (private/rejected -> pending), a reviewer approves or rejects.
--
-- content_hash is the sha256 of title, description and body, filled by the
-- trigger below. The reviewer approves exactly the hash they read, so an edit
-- that lands between reading and approving cannot be approved by accident.
-- An edit to an approved prompt sends it back to pending in the same trigger,
-- so no write path (route, SQL editor) can leave changed text public.
--
-- Only the service role touches the table, after the route proves ownership
-- or reviewer rights (same pattern as user_tool_configs, migration 070).
-- No foreign key to auth.users: like every other user_id in this schema
-- (migration 001), the column is a bare uuid.

create table if not exists public.user_prompts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  body text not null check (char_length(body) between 1 and 20000),
  status text not null default 'private'
    check (status in ('private', 'pending', 'approved', 'rejected')),
  content_hash text not null default '',
  approved_hash text,
  rejection_reason text check (char_length(rejection_reason) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_prompts_owner_slug_unique unique (owner_id, slug),
  constraint user_prompts_approved_iff_hash
    check ((status = 'approved') = (approved_hash is not null)),
  constraint user_prompts_decision_has_reviewer
    check (status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null)),
  constraint user_prompts_rejected_has_reason
    check (status <> 'rejected' or rejection_reason is not null)
);

create unique index if not exists user_prompts_approved_slug_unique
  on public.user_prompts (slug)
  where status = 'approved';

create index if not exists user_prompts_owner_created_idx
  on public.user_prompts (owner_id, created_at desc);

create index if not exists user_prompts_pending_created_idx
  on public.user_prompts (created_at)
  where status = 'pending';

create or replace function public.user_prompts_before_write()
returns trigger
language plpgsql
as $$
begin
  new.content_hash := encode(
    sha256(convert_to(
      length(new.title)::text || ':' || new.title || E'\n' ||
      length(new.description)::text || ':' || new.description || E'\n' ||
      length(new.body)::text || ':' || new.body,
      'UTF8'
    )),
    'hex'
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status = 'approved'
       and old.status = 'approved'
       and new.content_hash is distinct from old.content_hash then
      new.status := 'pending';
      new.approved_hash := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_prompts_before_write on public.user_prompts;
create trigger user_prompts_before_write
  before insert or update on public.user_prompts
  for each row execute function public.user_prompts_before_write();

alter table public.user_prompts enable row level security;

-- Defense in depth (migration 066 pattern for service-role-only tables):
-- RLS with no policies already denies every session query, and the revoke
-- below also takes the table grants away from anon/authenticated.
-- service_role is not revoked.
revoke all on table public.user_prompts from anon, authenticated;
