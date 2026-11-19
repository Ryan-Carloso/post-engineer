-- ============================================================================
-- 072 — 'own' as a persisted search tool for user_tool_configs.
-- The base prompt offers the agent's own web or MCP search tool as an
-- answer, but migration 070 shipped (PR #671) with the search_tool check
-- holding only ('tavily', 'exa'), so that answer could only be stored as
-- null and the next conversation asked again. Shipped migrations are never
-- edited, so the widening lands here instead of in 070. Idempotent.
-- ============================================================================

alter table public.user_tool_configs
  drop constraint if exists user_tool_configs_search_tool_check;

alter table public.user_tool_configs
  add constraint user_tool_configs_search_tool_check
  check (search_tool in ('tavily', 'exa', 'own'));
