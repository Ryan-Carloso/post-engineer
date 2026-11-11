// GENERATED FILE — do not edit by hand.
// Source: supabase/migrations/*.sql (columns added by `alter table ... add column`).
// Regenerate: node apps/web/scripts/generate-schema-expectations.mjs

export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  experiments: ['persona_id'],
  mcp_oauth_refresh_tokens: ['client_id', 'consumed_at', 'created_at', 'expires_at', 'resource', 'scope', 'user_id'],
  personas: ['cta_text', 'recent_image_ids', 'video_layout'],
  post_metrics: ['analytics_end_date', 'analytics_start_date', 'analytics_status', 'analytics_views', 'average_view_duration_seconds', 'average_view_percentage', 'content_type', 'engaged_views', 'experiment_id', 'experiment_pair', 'persona_id', 'script_angle', 'variant_id'],
  scheduled_posts: ['batch_id', 'charged_tokens', 'description', 'discount_tokens', 'experiment_id', 'experiment_pair', 'faceless', 'faceless_material', 'full_lipsync', 'music_mood', 'publish_attempts', 'publish_not_before', 'publish_outcomes', 'segments', 'title', 'variant_id', 'video_type'],
  schedules: ['facebook_account_ids', 'pinterest_account_ids', 'pinterest_board_id', 'post_cta_text', 'post_face_quality', 'post_language', 'post_niche', 'post_paragraph_number', 'post_video_aspect', 'post_video_layout', 'post_voice_audio_url', 'post_voice_id', 'publish_mode', 'rumble_account_ids', 'threads_account_ids', 'threespeak_account_ids'],
  video_generations: ['params', 'publish_mode', 'scheduled_at'],
};
