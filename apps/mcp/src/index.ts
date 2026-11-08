#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient, MAX_LIBRARY_IMAGES, MAX_LIBRARY_IMAGE_MB, MAX_UPLOAD_VIDEO_GB } from './client.js';
import {
  CreatePersonaShape,
  ListPersonasShape,
  ListVoicesShape,
  ListFacesShape,
  UpdatePersonaShape,
  ListSocialAccountsShape,
  ConnectAccountShape,
  ListSchedulesShape,
  GetTokenBalanceShape,
  ListPostsShape,
  CancelScheduleShape,
  GetSlotShape,
  UpdateSlotTitleShape,
  DeleteSlotShape,
  ListVideoGenerationsShape,
  GetVideoGenerationShape,
  ListTokenTransactionsShape,
  GetPersonaDeletePreviewShape,
  DeletePersonaShape,
  DisconnectAccountShape,
  GetVideoStatusShape,
  GetVideoTaskProgressShape,
  ListPersonaImagesShape,
  AddPersonaImageShape,
  UpdatePersonaImageShape,
  RemovePersonaImageShape,
  PublishVideoDirectShape,
  handleCreatePersona,
  handleListPersonas,
  handleListVoices,
  handleListFaces,
  handleUpdatePersona,
  handleListSocialAccounts,
  handleConnectAccount,
  handleListSchedules,
  handleCancelSchedule,
  handleGetSlot,
  handleUpdateSlotTitle,
  handleDeleteSlot,
  handleListVideoGenerations,
  handleGetVideoGeneration,
  handleListTokenTransactions,
  handleGetPersonaDeletePreview,
  handleDeletePersona,
  handleDisconnectAccount,
  handleGetTokenBalance,
  handleGetVideoStatus,
  handleGetVideoTaskProgress,
  handleListPersonaImages,
  handleAddPersonaImage,
  handleUpdatePersonaImage,
  handleRemovePersonaImage,
  handlePublishVideoDirect,
} from './tools.js';
import {
  GetPersonaPublishingAccountsShape,
  SetPersonaPublishingAccountsShape,
  handleGetPersonaPublishingAccounts,
  handleSetPersonaPublishingAccounts,
} from './tools-publishing-accounts.js';
import { registerClonedVoiceTools } from './cloned-voice-tools.js';
import {
  GetPostShape,
  GetPostMetricsShape,
  GetYouTubeRetentionCurveShape,
  handleGetPost,
  handleListPosts,
  handleGetPostMetrics,
  handleGetYouTubeRetentionCurve,
} from './tools-posts.js';
import {
  CancelVideoTaskShape,
  handleCancelVideoTask,
} from './video-task-tools.js';
import { GeneratePersonaVideoShape, ValidateScriptShape, ValidateScriptDescription, ScoreDraftShape, ScoreDraftDescription, handleGeneratePersonaVideo, handleValidateScript, handleScoreDraft } from './tools-single-video.js';
import { CheckMediaDescription, CheckMediaShape, UploadMediaDescription, UploadMediaShape, handleCheckMedia, handleUploadMedia } from './tools-user-media.js';
import { GeneratePersonaVideoBatchDescription, GeneratePersonaVideoBatchShape, handleGeneratePersonaVideoBatch } from './tools-batch.js';
import { AddExperimentPairShape, CreateExperimentShape, GetExperimentResultsShape, ListExperimentsShape, handleAddExperimentPair, handleCreateExperiment, handleGetExperimentResults, handleListExperiments } from './tools-experiments.js';
import { withTracking } from './analytics.js';
import { parseHttpTransportOptions, serveHttpTransport } from './http-transport.js';
import { parseHttpAuthOptions } from './http-auth.js';
import { SERVER_INSTRUCTIONS, registerPromptTools, withRecipeNudge, withScriptOutcome, type McpTransportKind } from './tools-prompts.js';
import { registerRemotePrompts } from './prompts.js';

// The server advertises the package version: import it so a version bump in
// package.json flows through without touching this file.
const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.POST_ENGINEER_API_KEY;
  if (!apiKey) {
    throw new Error('POST_ENGINEER_API_KEY is required');
  }
  return apiKey;
}

export function createPostEngineerMcpServer(client?: PostEngineerClient, transport: McpTransportKind = 'stdio'): McpServer {
  const apiClient = client ?? new PostEngineerClient({ apiKey: requireApiKey() });
  const server = new McpServer(
    {
      name: 'post-engineer-mcp',
      version: pkg.version,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerRemotePrompts(server, apiClient);
  const recipeSession = registerPromptTools(server, apiClient, transport);

  server.tool(
    'create_persona',
    'Create a new AI persona with avatar, voice, language, and niche prompt. A face is REQUIRED: pass avatarUrl (public URL or list_faces) or avatarPath (local photo file, uploaded directly). A video without a face is a per-video choice — set options.faceless on generate_persona_video.',
    CreatePersonaShape,
    withTracking('create_persona', withRecipeNudge(recipeSession, 'create_persona', async (args) => {
      return handleCreatePersona(apiClient, args);
    }))
  );

  server.tool(
    'list_personas',
    'List all existing personas for the authenticated user.',
    ListPersonasShape,
    withTracking('list_personas', withRecipeNudge(recipeSession, 'list_personas', async () => {
      return handleListPersonas(apiClient);
    }))
  );

  server.tool(
    'list_voices',
    'List persona voices (voiceId options): 65 English house voices, each with a text description of how it sounds plus gender/accent/kind, and your ready clones. Filter with gender, origin and search (e.g. "deep calm").',
    ListVoicesShape,
    withTracking('list_voices', async (args) => {
      return handleListVoices(apiClient, args);
    })
  );

  // Cloned-voice tools (list/create/get/delete/preview, plus the house-voice
  // preview) live in cloned-voice-tools.ts, next to their shapes/handlers.
  registerClonedVoiceTools(server, apiClient);

  server.tool(
    'list_faces',
    'List default/stock persona faces (avatar options). Each face includes id, url, name, gender, age (single number, not a range), ethnicity, hair, and description in English so you can pick without seeing the photo. Pass a face url as avatarUrl when calling create_persona.',
    ListFacesShape,
    withTracking('list_faces', async () => {
      return handleListFaces(apiClient);
    })
  );

  server.tool(
    'update_persona',
    'Update an existing AI persona (only the provided fields change). Replace the face with avatarUrl or avatarPath (local photo file).',
    UpdatePersonaShape,
    withTracking('update_persona', async (args) => {
      return handleUpdatePersona(apiClient, args);
    })
  );

  server.tool(
    'list_social_accounts',
    'List connected social accounts (YouTube, Instagram, LinkedIn, Threads, Bluesky) with the account IDs needed for posting.',
    ListSocialAccountsShape,
    withTracking('list_social_accounts', withRecipeNudge(recipeSession, 'list_social_accounts', async () => {
      return handleListSocialAccounts(apiClient);
    }))
  );

  server.tool(
    'get_persona_publishing_accounts',
    "List a persona's default publishing accounts per provider. generate_persona_video falls back to these when no account IDs are passed; explicit IDs always win.",
    GetPersonaPublishingAccountsShape,
    withTracking('get_persona_publishing_accounts', async (args) => {
      return handleGetPersonaPublishingAccounts(apiClient, args);
    })
  );

  server.tool(
    'set_persona_publishing_accounts',
    "Replace a persona's default publishing accounts (per provider). Account IDs come from list_social_accounts. Providers mapped to empty arrays keep no defaults.",
    SetPersonaPublishingAccountsShape,
    withTracking('set_persona_publishing_accounts', async (args) => {
      return handleSetPersonaPublishingAccounts(apiClient, args);
    })
  );

  server.tool(
    'connect_account',
    'Connect a social account. For youtube/instagram/linkedin/threads: returns an authorization URL — the user must open it in a browser where they are signed in to Post Engineer with the same account, and authorize; the account then connects automatically (verify with list_social_accounts). A browser that is not signed in, or signed in as another user, is rejected. For bluesky: connects directly with handle + appPassword (app password, not the main account password).',
    ConnectAccountShape,
    withTracking('connect_account', async (args) => {
      return handleConnectAccount(apiClient, args);
    })
  );

  server.tool(
    'list_schedules',
    'List all automation schedules for the authenticated user.',
    ListSchedulesShape,
    withTracking('list_schedules', async () => {
      return handleListSchedules(apiClient);
    })
  );

  server.tool(
    'list_posts',
    'List upcoming (scheduled) and past (published/failed) posts across all connected accounts. With from + to (ISO-8601 timestamps with UTC offset, at most 62 days) it instead returns every post of any status (awaiting|generating|ready|publishing|published|failed) with slot_at in [from, to) as one slots list plus truncated (true when the cap was hit) — use it to read a day or month. Without from/to it returns two lists: upcoming slots and recent results, each with id, slot_at, status (awaiting|generating|ready|published|failed), title, schedule_id, task_id, progress (0-100: 0 for awaiting, 100 for ready/publishing/published, live engine progress for generating, last known for failed), stage (engine pipeline stage like "lipsync" while generating, "done" when complete, null otherwise), queuePosition/queueTotal (1-based position among the schedule\'s awaiting+generating slots; awaiting slots only, null otherwise). Failed slots also carry error and retryable (boolean: true when the failure looks transient). Use when the user asks about their posts — what is coming next, what already went out, how far a video has generated, where it sits in the queue, or why a post failed. Combine with list_schedules or list_social_accounts when persona/account names are needed.',
    ListPostsShape,
    withTracking('list_posts', async (args) => {
      return handleListPosts(apiClient, args);
    })
  );

  server.tool(
    'cancel_schedule',
    'Cancel (delete) an automation schedule by its schedule ID. Unpublished slots (pending, generating, or ready) are removed so they cannot publish, and their prepaid tokens are refunded. A post already publishing or already published is not recalled. Use list_schedules to find the ID.',
    CancelScheduleShape,
    withTracking('cancel_schedule', async (args) => {
      return handleCancelSchedule(apiClient, args);
    })
  );

  server.tool(
    'get_slot',
    'Get one scheduled post\'s full detail by slot ID: status, title, scheduled time, generation progress, its schedule (providers, publish mode) and persona. Use the slotId from list_posts.',
    GetSlotShape,
    withTracking('get_slot', async (args) => {
      return handleGetSlot(apiClient, args);
    })
  );

  server.tool(
    'update_slot_title',
    'Edit the title text of one scheduled post. Only a slot that has not started generating (status pending/awaiting) can be edited — published or mid-flight slots are rejected.',
    UpdateSlotTitleShape,
    withTracking('update_slot_title', async (args) => {
      return handleUpdateSlotTitle(apiClient, args);
    })
  );

  server.tool(
    'delete_slot',
    'Delete one scheduled post slot. Only pending (awaiting) or failed slots can be deleted; published or mid-flight slots are rejected. The schedule\'s last slot cannot be deleted — use cancel_schedule to delete the whole schedule instead.',
    DeleteSlotShape,
    withTracking('delete_slot', async (args) => {
      return handleDeleteSlot(apiClient, args);
    })
  );

  server.tool(
    'list_video_generations',
    'List the video generation history (newest first): one row per generated video with status, error code, token refund flag, and timestamps. Use get_video_generation for one row\'s detail.',
    ListVideoGenerationsShape,
    withTracking('list_video_generations', async (args) => {
      return handleListVideoGenerations(apiClient, args);
    })
  );

  server.tool(
    'get_video_generation',
    'Get one video generation\'s detail by generation ID (the generationId field from list_video_generations).',
    GetVideoGenerationShape,
    withTracking('get_video_generation', async (args) => {
      return handleGetVideoGeneration(apiClient, args);
    })
  );

  server.tool(
    'cancel_video_task',
    'Cancel/remove one of your video tasks on the generation engine by task id (from get_video_status, get_video_task_progress, get_post or list_posts). Only the caller\'s own task can be cancelled; a persona-scoped API key can only cancel tasks belonging to its personas. Unknown or already-finished tasks return an error. No token refund is issued by this call.',
    CancelVideoTaskShape,
    withTracking('cancel_video_task', async (args) => {
      return handleCancelVideoTask(apiClient, args);
    })
  );

  server.tool(
    'get_post',
    'Get one post\'s full detail by id, whichever kind it is: a scheduled slot (kind "slot") or a direct video generation (kind "generation"). The server resolves the id, so there is no need to guess between get_slot and get_video_generation. Both kinds carry live generation progress while the video is still generating.',
    GetPostShape,
    withTracking('get_post', async (args) => {
      return handleGetPost(apiClient, args);
    })
  );

  server.tool(
    'get_post_metrics',
    'Get per-video performance snapshots (views, likes, comments, saves) of published posts for one window (24h, 7d or 28d), newest first, optionally filtered by persona, account, provider (network) and script angle. YouTube rows also carry YouTube Analytics retention for the user\'s own videos: engagedViews, stayedToWatchPct (derived: engaged views / views), averageViewPercentage, contentType, provisional (data may still change), and analyticsStatus (scope_missing = the user must reconnect YouTube). Returns rows plus truncated (true when more rows exist than the server cap).',
    GetPostMetricsShape,
    withTracking('get_post_metrics', async (args) => {
      return handleGetPostMetrics(apiClient, args);
    })
  );

  server.tool(
    'get_youtube_retention_curve',
    'Get the audience retention curve of one of the user\'s own published YouTube videos, read live from YouTube Analytics: points of ratio (elapsed share of the video, 0.01-1.0), audienceWatchRatio and relativeRetentionPerformance (vs. YouTube videos of similar length). Pass account and video from a youtube get_post_metrics row. Only the user\'s own channel is ever queried; a 403 YOUTUBE_ANALYTICS_SCOPE_MISSING means the user must reconnect YouTube.',
    GetYouTubeRetentionCurveShape,
    withTracking('get_youtube_retention_curve', async (args) => {
      return handleGetYouTubeRetentionCurve(apiClient, args);
    })
  );

  server.tool(
    'list_token_transactions',
    'List the token ledger: every token credit and debit (purchases, generation spends, refunds), newest first, with amounts, reasons, and the related generation when there is one. Use to audit where tokens went.',
    ListTokenTransactionsShape,
    withTracking('list_token_transactions', async (args) => {
      return handleListTokenTransactions(apiClient, args);
    })
  );

  server.tool(
    'get_persona_delete_preview',
    'Preview what deleting a persona would remove: counts of schedules, upcoming/published/failed slots, generated videos and library images, plus per-video download links (read-only, never mutates). Call before delete_persona.',
    GetPersonaDeletePreviewShape,
    withTracking('get_persona_delete_preview', async (args) => {
      return handleGetPersonaDeletePreview(apiClient, args);
    })
  );

  server.tool(
    'delete_persona',
    'DESTRUCTIVE and irreversible: delete a persona with all its schedules, slots, generated videos, and image library. No token refunds — prepaid tokens for pending slots are forfeited. Call get_persona_delete_preview first.',
    DeletePersonaShape,
    withTracking('delete_persona', async (args) => {
      return handleDeletePersona(apiClient, args);
    })
  );

  server.tool(
    'disconnect_account',
    'Disconnect a social account by provider and account ID (the IDs from list_social_accounts). The account stops being available for publishing.',
    DisconnectAccountShape,
    withTracking('disconnect_account', async (args) => {
      return handleDisconnectAccount(apiClient, args);
    })
  );

  server.tool(
    'get_token_balance',
    'Get the prepaid token wallet balance. Check before triggering video generation, which costs tokens.',
    GetTokenBalanceShape,
    withTracking('get_token_balance', withRecipeNudge(recipeSession, 'get_token_balance', async () => {
      return handleGetTokenBalance(apiClient);
    }))
  );

  server.tool(
    'generate_persona_video',
    'Generate and schedule ONE persona video from a complete script. Product rule: generation is always tied to publishing — one call generates the video AND schedules its automatic publish; there is no orphan generation. Send the full script as segments (first hook, then body, last CTA; 60-200 words total, body at least 30, CTA 5-20, hook 15-40 words ending with terminal punctuation) — no LLM expands it. title is the slot label for this video. Pass providers plus per-provider account IDs (see list_social_accounts), startAt (ISO datetime, wall-clock in timezone when naive), times (HH:MM, 24h), and timezone. Set mode to \'asap\' to publish the video the moment its generation finishes instead of scheduling it — startAt and times must NOT be set then. The slot must be 3h-30d ahead. idempotencyKey is generated automatically; reuse it to retry without generating twice (replayed: true). If the request is a topic rather than a ready script, call list_prompts first and follow the matching recipe with get_prompt instead of improvising the script — recipes pre-validate the script, media, and price facts before any token is spent; then pass its slug as recipe. Poll the slot\'s taskId with get_video_task_progress.',
    GeneratePersonaVideoShape,
    withTracking('generate_persona_video', withScriptOutcome(recipeSession, 'generate_persona_video', async (args) => handleGeneratePersonaVideo(apiClient, args))),
  );
  server.tool('generate_persona_video_batch', GeneratePersonaVideoBatchDescription, GeneratePersonaVideoBatchShape, withTracking('generate_persona_video_batch', async (args) => handleGeneratePersonaVideoBatch(apiClient, args)));
  server.tool('validate_script', ValidateScriptDescription, ValidateScriptShape, withTracking('validate_script', withScriptOutcome(recipeSession, 'validate_script', async (args) => handleValidateScript(apiClient, args))));
  server.tool('score_draft', ScoreDraftDescription, ScoreDraftShape, withTracking('score_draft', async (args) => handleScoreDraft(apiClient, args)));
  server.tool('upload_media', UploadMediaDescription, UploadMediaShape, withTracking('upload_media', async (args) => handleUploadMedia(apiClient, args)));
  server.tool('check_media', CheckMediaDescription, CheckMediaShape, withTracking('check_media', async (args) => handleCheckMedia(apiClient, args)));
  // Paired A/B content experiments (issue #476).
  server.tool('create_experiment', 'Create a paired A/B experiment that tests ONE script variable (the hook) with two variants, each with a slug variantId (e.g. hook-aggressive; never "A"/"B"), a name and a style description you will follow when writing its hooks. Then call add_experiment_pair once per pair. Results come from get_experiment_results.', CreateExperimentShape, withTracking('create_experiment', async (args) => handleCreateExperiment(apiClient, args)));
  server.tool('list_experiments', 'List your paired A/B experiments with their two variants and target pairs.', ListExperimentsShape, withTracking('list_experiments', async () => handleListExperiments(apiClient)));
  server.tool('add_experiment_pair', 'Create both videos of one experiment pair: the same title, body and CTA (segments, without the hook) and one hook per variant. Each video is a normal generate-and-schedule video (charged as usual); the second one starts spacingHours after the first and the order alternates per pair. The server rejects the second video of a pair (before charging; a concurrent race is caught after the insert and refunded) unless it matches the first in: the same providers and accounts, the same title, voice (id and audio URL), faceless and faceless material, full lip-sync, video aspect and layout, paragraph number, face quality, language, niche and CTA text, and identical body and CTA segments, with a different hook. The pinned options.imageId is not stored, so it is not compared: pass the same imageId (or none) to both videos yourself. Calling it again with the same arguments replays the videos already created.', AddExperimentPairShape, withTracking('add_experiment_pair', async (args) => handleAddExperimentPair(apiClient, args)));
  server.tool('get_experiment_results', 'Get an experiment\'s videos by pair and its paired results per provider for a metrics window (default 7d): per-pair views/likes/comments/average view duration, wins per variant, sign-test pValue and a label — pending (nothing to compare), indicative (not proven: too few pairs or not all pairs in) or clear (every target pair decided and p < 0.05). Never call a variant the winner unless the label is clear.', GetExperimentResultsShape, withTracking('get_experiment_results', async (args) => handleGetExperimentResults(apiClient, args)));

  server.tool('get_video_status', 'Check the generation status and fetch final video URLs for a taskId.', GetVideoStatusShape, withTracking('get_video_status', async (args) => handleGetVideoStatus(apiClient, args)));

  server.tool(
    'get_video_task_progress',
    'Poll one video task for its machine-readable progress: returns {task_id, state, progress, stage, error}. error is the engine failure reason when state is -1 (failed), null otherwise. Use for the video after generate_persona_video; prefer this over get_video_status when only progress matters.',
    GetVideoTaskProgressShape,
    withTracking('get_video_task_progress', async (args) => {
      return handleGetVideoTaskProgress(apiClient, args);
    })
  );

  server.tool(
    'list_persona_images',
    `List the image library of a persona (up to ${MAX_LIBRARY_IMAGES} tagged images). Each entry has id, tag, description, and is_primary. Use the ids with generate_persona_video options.imageId to force a specific image for the video.`,
    ListPersonaImagesShape,
    withTracking('list_persona_images', async (args) => {
      return handleListPersonaImages(apiClient, args);
    })
  );

  server.tool(
    'add_persona_image',
    `Add an image to a persona image library from a local file path (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB). Optional tag and description drive the deterministic per-video image selection. The server rejects full libraries (${MAX_LIBRARY_IMAGES} max).`,
    AddPersonaImageShape,
    withTracking('add_persona_image', async (args) => {
      return handleAddPersonaImage(apiClient, args);
    })
  );

  server.tool(
    'update_persona_image',
    'Update a persona library image tag, description, or primary flag.',
    UpdatePersonaImageShape,
    withTracking('update_persona_image', async (args) => {
      return handleUpdatePersonaImage(apiClient, args);
    })
  );

  server.tool(
    'remove_persona_image',
    'Remove an image from a persona image library.',
    RemovePersonaImageShape,
    withTracking('remove_persona_image', async (args) => {
      return handleRemovePersonaImage(apiClient, args);
    })
  );

  server.tool(
    'publish_video_direct',
    `Publish a ready-made video file directly to social accounts — no generation, no schedule. Reads a local video (.mp4 or .mov, max ${MAX_UPLOAD_VIDEO_GB}GB) and posts it immediately via POST /api/upload-content. YouTube requires title, description, tags, and privacyStatus; Instagram/Bluesky/LinkedIn/Threads require caption.`,
    PublishVideoDirectShape,
    withTracking('publish_video_direct', async (args) => {
      return handlePublishVideoDirect(apiClient, args);
    })
  );

  return server;
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Realpath both sides: the published bin is launched through a symlinked
    // .bin entry, and Node may keep the symlink path in either argv[1] or
    // import.meta.url — realpathing both makes the comparison robust either way.
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
  // Without --http-transport the server stays on stdio, no port; with OAuth, HTTP requests authenticate, else loopback only.
  const httpOptions = parseHttpTransportOptions(process.argv.slice(2), process.env);
  if (httpOptions !== null) {
    // HTTP-only parse: stdio startup must never fail on a malformed HTTP limit.
    const authOptions = parseHttpAuthOptions(process.env);
    // OAuth mode needs no local key; loopback mode still fails fast without one.
    // Fresh server per request; the bearer is forwarded as this request's web API credential.
    const apiKey = authOptions !== null ? process.env.POST_ENGINEER_API_KEY : requireApiKey();
    await serveHttpTransport(
      (auth) => createPostEngineerMcpServer(new PostEngineerClient({ apiKey: auth?.bearer ?? apiKey }), 'http'),
      httpOptions,
      authOptions,
    );
    return;
  }
  const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: requireApiKey() }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
