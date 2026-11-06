-- ============================================================================
-- 036 — Threads in the social_accounts provider check.
--
-- GET /api/threads-auth/callback upserts provider='threads' into
-- social_accounts, but production rejected the insert: the live
-- database carries a social_accounts_provider_check constraint that
-- no versioned migration ever created (drift — it holds only the
-- four pre-Threads providers), while 034 added 'threads' only to the
-- post_metrics check. Drop and re-add the constraint with the full
-- provider list; a no-op on databases that never had the drifted
-- constraint. Idempotent.
-- ============================================================================

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads'));
