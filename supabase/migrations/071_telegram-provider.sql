-- ============================================================================
-- 071 — Telegram as a publishing provider.
-- One provider covers both destinations: a channel and a group/supergroup
-- are the same Bot API publish (sendVideo/sendPhoto/sendAudio on a chat_id);
-- the destination kind lives in social_accounts.account_metadata.chatType
-- ('channel' | 'group' | 'supergroup'), never in the provider value, so a
-- group upgraded to a supergroup keeps its account. schedules gets its
-- per-provider account list (the default keeps existing rows and every
-- insert that predates the column valid), post_metrics and social_accounts
-- accept the new provider. Idempotent.
--
-- The provider checks are dropped and re-created with the full list for
-- the same reason as 037: the live constraint predates the current
-- migration chain, so a plain add would collide with it. The lists below
-- include every provider 057 already added; omitting one would drop the
-- provider.
-- ============================================================================

alter table public.schedules
  add column if not exists telegram_account_ids text[] not null default '{}';

alter table public.post_metrics
  drop constraint if exists post_metrics_provider_check;
alter table public.post_metrics
  add constraint post_metrics_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue', 'telegram'));

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;
alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue', 'telegram'));
