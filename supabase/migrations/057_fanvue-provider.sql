-- ============================================================================
-- 057 — Fanvue as a publishing provider (issue #551).
-- schedules gets its per-provider account list (the default keeps existing
-- rows and every insert that predates the column valid), post_metrics and
-- social_accounts accept the new provider. Fanvue needs no board: a video
-- publishes to the account, so there is no pinterest_board_id equivalent.
-- Idempotent.
--
-- The provider checks are dropped and re-created with the full list for
-- the same reason as 037: the live constraint predates the current
-- migration chain, so a plain add would collide with it. The lists below
-- include every provider 053 already added; omitting one would drop the
-- provider.
--
-- oauth_states gains the PKCE code_verifier the fanvue-auth start route
-- stores for the MCP connect-url flow (the callback exchanges the code
-- with it). Nullable: the browser-popup OAuth flows never store one, and
-- pre-migration rows have none.
-- ============================================================================

alter table public.schedules
  add column if not exists fanvue_account_ids text[] not null default '{}';

alter table public.post_metrics
  drop constraint if exists post_metrics_provider_check;

alter table public.post_metrics
  add constraint post_metrics_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'));

alter table public.social_accounts
  drop constraint if exists social_accounts_provider_check;

alter table public.social_accounts
  add constraint social_accounts_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'));

alter table public.oauth_states
  add column if not exists code_verifier text;
