-- ============================================================================
-- Migration 024 — Display name for per-user cloned voices
-- ----------------------------------------------------------------------------
-- WHY: The voice picker listed clones by language only, which is
-- indistinguishable once a user owns two clones in the same language.
-- Clones now carry an optional user-chosen display name.
--
-- WHAT: adds a nullable `name` column to cloned_voices. Existing rows
-- stay NULL and the UI falls back to the language label.
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================================================

alter table public.cloned_voices
  add column if not exists name text;
