-- ============================================================================
-- 081 — Per-post face photos for full lip sync.
-- Full lip sync renders the narration as windows of at most 12s. The agent
-- sends 2-5 different face photos of the persona (options.lipsyncPhotos,
-- each { mediaId } or { url }); window i shows photo i % count, so the
-- video does not stay on one photo for its whole length.
--
-- The web writes the list at slot creation next to `segments`, and the
-- engine's batch pipeline (fill_schedule) forwards it on the
-- TaskVideoRequest exactly like the web's direct dispatch. Without it, a
-- tick-dispatched pending slot or a slot requeued after an engine restart
-- would have no photos, and full lip sync fails without them.
-- NULL for every other video type.
-- ============================================================================
alter table public.scheduled_posts
  add column if not exists lipsync_photos jsonb;
