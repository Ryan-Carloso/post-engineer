-- ============================================================================
-- 037 — social_accounts accepts the threads provider.
-- Production carries a `social_accounts_provider_check` constraint that was
-- created by hand (001_schema.sql defines none), so it never listed
-- 'threads' and every Threads connect failed at the upsert with a check
-- violation. Own the constraint in the migration chain from now on: drop
-- whatever is there and recreate it from the provider list the code
-- accepts (SOCIAL_PROVIDERS). Idempotent.
-- ============================================================================

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads'));
