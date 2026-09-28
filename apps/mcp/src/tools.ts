import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PostEngineerClient } from './client.js';
import {
  MAX_LIBRARY_IMAGES,
  MAX_LIBRARY_IMAGE_MB,
  MAX_LIBRARY_TAG_LENGTH,
  MAX_LIBRARY_DESCRIPTION_LENGTH,
} from './client.js';
import { getErrorMessage } from './errors.js';

export type McpToolResponse = CallToolResult;

// Each provider in `providers` must map to a non-empty account-ID list.
export function missingProviderAccountIds(args: {
  providers: string[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
}): string[] {
  const idsByProvider: Record<string, string[] | undefined> = {
    youtube: args.youtubeAccountIds,
    instagram: args.instagramAccountIds,
    linkedin: args.linkedinAccountIds,
    bluesky: args.blueskyAccountIds,
  };
  return args.providers.filter((provider) => (idsByProvider[provider] ?? []).length === 0);
}

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
  avatarUrl: z.string().url().optional().nullable().describe('Public URL to the persona avatar image (use list_faces for stock face URLs)'),
  voiceId: z.string().default('alloy').describe('Voice ID to use (e.g. alloy, echo)'),
  language: z.string().default('en-US').describe('Language code (e.g. pt-BR, en-US)'),
  videoAspect: z.enum(['9:16', '16:9']).default('9:16').describe('Video aspect ratio'),
  scriptPrompt: z.string().optional().default('').describe('System prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).default(1).describe('Number of paragraphs'),
  niche: z.string().optional().default('General').describe('Content niche topic'),
  faceMixPercent: z.number().min(0).max(100).default(50),
  faceQuality: z.enum(['ok', 'very_good']).default('very_good'),
  images: z.array(PersonaLibraryImageInputShape).max(MAX_LIBRARY_IMAGES).optional().describe(`Up to ${MAX_LIBRARY_IMAGES} local image files of the same person for the persona image library. Each video deterministically picks the best-matching image by tag. Requires a non-faceless persona: avatarUrl must be set, because the server rejects library images for faceless personas.`),
  imagePrimaryIndex: z.number().int().min(0).max(MAX_LIBRARY_IMAGES - 1).optional().describe('Index into images[] marking the primary library image (no primary is set when omitted)'),
};

export const CreatePersonaSchema = z.object(CreatePersonaShape).superRefine((value, ctx) => {
  // Domain rule encoded at parse time (the round-4 standing rule: encode
  // domain rules in the zod schema): library images are rejected
  // server-side for faceless personas, so require the avatar up front.
  // The client keeps its own check as defense in depth.
  const hasImages = (value.images?.length ?? 0) > 0;
  const hasAvatar =
    value.avatarUrl !== undefined && value.avatarUrl !== null && value.avatarUrl.length > 0;
  if (hasImages && !hasAvatar) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['avatarUrl'],
      message:
        'avatarUrl is required when images are provided: library images need a persona avatar (faceless personas cannot have an image library).',
    });
  }
});

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

export const GenerateVideoShape = {
  // Omitting personaId selects the faceless flow (no persona loaded; the job
  // runs fully faceless with face_mix_percent 0). Faceless generation then
  // requires videoSubject plus a voice source (audioUrl or voiceId) — the
  // web API has no stored persona to fall back to.
  personaId: z.string().min(1, 'personaId is required').optional().describe('The ID of the persona to generate video with. Omit for faceless generation.'),
  videoSubject: z.string().min(1).optional().describe('Video subject/topic. Required for faceless generation (no persona).'),
  voiceId: z.string().min(1).optional().describe('Voice ID for faceless generation. Required when no audioUrl is given and no persona.'),
  scriptPrompt: z.string().optional().describe('Optional specific prompt override for this video'),
  audioUrl: z.string().url('audioUrl must be a valid URL').optional().describe('Optional public URL of custom audio for this video (overrides the persona voice)'),
  imageId: z.string().min(1, 'imageId must be a non-empty string').optional().describe('Optional library image ID to use for this video (overrides the deterministic per-video image selection; see list_persona_images)'),
};

export const GenerateVideoSchema = z.object(GenerateVideoShape);

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

export const ScheduleVideoShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona'),
  providers: z
    .array(z.enum(['youtube', 'instagram', 'linkedin', 'bluesky']))
    .min(1, 'At least one provider required')
    .describe('Target social platforms'),
  youtubeAccountIds: z.array(z.string()).optional().default([]),
  instagramAccountIds: z.array(z.string()).optional().default([]),
  linkedinAccountIds: z.array(z.string()).optional().default([]),
  blueskyAccountIds: z.array(z.string()).optional().default([]),
  scheduledAt: z
    .string()
    .describe('Target ISO date time for scheduling. Must be between 24h and 30 days in the future.'),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  postsPerDay: z.number().int().min(1).max(10).optional(),
  timezone: z.string().optional().default('UTC'),
};

// The cross-field "each provider needs account IDs" rule cannot live in the
// MCP registration (the SDK only accepts raw shapes, not refined schemas), so
// it stays here for handler-level validation and handleScheduleVideo enforces
// it fail-fast before any API call.
export const ScheduleVideoSchema = z
  .object(ScheduleVideoShape)
  .refine((args) => missingProviderAccountIds(args).length === 0, (args) => ({
    message: `Each provider requires at least one account ID — missing for: ${missingProviderAccountIds(args).join(', ')}. Discover them with list_social_accounts first.`,
  }));

export async function handleCreatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof CreatePersonaSchema>
): Promise<McpToolResponse> {
  // Re-parse with the refined schema: the MCP SDK parses tool args from the
  // raw shape only, so the superRefine cross-field rule would otherwise never
  // fire on the tool path. A parse failure becomes a loud isError via
  // handleLibraryCall, before any file is read.
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

export async function handleGenerateVideo(
  client: PostEngineerClient,
  args: z.infer<typeof GenerateVideoSchema>
): Promise<McpToolResponse> {
  // Faceless flow (no personaId): the web API has no stored persona to fall
  // back to, so the subject and a voice source must come with the request.
  // Fail fast here instead of surfacing the API 400.
  const faceless = args.personaId === undefined || args.personaId === null;
  if (faceless) {
    if (!args.videoSubject || args.videoSubject.trim().length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: faceless generation requires videoSubject (no persona to take the topic from).',
          },
        ],
        isError: true,
      };
    }
    if (!args.audioUrl && !args.voiceId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: faceless generation requires a voice source — audioUrl or voiceId (no persona voice to fall back to).',
          },
        ],
        isError: true,
      };
    }
  }
  return handleLibraryCall(() => client.generateVideoJob(args), 'generating video', 'Video generation task started');
}

/** Shared wrapper for the persona-image handlers: same try/catch + text
 * response shape, differing only in the client call and the message verbs.
 * Older handlers (handleConnectAccount, handleScheduleVideo) keep inline
 * try/catch because they pre-validate args before the client call — the
 * wrapper only covers the call itself. */
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

export async function handleScheduleVideo(
  client: PostEngineerClient,
  args: z.infer<typeof ScheduleVideoSchema>
): Promise<McpToolResponse> {
  const missing = missingProviderAccountIds(args);
  if (missing.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: each provider requires at least one account ID — missing for: ${missing.join(', ')}. Discover them with list_social_accounts first.`,
        },
      ],
      isError: true,
    };
  }
  try {
    const result = await client.createSchedule(args);
    return {
      content: [
        {
          type: 'text',
          text: `Video schedule created successfully: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error scheduling video: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}
