-- ============================================================================
-- Post Engineer — Supabase schema snapshot
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run.
-- Safe to re-run (all statements are idempotent).
--
-- SOURCE: generated from a read-only introspection of the production
-- PostgREST OpenAPI schema (2026-10-02). It captures tables, columns,
-- types, defaults and NOT NULL constraints.
--
-- WHAT THIS DOES NOT CAPTURE (PostgREST does not expose them read-only):
--   * Row Level Security policies — enable RLS and recreate the policies
--     from your Supabase dashboard (Table editor > Policies) if you need
--     anon-key access. The app's server paths use the service-role key
--     and re-check ownership in code.
--   * Foreign-key constraints, CHECK constraints, indexes and triggers,
--     except where noted. Probable relationships are listed in section 4
--     for you to verify in the dashboard before adding.
--   * RPC function bodies — section 5 lists the function names the app
--     calls; copy their definitions from the dashboard (Database >
--     Functions) or from the per-feature migration files below.
--   * Storage buckets — create a PRIVATE bucket named `personas`
--     (used for persona photos/voices; IMAGE_BUCKET in apps/web).
--
-- PER-FEATURE MIGRATIONS (authoritative for their tables — apply after
-- this file; they are idempotent and add the constraints/indexes/RLS
-- this snapshot cannot see):
--   * supabase/persona-images.sql    — persona_images constraints, trigger
--   * supabase/engine-task-state.sql — engine_task_state (engine task state)
-- ============================================================================

-- 1. Enum types
do $$
begin
  if not exists (select 1 from pg_type where typname = 'face_quality') then
    create type public.face_quality as enum ('ok', 'very_good');
  end if;
end
$$;

-- 2. Tables (alphabetical within dependency groups)
create table if not exists public.user_profiles (
  id uuid not null primary key,
  stripe_customer_id text,
  tokens_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  free_tokens_balance numeric not null default 0
);

create table if not exists public.personas (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  photo_path text,
  avatar_url text,
  voice_id text,
  voice_audio_path text,
  created_at timestamptz not null default now(),
  language text,
  video_aspect text,
  script_prompt text,
  paragraph_number integer,
  niche text,
  face_mix_percent integer,
  face_quality public.face_quality,
  recent_image_ids uuid[] not null default '{}'
);

create table if not exists public.persona_images (
  id uuid not null default gen_random_uuid() primary key,
  persona_id uuid not null,
  user_id uuid not null,
  image_path text not null,
  tag text not null default '',
  description text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  persona_id uuid not null,
  providers text[] not null,
  days_of_week integer[],
  start_hour integer,
  end_hour integer,
  posts_per_day integer not null default 1,
  timezone text not null default 'UTC',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  youtube_account_ids text[] not null,
  instagram_account_ids text[] not null,
  times text[] not null,
  linkedin_account_ids text[] not null,
  scheduled_at timestamptz,
  bluesky_account_ids text[] not null
);

create table if not exists public.scheduled_posts (
  id uuid not null default gen_random_uuid() primary key,
  schedule_id uuid not null,
  user_id uuid not null,
  slot_at timestamptz not null,
  status text not null default 'pending',
  topic text,
  task_id text,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_accounts (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  provider text not null,
  provider_account_id text not null,
  account_name text,
  account_metadata jsonb not null,
  encrypted_tokens text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.video_generations (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  generation_id text not null,
  engine_task_id text,
  persona_id uuid,
  persona_name text,
  video_subject text,
  status text not null default 'pending',
  error_code text,
  error_message text,
  tokens_refunded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.token_transactions (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  amount numeric not null,
  type text not null,
  description text,
  reference_id text,
  created_at timestamptz not null default now(),
  reason text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  generation_id text,
  free_amount numeric,
  engine_task_id text
);

create table if not exists public.user_api_keys (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  persona_ids uuid[]
);

create table if not exists public.stripe_webhook_events (
  event_id text not null primary key,
  event_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_clients (
  client_id text not null primary key,
  client_name text not null default 'MCP client',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_states (
  state_hash text not null primary key,
  user_id uuid not null,
  provider text not null,
  nonce text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + '00:15:00'::interval)
);
-- 4. Probable foreign-key relationships (NOT introspectable read-only).
-- Verify each one in the dashboard (Table editor) before adding, e.g.:
--
--   alter table public.personas
--     add constraint fk_personas_user foreign key (user_id)
--     references auth.users (id) on delete cascade;
--   alter table public.persona_images
--     add constraint fk_persona_images_persona foreign key (persona_id)
--     references public.personas (id) on delete cascade;
--   alter table public.schedules
--     add constraint fk_schedules_persona foreign key (persona_id)
--     references public.personas (id) on delete cascade;
--   alter table public.scheduled_posts
--     add constraint fk_scheduled_posts_schedule foreign key (schedule_id)
--     references public.schedules (id) on delete cascade;
--   alter table public.video_generations
--     add constraint fk_video_generations_persona foreign key (persona_id)
--     references public.personas (id) on delete set null;
--
-- (persona-images.sql already declares the persona_images -> personas
-- foreign key; do not add it twice.)

-- 5. RPC functions called by the app (bodies NOT introspectable read-only;
-- copy definitions from the dashboard under Database > Functions):
--   * public.spend_tokens
--   * public.refund_generation_tokens
--   * public.credit_tokens_for_payment
--   * public.grant_signup_bonus
--   * public.record_persona_image_use
--   * public.set_primary_persona_image
--   * public.rls_auto_enable
