import { z } from 'zod';
import { noticeSummary } from './publish-notices.js';
import { firstCommentWarningSuffix } from './first-comment-warnings.js';
import {
  CancelScheduleSchema,
  CancelScheduleShape,
  DeleteSlotSchema,
  DeleteSlotShape,
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
import { CreatePersonaSchema } from './persona-create.js';
import { presentSlotDetail } from './slot-detail-present.js';
export { CreatePersonaShape, CreatePersonaSchema } from './persona-create.js';

export type { McpToolResponse } from './tools-call.js';

export { UpdatePersonaShape, UpdatePersonaSchema, handleUpdatePersona } from './persona-update.js';
export { ConnectAccountShape, ConnectAccountSchema, handleConnectAccount } from './connect-account.js';


export async function handleCreatePersona(
  client: PostEngineerClient,
  args: z.infer<typeof CreatePersonaSchema>
): Promise<McpToolResponse> {
  return handleLibraryCall(
    async () => client.createPersona(CreatePersonaSchema.parse(args)),
    'creating persona',
    'Persona created successfully'
  );
}

export async function handleListPersonas(
  client: PostEngineerClient
): Promise<McpToolResponse> {
  return handleLibraryCall(() => client.listPersonas(), 'listing personas');
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
  const parsed = UpdateSlotTitleSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Error updating slot title: ${parsed.error.issues.map((issue) => issue.message).join('; ')}` }],
      isError: true,
    };
  }
  try {
    const result = await client.updateSlotTitle(args.slotId, args.title, args.firstComment);
    const title = result.title ?? args.title;
    const firstComment = result.firstComment ?? null;
    const changed = [
      ...(title === undefined ? [] : [`title updated to "${title}"`]),
      ...(args.firstComment === undefined ? [] : [firstComment === null ? 'first comment removed' : `first comment set to "${firstComment}"`]),
    ].join(', ');
    return {
      content: [
        {
          type: 'text',
          text: `Slot ${args.slotId} ${changed}.\n${JSON.stringify(
            {
              success: true,
              ...(title === undefined ? {} : { title }),
              ...(args.firstComment === undefined ? {} : { firstComment }),
            },
            null,
            2,
          )}`,
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

export async function handleDeletePersona(
  client: PostEngineerClient,
  args: { personaId: string },
): Promise<McpToolResponse> {
  try {
    await client.deletePersona(args.personaId);
    return {
      content: [
        {
          type: 'text',
          text: `Persona ${args.personaId} deleted: the persona, all its schedules and slots, and its photo are gone.`,
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

export { handleLibraryCall } from './tools-call.js';

export function sanitizeEngineError(error: string): string {
  return error
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
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
      caption: args.caption, boardId: args.boardId, firstComment: args.firstComment, idempotencyKey: args.idempotencyKey,
    });
    const lines = result.results.map((account) => {
      if (account.success) {
        const link = account.videoUrl ?? account.permalink ?? account.postId ?? account.videoId ?? '';
        return `- ${account.accountId}: published${link ? ` (${link})` : ''}${firstCommentWarningSuffix(account)}`;
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
