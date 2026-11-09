-- ============================================================================
-- 053 — Rumble as a publishing provider.
-- schedules gets its per-provider account list (the default keeps existing
-- rows and every insert that predates the column valid), post_metrics and
-- social_accounts accept the new provider. Idempotent.
--
-- The social_accounts check is dropped and re-created with the full list
-- for the same reason as 037: the live constraint predates the current
-- migration chain, so a plain add would collide with it.
--
-- Numbering: 050 is Pinterest (merged, #513), 051 is retry publish per
-- account (#504) and 052 is 3Speak (#514), so this migration takes 053,
-- the next free number. The provider lists below include pinterest and
-- 3speak: 050/052 already added them to both checks, and this migration
-- re-creates them, so omitting one would drop the provider.
-- ============================================================================

alter table public.schedules
  add column if not exists rumble_account_ids text[] not null default '{}';

alter table public.post_metrics
  drop constraint if exists post_metrics_provider_check;

alter table public.post_metrics
  add constraint post_metrics_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble'));

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble'));
