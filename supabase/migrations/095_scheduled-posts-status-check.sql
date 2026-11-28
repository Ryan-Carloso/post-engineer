-- ============================================================================
-- 095 — scheduled_posts gains the status check the code already assumes.
--
-- Production carries a scheduled_posts_status_check that no repo migration
-- defines (094 even states the table has no status check constraint), and
-- that drifted check rejects 'expired': expire_inactive_ready_slots (094)
-- fails every scheduler tick with "new row for relation scheduled_posts
-- violates check constraint scheduled_posts_status_check", so the due ready
-- slots of owners without access never expire and their media is never
-- cleaned up. Bring the constraint into the repo with every status the
-- code reads or writes: pending (001 default, slots are created pending),
-- generating (legacy engine rows, still read as live upload slots),
-- ready, awaiting_approval, publishing, published, failed, expired and
-- cancelled. Idempotent.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'scheduled_posts_status_check') then
    alter table public.scheduled_posts drop constraint scheduled_posts_status_check;
  end if;
  alter table public.scheduled_posts
    add constraint scheduled_posts_status_check
    check (
      status in (
        'pending', 'generating', 'ready', 'awaiting_approval',
        'publishing', 'published', 'failed', 'expired', 'cancelled'
      )
    );
end $$;
