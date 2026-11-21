-- hook_panel: whether the hook-only lip sync shows the segment photo as a
-- framed panel under the talking face.
--
-- The first photo of a video already opens it as the lip-sync image, so the
-- panel drawn under the face during the hook repeats that photo. A persona
-- chooses the default (true keeps the historical panel), and each video may
-- override it. schedules.post_hook_panel is the per-post snapshot taken when
-- the slot is created, like post_video_layout (migration 019): editing the
-- persona later cannot change an already-scheduled post. NULL there means a
-- schedule written before this migration, and the engine falls back to the
-- persona, then to true.

alter table public.personas
  add column if not exists hook_panel boolean not null default true;

alter table public.schedules
  add column if not exists post_hook_panel boolean;
