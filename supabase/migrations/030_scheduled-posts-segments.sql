-- 030: per-post script segments on scheduled_posts.
--
-- What the video says, segment by segment (hook, body, CTA), with each
-- segment's optional user media. The web writes it at slot creation
-- next to `faceless_material`, and the engine's batch pipeline
-- (fill_schedule) forwards it on the TaskVideoRequest, exactly like the
-- web's direct dispatch. Without it, a requeued slot (engine restart
-- mid-generation) or a tick-dispatched pending slot regenerates from
-- the topic alone: the script differs and every user photo disappears
-- with no warning. NULL means no segments (rows created before this
-- migration, and posts created without segments): the batch pipeline
-- then behaves exactly as before.
alter table public.scheduled_posts
  add column if not exists segments jsonb;
