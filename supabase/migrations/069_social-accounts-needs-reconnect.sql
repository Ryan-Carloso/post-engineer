-- social_accounts.needs_reconnect (issue #279).
-- A dead provider login is stored on the account so the next schedule
-- warns and the accounts page asks for a reconnect. The session JWT
-- stays SELECT-only (migration 066). This grant adds the new column to
-- that read set. Writes stay on the service client.

alter table public.social_accounts
  add column if not exists needs_reconnect boolean not null default false;

grant select (needs_reconnect) on table public.social_accounts to authenticated;
