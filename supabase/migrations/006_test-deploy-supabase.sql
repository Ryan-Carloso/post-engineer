-- 006_test-deploy-supabase.sql
--
-- Live end-to-end test of the automated migration pipeline (PR #65).
-- Proves that a new migration merged to main is actually applied to
-- production by deploy.yml's `supabase db push` (previous deploy runs
-- only reported "Remote database is up to date").
--
-- Creates a throwaway table; follow-up migration 007 will drop it after
-- verification in production. Safe to apply more than once: every
-- statement is guarded by IF NOT EXISTS.

create table if not exists public.test_deploy_supabase (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  note text
);

-- New tables ship with RLS enabled (deny-by-default). No policies are
-- granted, so the table is inaccessible until an explicit policy exists.
alter table public.test_deploy_supabase enable row level security;

comment on table public.test_deploy_supabase is
  'Pipeline live test. Dropped by 007 after verification.';
