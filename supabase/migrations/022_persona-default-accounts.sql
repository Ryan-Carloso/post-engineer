-- ============================================================================
-- Migration 022 — Per-persona default publishing accounts
-- ----------------------------------------------------------------------------
-- WHY: social accounts belong to the USER (social_accounts.user_id); there is
-- no persona→account mapping. Every generate-and-schedule call must pass
-- explicit publishing.accounts IDs or it 400s. Automated flows (CI
-- test-flight, agents, scheduled jobs) then either blast ALL of the user's
-- accounts or carry account IDs on every call. Users think in terms of
-- "this persona posts to these accounts" (issue #212).
--
-- WHAT: persona_default_accounts stores each persona's default publishing
-- accounts per provider. generate-and-schedule falls back to them when
-- publishing.accounts is omitted; explicit accounts always win.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded policies everywhere).
-- ============================================================================

create table if not exists public.persona_default_accounts (
  persona_id uuid not null references public.personas(id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  created_at timestamptz not null default now(),
  primary key (persona_id, provider, provider_account_id)
);

-- The API resolves a persona's defaults per provider on every generation
-- without explicit accounts; the covering index keeps that lookup cheap.
create index if not exists persona_default_accounts_persona_provider_idx
  on public.persona_default_accounts (persona_id, provider);

-- RLS: owner-only, mirroring public.persona_images (migration 002). The
-- policy verifies the referenced persona itself belongs to the caller, so a
-- forged persona_id can never attach defaults to someone else's persona.
-- (The app's server paths use the service-role key and re-check ownership
-- in code; the policy protects anon-key / direct-DB access.)
alter table public.persona_default_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'persona_default_accounts'
      and policyname = 'persona_default_accounts_owner_all'
  ) then
    create policy "persona_default_accounts_owner_all"
      on public.persona_default_accounts
      for all
      using (
        exists (
          select 1 from public.personas p
          where p.id = persona_default_accounts.persona_id
            and p.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.personas p
          where p.id = persona_default_accounts.persona_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end $$;
