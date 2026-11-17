-- ============================================================================
-- Migration 066 — Least-privilege RLS on the 001 core tables (issue #464)
-- ----------------------------------------------------------------------------
-- WHY: 001 created the multi-tenant tables without row level security, and
-- the web app ships the Supabase anon key. A single owner policy "for"
-- every command, together with Supabase's default GRANT ALL to
-- authenticated, lets a logged-in user write billing columns through
-- PostgREST with their own JWT (tokens_balance, charged_tokens, status,
-- tokens_refunded).
--
-- Number 065 is the definer-function grants migration. This file is 066 so
-- the two can merge in either order. That migration also enables RLS on
-- mcp_oauth_clients; the same statements below are idempotent.
--
-- WHAT, from the session-client call sites in apps/web (service-role
-- callers bypass RLS and are unchanged):
--   * user_profiles — SELECT own row only. No insert, update, or delete.
--   * token_transactions — SELECT own ledger. Writes stay on RPCs and
--     the service client.
--   * personas — SELECT own rows. Insert, update, and delete run on the
--     service client after the route coerces language, face quality,
--     recent_image_ids, voice, and photo. A column grant of the columns
--     the session used to write would still let PostgREST skip that
--     coercion.
--   * schedules — SELECT own rows. DELETE is the service client: a
--     session delete of the schedule, its slots, and its generations
--     makes find_zombie_schedule_candidates refund the batch.
--   * scheduled_posts — SELECT own rows. No UPDATE and no DELETE.
--     A direct slot_at write publishes a ready slot as soon as it is
--     due, skipping PATCH /api/schedule/slots. Deletes are the service
--     client for the same zombie-refund reason.
--   * social_accounts — SELECT own rows, excluding encrypted_tokens.
--     No insert, update, or delete. Ciphertext and metadata writes are
--     the service client after the caller has authenticated.
--   * video_generations — SELECT own rows. DELETE is the service client.
--   * user_api_keys, stripe_webhook_events, mcp_oauth_clients, oauth_states,
--     engine_heartbeat — RLS on, no policies, revoke from anon and
--     authenticated. Service role only.
--
-- Grants assume Supabase's default GRANT ALL to anon/authenticated. REVOKE
-- ALL then re-grant the session columns. service_role is not revoked.
-- Idempotent: enable RLS is idempotent; policies are dropped and recreated;
-- role creation is skipped when the Supabase roles already exist.
--
-- Persona-image session writes still lock public.personas. PostgreSQL
-- requires UPDATE privilege for SELECT ... FOR UPDATE, and an UPDATE
-- policy must pass for the locked row. authenticated has SELECT only, so
-- the invoker trigger enforce_persona_image_limit (fired by a session
-- insert into persona_images) and set_primary_persona_image (the browser
-- RPC) both fail with 42501. This migration recreates both as security
-- definer with search_path pinned to public. The RPC body is 065's: the
-- JWT subject wins over p_user_id. EXECUTE stays with authenticated and
-- service_role, and stays revoked from anon and public.
-- record_persona_image_use also updates personas, but authenticated
-- cannot execute it (065) and its only caller uses the service client,
-- which bypasses RLS. The scheduler-lease functions are invoker and
-- service-role only; they do not touch these tables.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- user_profiles: read own row. Balances and stripe_customer_id are not writable.
alter table public.user_profiles enable row level security;
drop policy if exists user_profiles_owner_all on public.user_profiles;
drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles
  for select to authenticated
  using (auth.uid() = id);
revoke all on table public.user_profiles from anon, authenticated;
grant select on table public.user_profiles to authenticated;

-- personas: session reads. Writes are the service client after coercion.
alter table public.personas enable row level security;
drop policy if exists personas_owner_all on public.personas;
drop policy if exists personas_select_own on public.personas;
drop policy if exists personas_insert_own on public.personas;
drop policy if exists personas_update_own on public.personas;
drop policy if exists personas_delete_own on public.personas;
create policy personas_select_own on public.personas
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.personas from anon, authenticated;
grant select on table public.personas to authenticated;

-- schedules: session reads. Deletes are the service client.
alter table public.schedules enable row level security;
drop policy if exists schedules_owner_all on public.schedules;
drop policy if exists schedules_select_own on public.schedules;
drop policy if exists schedules_delete_own on public.schedules;
create policy schedules_select_own on public.schedules
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.schedules from anon, authenticated;
grant select on table public.schedules to authenticated;

-- scheduled_posts: session reads only. Title, slot_at, and deletes are
-- the service client. A direct slot_at write skips the schedule window.
alter table public.scheduled_posts enable row level security;
drop policy if exists scheduled_posts_owner_all on public.scheduled_posts;
drop policy if exists scheduled_posts_select_own on public.scheduled_posts;
drop policy if exists scheduled_posts_update_own on public.scheduled_posts;
drop policy if exists scheduled_posts_delete_own on public.scheduled_posts;
create policy scheduled_posts_select_own on public.scheduled_posts
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.scheduled_posts from anon, authenticated;
grant select on table public.scheduled_posts to authenticated;

-- social_accounts: session reads the public columns. Ciphertext is neither
-- readable nor writable with a user JWT.
alter table public.social_accounts enable row level security;
drop policy if exists social_accounts_owner_all on public.social_accounts;
drop policy if exists social_accounts_select_own on public.social_accounts;
drop policy if exists social_accounts_insert_own on public.social_accounts;
drop policy if exists social_accounts_update_own on public.social_accounts;
drop policy if exists social_accounts_delete_own on public.social_accounts;
create policy social_accounts_select_own on public.social_accounts
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.social_accounts from anon, authenticated;
grant select (
  id,
  user_id,
  provider,
  provider_account_id,
  account_name,
  account_metadata,
  token_expires_at,
  created_at,
  updated_at,
  last_used_at
) on table public.social_accounts to authenticated;

-- video_generations: session reads. Deletes are the service client.
alter table public.video_generations enable row level security;
drop policy if exists video_generations_owner_all on public.video_generations;
drop policy if exists video_generations_select_own on public.video_generations;
drop policy if exists video_generations_delete_own on public.video_generations;
create policy video_generations_select_own on public.video_generations
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.video_generations from anon, authenticated;
grant select on table public.video_generations to authenticated;

-- token_transactions: owner read of the ledger. No session writes.
alter table public.token_transactions enable row level security;
drop policy if exists token_transactions_select_own on public.token_transactions;
create policy token_transactions_select_own on public.token_transactions
  for select to authenticated
  using (auth.uid() = user_id);
revoke all on table public.token_transactions from anon, authenticated;
grant select on table public.token_transactions to authenticated;

-- Service-role-only tables: RLS on, no policies, revoke the browser roles.
alter table public.user_api_keys enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.oauth_states enable row level security;
alter table public.engine_heartbeat enable row level security;

revoke all on table public.user_api_keys from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;
revoke all on table public.mcp_oauth_clients from anon, authenticated;
revoke all on table public.oauth_states from anon, authenticated;
revoke all on table public.engine_heartbeat from anon, authenticated;

-- Session inserts into persona_images fire this trigger. The body matches
-- 002. security definer lets the lock take the parent persona row, which
-- authenticated can only select. The insert itself is still gated by
-- persona_images RLS, so the locked persona_id is one the caller owns.
create or replace function public.enforce_persona_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lock the parent persona row: concurrent inserts for the same persona
  -- serialize here instead of racing on the count below.
  -- NOTE: the limit literal below mirrors MAX_PERSONA_IMAGES in
  -- apps/web/lib/persona-images.ts. SQL has no import of that constant, so
  -- keep the two in sync manually when the limit ever changes.
  perform 1 from public.personas where id = new.persona_id for update;
  if (select count(*) from public.persona_images where persona_id = new.persona_id) > 10 then
    -- Stable SQLSTATE (not the English message): the app maps PEL01 to a
    -- 400 "library full" instead of a generic 500. Keep the code in sync
    -- with PERSONA_IMAGE_LIMIT_SQLSTATE in apps/web/lib/persona-images.ts.
    raise exception 'persona image library is limited to 10 images' using errcode = 'PEL01';
  end if;
  return new;
end;
$$;

-- Browser RPC. Body matches 065: auth.uid() wins over p_user_id, so a
-- JWT cannot pass another user's id and move that user's primary image.
-- security definer is what makes the persona lock succeed once
-- authenticated no longer has UPDATE on public.personas.
create or replace function public.set_primary_persona_image(p_persona_id uuid, p_image_id uuid, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize concurrent swaps on the parent row. The explicit user_id
  -- guard keeps the lock scoped to the caller's own persona. As above,
  -- the JWT subject wins over a spoofed p_user_id.
  perform 1 from public.personas
  where id = p_persona_id
    and user_id = coalesce(auth.uid(), p_user_id)
  for update;
  -- Enforcing, not advisory: without the raise below, a service-role caller
  -- with a wrong/omitted p_user_id would fall through to the persona_id-scoped
  -- UPDATEs and corrupt another tenant's rows. (Session/JWT callers are
  -- additionally contained by RLS.)
  if not found then
    raise exception 'persona % not found for caller', p_persona_id using errcode = 'P0002';
  end if;
  update public.persona_images
  set is_primary = false
  where persona_id = p_persona_id and is_primary;
  update public.persona_images
  set is_primary = true
  where id = p_image_id and persona_id = p_persona_id;
  if not found then
    -- P0002 (no_data_found) lets the app distinguish "the image row
    -- vanished between the route's ownership pre-check and this swap"
    -- (a 404) from a genuine failure (a 500). The exception rolls back
    -- the demote above too.
    raise exception 'image % does not belong to persona %', p_image_id, p_persona_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_primary_persona_image(uuid, uuid, uuid) from public;
revoke execute on function public.set_primary_persona_image(uuid, uuid, uuid) from anon;
grant execute on function public.set_primary_persona_image(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_primary_persona_image(uuid, uuid, uuid) to service_role;
