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
//---------------

export const API_TELEMETRY_NAMES = {
  'DELETE /api/account': 'account_deleted',
  'DELETE /api/api-keys/[id]': 'api_key_deleted',
  'DELETE /api/persona': 'persona_deleted',
  'DELETE /api/persona/images': 'persona_image_deleted',
  'DELETE /api/persona/video-task/[taskId]': 'video_task_cancelled',
  'DELETE /api/schedule': 'schedule_deleted',
  'DELETE /api/schedule/slots/[slotId]': 'schedule_slot_deleted',
  'GET /api/account': 'account_fetched',
  'GET /api/api-keys': 'api_keys_listed',
  'GET /api/billing/tokens': 'token_balance_fetched',
  'GET /api/billing/transactions': 'billing_transactions_fetched',
  'GET /api/coverage': 'coverage_collected',
  'GET /api/google-oauth/callback': 'google_oauth_completed',
  'GET /api/google-oauth/start': 'google_oauth_started',
  'GET /api/health': 'health_checked',
  'GET /api/instagram-auth/callback': 'instagram_oauth_completed',
  'GET /api/instagram-auth/start': 'instagram_oauth_started',
  'GET /api/linkedin-auth/callback': 'linkedin_oauth_completed',
  'GET /api/linkedin-auth/start': 'linkedin_oauth_started',
  'GET /api/moneyprint/health': 'moneyprint_health_checked',
  'GET /api/persona/delete-preview': 'persona_delete_preview_fetched',
  'GET /api/persona/faces': 'persona_faces_listed',
  'GET /api/persona/images': 'persona_images_listed',
  'GET /api/persona/list': 'personas_listed',
  'GET /api/persona/video-download/[taskId]/[...path]': 'video_download_served',
  'GET /api/persona/video-events/[taskId]': 'video_events_fetched',
  'GET /api/persona/video-generations': 'video_generations_listed',
  'GET /api/persona/video-generations/[generationId]': 'video_generation_fetched',
  'GET /api/persona/video-status/[taskId]': 'video_status_fetched',
  'GET /api/persona/voice-sample-languages': 'voice_sample_languages_fetched',
  'GET /api/persona/voices': 'persona_voices_listed',
  'GET /api/schedule': 'schedule_fetched',
  'GET /api/schedule/slots/[slotId]': 'schedule_slot_fetched',
  'GET /api/schedule/status': 'schedule_status_fetched',
  'GET /api/version': 'version_fetched',
  'PATCH /api/persona': 'persona_updated',
  'PATCH /api/persona/images': 'persona_image_updated',
  'PATCH /api/schedule/slots/[slotId]': 'schedule_slot_updated',
  'POST /api/account/connect-url': 'connect_url_created',
  'POST /api/api-keys': 'api_key_created',
  'POST /api/billing/check-tokens': 'tokens_checked',
  'POST /api/billing/checkout': 'checkout_started',
  'POST /api/billing/webhook': 'billing_webhook_received',
  'POST /api/bluesky-connect': 'bluesky_connected',
  'POST /api/cron/billing-reconcile': 'billing_reconciled',
  'POST /api/logout': 'user_logged_out',
  'POST /api/persona': 'persona_created',
  'POST /api/persona/avatar': 'persona_avatar_uploaded',
  'POST /api/persona/images': 'persona_image_added',
  'POST /api/upload-content': 'content_uploaded',
} as const;

// 2xx event name for a route label, or undefined when the label is not
// mapped (the wrapper falls back to the generic server_success —
// telemetry must never break on a missing entry).
export function successEventName(route: string): string | undefined {
  return (API_TELEMETRY_NAMES as Record<string, string>)[route];
}

// 4xx event name for a route label, or undefined when the label is not
// mapped (the wrapper falls back to the generic server_warning).
export function rejectionEventName(route: string): string | undefined {
  const base = successEventName(route);
  return base === undefined ? undefined : `${base}_rejected`;
}
