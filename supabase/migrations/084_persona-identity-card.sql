-- ============================================================================
-- 084 — Persona identity card.
--
-- personas.identity_card holds one versioned JSON object per persona:
-- { version, identity, defaults }. It is advice for the agent's own image
-- tool: the server stores it and renders a prompt from it, it never generates
-- an image. The per-photo scene is NOT stored; it is passed to the render
-- route each time.
--
-- The card describes a real person's physical traits, so it is read only
-- through the owner-checked identity-card route, never through the persona
-- list and never on a share page. NULL means "no card" and is the default:
-- personas without a card behave exactly as before.
--
-- The shape (strict keys, version union, 80-character leaves) is validated at
-- the API boundary; the database only guarantees the value is a JSON object.
-- Idempotent: the column and the constraint are both guarded.
-- ============================================================================

alter table public.personas
  add column if not exists identity_card jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'personas_identity_card_object_check'
      and conrelid = 'public.personas'::regclass
  ) then
    alter table public.personas
      add constraint personas_identity_card_object_check
      check (identity_card is null or jsonb_typeof(identity_card) = 'object');
  end if;
end $$;
