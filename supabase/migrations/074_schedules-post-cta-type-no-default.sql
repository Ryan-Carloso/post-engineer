-- 074: drop the default 'follow' on schedules.post_cta_type (issue #639).
--
-- NULL means "no CTA on this post" (migration 073). The default let any
-- writer that omits the column inherit 'follow' by omission:
-- publish-existing did exactly that, storing a follow CTA on media that
-- never had one. Both schedules writers now set the column explicitly
-- (the generate-and-schedule snapshot, possibly null; publish-existing,
-- null), so no writer depends on the default.
alter table public.schedules alter column post_cta_type drop default;
