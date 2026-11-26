import { createHash } from 'node:crypto';
import type { PostEngineerClient } from './client.js';
import { ApiError, getErrorMessage } from './errors.js';
import { handleDeletePersona, handleLibraryCall, sanitizeEngineError } from './tools.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { getPersonaDeletePreview as getPersonaDeletePreviewContract } from './contracts/personas.js';
import type { McpToolResponse } from './tools-call.js';

type DeletePreview = ResponseOf<typeof getPersonaDeletePreviewContract>;

function digest(personaId: string, preview: DeletePreview): string {
  const stable = { personaId, counts: preview.counts };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

function previewText(preview: DeletePreview, confirmToken: string, note: string): string {
  const counts = preview.counts;
  const summary =
    `Deleting persona "${preview.persona.name}" would remove ` +
    `${counts.schedules} schedule(s), ${counts.upcomingSlots} upcoming slot(s), ` +
    `${counts.publishedSlots} published slot(s) and ${counts.failedSlots} failed slot(s).`;
  return `${note}\n${summary}\n${JSON.stringify(preview, null, 2)}\nNothing was deleted. To delete, call personas with action "delete", the same persona and confirmToken "${confirmToken}".`;
}

export async function handlePersonaDelete(
  client: PostEngineerClient,
  args: { personaId: string; confirmToken?: string },
): Promise<McpToolResponse> {
  let preview: DeletePreview;
  try {
    preview = await client.getPersonaDeletePreview(args.personaId);
  } catch (error) {
    if (error instanceof ApiError && error.code !== null) {
      const body = JSON.stringify({ code: error.code, message: sanitizeEngineError(getErrorMessage(error)), field: error.field });
      return { content: [{ type: 'text', text: `Error previewing the persona deletion: ${body}` }], isError: true };
    }
    return handleLibraryCall(async () => { throw error; }, 'previewing the persona deletion');
  }
  const token = digest(args.personaId, preview);
  if (args.confirmToken === undefined) {
    return { content: [{ type: 'text', text: previewText(preview, token, 'Preview only — confirmation needed.') }] };
  }
  if (args.confirmToken !== token) {
    return {
      content: [{ type: 'text', text: previewText(preview, token, 'The confirmToken does not match the persona as it is now (it changed since the preview, or the token is wrong).') }],
      isError: true,
    };
  }
  return handleDeletePersona(client, { personaId: args.personaId });
}
