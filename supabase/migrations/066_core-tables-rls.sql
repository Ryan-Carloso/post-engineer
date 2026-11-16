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
