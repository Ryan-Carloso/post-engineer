import type { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import { publishExisting } from './client-publish-existing.js';
import { ApiError, getErrorMessage } from './errors.js';
import { PublishExistingSchema } from './publish-existing-shape.js';
import { sanitizeEngineError } from './tools.js';
import { type McpToolResponse } from './tools-call.js';

//---------------
// Publish-existing handler (issue #384): the JSON-only remote flow that
// publishes or schedules media that already exists (a finished engine
// video, a ready signed-upload video, or an inline image) with no
// generation and no token charge. Kept in a new module so tools.ts stays
// under the file-size ratchet; the publish_video tool registers it in
// intent-content.ts. sanitizeEngineError is imported from tools.ts (an
// import cycle through tools.js that is safe: handlers run after module
// init).
//---------------

export async function handlePublishExisting(
  client: PostEngineerClient,
  args: z.infer<typeof PublishExistingSchema>,
): Promise<McpToolResponse> {
  try {
    const input = PublishExistingSchema.parse(args);
    const result = await publishExisting(client, input);
    if (result.mode === 'scheduled') {
      const slots = result.slots.map((slot) => `- slot ${slot.id} at ${slot.slot_at} (${slot.status})`).join('\n');
      return {
        content: [
          {
            type: 'text',
            text:
              `Scheduled existing ${input.mediaKind} to ${input.provider}${result.replayed ? ' (replayed: the same request was already scheduled)' : ''}.\n` +
              `Schedule ${result.scheduleId}.\n${slots}\n` +
              JSON.stringify({ success: true, mode: 'scheduled', replayed: result.replayed, scheduleId: result.scheduleId, slots: result.slots }),
          },
        ],
      };
    }
    const lines = result.publishes.map((publish) => {
      const accounts = publish.results
        .map((account) => {
          if (account.success) {
            const link = account.videoUrl ?? account.permalink ?? account.postId ?? account.videoId ?? '';
            return `- ${account.accountId}: published${link ? ` (${link})` : ''}`;
          }
          return `- ${account.accountId}: FAILED — ${account.error ?? 'unknown error'}`;
        })
        .join('\n');
      return `${publish.provider}: ${publish.success ? 'published' : 'FAILED'}\n${accounts}`;
    });
    return {
      content: [
        {
          type: 'text',
          text:
            `Published existing ${input.mediaKind} (${result.success ? 'all providers succeeded' : 'some providers failed'}).\n` +
            lines.join('\n') +
            `\n${JSON.stringify({ success: result.success, mode: 'asap', mediaKind: result.mediaKind, publishes: result.publishes, logId: result.logId })}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      return {
        content: [
          {
            type: 'text',
            text: `Error publishing existing media: ${JSON.stringify({
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
      content: [{ type: 'text', text: `Error publishing existing media: ${getErrorMessage(error)}` }],
      isError: true,
    };
  }
}
