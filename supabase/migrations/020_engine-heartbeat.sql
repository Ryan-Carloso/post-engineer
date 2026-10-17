-- ============================================================================
-- Migration 020 — engine_heartbeat: single-row liveness for death diagnosis
-- ----------------------------------------------------------------------------
-- WHY: when the engine process dies mid-generation (OOM-killer, container
-- restart, deploy), nothing inside the process can report its own death.
-- This table holds one row (id = 1, CHECK-pinned) that the engine rewrites
-- every ~45s with its pid, uptime and RSS, plus a clean_shutdown_at marker
-- written by the ASGI shutdown hook. At boot the engine reads the row and
-- emits a PostHog engine_boot event: time since the last heartbeat, whether
-- the shutdown was clean, and the last RSS reading. The dashboard then
-- answers "OOM or restart?" without anyone opening the VPS logs.
--
-- No RLS policies on purpose: only the service role touches this table
-- (same convention as 003_engine-task-state.sql).
-- ============================================================================

create table if not exists public.engine_heartbeat (
    id int primary key default 1 check (id = 1),
    updated_at timestamptz not null default now(),
    pid int,
    uptime_s double precision,
    rss_mb double precision,
    vram_mb double precision,
    clean_shutdown_at timestamptz
);
