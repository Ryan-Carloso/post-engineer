-- ============================================================================
-- Migration 065 — Row level security on the 001 core tables (issue #464)
-- ----------------------------------------------------------------------------
-- WHY: supabase/migrations/001_schema.sql created the multi-tenant tables
-- (user_profiles, personas, schedules, scheduled_posts, social_accounts,
-- video_generations, token_transactions, user_api_keys,
-- stripe_webhook_events, mcp_oauth_clients, oauth_states) and migration 020
-- added engine_heartbeat, but no migration ever enabled row level security
-- on them. The web app ships the Supabase anon key to the browser, so
-- without RLS anyone holding the anon key can read/write these tables
-- directly via PostgREST. Later tables (002, 010, 014, 022, 023, 025, 027,
-- 033, 041, 059, 060, 061) already enable RLS at creation.
--
-- WHAT: enable RLS on each of those tables, then:
--   * Owner tables get an owner policy for exactly the operations the
--     user-JWT client performs (select/insert/update/delete where
--     user_id = auth.uid(); user_profiles is keyed on id = auth.uid()).
--     The app's server paths mostly use the service-role client and
--     re-check ownership in code (which keeps working: service_role
--     bypasses RLS); these policies protect direct anon-key / user-JWT
--     access without changing any service-role behaviour.
--   * token_transactions gets a select-only owner policy: users read their
--     own ledger (GET /api/billing/transactions), while every write goes
--     through SECURITY DEFINER RPCs or the service role.
--   * user_api_keys, stripe_webhook_events, mcp_oauth_clients,
--     oauth_states and engine_heartbeat get RLS with no policies plus a
--     guarded revoke from anon/authenticated: only the service role
--     touches them (key hashes, webhook idempotency, OAuth state,
--     single-row heartbeat), so RLS alone already denies anon/authenticated.
--
-- Idempotent: safe to re-run (alter table enable is idempotent; policies
-- and revokes are pg_policies / pg_roles guarded).
-- ============================================================================

-- Owner tables: full CRUD on own rows. ------------------------------------

alter table public.user_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
      and policyname = 'user_profiles_owner_all'
  ) then
    create policy user_profiles_owner_all on public.user_profiles
      for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;

alter table public.personas enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'personas'
      and policyname = 'personas_owner_all'
  ) then
    create policy personas_owner_all on public.personas
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

alter table public.schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schedules'
      and policyname = 'schedules_owner_all'
  ) then
    create policy schedules_owner_all on public.schedules
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

alter table public.scheduled_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scheduled_posts'
      and policyname = 'scheduled_posts_owner_all'
  ) then
    create policy scheduled_posts_owner_all on public.scheduled_posts
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

alter table public.social_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'social_accounts'
      and policyname = 'social_accounts_owner_all'
  ) then
    create policy social_accounts_owner_all on public.social_accounts
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

alter table public.video_generations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'video_generations'
      and policyname = 'video_generations_owner_all'
  ) then
    create policy video_generations_owner_all on public.video_generations
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- token_transactions: owner read-only (writes via RPC/service role). -------

alter table public.token_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'token_transactions'
      and policyname = 'token_transactions_select_own'
  ) then
    create policy token_transactions_select_own on public.token_transactions
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- Service-role-only tables: RLS on, no policies, guarded revoke. ----------

alter table public.user_api_keys enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.oauth_states enable row level security;
alter table public.engine_heartbeat enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.user_api_keys from anon;
    revoke all on public.stripe_webhook_events from anon;
    revoke all on public.mcp_oauth_clients from anon;
    revoke all on public.oauth_states from anon;
    revoke all on public.engine_heartbeat from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.user_api_keys from authenticated;
    revoke all on public.stripe_webhook_events from authenticated;
    revoke all on public.mcp_oauth_clients from authenticated;
    revoke all on public.oauth_states from authenticated;
    revoke all on public.engine_heartbeat from authenticated;
  end if;
end $$;
