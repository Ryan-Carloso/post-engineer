-- 004_pipeline-smoke-test.sql
--
-- Smoke test for the automated migration pipeline (PR #65).
-- Proves the end-to-end flow: PR validation (CI supabase-migrations job)
-- -> merge to main -> deploy.yml `supabase db push` -> applied on production.
--
-- Creates a throwaway table; follow-up migration 005 drops it after the
-- pipeline is verified in production. Safe to apply more than once:
-- every statement is guarded by IF NOT EXISTS.

create table if not exists public._pipeline_smoke_test (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  note text
);

-- New tables ship with RLS enabled (deny-by-default). No policies are
-- granted, so the table is inaccessible until an explicit policy exists.
alter table public._pipeline_smoke_test enable row level security;

comment on table public._pipeline_smoke_test is
  'Smoke test for the automated migration pipeline. Dropped by 005 after verification.';
