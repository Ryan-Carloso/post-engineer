-- Prompts live only in user_prompts now: the official prompts that shipped
-- in git (shared/prompt-base) were moved into user_prompts as public prompts
-- of one account, by a one-off SQL run outside the migration chain.
-- Nothing records an official version any more, so the function goes.
-- Existing official rows in prompt_versions stay: posts and metrics still
-- point at them, and the source check keeps accepting 'official' for them.

drop function if exists public.ensure_official_prompt_version(text, text, text);
