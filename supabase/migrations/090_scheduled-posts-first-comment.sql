-- ============================================================================
-- 088 — scheduled_posts.first_comment: the optional comment a slot posts on
-- its own published post.
--
-- The slot already holds the per-post copy (title, description), so the first
-- comment is stored with it and the publisher forwards it to the upload API
-- once the post is live. NULL means no comment. The check mirrors
-- FIRST_COMMENT_MAX_LENGTH in shared/contracts/first-comment.ts (1000); a
-- file-parsing test pins both.
-- Idempotent: the column is guarded by IF NOT EXISTS, the check by pg_constraint.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists first_comment text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_first_comment_length_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      add constraint scheduled_posts_first_comment_length_check
      check (first_comment is null or char_length(first_comment) between 1 and 1000);
  end if;
end $$;
