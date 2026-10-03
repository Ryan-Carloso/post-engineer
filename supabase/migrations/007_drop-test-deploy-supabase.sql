-- 007_drop-test-deploy-supabase.sql
--
-- Drops the throwaway table created by 006_test-deploy-supabase.sql,
-- concluding the live pipeline test.
--
-- Migrations are append-only: 006 stays in the repo and in the migration
-- history forever; 007 reverses its effect. Never delete an applied
-- migration file — a fresh database would lose the audit trail.

drop table if exists public.test_deploy_supabase;
