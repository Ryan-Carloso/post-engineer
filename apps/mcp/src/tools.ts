import { z } from 'zod';
import { filterVoicesPayload, ListVoicesSchema, withResolvedPersonaVoice, type ListVoicesArgs } from './voice-filters.js';
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
import { DisconnectAccountSchema, DisconnectAccountShape } from './account-shapes.js';
import { PublishVideoDirectSchema, PublishVideoDirectShape } from './publish-direct-shape.js';
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
import { getErrorMessage, ApiError } from './errors.js';
import { CreatePersonaSchema, LibraryImageFields } from './persona-create.js';
import { presentSlotDetail } from './slot-detail-present.js';
export { CreatePersonaShape, CreatePersonaSchema } from './persona-create.js';

export type { McpToolResponse } from './tools-call.js';

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
  isPrimary: z
    .literal(true)
    .optional()
    .describe('Set true to mark this image as the primary library image (false is rejected — a new image is not primary unless marked)'),
};

export const AddPersonaImageSchema = z.object(AddPersonaImageShape);

export const UpdatePersonaImageShape = {
  id: z.string().min(1, 'id is required').describe('The library image ID to update'),
  tag: LibraryImageFields.tag.describe(
    'New tag (empty or whitespace-only clears the stored value; omit to keep it)'
  ),
  description: LibraryImageFields.description.describe(
    'New description (empty or whitespace-only clears the stored value; omit to keep it)'
  ),
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

interface NarrowedTokenTransaction {
  id: string | null;
  amount: number | null;
  type: string | null;
  description: string | null;
  reason: string | null;
  generationId: string | null;
  createdAt: string | null;
}

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

export function sanitizeEngineError(error: string): string {
  return error
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

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
    error: typeof error === 'string' ? sanitizeEngineError(error) : null,
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
