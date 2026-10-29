-- 032: schedules loses the post_script_prompt snapshot column.
--
-- BREAKING (beta): scripts come from segments only since Phase 5 PR 4 —
-- the web route no longer writes post_script_prompt and the engine no
-- longer reads it (P5-4 proved the column write-dead with no reads), so
-- the snapshot column is dropped. No backfill: the value fed only the
-- deleted LLM script path, and personas keep their own script_prompt
-- column (decision D4, explicitly out of Phase 5 PR 5).
--
-- Idempotency: the drop runs only while the column still exists, so
-- re-applying this file after the drop is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schedules'
      and column_name = 'post_script_prompt'
  ) then
    execute 'alter table public.schedules drop column post_script_prompt';
  end if;
end $$;
