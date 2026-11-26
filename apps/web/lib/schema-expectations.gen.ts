// GENERATED FILE — do not edit by hand.
// Source: supabase/migrations/*.sql (columns added by `alter table ... add column` and renamed by `rename column`, tables removed by `drop table`).
// Regenerate: node apps/web/scripts/generate-schema-expectations.mjs

export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  mcp_oauth_refresh_tokens: ['client_id', 'consumed_at', 'created_at', 'expires_at', 'resource', 'scope', 'user_id'],
  oauth_states: ['code_verifier'],
  personas: ['ai_label', 'identity_card'],
  post_metrics: ['analytics_end_date', 'analytics_start_date', 'analytics_status', 'analytics_views', 'average_view_duration_seconds', 'average_view_percentage', 'content_type', 'engaged_views', 'persona_id', 'prompt_version_id'],
  scheduled_posts: ['description', 'media_claimed_at', 'media_content_type', 'media_kind', 'media_ref', 'prompt_version_id', 'publish_attempts', 'publish_not_before', 'publish_outcomes', 'title'],
  schedules: ['facebook_account_ids', 'fanvue_account_ids', 'pinterest_account_ids', 'pinterest_board_id', 'publish_mode', 'rumble_account_ids', 'telegram_account_ids', 'threads_account_ids', 'threespeak_account_ids'],
  social_accounts: ['needs_reconnect'],
  user_profiles: ['trial_ends_at'],
  user_prompts: ['verified'],
};
