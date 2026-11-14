import { createHash } from 'node:crypto';
import type { PostEngineerClient } from './client.js';
import { ApiError, getErrorMessage } from './errors.js';
import { handleDeletePersona, handleLibraryCall, narrowDeletePreview, sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// personas · delete — preview, then confirm, inside one action.
//
// Without confirmToken the action only reads: it returns what deleting the
// persona would remove plus a confirmToken. With the token it deletes. The
// token is a digest of the persona id and of that preview (the counts and the
// video task ids, never the signed download links, which change per call), so
// a persona that changed since the preview — a new schedule, a published
// slot — invalidates it and the agent sees the new preview before anything
// is removed. It is a check that the agent saw this exact preview, NOT an
// authorisation boundary: the caller is already authorised to delete, and a
// scoped API key behaves exactly as with the old two tools.
//---------------

type DeletePreview = ReturnType<typeof narrowDeletePreview>;

function digest(personaId: string, preview: DeletePreview): string {
  const stable = { personaId, counts: preview.counts, tasks: preview.videos.map((video) => video.taskId), truncated: preview.videosTruncated };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

function previewText(personaId: string, preview: DeletePreview, confirmToken: string, note: string): string {
  const counts = preview.counts;
  const summary =
    `Deleting persona "${preview.persona.name ?? personaId}" would remove ` +
    `${counts.schedules ?? '?'} schedule(s), ${counts.upcomingSlots ?? '?'} upcoming slot(s), ` +
    `${counts.publishedSlots ?? '?'} published slot(s), ${counts.generatedVideos ?? '?'} generated video(s), ` +
    `and ${counts.personaImages ?? '?'} library image(s). No token refunds.`;
  return `${note}\n${summary}\n${JSON.stringify(preview, null, 2)}\nNothing was deleted. To delete, call personas with action "delete", the same persona and confirmToken "${confirmToken}".`;
}

export async function handlePersonaDelete(
  client: PostEngineerClient,
  args: { personaId: string; confirmToken?: string },
): Promise<McpToolResponse> {
  let preview: DeletePreview;
  try {
    preview = narrowDeletePreview(await client.getPersonaDeletePreview(args.personaId));
  } catch (error) {
    // An API error keeps its structured contract (code, message, field), as the other persona tools.
    if (error instanceof ApiError && error.code !== null) {
      const body = JSON.stringify({ code: error.code, message: sanitizeEngineError(getErrorMessage(error)), field: error.field });
      return { content: [{ type: 'text', text: `Error previewing the persona deletion: ${body}` }], isError: true };
    }
    return handleLibraryCall(async () => { throw error; }, 'previewing the persona deletion');
  }
  const token = digest(args.personaId, preview);
  if (args.confirmToken === undefined) {
    return { content: [{ type: 'text', text: previewText(args.personaId, preview, token, 'Preview only — confirmation needed.') }] };
  }
  if (args.confirmToken !== token) {
    return {
      content: [{ type: 'text', text: previewText(args.personaId, preview, token, 'The confirmToken does not match the persona as it is now (it changed since the preview, or the token is wrong).') }],
      isError: true,
    };
  }
  return handleDeletePersona(client, { personaId: args.personaId });
}
