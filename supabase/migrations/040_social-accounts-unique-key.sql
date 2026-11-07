-- ============================================================================
-- 040 — Unique key for the social_accounts upsert target.
--
-- upsertSocialAccount (apps/web/lib/social-accounts.ts) upserts with
-- onConflict: 'user_id,provider,provider_account_id', which PostgREST
-- turns into ON CONFLICT (user_id, provider, provider_account_id).
-- Postgres refuses to plan that statement without a unique constraint
-- or unique index on exactly those columns (42P10), even when zero rows
-- conflict — and no migration ever created one, so any database built
-- from the migration chain (CI's ephemeral Postgres, a fresh deploy)
-- fails every social-account connect at the upsert.
-- Idempotent.
-- ============================================================================

alter table public.social_accounts
  drop constraint if exists social_accounts_user_provider_account_key;

alter table public.social_accounts
  add constraint social_accounts_user_provider_account_key
  unique (user_id, provider, provider_account_id);
