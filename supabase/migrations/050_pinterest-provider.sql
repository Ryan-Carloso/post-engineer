-- ============================================================================
-- 050 — Pinterest as a publishing provider.
-- schedules gets its per-provider account list and the board a schedule
-- publishes its pins to (one board per schedule; the default keeps existing
-- rows and every insert that predates the columns valid), post_metrics and
-- social_accounts accept the new provider. Idempotent.
--
-- The social_accounts check is dropped and re-created with the full list
-- for the same reason as 037: the live constraint predates the current
-- migration chain, so a plain add would collide with it.
-- ============================================================================

alter table public.schedules
  add column if not exists pinterest_account_ids text[] not null default '{}';

alter table public.schedules
  add column if not exists pinterest_board_id text;

alter table public.post_metrics
  drop constraint if exists post_metrics_provider_check;

alter table public.post_metrics
  add constraint post_metrics_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest'));

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest'));
