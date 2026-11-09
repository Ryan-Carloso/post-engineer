-- 051: per-account publish outcomes (issue #500).
--
-- One row per (provider, account, video) so a kill mid-publish keeps the
-- accounts that already went live, and a later tick retries only the rest.
-- User-account failures (unverified email, expired token, missing credential,
-- disconnected) are terminal on the first try and carry the notice the web
-- and MCP show the user. Transient failures keep status "retrying" until
-- three tries are spent (30s, then 2min). The slot stays "publishing" while
-- any account is still retrying; publish_not_before is the next wake-up.

alter table public.scheduled_posts
  add column if not exists publish_outcomes jsonb not null default '[]'::jsonb;
