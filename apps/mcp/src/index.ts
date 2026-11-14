#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient, MAX_LIBRARY_IMAGES } from './client.js';
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
  UpdatePersonaImageShape,
  RemovePersonaImageShape,
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
  handleUpdatePersonaImage,
  handleRemovePersonaImage,
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
  WaitForVideoTasksShape,
  handleCancelVideoTask,
  handleWaitForVideoTasks,
} from './video-task-tools.js';
import { GeneratePersonaVideoShape, ValidateScriptShape, ValidateScriptDescription, ScoreDraftShape, ScoreDraftDescription, handleGeneratePersonaVideo, handleValidateScript, handleScoreDraft } from './tools-single-video.js';
import { CheckMediaDescription, CheckMediaShape, handleCheckMedia } from './tools-user-media.js';
import { CreatePersonaRemoteSchema, CreatePersonaRemoteShape, UpdatePersonaRemoteSchema, UpdatePersonaRemoteShape } from './remote-shapes.js';
import { registerLocalFileTools } from './local-file-tools.js';
import { registerPublishUploadedTools } from './publish-uploaded-tools.js';
import { ListPinterestBoardsDescription, ListPinterestBoardsShape, handleListPinterestBoards } from './tools-pinterest.js';
import { GeneratePersonaVideoBatchDescription, GeneratePersonaVideoBatchShape, handleGeneratePersonaVideoBatch } from './tools-batch.js';
import { AddExperimentPairShape, CreateExperimentShape, GetExperimentResultsShape, ListExperimentsShape, handleAddExperimentPair, handleCreateExperiment, handleGetExperimentResults, handleListExperiments } from './tools-experiments.js';
import { withTracking } from './analytics.js';
import { READ_ONLY, MUTATING, DESTRUCTIVE } from './tool-annotations.js';
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
  const isRemote = transport === 'http';

  if (isRemote) {
    server.tool(
      'create_persona',
      'Create a new AI persona with avatar, voice, language, and niche prompt. A face is REQUIRED: pass avatarUrl (public URL or list_faces). The remote server cannot read local files. A video without a face is a per-video choice — set options.videoType to "faceless" on generate_persona_video. At least one publishing account is REQUIRED (accounts): the persona is bound to those accounts and videos publish only to them.',
      CreatePersonaRemoteShape, MUTATING,
      withTracking('create_persona', withRecipeNudge(recipeSession, 'create_persona', async (args) => {
        return handleCreatePersona(apiClient, CreatePersonaRemoteSchema.parse(args));
      })),
    );
  } else {
    server.tool(
      'create_persona',
      'Create a new AI persona with avatar, voice, language, and niche prompt. A face is REQUIRED: pass avatarUrl (public URL or list_faces) or avatarPath (local photo file, uploaded directly). A video without a face is a per-video choice — set options.videoType to "faceless" on generate_persona_video. At least one publishing account is REQUIRED (accounts): the persona is bound to those accounts and videos publish only to them.',
      CreatePersonaShape, MUTATING,
      withTracking('create_persona', withRecipeNudge(recipeSession, 'create_persona', async (args) => {
        return handleCreatePersona(apiClient, args);
      })),
    );
  }

  server.tool(
    'list_personas',
    'List all existing personas for the authenticated user.',
    ListPersonasShape, READ_ONLY,
    withTracking('list_personas', withRecipeNudge(recipeSession, 'list_personas', async () => {
      return handleListPersonas(apiClient);
    }))
  );

  server.tool(
    'list_voices',
    'List persona voices (voiceId options): 65 English house voices, each with a text description of how it sounds plus gender/accent/kind, and your ready clones. Filter with gender, origin and search (e.g. "deep calm").',
    ListVoicesShape, READ_ONLY,
    withTracking('list_voices', async (args) => {
      return handleListVoices(apiClient, args);
    })
  );

  // Cloned-voice tools (list/create/get/delete/preview, plus the house-voice
  // preview) live in cloned-voice-tools.ts, next to their shapes/handlers.
  registerClonedVoiceTools(server, apiClient, isRemote);

  server.tool(
    'list_faces',
    'List default/stock persona faces (avatar options). Each face includes id, url, name, gender, age (single number, not a range), ethnicity, hair, and description in English so you can pick without seeing the photo. Pass a face url as avatarUrl when calling create_persona.',
    ListFacesShape, READ_ONLY,
    withTracking('list_faces', async () => {
      return handleListFaces(apiClient);
    })
  );

  if (isRemote) {
    server.tool(
      'update_persona',
      'Update an existing AI persona (only the provided fields change). Replace the face with avatarUrl. The remote server cannot read local files.',
      UpdatePersonaRemoteShape, MUTATING,
      withTracking('update_persona', async (args) => {
        return handleUpdatePersona(apiClient, UpdatePersonaRemoteSchema.parse(args));
      }),
    );
  } else {
    server.tool(
      'update_persona',
      'Update an existing AI persona (only the provided fields change). Replace the face with avatarUrl or avatarPath (local photo file).',
      UpdatePersonaShape, MUTATING,
      withTracking('update_persona', async (args) => {
        return handleUpdatePersona(apiClient, args);
      }),
    );
  }

  server.tool(
    'list_social_accounts',
    'List connected social accounts (YouTube, Instagram, LinkedIn, Threads, Facebook Pages, Bluesky, Pinterest, Rumble, Fanvue) with the account IDs needed for posting.',
    ListSocialAccountsShape, READ_ONLY,
    withTracking('list_social_accounts', withRecipeNudge(recipeSession, 'list_social_accounts', async () => {
      return handleListSocialAccounts(apiClient);
    }))
  );

  server.tool(
    'list_pinterest_boards',
    ListPinterestBoardsDescription,
    ListPinterestBoardsShape, READ_ONLY,
    withTracking('list_pinterest_boards', async (args) => {
      return handleListPinterestBoards(apiClient, args);
    })
  );

  server.tool(
    'get_persona_publishing_accounts',
    "List the publishing accounts a persona is bound to, per provider. generate_persona_video falls back to these when no account IDs are passed; explicit IDs must be a subset of the binding.",
    GetPersonaPublishingAccountsShape, READ_ONLY,
    withTracking('get_persona_publishing_accounts', async (args) => {
      return handleGetPersonaPublishingAccounts(apiClient, args);
    })
  );

  server.tool(
    'set_persona_publishing_accounts',
    "Replace the publishing accounts a persona is bound to (per provider). Account IDs come from list_social_accounts. Providers mapped to empty arrays keep no binding for that provider; the binding as a whole must keep at least one account.",
    SetPersonaPublishingAccountsShape, MUTATING,
    withTracking('set_persona_publishing_accounts', async (args) => {
      return handleSetPersonaPublishingAccounts(apiClient, args);
    })
  );

  server.tool(
    'connect_account',
    'Connect a social account. For youtube/instagram/linkedin/threads/facebook/pinterest/fanvue: returns an authorization URL — the user must open it in a browser where they are signed in to Post Engineer with the same account, and authorize; the account then connects automatically (verify with list_social_accounts). A browser that is not signed in, or signed in as another user, is rejected. For bluesky: connects directly with handle + appPassword (app password, not the main account password). For 3speak: connects directly with Hive username + posting key (posting key, not the owner/active/master password) For rumble: connects directly with channelId + accessToken (40-character Simple Upload API token, issued by emailing bd@rumble.com — no OAuth).',
    ConnectAccountShape, MUTATING,
    withTracking('connect_account', async (args) => {
      return handleConnectAccount(apiClient, args);
    })
  );

  server.tool(
    'list_schedules',
    'List all automation schedules for the authenticated user.',
    ListSchedulesShape, READ_ONLY,
    withTracking('list_schedules', async () => {
      return handleListSchedules(apiClient);
    })
  );

  server.tool(
    'list_posts',
    'List upcoming (scheduled) and past (published/failed) posts across all connected accounts. With from + to (ISO-8601 timestamps with UTC offset, at most 62 days) it instead returns every post of any status (awaiting|generating|ready|publishing|published|failed) with slot_at in [from, to) as one slots list plus truncated (true when the cap was hit) — use it to read a day or month. Without from/to it returns two lists: upcoming slots and recent results, each with id, slot_at, status (awaiting|generating|ready|publishing|published|failed; publishing appears in upcoming only when the slot already has userNotices), title, schedule_id, task_id, postUrl (the link to the post detail page — send it in chat so the user can watch or download the video and edit, reschedule or delete the post), progress (0-100: 0 for awaiting, 100 for ready/publishing/published, live engine progress for generating, last known for failed), stage (engine pipeline stage like "lipsync" while generating, "done" when complete, null otherwise), queuePosition/queueTotal (1-based position among the schedule\'s awaiting+generating slots; awaiting slots only, null otherwise). Failed slots also carry error and retryable (boolean: true when the failure looks transient). Use when the user asks about their posts — what is coming next, what already went out, how far a video has generated, where it sits in the queue, or why a post failed. Combine with list_schedules or list_social_accounts when persona/account names are needed. A slot that is still publishing is included in upcoming when it already has userNotices (requiresUser true): relay each notice as-is and do not retry, because only the user can fix the account. providerFailures lists every terminal account failure; its requiresUser is true only for the failures also in userNotices.',
    ListPostsShape, READ_ONLY,
    withTracking('list_posts', async (args) => {
      return handleListPosts(apiClient, args);
    })
  );

  server.tool(
    'cancel_schedule',
    'Cancel (delete) an automation schedule by its schedule ID. Unpublished slots (pending, generating, or ready) are removed so they cannot publish, and their prepaid tokens are refunded. A post already publishing or already published is not recalled. Use list_schedules to find the ID.',
    CancelScheduleShape, DESTRUCTIVE,
    withTracking('cancel_schedule', async (args) => {
      return handleCancelSchedule(apiClient, args);
    })
  );

  server.tool(
    'get_slot',
    'Get one scheduled post\'s full detail by slot ID: status, title, scheduled time, generation progress, its schedule (providers, publish mode) and persona. userNotices (requiresUser true) and providerFailures are on the slot as soon as an account fails, including while the slot is still publishing. Relay each userNotices notice. Only the user can fix that account. Do not retry it. The slot carries postUrl, the link to its post detail page — send it in chat so the user can watch or download the video and edit, reschedule or delete the post. Use the slotId from list_posts.',
    GetSlotShape, READ_ONLY,
    withTracking('get_slot', async (args) => {
      return handleGetSlot(apiClient, args);
    })
  );

  server.tool(
    'update_slot_title',
    'Edit the title text of one scheduled post. Only a pending/awaiting or ready slot can be edited — published or mid-flight slots are rejected.',
    UpdateSlotTitleShape, MUTATING,
    withTracking('update_slot_title', async (args) => {
      return handleUpdateSlotTitle(apiClient, args);
    })
  );

  server.tool(
    'delete_slot',
    'Delete one scheduled post slot. Only pending (awaiting), ready or failed slots can be deleted; published or mid-flight slots are rejected. The schedule\'s last slot cannot be deleted — use cancel_schedule to delete the whole schedule instead.',
    DeleteSlotShape, DESTRUCTIVE,
    withTracking('delete_slot', async (args) => {
      return handleDeleteSlot(apiClient, args);
    })
  );

  server.tool(
    'list_video_generations',
    'List the video generation history (newest first): one row per generated video with status, error code, token refund flag, and timestamps. Use get_video_generation for one row\'s detail.',
    ListVideoGenerationsShape, READ_ONLY,
    withTracking('list_video_generations', async (args) => {
      return handleListVideoGenerations(apiClient, args);
    })
  );

  server.tool(
    'get_video_generation',
    'Get one video generation\'s detail by generation ID (the generationId field from list_video_generations).',
    GetVideoGenerationShape, READ_ONLY,
    withTracking('get_video_generation', async (args) => {
      return handleGetVideoGeneration(apiClient, args);
    })
  );

  server.tool(
    'cancel_video_task',
    'Cancel/remove one of your video tasks on the generation engine by task id (from get_video_status, get_video_task_progress, get_post or list_posts). Only the caller\'s own task can be cancelled; a persona-scoped API key can only cancel tasks belonging to its personas. Unknown or already-finished tasks return an error. No token refund is issued by this call.',
    CancelVideoTaskShape, DESTRUCTIVE,
    withTracking('cancel_video_task', async (args) => {
      return handleCancelVideoTask(apiClient, args);
    })
  );

  server.tool(
    'get_post',
    'Get one post\'s full detail by id, whichever kind it is: a scheduled slot (kind "slot") or a direct video generation (kind "generation"). The server resolves the id, so there is no need to guess between get_slot and get_video_generation. Both kinds carry live generation progress while the video is still generating. A scheduled slot carries postUrl, the link to its post detail page — send it in chat so the user can watch or download the video and edit, reschedule or delete the post.',
    GetPostShape, READ_ONLY,
    withTracking('get_post', async (args) => {
      return handleGetPost(apiClient, args);
    })
  );

  server.tool(
    'get_post_metrics',
    'Get per-video performance snapshots (views, likes, comments, saves) of published posts for one window (24h, 7d or 28d), newest first, optionally filtered by persona, account, provider (network) and script angle. YouTube rows also carry YouTube Analytics retention for the user\'s own videos: engagedViews, stayedToWatchPct (derived: engaged views / views), averageViewPercentage, contentType, provisional (data may still change), and analyticsStatus (scope_missing = the user must reconnect YouTube). Returns rows plus truncated (true when more rows exist than the server cap).',
    GetPostMetricsShape, READ_ONLY,
    withTracking('get_post_metrics', async (args) => {
      return handleGetPostMetrics(apiClient, args);
    })
  );

  server.tool(
    'get_youtube_retention_curve',
    'Get the audience retention curve of one of the user\'s own published YouTube videos, read live from YouTube Analytics: points of ratio (elapsed share of the video, 0.01-1.0), audienceWatchRatio and relativeRetentionPerformance (vs. YouTube videos of similar length). Pass account and video from a youtube get_post_metrics row. Only the user\'s own channel is ever queried; a 403 YOUTUBE_ANALYTICS_SCOPE_MISSING means the user must reconnect YouTube.',
    GetYouTubeRetentionCurveShape, READ_ONLY,
    withTracking('get_youtube_retention_curve', async (args) => {
      return handleGetYouTubeRetentionCurve(apiClient, args);
    })
  );

  server.tool(
    'list_token_transactions',
    'List the token ledger: every token credit and debit (purchases, generation spends, refunds), newest first, with amounts, reasons, and the related generation when there is one. Use to audit where tokens went.',
    ListTokenTransactionsShape, READ_ONLY,
    withTracking('list_token_transactions', async (args) => {
      return handleListTokenTransactions(apiClient, args);
    })
  );

  server.tool(
    'get_persona_delete_preview',
    'Preview what deleting a persona would remove: counts of schedules, upcoming/published/failed slots, generated videos and library images, plus per-video download links (read-only, never mutates). Call before delete_persona.',
    GetPersonaDeletePreviewShape, READ_ONLY,
    withTracking('get_persona_delete_preview', async (args) => {
      return handleGetPersonaDeletePreview(apiClient, args);
    })
  );

  server.tool(
    'delete_persona',
    'DESTRUCTIVE and irreversible: delete a persona with all its schedules, slots, generated videos, and image library. No token refunds — prepaid tokens for pending slots are forfeited. Call get_persona_delete_preview first.',
    DeletePersonaShape, DESTRUCTIVE,
    withTracking('delete_persona', async (args) => {
      return handleDeletePersona(apiClient, args);
    })
  );

  server.tool(
    'disconnect_account',
    'Disconnect a social account by provider and account ID (the IDs from list_social_accounts). The account stops being available for publishing.',
    DisconnectAccountShape, DESTRUCTIVE,
    withTracking('disconnect_account', async (args) => {
      return handleDisconnectAccount(apiClient, args);
    })
  );

  server.tool(
    'get_token_balance',
    'Get the prepaid token wallet balance. Check before triggering video generation, which costs tokens.',
    GetTokenBalanceShape, READ_ONLY,
    withTracking('get_token_balance', withRecipeNudge(recipeSession, 'get_token_balance', async () => {
      return handleGetTokenBalance(apiClient);
    }))
  );

  server.tool(
    'generate_persona_video',
    'Generate and schedule ONE persona video from a complete script. Product rule: generation is always tied to publishing — one call generates the video AND schedules its automatic publish; there is no orphan generation. Send the full script as segments (first hook, then content takes in order — a CTA is a content take and may appear anywhere; 60-200 words total, content at least 30, hook 15-40 words ending with terminal punctuation) — no LLM expands it. title is the slot label for this video. Pass providers plus per-provider account IDs (see list_social_accounts), startAt (ISO datetime, wall-clock in timezone when naive), times (HH:MM, 24h), and timezone. Set mode to \'asap\' to publish the video the moment its generation finishes instead of scheduling it — startAt and times must NOT be set then. The slot must be 3h-30d ahead. idempotencyKey is generated automatically; reuse it to retry without generating twice (replayed: true). If the request is a topic rather than a ready script, call list_prompts first and follow the matching recipe with get_prompt instead of improvising the script — recipes pre-validate the script, media, and price facts before any token is spent; then pass its slug as recipe. Wait for the slot\'s taskId with wait_for_video_tasks — it blocks until the video completes or fails and reports the outcome.',
    GeneratePersonaVideoShape, MUTATING,
    withTracking('generate_persona_video', withScriptOutcome(recipeSession, 'generate_persona_video', async (args) => handleGeneratePersonaVideo(apiClient, args))),
  );
  server.tool('generate_persona_video_batch', GeneratePersonaVideoBatchDescription, GeneratePersonaVideoBatchShape, MUTATING, withTracking('generate_persona_video_batch', async (args) => handleGeneratePersonaVideoBatch(apiClient, args)));
  server.tool('validate_script', ValidateScriptDescription, ValidateScriptShape, READ_ONLY, withTracking('validate_script', withScriptOutcome(recipeSession, 'validate_script', async (args) => handleValidateScript(apiClient, args))));
  server.tool('score_draft', ScoreDraftDescription, ScoreDraftShape, READ_ONLY, withTracking('score_draft', async (args) => handleScoreDraft(apiClient, args)));
  server.tool('check_media', CheckMediaDescription, CheckMediaShape, READ_ONLY, withTracking('check_media', async (args) => handleCheckMedia(apiClient, args)));
  // Paired A/B content experiments (issue #476).
  server.tool('create_experiment', 'Create a paired A/B experiment that tests ONE script variable (the hook) with two variants, each with a slug variantId (e.g. hook-aggressive; never "A"/"B"), a name and a style description you will follow when writing its hooks. Then call add_experiment_pair once per pair. Results come from get_experiment_results.', CreateExperimentShape, MUTATING, withTracking('create_experiment', async (args) => handleCreateExperiment(apiClient, args)));
  server.tool('list_experiments', 'List your paired A/B experiments with their two variants and target pairs.', ListExperimentsShape, READ_ONLY, withTracking('list_experiments', async () => handleListExperiments(apiClient)));
  server.tool('add_experiment_pair', 'Create both videos of one experiment pair: the same title and content (segments, without the hook) and one hook per variant. Each video is a normal generate-and-schedule video (charged as usual); the second one starts spacingHours after the first and the order alternates per pair. The server rejects the second video of a pair (before charging; a concurrent race is caught after the insert and refunded) unless it matches the first in: the same providers and accounts, the same title, voice (id and audio URL), video type, video aspect and layout, paragraph number, face quality, language, niche and CTA text, and identical content segments, with a different hook. The pinned options.imageId is not stored, so it is not compared: pass the same imageId (or none) to both videos yourself. Calling it again with the same arguments replays the videos already created.', AddExperimentPairShape, MUTATING, withTracking('add_experiment_pair', async (args) => handleAddExperimentPair(apiClient, args)));
  server.tool('get_experiment_results', 'Get an experiment\'s videos by pair and its paired results per provider for a metrics window (default 7d): per-pair views/likes/comments/average view duration, wins per variant, sign-test pValue and a label — pending (nothing to compare), indicative (not proven: too few pairs or not all pairs in) or clear (every target pair decided and p < 0.05). Never call a variant the winner unless the label is clear.', GetExperimentResultsShape, READ_ONLY, withTracking('get_experiment_results', async (args) => handleGetExperimentResults(apiClient, args)));

  server.tool('get_video_status', 'Check the generation status and fetch final video URLs for a taskId. When the video belongs to a scheduled slot the body also carries postUrl, the link to its post detail page — send it in chat so the user can watch or download the video.', GetVideoStatusShape, READ_ONLY, withTracking('get_video_status', async (args) => handleGetVideoStatus(apiClient, args)));

  server.tool(
    'get_video_task_progress',
    'Poll one video task for its machine-readable progress: returns {task_id, state, progress, stage, error, postUrl}. error is the engine failure reason when state is -1 (failed), null otherwise. postUrl is the link to the post detail page when the video belongs to a scheduled slot (null otherwise) — send it in chat so the user can watch or download the video. Use for the video after generate_persona_video; prefer this over get_video_status when only progress matters. Prefer wait_for_video_tasks when you need the final outcome instead of progress snapshots.',
    GetVideoTaskProgressShape, READ_ONLY,
    withTracking('get_video_task_progress', async (args) => {
      return handleGetVideoTaskProgress(apiClient, args);
    })
  );

  server.tool(
    'wait_for_video_tasks',
    'Wait for one or more video tasks to reach a terminal state: blocks until every taskId completes (state 1) or fails (state -1, or gone from the engine), or the timeout elapses. Returns {summary, allTerminal, timedOut, results} with one entry per taskId: {task_id, state, outcome, progress, stage, error, postUrl}. error is the engine failure reason when outcome is failed. postUrl is the link to the post detail page when the video belongs to a scheduled slot (null otherwise) — send it in chat so the user can watch or download the video. Use after generate_persona_video or generate_persona_video_batch instead of polling get_video_task_progress. On timeout the results are partial: call again with the unfinished taskIds.',
    WaitForVideoTasksShape, READ_ONLY,
    withTracking('wait_for_video_tasks', async (args) => {
      return handleWaitForVideoTasks(apiClient, args);
    })
  );

  server.tool(
    'list_persona_images',
    `List the image library of a persona (up to ${MAX_LIBRARY_IMAGES} tagged images). Each entry has id, tag, description, and is_primary. Use the ids with generate_persona_video options.imageId to force a specific image for the video.`,
    ListPersonaImagesShape, READ_ONLY,
    withTracking('list_persona_images', async (args) => {
      return handleListPersonaImages(apiClient, args);
    })
  );

  server.tool(
    'update_persona_image',
    'Update a persona library image tag, description, or primary flag.',
    UpdatePersonaImageShape, MUTATING,
    withTracking('update_persona_image', async (args) => {
      return handleUpdatePersonaImage(apiClient, args);
    })
  );

  server.tool(
    'remove_persona_image',
    'Remove an image from a persona image library.',
    RemovePersonaImageShape, DESTRUCTIVE,
    withTracking('remove_persona_image', async (args) => {
      return handleRemovePersonaImage(apiClient, args);
    })
  );

  registerPublishUploadedTools(server, apiClient); // JSON-only signed-upload tools: both transports.
  // Local-file tools exist only on stdio, where the disk is the agent's
  // own machine; the remote server must never read paths from its host.
  if (!isRemote) registerLocalFileTools(server, apiClient);

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

export async function main() {
  // Without --http-transport the server stays on stdio, no port; with OAuth, HTTP requests authenticate, else loopback only.
  const httpOptions = parseHttpTransportOptions(process.argv.slice(2), process.env);
  if (httpOptions !== null) {
    // HTTP-only parse: stdio startup must never fail on a malformed HTTP limit.
    const authOptions = parseHttpAuthOptions(process.env);
    // OAuth mode needs no local key; loopback mode still fails fast without one.
    // Fresh server per request; the bearer is forwarded as this request's web API credential.
    const apiKey = authOptions !== null ? process.env.POST_ENGINEER_API_KEY : requireApiKey();
    await serveHttpTransport(
      (auth) => createPostEngineerMcpServer(new PostEngineerClient({ apiKey: auth?.bearer ?? apiKey, suppressVersionHeader: true }), 'http'),
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
