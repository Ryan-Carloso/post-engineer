-- ============================================================================
-- Migration 023 — Per-user Chatterbox cloned voices (TRUE cloning foundation)
-- ----------------------------------------------------------------------------
-- WHY: Users record or upload reference audio; the engine registers a dedicated
-- Chatterbox voice per owner and exposes it only in that user's voice catalog.
-- Personas store the provider-qualified id (chatterbox:<engine_voice_key>).
--
-- WHAT: cloned_voices tracks async registration (pending → ready | failed),
-- consent timestamp, private storage path, engine voice key, language, and a
-- stable error_code for UI/analytics (never raw provider errors).
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded policies).
-- ============================================================================

create table if not exists public.cloned_voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed')),
  consent_at timestamptz not null,
  storage_path text not null,
  engine_voice_key text not null,
  language text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cloned_voices_user_voice_key_unique unique (user_id, engine_voice_key)
);

create index if not exists cloned_voices_user_id_status_idx
  on public.cloned_voices (user_id, status);

-- RLS: owner-only. Service-role engine routes filter by user_id explicitly.
alter table public.cloned_voices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cloned_voices'
      and policyname = 'cloned_voices_owner_all'
  ) then
    create policy "cloned_voices_owner_all"
      on public.cloned_voices
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;
