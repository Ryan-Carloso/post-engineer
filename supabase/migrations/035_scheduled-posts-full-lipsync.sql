-- 035: per-post full lip-sync choice on scheduled_posts.
--
-- Whether this post renders as full lip-sync (the persona talking for the
-- whole video, no b-roll) instead of the default intro-only lip-sync over
-- stock material. The web writes it at slot creation next to
-- `faceless_material`, and the engine's batch pipeline (fill_schedule)
-- forwards it on the TaskVideoRequest, exactly like the web's direct
-- dispatch. Without it, a tick-dispatched pending slot or a requeued slot
-- (engine restart mid-generation) silently renders intro-only b-roll even
-- though the user asked for full lip-sync — the silent degradation the
-- full lip-sync module contract forbids.
-- Existing rows default to false, which is what every video rendered
-- before this choice already was.

alter table public.scheduled_posts
  add column if not exists full_lipsync boolean not null default false;
