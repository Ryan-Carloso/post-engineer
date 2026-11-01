-- ============================================================================
-- 034 — Threads as a publishing provider.
-- schedules gets its per-provider account list (the default keeps existing
-- rows and every insert that predates the column valid) and post_metrics
-- accepts the new provider. Idempotent.
-- ============================================================================

alter table public.schedules
  add column if not exists threads_account_ids text[] not null default '{}';

alter table public.post_metrics
  drop constraint if exists post_metrics_provider_check;

alter table public.post_metrics
  add constraint post_metrics_provider_check
  check (provider in ('youtube', 'instagram', 'bluesky', 'linkedin', 'threads'));
