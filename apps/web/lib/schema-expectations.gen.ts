// GENERATED FILE — do not edit by hand.
// Source: supabase/migrations/*.sql (columns added by `alter table ... add column`, tables removed by `drop table`).
// Regenerate: node apps/web/scripts/generate-schema-expectations.mjs

export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  mcp_oauth_refresh_tokens: ['client_id', 'consumed_at', 'created_at', 'expires_at', 'resource', 'scope', 'user_id'],
  oauth_states: ['code_verifier'],
  personas: ['cta_instruction', 'cta_type', 'cta_url', 'hook_panel', 'recent_image_ids', 'video_layout'],
  post_metrics: ['analytics_end_date', 'analytics_start_date', 'analytics_status', 'analytics_views', 'average_view_duration_seconds', 'average_view_percentage', 'content_type', 'engaged_views', 'persona_id', 'prompt_version_id', 'script_angle'],
  scheduled_posts: ['batch_id', 'charged_tokens', 'description', 'discount_tokens', 'faceless', 'faceless_material', 'full_lipsync', 'media_claimed_at', 'media_content_type', 'media_kind', 'media_ref', 'music_mood', 'prompt_version_id', 'publish_attempts', 'publish_not_before', 'publish_outcomes', 'segments', 'title', 'video_type'],
  schedules: ['facebook_account_ids', 'fanvue_account_ids', 'pinterest_account_ids', 'pinterest_board_id', 'post_cta_instruction', 'post_cta_type', 'post_cta_url', 'post_face_quality', 'post_hook_panel', 'post_language', 'post_niche', 'post_paragraph_number', 'post_video_aspect', 'post_video_layout', 'post_voice_audio_url', 'post_voice_id', 'publish_mode', 'rumble_account_ids', 'telegram_account_ids', 'threads_account_ids', 'threespeak_account_ids'],
  social_accounts: ['needs_reconnect'],
  video_generations: ['params', 'publish_mode', 'scheduled_at'],
};
