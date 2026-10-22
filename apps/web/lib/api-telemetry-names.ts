//---------------
// Semantic PostHog event names for web API responses.
//
// withApiErrorReporting used to report every 2xx as a generic
// `server_success` and every 4xx as `server_warning`, with the route only
// in the event properties — the events feed was a wall of identical
// names. This table maps each route label to a deliberate semantic name
// (noun + past-tense verb, matching the repo's existing PostHog names
// like video_generated and refund_issued) so the feed reads as what
// actually happened: billing_transactions_fetched, persona_created.
//
// Rules:
// - One entry per withApiErrorReporting('METHOD /api/...') label. Keys
//   must match the label strings exactly, including [id]-style segments.
// - The value is the 2xx event name. The wrapper derives the 4xx name as
//   `${name}_rejected` — "rejected", not "failed", because a 4xx is the
//   caller erroring, not our system failing.
// - 5xx are out of scope: they go to error tracking as $exception.
// - api-telemetry-names-coverage.test.ts fails CI when a route label has
//   no entry here, so a new route without a semantic name can never
//   ship silently.
//
// The table is built with one assignment statement per route (not an
// object literal): v8 emits no line-coverage entries for object-literal
// properties, which would read as 0% patch coverage on this data.
//---------------

const table: Record<string, string> = {};
table['DELETE /api/account'] = 'account_deleted';
table['DELETE /api/api-keys/[id]'] = 'api_key_deleted';
table['DELETE /api/persona'] = 'persona_deleted';
table['DELETE /api/persona/cloned-voices/[cloneId]'] = 'cloned_voice_deleted';
table['DELETE /api/persona/images'] = 'persona_image_deleted';
table['DELETE /api/persona/video-task/[taskId]'] = 'video_task_cancelled';
table['DELETE /api/schedule'] = 'schedule_deleted';
table['DELETE /api/schedule/slots/[slotId]'] = 'schedule_slot_deleted';
table['GET /api/account'] = 'account_fetched';
table['GET /api/api-keys'] = 'api_keys_listed';
table['GET /api/billing/tokens'] = 'token_balance_fetched';
table['GET /api/billing/transactions'] = 'billing_transactions_fetched';
table['GET /api/coverage'] = 'coverage_collected';
table['GET /api/google-oauth/callback'] = 'google_oauth_completed';
table['GET /api/google-oauth/start'] = 'google_oauth_started';
table['GET /api/health'] = 'health_checked';
table['GET /api/instagram-auth/callback'] = 'instagram_oauth_completed';
table['GET /api/instagram-auth/start'] = 'instagram_oauth_started';
table['GET /api/linkedin-auth/callback'] = 'linkedin_oauth_completed';
table['GET /api/linkedin-auth/start'] = 'linkedin_oauth_started';
table['GET /api/moneyprint/health'] = 'moneyprint_health_checked';
table['GET /api/persona/cloned-voices'] = 'cloned_voices_listed';
table['GET /api/persona/cloned-voices/[cloneId]'] = 'cloned_voice_fetched';
table['GET /api/persona/delete-preview'] = 'persona_delete_preview_fetched';
table['GET /api/persona/faces'] = 'persona_faces_listed';
table['GET /api/persona/images'] = 'persona_images_listed';
table['GET /api/persona/list'] = 'personas_listed';
table['GET /api/persona/publishing-accounts'] = 'persona_publishing_accounts_fetched';
table['GET /api/persona/video-download/[taskId]/[...path]'] = 'video_download_served';
table['GET /api/persona/video-events/[taskId]'] = 'video_events_fetched';
table['GET /api/persona/video-generations'] = 'video_generations_listed';
table['GET /api/persona/video-generations/[generationId]'] = 'video_generation_fetched';
table['GET /api/persona/video-status/[taskId]'] = 'video_status_fetched';
table['GET /api/persona/voices'] = 'persona_voices_listed';
table['GET /api/posts/[id]'] = 'post_fetched';
table['GET /api/schedule'] = 'schedule_fetched';
table['GET /api/schedule/slots/[slotId]'] = 'schedule_slot_fetched';
table['GET /api/schedule/status'] = 'schedule_status_fetched';
table['GET /api/version'] = 'version_fetched';
table['PATCH /api/persona'] = 'persona_updated';
table['PATCH /api/persona/images'] = 'persona_image_updated';
table['PATCH /api/schedule/slots/[slotId]'] = 'schedule_slot_updated';
table['POST /api/account/connect-url'] = 'connect_url_created';
table['POST /api/api-keys'] = 'api_key_created';
table['POST /api/billing/check-tokens'] = 'tokens_checked';
table['POST /api/billing/checkout'] = 'checkout_started';
table['POST /api/billing/webhook'] = 'billing_webhook_received';
table['POST /api/bluesky-connect'] = 'bluesky_connected';
table['POST /api/cron/billing-reconcile'] = 'billing_reconciled';
table['POST /api/logout'] = 'user_logged_out';
table['POST /api/persona'] = 'persona_created';
table['POST /api/persona/avatar'] = 'persona_avatar_uploaded';
table['POST /api/persona/cloned-voices'] = 'cloned_voice_created';
table['POST /api/persona/cloned-voices/denoise-preview'] = 'cloned_voice_denoise_previewed';
table['POST /api/persona/cloned-voices/[cloneId]/preview'] = 'cloned_voice_previewed';
table['POST /api/persona/images'] = 'persona_image_added';
table['POST /api/upload-content'] = 'content_uploaded';
table['POST /api/videos/generate-and-schedule'] = 'generate_and_schedule_started';
table['PUT /api/persona/publishing-accounts'] = 'persona_publishing_accounts_updated';

export const API_TELEMETRY_NAMES: Record<string, string> = table;

// 2xx event name for a route label, or undefined when the label is not
// mapped (the wrapper falls back to the generic server_success —
// telemetry must never break on a missing entry).
export function successEventName(route: string): string | undefined {
  return API_TELEMETRY_NAMES[route];
}

// 4xx event name for a route label, or undefined when the label is not
// mapped (the wrapper falls back to the generic server_warning).
export function rejectionEventName(route: string): string | undefined {
  const base = successEventName(route);
  return base === undefined ? undefined : `${base}_rejected`;
}
