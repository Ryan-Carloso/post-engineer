-- user_tool_configs (issue #669): per-user research/stock tool configuration.
-- One row per user: which search tool (tavily/exa) and which licensed stock
-- sources (pexels/pixabay/coverr) the user has keys for, plus the keys
-- themselves in one AES-256-GCM blob (lib/token-crypto.ts, the same infra as
-- social_accounts.encrypted_tokens). RLS on, no policies: only the service
-- role touches the table, after the route proves ownership. The session JWT
-- gets no SELECT on it, so ciphertext never reaches PostgREST.
-- No foreign key to auth.users: like every other user_id in this schema
-- (migration 001), the column is a bare uuid — the auth schema on a
-- migrated database has no users table to reference.

create table if not exists public.user_tool_configs (
  user_id uuid primary key,
  search_tool text check (search_tool in ('tavily', 'exa')),
  stock_sources text[] not null default '{}',
  encrypted_keys text,
  updated_at timestamptz not null default now(),
  check (stock_sources <@ array['pexels', 'pixabay', 'coverr']::text[])
);

alter table public.user_tool_configs enable row level security;

-- Defense in depth (migration 066 pattern for service-role-only tables):
-- RLS with no policies already denies every session query, and the revoke
-- below also takes the table grants away from anon/authenticated.
-- service_role is not revoked.
revoke all on table public.user_tool_configs from anon, authenticated;
