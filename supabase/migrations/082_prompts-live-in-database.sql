-- Prompts live only in user_prompts now. The official prompts that shipped
-- in git (shared/prompt-base) are moved into user_prompts by a one-off SQL
-- run outside the chain: public, verified, owned by the Post Engineer system
-- owner id (a fixed uuid that is no auth user, so nobody edits them from the
-- app).
--
-- verified marks a prompt Post Engineer checked. Only the service role
-- writes it: the API never accepts it from a caller, so a user cannot verify
-- their own prompt.
--
-- Nothing records an official version any more, so
-- ensure_official_prompt_version goes. Existing official rows in
-- prompt_versions stay: posts and metrics still point at them, and the
-- source check keeps accepting 'official' for them.

alter table public.user_prompts
  add column if not exists verified boolean not null default false;

drop function if exists public.ensure_official_prompt_version(text, text, text);
