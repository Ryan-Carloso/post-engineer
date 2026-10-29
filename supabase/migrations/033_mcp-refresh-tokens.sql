-- 033: MCP OAuth refresh-token allowlist + rotation RPCs.
--
-- WHY: apps/web/app/oauth/token/route.ts registers every issued
-- refresh token and rotates it on every use, failing closed (500)
-- when registration fails — but no versioned migration ever created
-- the objects it calls. The route comment cited "migration 0026",
-- yet 026 is the post-metrics-dimensions migration and contains no
-- refresh-token object, and a repo-wide grep finds zero "refresh"
-- hits in any versioned migration. Either the RPCs were created
-- outside migrations (against the repo rule: versioned migrations
-- only, applied by the pipeline) or the offline_access flow fails
-- closed with 500 in production today. This migration ends that
-- ambiguity either way: the objects now exist in the versioned
-- chain, and re-applying is safe wherever they already exist.
--
-- WHAT:
--   1. public.mcp_oauth_refresh_tokens — the allowlist. One row per
--      issued refresh token, identifier only (jti); the token value
--      itself is never stored (tokens are self-contained ES256 JWTs,
--      see apps/web/lib/oauth/tokens.ts). consumed_at marks a rotated
--      token; a row with consumed_at set can never rotate again.
--   2. register_mcp_refresh_token — inserts a fresh jti; a
--      re-registration of the same jti is a no-op, never an error,
--      so a retried grant cannot fail on its own duplicate.
--   3. rotate_mcp_refresh_token — consumes the presented jti and
--      registers its replacement in one function call. The consume
--      UPDATE re-checks unconsumed and unexpired in its predicate,
--      so concurrent replays serialize on the row and all but one
--      see zero rows and get false (the route maps false to
--      invalid_grant). The presented jti must also belong to the
--      calling user and client; a mismatch is treated exactly like
--      an unknown jti (false, never an error leak).
--
-- IDEMPOTENCY: create table if not exists, create or replace for
-- both functions, and guarded column backfills — if an environment
-- already carries this table from an out-of-band creation, applying
-- this file adds any missing column without dropping a row. Backfilled
-- columns are added nullable on purpose: a NOT NULL add without a
-- default aborts on a populated table, which would break exactly the
-- out-of-band-with-rows case this backfill exists for. Rows predating
-- a backfilled column carry NULL there and fail the rotate predicate
-- with invalid_grant (fail closed) until re-registered. The functions
-- are replaced, never dropped, so existing allowlist rows survive.
-- No data is deleted anywhere in this file.
--
-- TRUST BOUNDARY: the table has RLS enabled and deliberately no
-- policy at all (mirrors scheduler_leases, 027): only the two
-- service-role RPCs below may read or write it. The RPCs follow the
-- repo convention (004/017/025): security definer with a pinned
-- search_path, revoked from public/anon/authenticated (Supabase
-- default-privileges new functions to anon/authenticated, so
-- revoking PUBLIC alone is not enough), granted to service_role
-- only. The grants are guarded: vanilla Postgres in CI has none of
-- these roles.

create table if not exists public.mcp_oauth_refresh_tokens (
  jti text not null primary key,
  user_id uuid not null,
  client_id text not null,
  resource text not null,
  scope text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Backfill any column missing from an out-of-band pre-existing table.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'user_id'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column user_id uuid';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'client_id'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column client_id text';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'resource'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column resource text';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'scope'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column scope text';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'expires_at'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column expires_at timestamptz';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'consumed_at'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column consumed_at timestamptz';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mcp_oauth_refresh_tokens'
      and column_name = 'created_at'
  ) then
    execute 'alter table public.mcp_oauth_refresh_tokens add column created_at timestamptz not null default now()';
  end if;
end $$;

alter table public.mcp_oauth_refresh_tokens enable row level security;

create or replace function public.register_mcp_refresh_token(
  p_jti text,
  p_user_id uuid,
  p_client_id text,
  p_resource text,
  p_scope text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mcp_oauth_refresh_tokens (jti, user_id, client_id, resource, scope, expires_at)
  values (p_jti, p_user_id, p_client_id, p_resource, p_scope, p_expires_at)
  on conflict (jti) do nothing;
$$;

create or replace function public.rotate_mcp_refresh_token(
  p_old_jti text,
  p_new_jti text,
  p_user_id uuid,
  p_client_id text,
  p_resource text,
  p_scope text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Consume exactly once: the predicate re-checks ownership,
  -- unconsumed state and expiry, so a replay, an expired token, or
  -- a jti belonging to another user/client updates zero rows.
  update public.mcp_oauth_refresh_tokens
  set consumed_at = now()
  where jti = p_old_jti
    and user_id = p_user_id
    and client_id = p_client_id
    and consumed_at is null
    and expires_at > now();
  if not found then
    return false;
  end if;
  insert into public.mcp_oauth_refresh_tokens (jti, user_id, client_id, resource, scope, expires_at)
  values (p_new_jti, p_user_id, p_client_id, p_resource, p_scope, p_expires_at)
  on conflict (jti) do nothing;
  return true;
end;
$$;

-- Trust boundary: revoked from public/anon/authenticated, granted to
-- service_role only. Guarded: vanilla Postgres in CI has none of
-- these roles.
do $$
begin
  revoke execute on function public.register_mcp_refresh_token(text, uuid, text, text, text, timestamptz) from public;
  revoke execute on function public.rotate_mcp_refresh_token(text, text, uuid, text, text, text, timestamptz) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.register_mcp_refresh_token(text, uuid, text, text, text, timestamptz) from anon;
    revoke execute on function public.rotate_mcp_refresh_token(text, text, uuid, text, text, text, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.register_mcp_refresh_token(text, uuid, text, text, text, timestamptz) from authenticated;
    revoke execute on function public.rotate_mcp_refresh_token(text, text, uuid, text, text, text, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.register_mcp_refresh_token(text, uuid, text, text, text, timestamptz) to service_role;
    grant execute on function public.rotate_mcp_refresh_token(text, text, uuid, text, text, text, timestamptz) to service_role;
  end if;
end $$;
