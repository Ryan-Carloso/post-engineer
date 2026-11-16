-- ============================================================================
-- 065 — SECURITY DEFINER grants: service-role-only RPCs, persona ownership,
-- and mcp_oauth_clients RLS (issues #460, #461, #462, #463, #465).
--
-- Several SECURITY DEFINER RPCs take a caller-supplied p_user_id and were
-- only revoked from PUBLIC (migration 004) or not at all (017/018/044 for
-- refund_batch_tokens, 046/047 for the batch-clawback helpers, 058 for the
-- slot-delete guard), or created as invoker functions with no revoke at
-- all (002 for record_persona_image_use). Supabase grants new public-
-- schema functions to anon/authenticated through default privileges (the
-- 025 convention), so any logged-in user could call these through
-- PostgREST with their own id — most damagingly refund_batch_tokens on
-- their own still-generating batch. This migration closes the boundary:
-- every non-trigger definer function in the chain ends up service-role
-- only, except set_primary_persona_image, which the browser calls with a
-- session client and keeps authenticated while enforcing auth.uid()
-- ownership inside its body.
--
-- What this does:
--   1. Recreates record_persona_image_use and set_primary_persona_image
--      with auth.uid() winning over p_user_id (coalesce order swapped):
--      a spoofed p_user_id can no longer redirect the write to another
--      tenant. The app always passes the verified caller id, and
--      service-role callers have auth.uid() = null, so their path is
--      unchanged. Both bodies also pin search_path to public.
--   2. Recreates delete_slot_if_not_last with search_path pinned to
--      public (058 left it unpinned).
--   3. Revokes EXECUTE from public/anon/authenticated and grants it to
--      service_role for the service-only RPCs: the billing detectors,
--      refund_batch_tokens, settle_batch_clawback,
--      restore_batch_discount_credit, delete_slot_if_not_last and
--      record_persona_image_use. set_primary_persona_image keeps
--      authenticated (browser flow) and loses anon.
--   4. Enables RLS on public.mcp_oauth_clients with no policies and
--      revokes the table from anon/authenticated: only the service role
--      reads/writes the DCR allowlist (POST /oauth/register and
--      GET /oauth/authorize use the service client), so anon can no
--      longer rewrite redirect_uris.
--
-- Out of scope, deliberately: public.personas has no RLS in this chain
-- and is read/written with the session client, so enabling RLS without
-- policies would break it; its RPC ownership is fixed here instead. The
-- dashboard-only RPCs (spend_tokens, refund_generation_tokens,
-- credit_tokens_for_payment, grant_signup_bonus) are never defined in
-- the migration chain, so no versioned migration can revoke them.
--
-- Every caller of the restricted RPCs was verified to use the service
-- client (the web routes and the engine's service-key REST calls); the
-- two request paths that used the cookie client (schedule cancel,
-- slot delete) now pass the service client to the RPC calls.
--
-- Idempotent (CREATE OR REPLACE, guarded grants, RLS enable is a no-op
-- when already on).
-- ============================================================================

-- 1. Persona image RPCs: auth.uid() wins over p_user_id.
create or replace function public.record_persona_image_use(p_persona_id uuid, p_image_id uuid, p_user_id uuid default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.personas
  set recent_image_ids =
    (array[p_image_id] || array_remove(coalesce(recent_image_ids, '{}'), p_image_id))[1:3]
  where id = p_persona_id
    -- Ownership: a session/JWT caller is bound to its own subject; the
    -- argument only fills in for service-role callers (auth.uid() null),
    -- which the web app only invokes with the verified caller id. A
    -- spoofed p_user_id can no longer redirect the write.
    and user_id = coalesce(auth.uid(), p_user_id);
  -- Enforcing, not advisory: a silent no-op here would disable the
  -- anti-repeat behavior with no diagnostic trail (e.g. a caller that
  -- forgot p_user_id on the service-role path, where auth.uid() is null).
  if not found then
    raise exception 'persona % not found for caller', p_persona_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_primary_persona_image(p_persona_id uuid, p_image_id uuid, p_user_id uuid default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  -- Serialize concurrent swaps on the parent row. The explicit user_id
  -- guard keeps the lock scoped to the caller's own persona. As above,
  -- the JWT subject wins over a spoofed p_user_id.
  perform 1 from public.personas
  where id = p_persona_id
    and user_id = coalesce(auth.uid(), p_user_id)
  for update;
  -- Enforcing, not advisory: without the raise below, a service-role caller
  -- with a wrong/omitted p_user_id would fall through to the persona_id-scoped
  -- UPDATEs and corrupt another tenant's rows. (Session/JWT callers are
  -- additionally contained by RLS.)
  if not found then
    raise exception 'persona % not found for caller', p_persona_id using errcode = 'P0002';
  end if;
  update public.persona_images
  set is_primary = false
  where persona_id = p_persona_id and is_primary;
  update public.persona_images
  set is_primary = true
  where id = p_image_id and persona_id = p_persona_id;
  if not found then
    -- P0002 (no_data_found) lets the app distinguish "the image row
    -- vanished between the route's ownership pre-check and this swap"
    -- (a 404) from a genuine failure (a 500). The exception rolls back
    -- the demote above too.
    raise exception 'image % does not belong to persona %', p_image_id, p_persona_id
      using errcode = 'P0002';
  end if;
end;
$$;

-- 2. Slot-delete guard: pin search_path (058 left it unpinned).
create or replace function public.delete_slot_if_not_last(
  p_slot_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule_id uuid;
  v_status text;
  v_remaining int;
begin
  -- Lock the target row first so concurrent deletes serialize here.
  select schedule_id, status into v_schedule_id, v_status
  from public.scheduled_posts
  where id = p_slot_id and user_id = p_user_id
  for update;

  if not found then
    return 'not_found';
  end if;

  -- Pending (not yet dispatched), ready (generated, not yet dispatched)
  -- and failed (dead row cleanup) slots can be deleted; the engine owns
  -- everything mid-flight.
  if v_status not in ('pending', 'ready', 'failed') then
    return 'not_deletable';
  end if;

  select count(*) into v_remaining
  from public.scheduled_posts
  where schedule_id = v_schedule_id and id <> p_slot_id;

  if v_remaining = 0 then
    return 'is_last_slot';
  end if;

  delete from public.scheduled_posts
  where id = p_slot_id and user_id = p_user_id;

  return 'deleted';
end;
$$;

-- 3. Service-role-only trust boundary. Supabase grants new functions to
-- anon/authenticated through default privileges, so revoking PUBLIC
-- alone is not enough (025 convention). Guarded: vanilla Postgres in CI
-- has none of these roles.
do $$
begin
  revoke execute on function public.find_zombie_schedule_candidates(timestamptz) from public;
  revoke execute on function public.find_stuck_generations(timestamptz) from public;
  revoke execute on function public.refund_batch_tokens(uuid, text, text, numeric, text, text) from public;
  revoke execute on function public.settle_batch_clawback(uuid, jsonb, jsonb) from public;
  revoke execute on function public.restore_batch_discount_credit(uuid, text, text, numeric) from public;
  revoke execute on function public.delete_slot_if_not_last(uuid, uuid) from public;
  revoke execute on function public.record_persona_image_use(uuid, uuid, uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.find_zombie_schedule_candidates(timestamptz) from anon;
    revoke execute on function public.find_stuck_generations(timestamptz) from anon;
    revoke execute on function public.refund_batch_tokens(uuid, text, text, numeric, text, text) from anon;
    revoke execute on function public.settle_batch_clawback(uuid, jsonb, jsonb) from anon;
    revoke execute on function public.restore_batch_discount_credit(uuid, text, text, numeric) from anon;
    revoke execute on function public.delete_slot_if_not_last(uuid, uuid) from anon;
    revoke execute on function public.record_persona_image_use(uuid, uuid, uuid) from anon;
    revoke execute on function public.set_primary_persona_image(uuid, uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.find_zombie_schedule_candidates(timestamptz) from authenticated;
    revoke execute on function public.find_stuck_generations(timestamptz) from authenticated;
    revoke execute on function public.refund_batch_tokens(uuid, text, text, numeric, text, text) from authenticated;
    revoke execute on function public.settle_batch_clawback(uuid, jsonb, jsonb) from authenticated;
    revoke execute on function public.restore_batch_discount_credit(uuid, text, text, numeric) from authenticated;
    revoke execute on function public.delete_slot_if_not_last(uuid, uuid) from authenticated;
    revoke execute on function public.record_persona_image_use(uuid, uuid, uuid) from authenticated;
    -- set_primary_persona_image keeps authenticated: the browser flow
    -- calls it with the session client after the route validated
    -- ownership, and the body now binds writes to auth.uid().
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.find_zombie_schedule_candidates(timestamptz) to service_role;
    grant execute on function public.find_stuck_generations(timestamptz) to service_role;
    grant execute on function public.refund_batch_tokens(uuid, text, text, numeric, text, text) to service_role;
    grant execute on function public.settle_batch_clawback(uuid, jsonb, jsonb) to service_role;
    grant execute on function public.restore_batch_discount_credit(uuid, text, text, numeric) to service_role;
    grant execute on function public.delete_slot_if_not_last(uuid, uuid) to service_role;
    grant execute on function public.record_persona_image_use(uuid, uuid, uuid) to service_role;
    grant execute on function public.set_primary_persona_image(uuid, uuid, uuid) to service_role;
  end if;
end $$;

-- set_primary_persona_image also drops PUBLIC (revoke from public above
-- only names the service-only list); authenticated access is preserved
-- deliberately for the browser flow.
do $$
begin
  revoke execute on function public.set_primary_persona_image(uuid, uuid, uuid) from public;
end $$;

-- 4. mcp_oauth_clients: RLS on with no policies. Only the service role
-- reads/writes the DCR allowlist (POST /oauth/register and
-- GET /oauth/authorize use the service client), so anon/authenticated
-- keep no access even though PostgREST exposes the public schema.
alter table public.mcp_oauth_clients enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.mcp_oauth_clients from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.mcp_oauth_clients from authenticated;
  end if;
end $$;
