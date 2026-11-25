# Supabase migrations

Numbered, append-only migration files live in `supabase/migrations/`.
Apply them in **numeric order** (lowest number first). The `NNN_` prefix is
the order — you never need to guess or read docs to know what comes next:

| #   | File                                        | What it does                                        |
| --- | ------------------------------------------- | --------------------------------------------------- |
| 001 | `migrations/001_schema.sql`                 | Base schema: tables, types, defaults (snapshot)     |
| 002 | `migrations/002_persona-images.sql`         | Persona image library: constraints, trigger, RPCs   |
| 003 | `migrations/003_engine-task-state.sql`      | Engine task state (only for `MPT_STATE_BACKEND=supabase`) |
| 004 | `migrations/004_billing_reconcile.sql`        | Billing reconciliation: zombie/stuck detectors, daily pg_cron trigger (fully automatic, no review queue) (the pg_cron trigger is superseded by 027: the daily run now happens in the web app) |
| 005 | `migrations/005_persona-visual-identity.sql` | CHECK: a persona never has both `photo_path` and `avatar_url` |
| 006 | `migrations/006_test-deploy-supabase.sql`    | Test-deploy schema verification (CI/dev only)    |
| 007 | `migrations/007_personas-drop-face-mix.sql`  | `scheduled_posts.voiceover` (per-post "no face") + `drop column personas.face_mix_percent`: personas are always faced. **Destructive** — shipped under the former `db:destructive-approved` PR label gate (removed in BETA; approval is now the owner's merge tap) |
| 008 | `migrations/008_video-generations-engine-task-id-idx.sql` | Index `video_generations.engine_task_id`: generation_id ↔ task_id correlation for debugging. No FK (engine_task_state is ephemeral) |
| 009 | `migrations/009_batch-charge-task-correlation.sql` | Backfill `token_transactions.engine_task_id` for **single-slot** batch charges, so a scheduled post's prepaid charge can be resolved from its engine task id (fixes history rows stuck in `running` when the engine drops a task). Multi-slot batches are deliberately left NULL — one charge covers several videos. Plus two indexes for the gone-task reconciliation |
| 010 | `migrations/010_scheduled-post-progress-history.sql` | `scheduled_post_progress_history`: every observed (progress, stage) transition per post, recorded change-only by `GET /api/schedule/status`; cascade-deletes with the post |
| 011 | `migrations/011_schedules-drop-persona-owner-unique.sql` | Drop `schedules_persona_owner` (the legacy one-schedule-per-persona unique constraint). Only databases bootstrapped from the old `apps/web/supabase/` chain carry it; it makes every batch after a persona's first one fail. The canonical `001_schema.sql` never declared it |
| 012 | `migrations/012_schedules-optional-persona-snapshot.sql` | Let a post exist without a persona: `schedules.persona_id` becomes nullable, and the editorial definition the persona used to supply (voice, language, niche, video aspect, paragraph count) is snapshotted on the schedule row so the engine can generate voiceover posts reproducibly |
| 013 | `migrations/013_schedules-voice-audio-url-snapshot.sql` | Snapshot the persona-less audio voice URL (`post_voice_audio_url`) on the schedule, so audio-voice posts keep their voice at tick time instead of re-resolving (and rejecting) it |
| 014 | `migrations/014_videos-storage-bucket.sql` | Create the private `videos` storage bucket (plus RLS policies) so the engine can archive final videos at `{user_id}/{persona_id\|voiceover}/{task_id}/final-1.mp4` |
| 015 | `migrations/015_schedules-publish-mode.sql` | `schedules.publish_mode` (`scheduled` default, CHECK-pinned to `scheduled`/`asap`): records whether a post publishes at its slot times or ASAP (the moment generation finishes, no scheduled time) |
| 016 | `migrations/016_scheduled-posts-publish-attempts.sql` | `scheduled_posts.publish_attempts` (NOT NULL DEFAULT 0): counts publish attempts per slot so the engine auto-cancels (failed) with a token refund after 3 failures instead of retrying forever |
| 017 | `migrations/017_refund-batch-tokens.sql` | Create the missing `public.refund_batch_tokens` RPC: per-slot refund of a batch prepaid under `batch:<scheduleId>`. Idempotent per refund key (`token_transactions.reference_id`), total refunds capped at the batch charge, restores the free/paid split, answers `{refunded}` like `refund_generation_tokens`. Both the engine's fill_schedule store and the web's generate-and-schedule route already call it — every call 404'd until this migration |
| 018 | `migrations/018_refund-task-id.sql` | Extend `refund_batch_tokens` (017) with an optional `p_engine_task_id`, written to `token_transactions.engine_task_id` so a refund links back to the engine task that failed. Callers that omit it keep working (defaults to NULL) |
| 019 | `migrations/019_personas-video-layout.sql` | `personas.video_layout` + `schedules.post_video_layout` (`standard` / `react`, NULL = `standard`, CHECK-pinned): how the persona hook is composed with the b-roll — the avatar filling the frame, or a 50/50 split with the b-roll below. Presentation only; the hook render and its cost are identical |
| 020 | `migrations/020_engine-heartbeat.sql` | `engine_heartbeat` (single row, id=1 CHECK-pinned): engine liveness for death diagnosis — pid, uptime, RSS/VRAM rewritten every ~45s, plus `clean_shutdown_at` stamped by the ASGI shutdown hook. The boot reads it for the PostHog `engine_boot` autopsy event |
| 021 | `migrations/021_video-generations-params.sql` | `video_generations.params` (JSONB: full engine job payload), `publish_mode` (`asap`/`scheduled`, CHECK-pinned, default `asap`), `scheduled_at` (timestamptz): the boot triage rebuilds orphaned direct generations from the row instead of failing them (issue #205). Partial index on `engine_task_id` where params is not null |
| 022 | `migrations/022_persona-default-accounts.sql` | Per-persona default publishing accounts (`persona_default_accounts`) with owner-scoped RLS |
| 023 | `migrations/023_cloned-voices.sql` | Per-user Chatterbox cloned voices (`cloned_voices`): async registration status, consent, storage path, engine voice key, language, error_code; owner-scoped RLS |
| 024 | `migrations/024_persona-cta.sql` | Per-persona call to action (`personas.cta_text`) and its schedule snapshot (`schedules.post_cta_text`), both capped at 200 characters |
| 025 | `migrations/025_post-metrics.sql` | Per-video performance snapshots (`post_metrics`: views/likes/comments/saves at 24h and 7d) with owner-read RLS, `post_metrics_done` (posts finished per window, service-role only), plus the hourly `post-metrics-hourly` pg_cron job (`schedule_post_metrics()`) (superseded by 027: the hourly run now happens in the web app) |
| 026 | `migrations/026_post-metrics-dimensions.sql` | Metrics dimensions on `post_metrics`: `persona_id` (filled by a BEFORE INSERT trigger from the post's schedule; NULL for voiceover posts) and `script_angle` (written by the web collector from the engine task record), so the metrics dashboard filters by persona, account, network and script angle without joins. Existing snapshots are backfilled for `persona_id` |
| 027 | `migrations/027_internal-scheduler.sql` | In-app scheduler replaces the pg_cron/pg_net HTTP triggers: unschedules `post-metrics-hourly`/`billing-reconcile-daily` and drops `schedule_post_metrics()`/`schedule_billing_reconcile()` (both guarded), adds `scheduler_leases` + `try_acquire_scheduler_lease()` (service-role only) — the web app (`apps/web/lib/scheduler-jobs.ts`) runs the jobs in-process, one run per tick across replicas |
| 028 | `migrations/028_publish_retry_backoff.sql` | Publish retry backoff: `scheduled_posts.publish_not_before`, skipped by `ready_due_slots` until the delay elapses |
| 029 | `migrations/029_scheduled-posts-material.sql` | Per-post video material (`scheduled_posts.voiceover_material`, `'broll'` or `'svg'`, default `'broll'`), forwarded by the engine batch pipeline |
| 030 | `migrations/030_scheduled-posts-segments.sql` | Per-post script segments (`scheduled_posts.segments`, nullable jsonb), forwarded by the engine batch pipeline so a requeued slot keeps its script and user photos |
| 031 | `migrations/031_scheduled-posts-title-drop-topic.sql` | BREAKING: `scheduled_posts.title` (slot label) replaces `scheduled_posts.topic` — existing labels are backfilled from `topic`, then the `topic` column is dropped (destructive; shipped under the former `db:destructive-approved` label gate, removed in BETA). Segments-NULL rows have no script and fail under the engine's generic scriptless rule |
| 032 | `migrations/032_schedules-drop-post-script-prompt.sql` | BREAKING: drop `schedules.post_script_prompt` — scripts come from segments only since Phase 5 PR 4, so the snapshot column is write-dead with no reads (destructive; the former `db:destructive-approved` label gate was removed in BETA). No backfill: the value fed only the deleted LLM script path |
| 033 | `migrations/033_mcp-refresh-tokens.sql` | MCP OAuth refresh-token allowlist (`mcp_oauth_refresh_tokens`, jti only, never the token value) + `register_mcp_refresh_token` / `rotate_mcp_refresh_token` RPCs (service-role only, single-use rotation, replay returns false) — the objects `apps/web/app/oauth/token/route.ts` already calls and fails closed without; the route comment cited 0026, which never contained them |
| 034 | `migrations/034_threads-provider.sql` | Threads as a publishing provider: `schedules.threads_account_ids` (default empty) and `threads` in the `post_metrics.provider` check |
| 035 | `migrations/035_scheduled-posts-full-lipsync.sql` | Per-post full lip-sync choice (`scheduled_posts.full_lipsync`, default false), forwarded by the engine batch pipeline so a tick-dispatched or requeued slot keeps full lip-sync instead of silently rendering intro-only b-roll |
| 036 | `migrations/036_drop-unknown-social-accounts.sql` | Deletes social accounts stored with the placeholder `provider_account_id` `'unknown'` (a failed YouTube channel lookup used to save them; unrecoverable and every publish to them failed) so users reconnect |
| 037 | `migrations/037_social-accounts-threads-provider.sql` | Threads in the `social_accounts.provider` check: re-creates `social_accounts_provider_check` with all five providers — production carried the constraint from versioned migrations 0015/0016 deleted in the b4037cff consolidation (four pre-Threads providers) while 034 added `threads` only to `post_metrics`, so the Threads OAuth callback upsert failed with a check violation |
| 038 | `migrations/038_drop-placeholder-persona-default-accounts.sql` | Deletes `persona_default_accounts` rows saved under the `'unknown'` placeholder account id (no FK, so migration 036 left them dangling and the persona publishing-accounts editor could no longer be saved) |
| 039 | `migrations/039_post-metrics-retention.sql` | YouTube Analytics retention columns on `post_metrics` (`analytics_views`, `engaged_views`, `average_view_duration_seconds`, `average_view_percentage`, `content_type`, `analytics_start_date`, `analytics_end_date`, `analytics_status` with its check) and a `'28d'` snapshot window: the `metrics_window` checks on `post_metrics` and `post_metrics_done` accept it, and `find_post_metrics_due` opens it 672-696h after publish (final Analytics data, same hourly job) |
| 040 | `migrations/040_social-accounts-unique-key.sql` | Unique key for the `social_accounts` upsert target (`user_id`, `provider`, `provider_account_id`): `upsertSocialAccount` plans `ON CONFLICT` on exactly those columns, and no migration ever created the key, so a database built from the chain failed every connect at the upsert (42P10) |
| 041 | `migrations/041_experiments.sql` | Content experiments (issue #476): `experiments` (owns one schedule, `variable` check `hook`, 3-20 `target_pairs`) and `experiment_variants` (exactly two, slug `variant_id`, no visible A/B label); `scheduled_posts` gains `experiment_id`/`variant_id`/`experiment_pair` (composite FK to the variant, `ON DELETE SET NULL`, one slot per experiment+pair+variant) and `post_metrics` gets the same three columns as snapshot values copied by a BEFORE INSERT trigger; owner-read RLS on both new tables |
| 042 | `migrations/042_experiments-persona.sql` | Drops `experiments.schedule_id` (generate-and-schedule creates one schedule per video, so an experiment spans many) and adds nullable `experiments.persona_id`: every video linked to the experiment must use that persona, and persona-scoped API keys see only their personas' experiments |
| 043 | `migrations/043_scheduled-posts-images-material.sql` | `scheduled_posts.voiceover_material` check gains `'images'` (issue #481): a video rendered only from the agent's segment images, no stock or drawings. Drop and re-add of the 029 check; existing `broll`/`svg` rows stay valid |
| 044 | `migrations/044_refund-batch-tokens-net-cap.sql` | `refund_batch_tokens` caps refunds at TOTAL charges, not the oldest spend row: a fully-refunded attempt re-charges under the same generation_id, so the old cap returned `nothing_to_refund` for the retry's per-slot refund and the retry's fresh charge was never returned |
| 045 | `migrations/045_scheduled-posts-batch-billing.sql` | `scheduled_posts.charged_tokens` (NOT NULL, `>= 0`): the tokens each slot was charged, written by generate-and-schedule at slot creation and read by every refund path (engine generate/reconcile/publish, web schedule cancel) instead of recomputing the list price; existing rows are backfilled with the list price they were charged under (voiceover 1, face 2/3, full lip-sync 8/15). Batch discount (issue #487): nullable `batch_id` (indexed) groups the videos of one MCP batch, and `discount_tokens` (default 0, `>= 0`) holds the tokens credited back for a free video |
| 046 | `migrations/046_batch-clawback-refund-room.sql` | `settle_batch_clawback`: one transaction that refunds cancelled batch slots in full, then shrinks the free slot's discount `generation_refund` by the clawed amount and moves that amount back onto `charged_tokens`. The charge cap (migration 044, total charges) counts that row, so a later refund of the re-charged video is no longer answered `nothing_to_refund`. A `failed` slot is not re-charged |
| 047 | `migrations/047_restore-batch-discount-credit.sql` | `restore_batch_discount_credit`: when a batch earns a clawed-back free video again, tops that same discount `generation_refund` back up to the slot charge and returns the tokens, inside the migration 044 cap. A row that already holds the full amount is left untouched, so a retry of a credit that did land does not pay twice |
| 048 | `migrations/048_scheduled-posts-music-mood.sql` | `scheduled_posts` gains nullable `music_mood` (issue #489): the requested BGM mood rides the slot row so a tick-dispatched or requeued slot renders with the requested mood instead of the engine default; pre-migration rows render the default |
| 049 | `migrations/049_facebook-provider.sql` | Facebook Pages as a publishing provider: `schedules.facebook_account_ids` (default empty) and `facebook` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list, so a live constraint the chain no longer defines cannot survive) |
| 050 | `migrations/050_pinterest-provider.sql` | Pinterest as a publishing provider: `schedules.pinterest_account_ids` (default empty) and nullable `schedules.pinterest_board_id` (the board a schedule publishes its pins to), and `pinterest` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list, so a live constraint the chain no longer defines cannot survive) |
| 051 | `migrations/051_scheduled_posts_publish_outcomes.sql` | `scheduled_posts.publish_outcomes` (jsonb, default `[]`): one row per provider, account, and video so a restart keeps accounts that already published and retries only the rest (issue #500) |
| 052 | `migrations/052_threespeak-provider.sql` | 3Speak (Hive) as a publishing provider: `schedules.threespeak_account_ids` (default empty) and `3speak` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list, so a live constraint the chain no longer defines cannot survive) |
| 053 | `migrations/053_rumble-provider.sql` | Rumble as a publishing provider: `schedules.rumble_account_ids` (default empty) and `rumble` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list, so a live constraint the chain no longer defines cannot survive) |
| 054 | `migrations/054_scheduled-posts-images-only-material.sql` | `scheduled_posts.voiceover_material` keeps only `'images'` (issue #542): stock B-roll and SVG are deleted, stored `'broll'`/`'svg'` rows are backfilled to `'images'`, the column default moves from `'broll'` to `'images'`, and the check drops the two dead values |
| 055 | `migrations/055_scheduled-posts-description.sql` | `scheduled_posts` gains nullable `description` (issue #542 follow-up): the agent-supplied video description rides the slot row so a tick-dispatched or requeued slot publishes with the agent's copy instead of the mechanical subject metadata; the description is REQUIRED on every new request; pre-migration rows are backfilled from the slot title so an already-prepaid row keeps generating (a row with no title at all still fails loudly) |
| 056 | `migrations/056_scheduled-posts-video-type.sql` | `scheduled_posts` gains `video_type` (issue #542 follow-up): the one video mode (`full_lipsync` / `hook_lipsync` / `voiceover`) replaces the `voiceover` / `full_lipsync` / `lipsync_enabled` boolean combination; stored rows are backfilled from the booleans, photo-aware: a row whose schedule's persona has no photo stays `voiceover` (it rendered images-only before), the column is NOT NULL with a `'hook_lipsync'` default and a check pinning the three values |
| 057 | `migrations/057_fanvue-provider.sql` | Fanvue as a publishing provider (issue #551): `schedules.fanvue_account_ids` (default empty) and `fanvue` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list, so a live constraint the chain no longer defines cannot survive); nullable `oauth_states.code_verifier` stores the PKCE verifier for the MCP connect-url flow |
| 058 | `migrations/058_slot-delete-ready.sql` | Ready slots are deletable (issue #555): the atomic delete guard `delete_slot_if_not_last` allows `ready` alongside `pending`/`failed` (a ready slot is generated but not yet dispatched, so deleting it prevents the later publish); last-slot guard and no-refund behaviour unchanged; the standalone `supabase/slot-delete-guard.sql` mirrors the live body, now from 065 |
| 059 | `migrations/059_owner-alert-notices.sql` | `owner_alert_notices` plus `claim_owner_alert` / `release_owner_alert` (issue #558): one row per user and dedup key so a broken account emails at most once per 7 days, and a failed generation or publish emails once per slot. RLS on, no policies, service_role only. A failed Resend send deletes the row so the next attempt can retry |
| 060 | `migrations/060_video-uploads.sql` | Signed video uploads for publish-by-id (issue #561): `video_uploads` (owner-bound row per upload, `pending`/`ready`/`consumed` single-use status, declared+detected video content types, size, expiry) pointing at `{user_id}/direct-uploads/{id}.{ext}` in the private `videos` bucket; owner-read RLS, writes via service role |
| 061 | `migrations/061_publish-ledger.sql` | Publish ledger (`publish_ledger` + `claim_publish_ledger` / `record_publish_ledger` RPCs, service-role only): one recorded publish per (scope key, provider, account) so a retry after the engine's 600s upload timeout replays the recorded post or waits for the in-flight attempt instead of posting a second identical video |
| 062 | `migrations/062_publish-ledger-unknown.sql` | Publish ledger gains `'unknown'`: a post whose record is lost after retries parks its claim as unknown (`mark_publish_unknown`, service-role only) so no retry can ever claim a fresh publish over it — the retry answers `publish_unknown` and the account waits for a human to verify the post on the provider; `claim_publish_ledger` returns the `unknown` outcome for such rows |
| 063 | `migrations/063_scheduled-posts-existing-media.sql` | Existing-media columns on `scheduled_posts` (issue #384): `media_kind` (`'upload'`/`'image'`, NULL on generation-born slots), `media_ref` (upload id or storage path), `media_content_type` — a scheduled post can publish media that already exists without an engine task id |
| 064 | `migrations/064_scheduled-posts-media-claimed-at.sql` | `scheduled_posts` gains nullable `media_claimed_at` (issue #384): the `consumed_at` of the `video_uploads` row this slot's own first attempt claimed, so a resume trusts a `consumed` row only when it is the slot's own claim — a foreign claim fails permanently instead of double-publishing or retrying forever |
| 065 | `migrations/065_definer-function-grants.sql` | SECURITY DEFINER grants (issues #460, #461, #462, #463, #465): the billing detectors, `refund_batch_tokens`, `settle_batch_clawback`, `restore_batch_discount_credit`, `delete_slot_if_not_last` and `record_persona_image_use` end up revoked from public/anon/authenticated and granted to service_role only; `set_primary_persona_image` keeps authenticated and both persona RPCs now bind writes to `auth.uid()` first (a spoofed `p_user_id` no longer redirects them); the slot-delete guard pins `search_path`; `mcp_oauth_clients` gets RLS with no policies + revoke from anon/authenticated (service-role-only DCR allowlist) |
| 066 | `migrations/066_core-tables-rls.sql` | Least-privilege row level security on the 001 core tables (issue #464). Number 065 is the definer-function grants migration, so this file is 066 and the two merge in either order. Enables RLS on `user_profiles`, `personas`, `schedules`, `scheduled_posts`, `social_accounts`, `video_generations`, `token_transactions`, `user_api_keys`, `stripe_webhook_events`, `mcp_oauth_clients`, `oauth_states` and `engine_heartbeat` (020). `authenticated` may only SELECT its own rows on the first seven tables (`social_accounts` SELECT excludes `encrypted_tokens`). Insert, update, and delete of personas, schedules, scheduled_posts, social_accounts, and video_generations are the service client: a session delete of slots plus generations makes `find_zombie_schedule_candidates` refund the batch, a direct `slot_at` write publishes a ready slot, and a direct `encrypted_tokens` write stores ciphertext the refresh path cannot decrypt. The last five tables get RLS with no policies plus a revoke from anon and authenticated. `mcp_oauth_clients` RLS is also enabled by migration 065; both statements are idempotent. `enforce_persona_image_limit` and `set_primary_persona_image` become security definer (`search_path` public) so a cookie session can still lock its own persona while inserting a library image or setting the primary; the RPC keeps authenticated EXECUTE and binds the row with `auth.uid()` before `p_user_id` |
| 067 | `migrations/067_scheduled-posts-upload-ref-unique.sql` | Partial unique index `scheduled_posts_upload_media_ref_key` on `media_ref` where `media_kind = 'upload'` and `status in ('pending', 'ready')`: a single-use signed upload backs at most one schedulable slot, so a second publish-existing call for the same upload answers 409 `VIDEO_UPLOAD_SCHEDULED` instead of scheduling a slot that fails at publish time. Before building the index it releases the duplicate rows production already holds (keeping the earliest slot per upload and deleting the schedules that leaves empty), and it never touches a publishing or published row, which `post_metrics` cascades from |
| 068 | `migrations/068_video-uploads-image-types.sql` | Widens `video_uploads_declared_content_type_check` and `video_uploads_detected_content_type_check` to `image/jpeg` and `image/png`: a signed upload can carry an image (8 MB cap, magic bytes verified) for the image networks, so the remote MCP server never sends image bytes as base64 |
| 069 | `migrations/069_social-accounts-needs-reconnect.sql` | `social_accounts.needs_reconnect` (issue #279): a dead provider login is stored on the account (default false) so a later schedule warns and the accounts page asks for a reconnect. The session JWT gains SELECT on that column only; writes stay on the service client, and a reconnect upsert clears the flag |
| 070 | `migrations/070_user-tool-configs.sql` | `user_tool_configs` (issue #669): one row per user with the configured search tool (`tavily`/`exa`), licensed stock sources (`pexels`/`pixabay`/`coverr`) and the API keys in one AES-256-GCM blob (`lib/token-crypto.ts`, same infra as `social_accounts.encrypted_tokens`). RLS on, no policies, revoked from anon/authenticated: service-role only, after the route proves ownership |
| 071 | `migrations/071_telegram-provider.sql` | Telegram as a publishing provider: `schedules.telegram_account_ids` (default empty) and `telegram` in both the `post_metrics.provider` and `social_accounts.provider` checks (each dropped and re-created with the full list). One provider covers channels and groups/supergroups — the destination kind is `social_accounts.account_metadata.chatType`, not a second provider |
| 072 | `migrations/072_persona-cta-intent.sql` | Per-persona CTA, intent only (issue #639): `personas.cta_type` (`follow`/`comment`/`share`/`save`/`link`/`buy`/`other`, NOT NULL DEFAULT `follow`), `cta_url` (≤2048) and `cta_instruction` (≤500), mirrored as `post_cta_*` snapshot columns on `schedules`. Drops the old stored-text columns `personas.cta_text` and `schedules.post_cta_text` (migration 024) — BETA rule: delete the old path, never keep both |
| 073 | `migrations/073_schedules-post-cta-type-nullable.sql` | `schedules.post_cta_type` drops NOT NULL (issue #639): a schedule legitimately has no CTA (voiceover posts, per-video `cta: null`), so NULL means "no CTA". No `follow` fallback — that would read back as a follow CTA and mismatch a no-CTA pair partner in `experiment-link.ts`. The CHECK still admits only the seven intent values for non-NULL rows |
| 074 | `migrations/074_schedules-post-cta-type-no-default.sql` | `schedules.post_cta_type` drops its `default 'follow'` (issue #639): the default let any writer omitting the column inherit `follow` by omission (publish-existing did exactly that). Both schedules writers now set the column explicitly, so no writer depends on the default |
| 075 | `migrations/075_user-tool-configs-own-search-tool.sql` | Widens the `user_tool_configs` search-tool check to (`tavily`, `exa`, `own`): the base prompt offers the agent's own web or MCP search tool, which 070 could only store as null. Shipped migrations are never edited, so the widening lands here instead of in 070 |
| 076 | `migrations/076_user-prompts.sql` | `user_prompts`: prompts written by users, `visibility` `private` (default) or `public`. A public prompt is visible to everybody with no review while the product is in beta; only the owner writes to a prompt. Public slugs are globally unique (partial unique index), private slugs unique per owner. A trigger keeps `updated_at`. RLS on, no policies, revoked from anon/authenticated: service-role only, after the route proves ownership (same pattern as 070). Behaviour pinned by `scripts/db/check-user-prompts.sql` in CI |
| 077 | `migrations/077_hook-panel.sql` | `personas.hook_panel` (NOT NULL DEFAULT true) and the snapshot `schedules.post_hook_panel` (NULL = written before 077, engine falls back to the persona, then true): whether a hook-only lip-sync video draws the segment photo as a panel under the talking face. The persona sets the default, each video may override it (`options.hookPanel`) |
| 078 | `migrations/078_prompt-versions.sql` | `prompt_versions`: every prompt text a video was written from, immutable (a guard trigger refuses updates except the `ON DELETE SET NULL` unlink). An AFTER trigger on `user_prompts` records version 1 on create and the next version whenever `body` changes (title/description/visibility do not); existing prompts are backfilled as version 1. A version has no visibility of its own: it is visible when its prompt is. Deleting a prompt keeps its versions with their slug and title. `ensure_official_prompt_version()` records official prompts (code, not rows) once per body hash and returns that version's id and number. `scheduled_posts.prompt_version_id` (FK) and `post_metrics.prompt_version_id` (snapshot, BEFORE INSERT trigger). **Drops the paired A/B experiments of 041/042** (tables, columns, trigger, `create_experiment()`) with their data. Service-role only. Behaviour pinned by `scripts/db/check-prompt-versions.sql` in CI |
| 079 | `migrations/079_post-metrics-daily.sql` | `post_metrics_daily` (issue #618): one cumulative reading per (post, provider, external video, UTC `snapshot_date`), counters nullable, unique on that key so a same-day re-run overwrites. Owner-select RLS like `post_metrics`; writes service-role only. Indexed for "latest reading minus the one about 24h earlier" (per video and per user/date). `post_metrics_daily_attempts` (post, UTC date; RLS on, no policy, service-role only) marks a post once every video reached a terminal outcome that day (read, gone, unresolved, unknown provider, dead token), so all-skipped posts do not stay due; transient failures leave no marker. `find_post_metrics_daily_due(p_now, p_limit)` returns published posts from the last 28 days with no attempt marker for today's UTC date, with the `provider:external_id` keys already read today (never-read first, then oldest newest-reading), definer, service-role only. Provider check carries the full list from `shared/contracts/providers.ts` |
| 080 | `migrations/080_share-links.sql` | `share_links` (issue #645): public read-only links to the metrics summary and the week's posts. Only the SHA-256 hash of the token is stored; `persona_ids` null = every persona, a list limits the page to those personas; `expires_at`, `revoked_at`, `last_viewed_at`. RLS: owners read their rows (column grant, `token_hash` excluded) and revoke them (update of `revoked_at` only); inserts and the public lookup are service-role only. `create_share_link(...)` inserts unless the user already holds `p_max` active links (one advisory lock per user), returns no row at the cap. `share_week_posts(...)` returns title, slot time, status and networks of an owner's posts in a week, deciding the persona scope inside one uncapped query (an orphaned post is kept only by an unscoped link). Both functions are definer, service-role only. Behaviour pinned by `scripts/db/check-share-links.sql` in CI |
| 081 | `migrations/081_scheduled-posts-lipsync-photos.sql` | `scheduled_posts.lipsync_photos` (jsonb, NULL for non-full videos): the 2-5 face photos of a full lip-sync video (`options.lipsyncPhotos`, each `{ mediaId }` or `{ url }`), written by the web at slot creation and forwarded by the engine batch pipeline. Window i of the narration (at most 12s each) shows photo i % count |
| 082 | `migrations/082_prompts-live-in-database.sql` | Prompts live only in `user_prompts`: adds `user_prompts.verified` (NOT NULL DEFAULT false, written only by the service role, never by the API) and drops `ensure_official_prompt_version()`. The former official prompts are moved into `user_prompts` as public, verified prompts of the Post Engineer system owner by a one-off SQL run outside the chain. Existing `source = 'official'` rows in `prompt_versions` stay, because posts and metrics point at them. |
| 083 | `migrations/083_scheduled-posts-voiceover.sql` | The `faceless` video mode is renamed `voiceover` (the persona's voice over the agent images, no lip sync; the images may show people): `video_type` rows and check move to `'voiceover'`, `scheduled_posts.faceless` → `voiceover`, `faceless_material` → `voiceover_material` (check renamed to match). |
| 084 | `migrations/084_persona-identity-card.sql` | `personas.identity_card jsonb` (nullable, no default, `jsonb_typeof = 'object'` check): the versioned identity card `{ version, identity, defaults }` the server renders into an image prompt for the agent's own image tool. The per-photo `scene` is not stored. Read only through `GET /api/persona/identity-card`, never in the persona list or on share pages. |
| 085 | `migrations/085_scheduled-posts-hook-title.sql` | `scheduled_posts.hook_title` (nullable text, 1-60 characters): the optional on-screen headline of a scheduled video, stored with the slot so the batch dispatch can forward it to the engine. The 60 mirrors `HOOK_TITLE_MAX_CHARS` in `shared/script-segments/hook-title.ts`. |

## Schema snapshot

`supabase/schema.snapshot.json` is Postgres's own report of the public schema after the whole chain is applied: columns (type, NOT NULL, default), constraints, RLS flag and policies. CI (`supabase-migrations`) regenerates it on the ephemeral Postgres and fails when the committed file is stale; unit tests compare it with the code (`migration-check-constraints-sync.test.ts` pins every enum CHECK to its TypeScript list). A migration that changes the schema therefore ships with the regenerated snapshot:

```bash
node scripts/db/dump-schema.mjs --db-url postgresql://postgres@127.0.0.1:5432/<freshly migrated db> --write
```

A constraint created by hand in production is invisible to this check; write it as a migration instead.

## How to apply

**Production (this repo's hosted project):** fully automated — never apply
manually. After a PR merges to `main`:

1. CI (`.github/workflows/ci.yml`, job `supabase-migrations`) has already
   validated the migration chain on the PR: numbering is unique and
   strictly increasing, and the whole chain applies cleanly to
   a fresh Postgres. BETA: there is no destructive-DDL label gate —
   destructive migrations are approved by the owner's merge tap, no
   separate label step; reintroduce the `db:destructive-approved` label
   gate explicitly when the first paying user arrives (the BETA flip rule).
2. The Deploy workflow (`.github/workflows/deploy.yml`) runs
   `supabase db push --linked --include-all`, which applies **migrations
   missing from the remote history table** (tracked in
   `supabase_migrations.schema_migrations`), including out-of-order ones:
   `--include-all` also applies an older-numbered migration whose PR merged
   after a newer one (plain `db push` would refuse those even though the
   SQL is idempotent). Without this flag a pending out-of-order migration
   fails every subsequent deploy until the flag is added.
3. The web app itself is deployed to our own VPS
   (`apps/web/docker-compose.yml`, via `deploy.sh` on the host) — migrations
   land first, then the host is redeployed.

**Self-hosters / local:** for each file, in order: Supabase Dashboard →
SQL Editor → New query → paste the file → run — or, from the repo root,
`supabase db push --db-url "<connection-string>"` (reads
`supabase/migrations/`). See each file's header for prerequisites and
details (some dashboard-only steps like RLS policies, FK checks and the
`personas` storage bucket are listed there too).

All statements are idempotent, so re-running the whole sequence is always
safe.

## `personas` storage bucket (private) — object layout

Objects live under the user's folder, then the persona's:

```
personas/{userId}/{personaId}/photo.{jpg|png}        the persona's single visual identity
personas/{userId}/{personaId}/images/{uuid}.{ext}    the image library (0-10 items)
personas/{userId}/cloned-voices/{cloneId}/reference.wav  cloned-voice reference audio (migration 023)
```

The persona folder is for **debugging in this dashboard** (you can tell whose
file it is without opening the database). It is not a second security gate:

- `personas_storage_own_all` checks ONLY the first segment —
  `(storage.foldername(name))[1] = auth.uid()`. A deeper path keeps working
  untouched, and the objects written before this layout (flat
  `{userId}/{uuid}.{ext}`) stay valid: the DB stores the full path in
  `personas.photo_path` / `persona_images.image_path`, so no backfill exists or
  is needed.
- Real ownership is enforced on the TABLE (`personas.user_id`,
  `persona_images.user_id`), re-checked by every route, and the bucket is
  private behind signed URLs.

Do not "harden" the policy to require two segments: that locks every legacy
object out of its owner with no way to recover the files.
`apps/web/lib/persona-images.ts` (`personaAssetPath`) is the only place that
builds these paths, and the tests pin the shape per writer.

## Adding a new migration (maintainers)

- **Append** a new numbered file (`migrations/005_....sql`,
  `migrations/006_....sql`, …). Never edit an already-shipped number —
  existing databases must be able to apply only the new files.
- Keep every statement idempotent (`create table if not exists`,
  `add column if not exists`, `create or replace`, `drop ... if exists`
  before recreate). Inline `references` in `create table` does NOT fire on
  an existing table — add FKs on existing tables in an explicit do-block
  (see section 1b of `migrations/002_persona-images.sql` for the pattern).
- Avoid destructive DDL. BETA: `DROP COLUMN`, `TRUNCATE`, and unconditional
  `DROP TABLE` are no longer blocked by a CI label gate — approval of a
  destructive migration is the owner's merge tap, no separate label step.
  Reintroduce the `db:destructive-approved` label gate explicitly when
  the first paying user arrives (the BETA flip rule).
- If the migration adds behavior the app depends on, add a static sync
  test that parses the SQL file and asserts the literals (see the
  `supabase/migrations/002_persona-images.sql literals` describe block in
  `apps/web/lib/__tests__/persona-images.test.ts` for the pattern).
- If the migration adds a column (`alter table ... add column`), regenerate
  the boot-time schema expectations:
  `node apps/web/scripts/generate-schema-expectations.mjs`. The web checks
  those columns against the live database at startup and reports a missing
  one (a deploy that went out before its migration), and
  `apps/web/lib/__tests__/schema-expectations-gen.test.ts` fails when the
  committed `lib/schema-expectations.gen.ts` is stale.
- Update the table above. It is the single migration list:
  `docs/SELF_HOSTING.md` links here instead of duplicating it.

## Pipeline secrets (repo settings → Secrets and variables → Actions)

| Secret                   | Used for                                              |
| ------------------------ | ----------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | `supabase link` authentication                        |
| `SUPABASE_PROJECT_ID`    | `supabase link --project-ref`                         |
| `SUPABASE_DB_PASSWORD`   | Direct Postgres connection used by `supabase db push` |

One-time production bootstrap (run once locally, before the first automated
deploy) — marks the previously dashboard-applied migrations as applied so
the first `db push` only picks up genuinely new files:

```bash
# Roda na sua máquina (não no CI nem na VPS), uma única vez, antes do
# primeiro deploy automático. Marca como aplicadas no histórico as migrations
# que já foram aplicadas manualmente pelo dashboard, sem rodar o SQL delas.
# Não precisa de `supabase link` nem de access token para este passo.
# (Versões são argumentos posicionais — não existe flag --version no repair.)
supabase migration repair --status applied 001 002 003 004 005 \
  --db-url "postgresql://postgres:<DB_PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres"
```
- `<DB_PASSWORD>`: Supabase Dashboard → Project Settings → Database
  (se perdeu, dá para resetar lá). Se a senha tiver caracteres especiais
  (`@`, `/`, `:`…), use a forma percent-encoded na URL (`@` → `%40`).
- `<PROJECT_REF>`: Dashboard → Project Settings → General → Reference ID
  (o `<ref>` de `https://<ref>.supabase.co`).

(All statements are idempotent, so skipping the repair is safe — the first
push would just re-apply everything as no-ops.)
