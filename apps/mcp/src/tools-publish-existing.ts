import { randomUUID } from 'node:crypto';

import type { PostEngineerClient } from './client.js';
import type { PublishExistingInput, PublishExistingResult } from './client-types.js';
import { publishExisting } from './client-publish-existing.js';
import { readLocalImage } from './client-user-media.js';
import { ApiError, getErrorMessage } from './errors.js';
import { IMAGE_PROVIDERS, isImageProvider, type SocialProvider as Provider } from './contracts/providers.js';
import { boundAccounts } from './generate-video.js';
import { PublishExistingSchema, type PublishExistingArgs } from './publish-existing-shape.js';
import { createRefResolvers } from './refs.js';
import { sanitizeEngineError } from './tools.js';
import { type McpToolResponse } from './tools-call.js';

//---------------
// Publish-existing handler (issue #384): publish or schedule media that
// already exists (a finished generated video, a completed signed upload,
// or an image) with no generation and no token charge. Every account
// reference is resolved before the call (refs.ts: exact match, candidates
// on ambiguity, never a guess) and echoed back; with no accounts, the
// persona's bound accounts are used, like generate_video. Kept in a new
// module so tools.ts stays under the file-size ratchet; the publish_video
// tool registers it in intent-content.ts. sanitizeEngineError is imported
// from tools.ts (an import cycle through tools.js that is safe: handlers
// run after module init).
//---------------

type Resolved<T> = { kind: 'ok'; value: T } | { kind: 'response'; response: McpToolResponse };

function failure(message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `Error publishing existing media: ${message}` }], isError: true };
}

async function resolveTargets(
  client: PostEngineerClient,
  args: PublishExistingArgs,
): Promise<Resolved<{ accounts: Map<Provider, string[]>; note: string }>> {
  const accounts = new Map<Provider, string[]>();
  const notes: string[] = [];
  if (args.accounts !== undefined) {
    const resolvers = createRefResolvers(client);
    for (const ref of args.accounts) {
      const outcome = await resolvers.account(ref);
      if (outcome.kind === 'response') return outcome;
      const provider = outcome.value.provider as Provider;
      const ids = accounts.get(provider) ?? [];
      if (!ids.includes(outcome.value.id)) accounts.set(provider, [...ids, outcome.value.id]);
      notes.push(`account "${ref}" → ${provider} ${outcome.value.id}`);
    }
    return { kind: 'ok', value: { accounts, note: notes.join('; ') } };
  }
  if (args.personaId === undefined) {
    return { kind: 'response', response: failure('say where to publish: pass accounts (names or ids from accounts (action: list)), or a persona with bound publishing accounts.') };
  }
  let bound: Map<Provider, string[]>;
  try {
    bound = await boundAccounts(client, args.personaId);
  } catch (error) {
    return { kind: 'response', response: failure(`could not read the persona's publishing accounts: ${getErrorMessage(error)}`) };
  }
  if (bound.size === 0) {
    return { kind: 'response', response: failure('the persona has no bound publishing accounts. Pass accounts, or bind accounts with accounts (action: set_persona_publishing).') };
  }
  const note = `the persona's bound accounts: ${[...bound].map(([provider, ids]) => `${provider} (${ids.join(', ')})`).join('; ')}`;
  return { kind: 'ok', value: { accounts: bound, note } };
}

async function resolveMedia(args: PublishExistingArgs): Promise<Resolved<PublishExistingInput['media']>> {
  if (args.mediaKind === 'task' && args.taskId !== undefined) return { kind: 'ok', value: { kind: 'task', taskId: args.taskId } };
  if (args.mediaKind === 'upload' && args.uploadId !== undefined) return { kind: 'ok', value: { kind: 'upload', uploadId: args.uploadId } };
  if (args.imagePath !== undefined) {
    let image: { buffer: Buffer; mimeType: string };
    try {
      image = await readLocalImage(args.imagePath);
    } catch (error) {
      return { kind: 'response', response: failure(getErrorMessage(error)) };
    }
    if (image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/png') {
      return { kind: 'response', response: failure('Image posts take a JPEG or PNG; convert the WebP first.') };
    }
    return { kind: 'ok', value: { kind: 'image', imageData: image.buffer.toString('base64'), contentType: image.mimeType } };
  }
  // The strict schema already demanded the reference for the kind.
  return { kind: 'response', response: failure(`mediaKind ${args.mediaKind} needs its media reference.`) };
}

function summary(result: PublishExistingResult, mediaKind: string, resolvedNote: string): string {
  const resolved = resolvedNote === '' ? '' : `Resolved: ${resolvedNote}.\n`;
  if (result.mode === 'scheduled') {
    const slots = result.slots.map((slot) => `- slot ${slot.id} at ${slot.slot_at} (${slot.status})`).join('\n');
    return (
      `${resolved}Scheduled existing ${mediaKind}${result.replayed ? ' (replayed: the same request was already scheduled)' : ''}.\n` +
      `Schedule ${result.scheduleId}.\n${slots}\n` +
      JSON.stringify({ success: true, mode: 'scheduled', replayed: result.replayed, scheduleId: result.scheduleId, slots: result.slots })
    );
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
  const outcome = result.replayed
    ? 'replayed from the first call: nothing was posted again'
    : result.success
      ? 'all networks succeeded'
      : 'some networks failed';
  return (
    `${resolved}Published existing ${mediaKind} (${outcome}).\n${lines.join('\n')}\n` +
    JSON.stringify({ success: result.success, mode: 'asap', replayed: result.replayed, mediaKind: result.mediaKind, publishes: result.publishes, logId: result.logId })
  );
}

export async function handlePublishExisting(client: PostEngineerClient, args: PublishExistingArgs): Promise<McpToolResponse> {
  const parsed = PublishExistingSchema.safeParse(args);
  if (!parsed.success) {
    return failure(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; '));
  }
  const input = parsed.data;
  try {
    const targets = await resolveTargets(client, input);
    if (targets.kind === 'response') return targets.response;
    const providers = [...targets.value.accounts.keys()];
    // Images post only to the image networks: refuse before reading the file.
    // (An image upload is checked by the server, which knows its type.)
    const videoOnly = providers.filter((provider) => !isImageProvider(provider));
    if (input.mediaKind === 'image' && videoOnly.length > 0) {
      return failure(`images go to ${IMAGE_PROVIDERS.join(', ')} only; drop the ${videoOnly.join(', ')} account(s).`);
    }
    const media = await resolveMedia(input);
    if (media.kind === 'response') return media.response;
    const result = await publishExisting(client, {
      media: media.value,
      accounts: Object.fromEntries(targets.value.accounts),
      title: input.title,
      description: input.description,
      caption: input.caption,
      personaId: input.personaId,
      mode: input.mode,
      publishAt: input.publishAt,
      timezone: input.timezone,
      tags: input.tags,
      privacyStatus: input.privacyStatus,
      boardId: input.boardId,
      // A fresh key per call keeps a new publish a new one; the caller's
      // key makes its retry replay instead of posting again.
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
    });
    return { content: [{ type: 'text', text: summary(result, input.mediaKind, targets.value.note) }] };
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
    return failure(getErrorMessage(error));
  }
}
