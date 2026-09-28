-- ============================================================================
-- Persona image library
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run.
-- The schema is not versioned in this repo; apply once per Supabase project.
-- Safe to re-run (all statements are idempotent).
-- ============================================================================

-- 1. Image library table: up to 10 images per persona, each with a tag and
--    a description used for deterministic per-video selection.
create table if not exists public.persona_images (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  user_id uuid not null,
  image_path text not null,
  tag text not null default '',
  description text not null default '',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_persona_images_persona
  on public.persona_images(persona_id);

-- One primary image per persona at most (partial unique index).
create unique index if not exists uq_persona_images_primary
  on public.persona_images(persona_id)
  where is_primary;

-- 2. Anti-repeat history (mirrors the BGM history window): ids of the most
--    recently used library images, newest first. The selector excludes these
--    so consecutive videos don't reuse the same photo.
alter table public.personas
  add column if not exists recent_image_ids uuid[] not null default '{}';

-- 3. Atomic 10-image limit: the app checks the count before inserting, but
--    two concurrent requests could both pass the check. This trigger locks
--    the parent persona row first, serializing inserts per persona so the
--    count check is race-free.
create or replace function public.enforce_persona_image_limit()
returns trigger
language plpgsql
as $$
begin
  -- Lock the parent persona row: concurrent inserts for the same persona
  -- serialize here instead of racing on the count below.
  -- NOTE: the limit literal below mirrors MAX_PERSONA_IMAGES in
  -- apps/web/lib/persona-images.ts. SQL has no import of that constant, so
  -- keep the two in sync manually when the limit ever changes.
  perform 1 from public.personas where id = new.persona_id for update;
  if (select count(*) from public.persona_images where persona_id = new.persona_id) > 10 then
    raise exception 'persona image library is limited to 10 images';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_persona_image_limit on public.persona_images;
create trigger trg_persona_image_limit
  after insert on public.persona_images
  for each row execute function public.enforce_persona_image_limit();

-- 4. RLS: owner-only, mirroring public.personas (RLS by user_id). The policy
--    also verifies the referenced persona itself belongs to the caller, so a
--    forged persona_id can never attach images to someone else's persona.
alter table public.persona_images enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'persona_images'
      and policyname = 'persona_images_owner_all'
  ) then
    create policy "persona_images_owner_all"
      on public.persona_images
      for all
      using (
        auth.uid() = user_id
        and exists (
          select 1 from public.personas p
          where p.id = persona_images.persona_id
            and p.user_id = auth.uid()
        )
      )
      with check (
        auth.uid() = user_id
        and exists (
          select 1 from public.personas p
          where p.id = persona_images.persona_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- 5. Atomic rotation-history update: read-modify-write from the app can
--    lose concurrent updates (two generations racing the same window).
--    This function prepends the image id, dedupes, and caps the window at
--    3 (PERSONA_IMAGE_HISTORY_LIMIT in apps/web/lib/persona-image-select.ts)
--    in a single UPDATE, so the write is race-free. This is the only write
--    path for the history — the old app-side helper was removed. Called by
--    the web app via the service-role client (recordRecentImageId in
--    apps/web/lib/persona-images.ts).
--    Trust boundary: this function performs no ownership check itself — it
--    relies on RLS on public.personas (invoker rights) when called with a
--    user-scoped client. The app invokes it with both the service-role
--    client (API-key callers, after route-level ownership checks) and the
--    session client, so EXECUTE must stay granted to authenticated: the
--    safety net is the RLS policy on personas, which must keep covering
--    UPDATE for the row owner.
create or replace function public.record_persona_image_use(p_persona_id uuid, p_image_id uuid)
returns void
language sql
as $$
  update public.personas
  set recent_image_ids =
    (array[p_image_id] || array_remove(coalesce(recent_image_ids, '{}'), p_image_id))[1:3]
  where id = p_persona_id;
$$;

-- 6. Atomic primary-image swap: the app used to demote-then-promote with two
--    separate UPDATEs, which concurrent swaps could interleave (transiently
--    leaving zero or two primaries despite the partial unique index). This
--    function locks the parent persona row first so concurrent swaps
--    serialize, then demotes the old primary and promotes the new one
--    back-to-back. Raises if the image does not belong to the persona (the
--    exception rolls back the demote too).
--    Trust boundary: like record_persona_image_use, this function performs
--    no ownership check itself — it relies on RLS (invoker rights) when
--    called with a user-scoped client. The app invokes it with both the
--    service-role client (API-key callers) and the session client, always
--    after the route validated that the image belongs to the caller's
--    persona via getOwnedImage. EXECUTE must stay granted to authenticated;
--    the RLS policies on persona_images must keep scoping UPDATE/SELECT to
--    the row owner.
create or replace function public.set_primary_persona_image(p_persona_id uuid, p_image_id uuid)
returns void
language plpgsql
as $$
begin
  -- Serialize concurrent swaps on the parent row.
  perform 1 from public.personas where id = p_persona_id for update;
  update public.persona_images
  set is_primary = false
  where persona_id = p_persona_id and is_primary;
  update public.persona_images
  set is_primary = true
  where id = p_image_id and persona_id = p_persona_id;
  if not found then
    raise exception 'image % does not belong to persona %', p_image_id, p_persona_id;
  end if;
end;
$$;
