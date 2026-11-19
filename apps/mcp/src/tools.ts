import { z } from 'zod';
import { filterVoicesPayload, ListVoicesSchema, personaVoiceField, withResolvedPersonaVoice, type ListVoicesArgs } from './voice-filters.js';
import { noticeSummary } from './publish-notices.js';
import {
  CancelScheduleSchema,
  CancelScheduleShape,
  DeleteSlotSchema,
  DeleteSlotShape,
  GeneratePersonaVideoOptionsShape,
  GetSlotSchema,
  GetSlotShape,
  ListPostsSchema,
  ListPostsShape,
  ListSchedulesSchema,
  ListSchedulesShape,
  UpdateSlotTitleSchema,
  UpdateSlotTitleShape,
} from './schedule-shapes.js';
import { DisconnectAccountSchema, DisconnectAccountShape, createPersonaAccountsField } from './account-shapes.js';
import { PublishVideoDirectSchema, PublishVideoDirectShape } from './publish-direct-shape.js';
// Re-exported so existing import sites (`./tools.js`) keep working.
export {
  CancelScheduleSchema,
  CancelScheduleShape,
  DeleteSlotSchema,
  DeleteSlotShape,
  DisconnectAccountSchema,
  DisconnectAccountShape,
  GeneratePersonaVideoOptionsShape,
  GetSlotSchema,
  GetSlotShape,
  ListPostsSchema,
  ListPostsShape,
  ListSchedulesSchema,
  ListSchedulesShape,
  PublishVideoDirectSchema,
  PublishVideoDirectShape,
  UpdateSlotTitleSchema,
  UpdateSlotTitleShape,
};
import type { PostEngineerClient } from './client.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';
import {
  MAX_LIBRARY_IMAGES,
  MAX_LIBRARY_IMAGE_MB,
  MAX_LIBRARY_TAG_LENGTH,
  MAX_LIBRARY_DESCRIPTION_LENGTH,
  VIDEO_LAYOUTS,
} from './client.js';
import { getErrorMessage, ApiError } from './errors.js';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from './language.js';
import { CreatePersonaAvatarFields, refinePersonaAvatar } from './persona-avatar.js';
import { getSlot as getSlotContract } from './contracts/schedule.js';
import { FACE_QUALITIES, VIDEO_ASPECTS } from './contracts/personas.js';
import type { ResponseOf } from './contracts/endpoint.js';

export type { McpToolResponse } from './tools-call.js';
// Image path/tag/description limits are shared by create-persona and persona_media (action: add_image).
const LibraryImageFields = {
  path: z.string().min(1).describe(`Local file path to the image (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB)`),
  tag: z.string().max(MAX_LIBRARY_TAG_LENGTH).optional().describe('Short tag for deterministic per-video matching (e.g. casual, formal, gym)'),
  description: z.string().max(MAX_LIBRARY_DESCRIPTION_LENGTH).optional().describe('Description of the photo for tag/keyword matching (e.g. smiling at the beach at sunset)'),
};
// Single source of truth: the intent-*.ts modules build the advertised shapes from these
// ones, so field definitions (and their descriptions) live here only.
const PersonaLibraryImageInputShape = z.object(LibraryImageFields);

export const CreatePersonaShape = {
  name: z.string().min(1, 'Name is required').describe('Name of the persona'),
  // Every persona has a face (avatarUrl or avatarPath); faceless is a per-video mode (options.videoType).
  ...CreatePersonaAvatarFields,
  voiceId: personaVoiceField('voiceId is required').describe('id or label from voices (action: list). Never type a provider prefix.'),
  language: z
    .string()
    .refine(isEnglishLanguage, { message: ONLY_ENGLISH_VIDEOS_MESSAGE })
    .default('en-US')
    .describe('Language code — English only for now (e.g. en-US, en-GB)'),
  videoAspect: z.enum(VIDEO_ASPECTS).default('9:16').describe('Video aspect ratio'),
  videoLayout: z
    .enum(VIDEO_LAYOUTS)
    .default('standard')
    .describe(
      'How the persona hook is composed with the video material: "standard" fills the frame with the avatar, "react" splits it in half (persona on top, video material below: real clips or drawings). Same render cost either way.',
    ),
  scriptPrompt: z.string().optional().default('').describe('System prompt instructions for video scripts'),
  paragraphNumber: z.number().int().min(1).max(10).default(1).describe('Number of paragraphs'),
  niche: z.string().optional().default('General').describe('Content niche'),
  faceQuality: z.enum(FACE_QUALITIES).default('very_good').describe('Face resolution of the rendered videos: ok (480p, 2 tokens/video) or very_good (720p, 3 tokens/video)'),
  accounts: createPersonaAccountsField,
  images: z.array(PersonaLibraryImageInputShape).max(MAX_LIBRARY_IMAGES).optional().describe(`Up to ${MAX_LIBRARY_IMAGES} local image files of the same person for the persona image library. Each video deterministically picks the best-matching image by tag.`),
  imagePrimaryIndex: z.number().int().min(0).max(MAX_LIBRARY_IMAGES - 1).optional().describe('Index into images[] marking the primary library image (no primary is set when omitted)'),
};

export const CreatePersonaSchema = z.object(CreatePersonaShape).superRefine(refinePersonaAvatar(true));

export { ListVoicesShape, ListVoicesSchema } from './voice-filters.js';

export {
  ListClonedVoicesShape,
  ListClonedVoicesSchema,
  CreateClonedVoiceShape,
  CreateClonedVoiceSchema,
  DeleteClonedVoiceShape,
  DeleteClonedVoiceSchema,
  PreviewClonedVoiceShape,
  PreviewClonedVoiceSchema,
} from './cloned-voice-tools.js';

export const ListFacesShape = {};

// personas (action: update) lives in persona-update.ts (shape, schema and handler);
// re-exported here so existing import sites keep working.
export { UpdatePersonaShape, UpdatePersonaSchema, handleUpdatePersona } from './persona-update.js';
export { ConnectAccountShape, ConnectAccountSchema, handleConnectAccount } from './connect-account.js';


export const ListVideoGenerationsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max generations to return (1-200). Defaults to 50, newest first.'),
};

export const ListVideoGenerationsSchema = z.object(ListVideoGenerationsShape);

export const GetVideoGenerationShape = {
  generationId: z
    .string()
    .min(1, 'generationId is required')
    .describe('The generation ID (the generationId field from video_tasks (action: list_generations)).'),
};

export const GetVideoGenerationSchema = z.object(GetVideoGenerationShape);

export const ListTokenTransactionsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max transactions to return (1-100). Defaults to 20, newest first.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('How many newest transactions to skip for paging. Defaults to 0.'),
};

export const ListTokenTransactionsSchema = z.object(ListTokenTransactionsShape);

export const DeletePersonaShape = {
  personaId: z
    .string()
    .min(1, 'personaId is required')
    .describe(
      'The persona ID to delete. DESTRUCTIVE and irreversible: deletes the persona, all its schedules and slots, all generated videos, and the image library. No token refunds — prepaid tokens for pending slots are forfeited. Call personas (action: delete) first to see exactly what will be removed.',
    ),
};

export const DeletePersonaSchema = z.object(DeletePersonaShape);


export const ListPersonaImagesShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona whose image library to list'),
};

export const ListPersonaImagesSchema = z.object(ListPersonaImagesShape);

export const AddPersonaImageShape = {
  personaId: z.string().min(1, 'personaId is required').describe('The ID of the persona to add the image to'),
  ...LibraryImageFields,
  // Swap-only, symmetric with persona_media (action: update_image): isPrimary:false on a new
  // image is meaningless (never primary unless marked), so the schema accepts
  // only true and surfaces the constraint at parse time, not as a silent drop.
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
  // trim to '' client-side and therefore clear too (undefined = keep, '' = clear).
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

export async function handleCreatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof CreatePersonaSchema>
): Promise<McpToolResponse> {
  // Re-parses with the full schema (the SDK parses tool args from the raw
  // shape only), then routes the voice BEFORE any POST: an unknown voice
  // never debits tokens (issue #353).
  return handleLibraryCall(
    async () => client.createPersona(await withResolvedPersonaVoice(client, CreatePersonaSchema.parse(args))),
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
  client: PostEngineerClient,
  args: ListVoicesArgs = {}
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => filterVoicesPayload(await client.listVoices(), ListVoicesSchema.parse(args)),
    'listing voices'
  );
}

export {
  handleListClonedVoices,
  handleCreateClonedVoice,
  handleDeleteClonedVoice,
  handlePreviewClonedVoice,
} from './cloned-voice-tools.js';

export async function handleListFaces(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listFaces(), 'listing faces');
}

export async function handleListSocialAccounts(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listSocialAccounts(), 'listing social accounts');
}


export async function handleListSchedules(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listSchedules(), 'listing schedules');
}

export async function handleCancelSchedule(
  client: PostEngineerClient,
  args: z.infer<typeof CancelScheduleSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.cancelSchedule(args.scheduleId), 'cancelling schedule', 'Schedule cancelled successfully');
}

export async function handleGetSlot(
  client: PostEngineerClient,
  args: z.infer<typeof GetSlotSchema>
): Promise<McpToolResponse> {
  try {
    const presented = presentSlotDetail(await client.getSlot(args.slotId));
    const slot = presented.slot;
    const humanSummary = `Slot ${slot.id}: "${slot.title ?? '(untitled)'}" — ${slot.status}, scheduled for ${slot.slotAt}.${noticeSummary(slot.userNotices)}`;
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\n${JSON.stringify(presented, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting slot: ${JSON.stringify({
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
          text: `Error getting slot: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleUpdateSlotTitle(
  client: PostEngineerClient,
  args: z.infer<typeof UpdateSlotTitleSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.updateSlotTitle(args.slotId, args.title);
    const title = result.title ?? args.title;
    return {
      content: [
        {
          type: 'text',
          text: `Slot ${args.slotId} title updated to "${title}".\n${JSON.stringify({ success: true, title }, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating slot title: ${JSON.stringify({
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
          text: `Error updating slot title: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDeleteSlot(
  client: PostEngineerClient,
  args: z.infer<typeof DeleteSlotSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    () => client.deleteSlot(args.slotId),
    'deleting slot',
    `Slot ${args.slotId} deleted`
  );
}

export async function handleListVideoGenerations(
  client: PostEngineerClient,
  args: z.infer<typeof ListVideoGenerationsSchema>
): Promise<McpToolResponse> {
  try {
    const generations = narrowVideoGenerations(await client.listVideoGenerations(args.limit));
    const humanSummary = `${generations.length} video generation(s) in history (newest first).`;
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\n${JSON.stringify({ generations }, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing video generations: ${JSON.stringify({
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
          text: `Error listing video generations: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGetVideoGeneration(
  client: PostEngineerClient,
  args: z.infer<typeof GetVideoGenerationSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.getVideoGeneration(args.generationId);
    const generation = narrowVideoGeneration(result.generation);
    const humanSummary = `Generation ${generation.generationId ?? args.generationId}: "${generation.videoSubject ?? '(untitled)'}" — ${generation.status ?? 'unknown'}.`;
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\n${JSON.stringify({ generation }, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting video generation: ${JSON.stringify({
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
          text: `Error getting video generation: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/** One narrowed video_generations row: the fields the tool contract promises. */
interface NarrowedVideoGeneration {
  id: string | null;
  generationId: string | null;
  engineTaskId: string | null;
  personaName: string | null;
  videoSubject: string | null;
  status: string | null;
  errorCode: string | null;
  tokensRefunded: boolean | null;
  createdAt: string | null;
  completedAt: string | null;
}

/** Narrows one video_generations row. Anything the API adds later rides
 * through unparsed — the projection only pins what the tool renders and
 * documents. */
function narrowVideoGeneration(row: unknown): NarrowedVideoGeneration {
  const record =
    typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  const str = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;
  return {
    id: str(record.id),
    generationId: str(record.generationId),
    engineTaskId: str(record.engineTaskId),
    personaName: str(record.personaName),
    videoSubject: str(record.videoSubject),
    status: str(record.status),
    errorCode: str(record.errorCode),
    tokensRefunded:
      typeof record.tokensRefunded === 'boolean' ? record.tokensRefunded : null,
    createdAt: str(record.createdAt),
    completedAt: str(record.completedAt),
  };
}

/** Narrows the GET /api/persona/video-generations envelope to the pinned
 * row fields. */
function narrowVideoGenerations(result: unknown): NarrowedVideoGeneration[] {
  const record =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)
      : {};
  const raw = Array.isArray(record.generations) ? record.generations : [];
  return raw.map((row) => narrowVideoGeneration(row));
}

export async function handleListTokenTransactions(
  client: PostEngineerClient,
  args: z.infer<typeof ListTokenTransactionsSchema>
): Promise<McpToolResponse> {
  try {
    const narrowed = narrowTokenTransactions(await client.listTokenTransactions(args.limit, args.offset));
    const shown = narrowed.transactions.length;
    const humanSummary =
      `Token ledger: showing ${shown} of ${narrowed.total ?? '?'} transaction(s) (newest first). ` +
      `Negative amounts are spends, positive amounts are credits.`;
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\n${JSON.stringify(narrowed, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing token transactions: ${JSON.stringify({
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
          text: `Error listing token transactions: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDeletePersona(
  client: PostEngineerClient,
  args: z.infer<typeof DeletePersonaSchema>
): Promise<McpToolResponse> {
  try {
    await client.deletePersona(args.personaId);
    return {
      content: [
        {
          type: 'text',
          text:
            `Persona ${args.personaId} deleted: the persona, all its schedules and slots, ` +
            `all generated videos, and the image library are gone. No token refunds were issued.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting persona: ${JSON.stringify({
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
          text: `Error deleting persona: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDisconnectAccount(
  client: PostEngineerClient,
  args: z.infer<typeof DisconnectAccountSchema>
): Promise<McpToolResponse> {
  try {
    await client.disconnectAccount(args.provider, args.providerAccountId);
    return {
      content: [
        {
          type: 'text',
          text: `Account ${args.providerAccountId} (${args.provider}) disconnected.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error disconnecting account: ${JSON.stringify({
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
          text: `Error disconnecting account: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/** Narrows the GET /api/persona/delete-preview envelope: the persona, the
 * removal counts, and the per-video download links. Anything the API adds
 * later rides through unparsed. */
/** One narrowed token_transactions row: the fields the tool contract promises. */
interface NarrowedTokenTransaction {
  id: string | null;
  amount: number | null;
  type: string | null;
  description: string | null;
  reason: string | null;
  generationId: string | null;
  createdAt: string | null;
}

/** Narrows the GET /api/billing/transactions envelope. Anything the API
 * adds later rides through unparsed — the projection only pins what the
 * tool renders and documents. */
function narrowTokenTransactions(result: unknown): {
  transactions: NarrowedTokenTransaction[];
  total: number | null;
  limit: number | null;
  offset: number | null;
} {
  const record =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)
      : {};
  const raw = Array.isArray(record.transactions) ? record.transactions : [];
  const str = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;
  const num = (value: unknown): number | null =>
    typeof value === 'number' ? value : null;
  return {
    transactions: raw.map((row) => {
      const r =
        typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
      return {
        id: str(r.id),
        amount: num(r.amount),
        type: str(r.type),
        description: str(r.description),
        reason: str(r.reason),
        generationId: str(r.generationId),
        createdAt: str(r.createdAt),
      };
    }),
    total: num(record.total),
    limit: num(record.limit),
    offset: num(record.offset),
  };
}

/** The agent-facing shape of a slot detail: the parsed contract result
 * with the `success` envelope and the `generation` block dropped (the
 * slot's own progress/stage already carry it). Fields are picked, never
 * spread, so unknown fields can never ride through to the agent. */
function presentSlotDetail(detail: ResponseOf<typeof getSlotContract>) {
  const { slot, schedule, persona } = detail;
  return {
    slot: {
      id: slot.id,
      scheduleId: slot.scheduleId,
      slotAt: slot.slotAt,
      status: slot.status,
      title: slot.title,
      taskId: slot.taskId,
      progress: slot.progress,
      stage: slot.stage,
      error: slot.error,
      publishedAt: slot.publishedAt,
      postUrl: slot.postUrl,
      publishLinks: slot.publishLinks,
      progressHistory: slot.progressHistory,
      scriptAngle: slot.scriptAngle,
      retryable: slot.retryable,
      queuePosition: slot.queuePosition,
      queueTotal: slot.queueTotal,
      userNotices: slot.userNotices,
      providerFailures: slot.providerFailures,
    },
    schedule: {
      id: schedule.id,
      personaId: schedule.personaId,
      providers: schedule.providers,
      youtubeAccountIds: schedule.youtubeAccountIds,
      instagramAccountIds: schedule.instagramAccountIds,
      linkedinAccountIds: schedule.linkedinAccountIds,
      blueskyAccountIds: schedule.blueskyAccountIds,
      threadsAccountIds: schedule.threadsAccountIds,
      facebookAccountIds: schedule.facebookAccountIds,
      pinterestAccountIds: schedule.pinterestAccountIds,
      pinterestBoardId: schedule.pinterestBoardId,
      threespeakAccountIds: schedule.threespeakAccountIds,
      rumbleAccountIds: schedule.rumbleAccountIds,
      fanvueAccountIds: schedule.fanvueAccountIds,
      telegramAccountIds: schedule.telegramAccountIds,
      timezone: schedule.timezone,
      publishMode: schedule.publishMode,
    },
    persona: persona === null ? null : { id: persona.id, name: persona.name },
  };
}

export async function handleGetTokenBalance(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.getTokenBalance(), 'getting token balance');
}

export { handleLibraryCall } from './tools-call.js';

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
      // Re-parse with the refined schema (the SDK parses tool args from the
      // raw shape only): the "at least one of tag/description/isPrimary"
      // refine becomes a loud isError before any client call, and it pairs
      // with the same reason handleCreatePersona re-parses.
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
 * poll on, plus the post detail link when the video belongs to a scheduled
 * slot (issue #555). The engine task record carries task_id/state/progress/
 * stage; error carries the engine failure reason when the task failed. A
 * body without them (empty-body sentinel, 404 shape) is reported with
 * explicit nulls rather than silently dropping fields. */
export function narrowTaskProgress(result: unknown): {
  task_id: string | null;
  state: number | null;
  progress: number | null;
  stage: string | null;
  error: string | null;
  postUrl: string | null;
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
    // The post detail link, when the video belongs to a scheduled slot
    // (null for direct generations and for tasks with no slot yet).
    postUrl: typeof get('postUrl') === 'string' ? (get('postUrl') as string) : null,
  };
}

export async function handlePublishVideoDirect(
  client: PostEngineerClient,
  args: z.infer<typeof PublishVideoDirectSchema>
): Promise<McpToolResponse> {
  try {
    const result = await client.publishVideoDirect({
      provider: args.provider,
      videoPath: args.videoPath,
      accountIds: args.accountIds,
      title: args.title,
      description: args.description,
      tags: args.tags,
      privacyStatus: args.privacyStatus,
      caption: args.caption, boardId: args.boardId, idempotencyKey: args.idempotencyKey,
    });
    const lines = result.results.map((account) => {
      if (account.success) {
        const link = account.videoUrl ?? account.permalink ?? account.postId ?? account.videoId ?? '';
        return `- ${account.accountId}: published${link ? ` (${link})` : ''}`;
      }
      return `- ${account.accountId}: FAILED — ${account.error ?? 'unknown error'}`;
    });
    return {
      content: [
        {
          type: 'text',
          text:
            `Direct publish to ${result.provider}: ${result.successCount}/${result.results.length} accounts succeeded.\n` +
            lines.join('\n') +
            `\n${JSON.stringify({
              success: result.success,
              provider: result.provider,
              successCount: result.successCount,
              results: result.results,
              logId: result.logId,
            })}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error publishing video: ${JSON.stringify({
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
          text: `Error publishing video: ${getErrorMessage(error)}`,
        },
      ],
      isError: true,
    };
  }
}
