import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PostEngineerClient } from './client.js';
import {
  MAX_LIBRARY_IMAGES,
  MAX_LIBRARY_IMAGE_MB,
  MAX_LIBRARY_TAG_LENGTH,
  MAX_LIBRARY_DESCRIPTION_LENGTH,
} from './client.js';
import { getErrorMessage, ApiError } from './errors.js';

export type McpToolResponse = CallToolResult;

// Shared field definitions: path/tag/description limits appear in both the
// create-persona images array and add_persona_image — define once so the
// limits and descriptions can't drift apart.
const LibraryImageFields = {
  path: z.string().min(1).describe(`Local file path to the image (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB)`),
  tag: z.string().max(MAX_LIBRARY_TAG_LENGTH).optional().describe('Short tag for deterministic per-video matching (e.g. casual, formal, gym)'),
  description: z.string().max(MAX_LIBRARY_DESCRIPTION_LENGTH).optional().describe('Description of the photo for tag/keyword matching (e.g. smiling at the beach at sunset)'),
};

// Single source of truth: index.ts registers these shapes directly with the
// MCP server, so field definitions (and their descriptions) live here only.
const PersonaLibraryImageInputShape = z.object(LibraryImageFields);

export const CreatePersonaShape = {
  name: z.string().min(1, 'Name is required').describe('Name of the persona'),
  // REQUIRED: every persona has a face. A video without one is a per-video
  // choice (generate_persona_videos options.faceless), never a persona one.
  avatarUrl: z
    .string()
    .url()
    .describe(
      'REQUIRED. Public URL to the persona avatar image (use list_faces for stock face URLs). Every persona has a face; "no face" is chosen per video with generate_persona_videos options.faceless.',
    ),
  voiceId: z.string().default('alloy').describe('Voice ID to use (e.g. alloy, echo)'),
  language: z.string().default('en-US').describe('Language code (e.g. pt-BR, en-US)'),
  videoAspect: z.enum(['9:16', '16:9']).default('9:16').describe('Video aspect ratio'),
  scriptPrompt: z.string().optional().default('').describe('System prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).default(1).describe('Number of paragraphs'),
  niche: z.string().optional().default('General').describe('Content niche topic'),
  faceQuality: z.enum(['ok', 'very_good']).default('very_good').describe('Face resolution of the rendered videos: ok (480p, 2 tokens/video) or very_good (720p, 3 tokens/video)'),
  images: z.array(PersonaLibraryImageInputShape).max(MAX_LIBRARY_IMAGES).optional().describe(`Up to ${MAX_LIBRARY_IMAGES} local image files of the same person for the persona image library. Each video deterministically picks the best-matching image by tag.`),
  imagePrimaryIndex: z.number().int().min(0).max(MAX_LIBRARY_IMAGES - 1).optional().describe('Index into images[] marking the primary library image (no primary is set when omitted)'),
};

export const CreatePersonaSchema = z.object(CreatePersonaShape);

export const ListPersonasShape = {};

export const ListPersonasSchema = z.object(ListPersonasShape);

export const ListVoicesShape = {};

export const ListVoicesSchema = z.object(ListVoicesShape);

export const ListFacesShape = {};

export const ListFacesSchema = z.object(ListFacesShape);

export const UpdatePersonaShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to update'),
  name: z.string().min(1).optional().describe('New name for the persona'),
  // No .nullable(): the API has no "clear avatar" sentinel — null would be silently ignored.
  avatarUrl: z.string().url().optional().describe('New public avatar image URL'),
  voiceId: z.string().optional().describe('New voice ID (see list_voices)'),
  language: z.string().optional().describe('New language code (e.g. pt-BR, en-US)'),
  videoAspect: z.enum(['9:16', '16:9']).optional().describe('New video aspect ratio'),
  scriptPrompt: z.string().optional().describe('New system prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).optional().describe('New number of paragraphs'),
  niche: z.string().max(300).optional().describe('New content niche topic'),
};

export const UpdatePersonaSchema = z.object(UpdatePersonaShape);

export const ListSocialAccountsShape = {};

export const ListSocialAccountsSchema = z.object(ListSocialAccountsShape);

export const ConnectAccountShape = {
  provider: z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']).describe('The social platform to connect'),
  handle: z.string().min(1).optional().describe('Bluesky handle (e.g. user.bsky.social). Required only for bluesky.'),
  appPassword: z.string().min(1).optional().describe('Bluesky app password (Settings > App passwords). Required only for bluesky. Never shared or logged.'),
};

export const ConnectAccountSchema = z.object(ConnectAccountShape);

export const ListSchedulesShape = {};

export const ListSchedulesSchema = z.object(ListSchedulesShape);

export const ListPostsShape = {
  limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500.'),
};

export const ListPostsSchema = z.object(ListPostsShape);

export const CancelScheduleShape = {
  scheduleId: z.string().min(1, 'scheduleId is required').describe('The ID of the schedule to cancel'),
};

export const CancelScheduleSchema = z.object(CancelScheduleShape);

export const GetTokenBalanceShape = {};

export const GetTokenBalanceSchema = z.object(GetTokenBalanceShape);

// Loopback hosts for which a plain http: media/webhook URL is tolerated
// (local dev callbacks). Anything else must be https so the URL's content
// never travels in cleartext.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isHttpsOrLoopbackHttp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
}

/** URL field for user-supplied media/webhook URLs: https, or http on loopback only. */
function httpsUrlField(fieldName: string) {
  return z
    .string()
    .url(`${fieldName} must be a valid URL`)
    .refine(isHttpsOrLoopbackHttp, {
      message: `${fieldName} must be an https URL (http is allowed only for loopback hosts like localhost)`,
    });
}

// Shared per-provider account-id fields for generate_persona_videos.
// Defined once so the four provider blocks can't drift apart; the server
// enforces which providers need accounts, the client only maps them.
const PublishingAccountIdsShape = {
  youtubeAccountIds: z.array(z.string().min(1)).optional().describe('YouTube channel IDs (the channelId field from list_social_accounts). Required when providers includes youtube.'),
  instagramAccountIds: z.array(z.string().min(1)).optional().describe('Instagram account IDs (the igUserId field from list_social_accounts). Required when providers includes instagram.'),
  linkedinAccountIds: z.array(z.string().min(1)).optional().describe('LinkedIn account IDs (the providerAccountId field from list_social_accounts). Required when providers includes linkedin.'),
  blueskyAccountIds: z.array(z.string().min(1)).optional().describe('Bluesky DIDs (the did field from list_social_accounts). Required when providers includes bluesky.'),
};

export const GeneratePersonaVideosShape = {
  // Optional since migration 012: a faceless post can be defined entirely by
  // options. A persona is not only a face — it is where the voice, the script
  // prompt, the aspect ratio and the niche come from, so a post without one
  // must supply them (or at least a voice) via options.
  personaId: z
    .string()
    .min(1, 'personaId must be a non-empty string when provided')
    .optional()
    .describe('The persona to generate videos with. Omit for a faceless post with no persona: in that case set options.faceless and options.voiceId (or options.audioUrl), plus options.scriptPrompt / videoAspect / language / niche as needed. With a persona these options still override it.'),
  // The array bounds live in the shape (not a .refine): the MCP SDK parses
  // tool args against the raw shape, so a whole-object refine would be a
  // hollow claim on the tool path (round 26 learning).
  topics: z
    .array(z.string().min(1, 'Each topic must be a non-empty string'))
    .min(1, 'Provide at least one video topic')
    .max(10, 'At most 10 topics per call')
    .describe('Video topics, one per video (1-10). In scheduled mode the server assigns each topic a publish slot: topic i goes to day startAt\'s date + floor(i/times.length) at the i-th sorted time. In asap mode each video publishes the moment its generation finishes.'),
  providers: z
    .array(z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']))
    .min(1, 'Provide at least one provider')
    .describe('Where to publish the videos.'),
  ...PublishingAccountIdsShape,
  // Publish mode: 'scheduled' (default) distributes publish slots across
  // startAt + times; 'asap' publishes each video the moment generation
  // finishes, with no scheduled time. In asap mode startAt and times must
  // NOT be set (the handler fails fast on a stray plan).
  mode: z
    .enum(['scheduled', 'asap'])
    .default('scheduled')
    .describe("Publish mode: 'scheduled' (default) slots each video across startAt + times; 'asap' publishes each video the moment generation finishes, with no scheduled time — do not set startAt or times."),
  startAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'startAt must be a valid ISO datetime (e.g. "2026-10-02T20:00:00")',
    })
    .optional()
    .describe('When the first publish slot may start: ISO datetime. A naive "2026-10-02T20:00:00" is wall-clock in timezone. Required unless mode is \'asap\'. Slots before startAt are skipped; every slot must be 3h–30d ahead.'),
  times: z
    .array(
      z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Each time must be HH:MM in 24-hour format (e.g. "09:30", "20:00")')
    )
    .min(1, 'Provide at least one publish time')
    .optional()
    .describe('Daily publish times in HH:MM 24-hour format. Required unless mode is \'asap\'.'),
  timezone: z.string().min(1).default('UTC').describe('IANA timezone for a naive startAt and the HH:MM times, e.g. "Europe/Lisbon". Defaults to UTC. Display-only when mode is \'asap\'.'),
  options: z
    .object({
      faceless: z.boolean().optional().describe('Generate faceless (no face). With a persona this drops only the face — the persona voice, niche and script prompt still apply. Without a persona it is REQUIRED.'),
      audioUrl: httpsUrlField('audioUrl').optional().describe('Public URL of custom audio for the videos (overrides the persona voice).'),
      imageId: z.string().min(1, 'imageId must be a non-empty string').optional().describe('Library image ID to use for every video (overrides the deterministic per-video selection; see list_persona_images).'),
      scriptPrompt: z.string().optional().describe('Script prompt override applied to every video in this call.'),
      scriptPrompts: z.array(z.string().min(1)).optional().describe('Per-topic script prompt overrides; must have one entry per topic.'),
      voiceId: z.string().min(1, 'voiceId must be a non-empty string').optional().describe('Voice ID override (see list_voices).'),
      webhookUrl: httpsUrlField('webhookUrl').optional().describe('Callback URL the server POSTs to when each video reaches a terminal state (completed/failed).'),
      videoAspect: z.enum(['9:16', '16:9']).optional().describe('Frame shape. Overrides the persona when one is given; a post without a persona defaults to 9:16.'),
      paragraphNumber: z.number().int().min(1).max(10).optional().describe('Paragraph count (1-10). Overrides the persona when one is given.'),
      language: z.string().min(1).max(32).optional().describe('Spoken language code, e.g. pt-BR. Overrides the persona when one is given.'),
      niche: z.string().min(1).max(300).optional().describe('Content niche. Overrides the persona when one is given.'),
    })
    .optional()
    .describe('Generation options applied to the videos in this call.'),
  idempotencyKey: z.string().min(1).optional().describe('Idempotency key: retrying the call with the same key returns the original schedule (replayed: true) instead of generating again. A UUID is generated automatically when omitted.'),
};

export const GeneratePersonaVideosSchema = z.object(GeneratePersonaVideosShape);

export const ListPersonaImagesShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona whose image library to list'),
};

export const ListPersonaImagesSchema = z.object(ListPersonaImagesShape);

export const AddPersonaImageShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to add the image to'),
  ...LibraryImageFields,
  // Swap-only, symmetric with update_persona_image: isPrimary:false on a new
  // image is meaningless (it is never primary unless marked), so the schema
  // accepts only true and surfaces the constraint at parse time instead of
  // silently dropping the flag.
  isPrimary: z
    .literal(true)
    .optional()
    .describe('Set true to mark this image as the primary library image (false is rejected — a new image is not primary unless marked)'),
};

export const AddPersonaImageSchema = z.object(AddPersonaImageShape);

export const UpdatePersonaImageShape = {
  id: z.string().min(1, 'id is required').describe('The library image ID to update'),
  // Reuse the shared field definitions so tag/description limits can't drift
  // from the create path; PATCH supports clearing via empty string, which the
  // create schema's .min(1) path field doesn't need. Whitespace-only values
  // trim to '' client-side and therefore clear too (server convention:
  // undefined = keep, '' = clear) — the descriptions say so explicitly.
  tag: LibraryImageFields.tag.describe(
    'New tag (empty or whitespace-only clears the stored value; omit to keep it)'
  ),
  description: LibraryImageFields.description.describe(
    'New description (empty or whitespace-only clears the stored value; omit to keep it)'
  ),
  // Swap-only: the server rejects isPrimary:false, so the schema accepts only
  // true and surfaces the constraint at parse time instead of a server 400.
  isPrimary: z
    .literal(true)
    .optional()
    .describe(
      'Set true to mark this image as the primary library image (the swap atomically demotes the old primary; false is rejected — mark another image instead)'
    ),
};

export const UpdatePersonaImageSchema = z
  .object(UpdatePersonaImageShape)
  .refine(
    (v) => v.tag !== undefined || v.description !== undefined || v.isPrimary !== undefined,
    { message: 'At least one of tag, description, or isPrimary is required.' },
  );

export const RemovePersonaImageShape = {
  id: z.string().min(1, 'id is required').describe('The library image ID to remove'),
};

export const RemovePersonaImageSchema = z.object(RemovePersonaImageShape);

export const GetVideoStatusShape = {
  taskId: z.string().min(1, 'taskId is required').describe('The video generation task ID'),
};

export const GetVideoStatusSchema = z.object(GetVideoStatusShape);

// Machine-readable progress for a single video task. Unlike get_video_status
// (raw status + URLs), this returns only the four progress fields so agents
// can poll "video 1/6: 60%" style progress without parsing a full payload.
export const GetVideoTaskProgressShape = {
  taskId: z.string().min(1, 'taskId is required').describe('The video generation task ID'),
};

export const GetVideoTaskProgressSchema = z.object(GetVideoTaskProgressShape);

export async function handleCreatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof CreatePersonaSchema>
): Promise<McpToolResponse> {
  // Re-parse with the full schema: the MCP SDK parses tool args from the
  // raw shape only, so required-field failures (like a missing avatarUrl)
  // would otherwise never fire on the tool path. A parse failure becomes a
  // loud isError via handleLibraryCall, before any file is read.
  return handleLibraryCall(
    () => client.createPersona(CreatePersonaSchema.parse(args)),
    'creating persona',
    'Persona created successfully'
  );
}

export async function handleListPersonas(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listPersonas(), 'listing personas');
}

export async function handleListVoices(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listVoices(), 'listing voices');
}


export async function handleListFaces(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listFaces(), 'listing faces');
}

export async function handleUpdatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.updatePersona(args), 'updating persona', 'Persona updated successfully');
}

export async function handleListSocialAccounts(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listSocialAccounts(), 'listing social accounts');
}

export async function handleConnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof ConnectAccountSchema>
): Promise<McpToolResponse> {
  if (args.provider === 'bluesky') {
    if (!args.handle || !args.appPassword) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Bluesky requires both handle and appPassword.',
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await client.connectBlueskyAccount(args.handle, args.appPassword);
      return {
        content: [
          {
            type: 'text',
            text: `Bluesky account connected successfully: ${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error connecting Bluesky account: ${getErrorMessage(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  try {
    const parsed = z.object({ auth_url: z.string().url() }).safeParse(await client.getOAuthConnectUrl(args.provider));
    if (!parsed.success) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: the connect endpoint did not return an auth_url.',
          },
        ],
        isError: true,
      };
    }
    const result = parsed.data;
    // Never echo a non-https URL as a "open in your browser" authorization
    // link: z.string().url() accepts any scheme, including javascript:.
    if (new URL(result.auth_url).protocol !== 'https:') {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: the connect endpoint returned a non-https auth_url.',
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text:
            `To connect your ${args.provider} account, open this URL in your browser and authorize Post Engineer:\n\n` +
            `${result.auth_url}\n\n` +
            `Once you authorize, the account is connected automatically. Verify with list_social_accounts.`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting OAuth connect URL: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListSchedules(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listSchedules(), 'listing schedules');
}

export async function handleListPosts(
  client: PostEngineerClient,
  args: z.infer<typeof ListPostsSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listPosts(args.limit), 'listing posts');
}

export async function handleCancelSchedule(
  client: PostEngineerClient,
  args: z.infer<typeof CancelScheduleSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.cancelSchedule(args.scheduleId), 'cancelling schedule', 'Schedule cancelled successfully');
}

export async function handleGetTokenBalance(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.getTokenBalance(), 'getting token balance');
}

/** Shared wrapper for the persona-image handlers: same try/catch + text
 * response shape, differing only in the client call and the message verbs.
 * Older handlers (handleConnectAccount) keep inline
 * try/catch because they pre-validate args before the client call —
 * the wrapper only covers the call itself. */
async function handleLibraryCall(
  clientCall: () => Promise<unknown>,
  errorVerb: string,
  successPrefix?: string,
): Promise<McpToolResponse> {
  try {
    const result = await clientCall();
    const text = successPrefix
      ? `${successPrefix}: ${JSON.stringify(result, null, 2)}`
      : JSON.stringify(result, null, 2);
    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error ${errorVerb}: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListPersonaImages(
  client: PostEngineerClient,
  args: z.infer<typeof ListPersonaImagesSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => client.listPersonaImages(args.personaId),
    'listing persona images',
  );
}

export async function handleAddPersonaImage(
  client: PostEngineerClient,
  args: z.infer<typeof AddPersonaImageSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () =>
      client.addPersonaImage(args.personaId, {
        path: args.path,
        tag: args.tag,
        description: args.description,
        isPrimary: args.isPrimary,
      }),
    'adding persona image',
    'Persona image added successfully',
  );
}

export async function handleUpdatePersonaImage(
  client: PostEngineerClient,
  args: z.infer<typeof UpdatePersonaImageSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => {
      // Re-parse with the refined schema: the MCP SDK parses tool args
      // from the raw shape only, so the "at least one of
      // tag/description/isPrimary" refine would otherwise never fire on
      // the tool path. Parsing inside the closure turns the failure into
      // a loud isError, before any client call.
      // (Same reason handleCreatePersona re-parses.)
      const parsed = UpdatePersonaImageSchema.parse(args);
      return client.updatePersonaImage({
        id: parsed.id,
        tag: parsed.tag,
        description: parsed.description,
        isPrimary: parsed.isPrimary,
      });
    },
    'updating persona image',
    'Persona image updated successfully',
  );
}

export async function handleRemovePersonaImage(
  client: PostEngineerClient,
  args: z.infer<typeof RemovePersonaImageSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => client.deletePersonaImage(args.id),
    'removing persona image',
    'Persona image removed successfully',
  );
}

export async function handleGetVideoStatus(
  client: PostEngineerClient,
  args: z.infer<typeof GetVideoStatusSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.getVideoStatus(args.taskId), 'fetching video status');
}

/** Redacts credential-shaped material from an engine failure reason before
 * it reaches the MCP client. The engine error is the user's own task failure
 * text (e.g. "persona hook must end between 3 and 6 seconds"), but provider
 * exceptions can echo request URLs, DSNs, or bearer tokens into it. Keep the
 * human-readable reason intact; only the secret-shaped fragments are masked.
 * Mirrors the app-password redaction in client.ts. */
export function sanitizeEngineError(error: string): string {
  return error
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

/** Narrows the web video-status response to the progress fields agents
 * poll on. The engine task record carries task_id/state/progress/stage;
 * error carries the engine failure reason when the task failed. A body
 * without them (empty-body sentinel, 404 shape) is reported with
 * explicit nulls rather than silently dropping fields. */
function narrowTaskProgress(result: unknown): {
  task_id: string | null;
  state: number | null;
  progress: number | null;
  stage: string | null;
  error: string | null;
} {
  const payload =
    typeof result === 'object' && result !== null && 'body' in result
      ? (result as { body?: unknown }).body
      : undefined;
  const record = typeof payload === 'object' && payload !== null ? payload : {};
  const get = (key: string): unknown =>
    key in record ? (record as Record<string, unknown>)[key] : undefined;
  const taskId = get('task_id');
  const state = get('state');
  const progress = get('progress');
  const stage = get('stage');
  const error = get('error');
  return {
    task_id: typeof taskId === 'string' ? taskId : null,
    state: typeof state === 'number' ? state : null,
    progress: typeof progress === 'number' ? progress : null,
    stage: typeof stage === 'string' ? stage : null,
    // Surface the engine failure reason: without it a failed task only
    // reports state -1 and the caller can never learn why it failed.
    error: typeof error === 'string' ? sanitizeEngineError(error) : null,
  };
}

export async function handleGetVideoTaskProgress(
  client: PostEngineerClient,
  args: z.infer<typeof GetVideoTaskProgressSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => narrowTaskProgress(await client.getVideoStatus(args.taskId)),
    'fetching video task progress'
  );
}

export async function handleGeneratePersonaVideos(
  client: PostEngineerClient,
  args: z.infer<typeof GeneratePersonaVideosSchema>
): Promise<McpToolResponse> {
  try {
    // The MCP SDK parses tool args against the raw shape, so a whole-object
    // refine would be a hollow claim on the tool path (round 26 learning):
    // the mode/plan consistency rule lives here instead, where it always
    // runs. A stray schedule plan 400s server-side; name the rule before
    // the client fires.
    const mode = args.mode ?? 'scheduled';
    if (mode === 'asap' && (args.startAt !== undefined || args.times !== undefined)) {
      throw new Error("startAt and times must not be set when mode is 'asap'.");
    }
    if (mode === 'scheduled' && (args.startAt === undefined || args.times === undefined)) {
      throw new Error("startAt and times are required when mode is 'scheduled'.");
    }
    const narrowed = narrowScheduledVideos(
      await client.generatePersonaVideos({
        personaId: args.personaId,
        topics: args.topics,
        providers: args.providers,
        youtubeAccountIds: args.youtubeAccountIds,
        instagramAccountIds: args.instagramAccountIds,
        linkedinAccountIds: args.linkedinAccountIds,
        blueskyAccountIds: args.blueskyAccountIds,
        mode,
        startAt: args.startAt,
        times: args.times,
        timezone: args.timezone,
        options: args.options,
        idempotencyKey: args.idempotencyKey,
      })
    );
    // Keeps its own try/catch (like handleConnectAccount): success renders a
    // concise human summary plus the machine JSON, and API errors surface
    // the structured { code, message, field } — the handleLibraryCall
    // wrapper covers neither.
    const slotCount = narrowed.slots.length;
    const scheduleId = narrowed.schedule.id ?? '(unknown id)';
    const humanSummary = narrowed.replayed
      ? `Replayed idempotent schedule ${scheduleId}: ${slotCount} publish slot(s) (no new videos generated).`
      : narrowed.schedule.mode === 'asap'
        ? `Generating ${slotCount} video(s) in schedule ${scheduleId}: each video publishes as soon as its generation finishes (ASAP mode).`
        : `Scheduled ${slotCount} video(s) in schedule ${scheduleId}: each video is generated and auto-published at its slot.`;
    const slotLines = narrowed.slots.map(
      (slot, i) =>
        `${i + 1}. ${slot.topic ?? '(untitled)'} → ${slot.slotAt ?? '(unscheduled)'} [${slot.status ?? 'unknown'}${slot.taskId ? `, task ${slot.taskId}` : ''}]`
    );
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\n${slotLines.join('\n')}\n${JSON.stringify(narrowed, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    // The API error contract carries a stable code: surface it as
    // { code, message, field } JSON instead of rewording the platform's
    // own human message — never a bare "Tool execution failed". The
    // message is capped at 200 chars by the client and credential-shaped
    // fragments are redacted before reaching the agent.
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating and scheduling videos: ${JSON.stringify({
              code: error.code,
              message: sanitizeEngineError(getErrorMessage(error)),
              field: error.field,
            })}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error generating and scheduling videos: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/** Narrows the generate-and-schedule success envelope to the fields the
 * tool contract promises: the schedule id and publish mode, one row per
 * publish slot, and the replayed flag. Anything the API adds later rides
 * through unparsed — the projection only pins what the tool renders and
 * documents. */
function narrowScheduledVideos(result: unknown): {
  schedule: { id: string | null; mode: string | null };
  slots: Array<{
    slotId: string | null;
    slotAt: string | null;
    topic: string | null;
    taskId: string | null;
    status: string | null;
  }>;
  replayed: boolean | null;
} {
  const record =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)
      : {};
  const schedule =
    typeof record.schedule === 'object' && record.schedule !== null
      ? (record.schedule as Record<string, unknown>)
      : {};
  const rawSlots = Array.isArray(record.slots) ? record.slots : [];
  const str = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;
  return {
    schedule: { id: str(schedule.id), mode: str(schedule.mode) },
    slots: rawSlots.map((slot) => {
      const s =
        typeof slot === 'object' && slot !== null
          ? (slot as Record<string, unknown>)
          : {};
      return {
        slotId: str(s.slotId),
        slotAt: str(s.slotAt),
        topic: str(s.topic),
        taskId: str(s.taskId),
        status: str(s.status),
      };
    }),
    replayed: typeof record.replayed === 'boolean' ? record.replayed : null,
  };
}

