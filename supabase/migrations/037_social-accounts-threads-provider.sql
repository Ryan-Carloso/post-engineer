-- ============================================================================
-- 037 — Threads in the social_accounts provider check.
--
-- GET /api/threads-auth/callback upserts provider='threads' into
-- social_accounts, but production rejected the insert: the live
-- database carries a social_accounts_provider_check constraint
-- created by versioned migrations 0015/0016, which the b4037cff
-- consolidation deleted — so the current versioned chain never
-- creates it (it still holds only the four pre-Threads providers),
-- while 034 added 'threads' only to the post_metrics check. Drop
-- and re-add the constraint with the full provider list; on
-- databases built from the current versioned chain (which never
-- creates the check) the drop is a no-op and the add introduces it
-- for the first time. Idempotent.
-- ============================================================================

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads'));
