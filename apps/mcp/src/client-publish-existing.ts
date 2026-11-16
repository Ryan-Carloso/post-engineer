import type { PostEngineerClient } from './client.js';
import type { DirectPublishAccountResult, PublishExistingInput, PublishExistingResult } from './client-types.js';
import { isRecord, narrowDirectPublishAccountResult } from './direct-publish-narrowing.js';

//---------------
// Publish-existing client call (issue #384). Standalone function (not a
// client method) because client.ts is grandfathered over the 500-line cap
// and may not grow — the same pattern as client-publish-uploaded.ts. One
// call publishes or schedules media that already exists (a finished engine
// video, a ready signed-upload video, or an inline image) with no
// generation and no token charge. JSON only: no local path ever crosses
// this surface. The input arrives validated and resolved (the handler's
// strict schema, then the account references), so this module only
// builds the body and narrows the answer: the server re-checks every rule.
//---------------

const PUBLISH_EXISTING_TIMEOUT_MS = 120_000;
function narrowScheduledSlot(value: unknown): { id: string; slot_at: string; title: string; status: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.slot_at !== 'string' || typeof value.title !== 'string') return null;
  return { id: value.id, slot_at: value.slot_at, title: value.title, status: typeof value.status === 'string' ? value.status : 'ready' };
}

// A 200 with a malformed body is an error, never a silent success: the
// agent must not report "scheduled" or "published" on a body it can't read.
function narrowPublishExistingResult(value: unknown): PublishExistingResult {
  if (!isRecord(value) || (value.mode !== 'scheduled' && value.mode !== 'asap')) {
    throw new Error('Malformed publish-existing response from the API.');
  }
  if (value.mode === 'scheduled') {
    if (
      value.success !== true ||
      !isRecord(value.schedule) ||
      typeof value.schedule.id !== 'string' ||
      !Array.isArray(value.slots) ||
      value.slots.some((slot) => narrowScheduledSlot(slot) === null)
    ) {
      throw new Error('Malformed publish-existing response from the API.');
    }
    return {
      mode: 'scheduled',
      success: true,
      replayed: value.replayed === true,
      scheduleId: value.schedule.id,
      slots: value.slots.map((slot) => narrowScheduledSlot(slot) as { id: string; slot_at: string; title: string; status: string }),
    };
  }
  if (
    typeof value.mediaKind !== 'string' ||
    !['task', 'upload', 'image'].includes(value.mediaKind) ||
    !Array.isArray(value.publishes) ||
    typeof value.logId !== 'string'
  ) {
    throw new Error('Malformed publish-existing response from the API.');
  }
  const publishes: Array<{ provider: string; success: boolean; results: DirectPublishAccountResult[] }> = [];
  for (const publish of value.publishes) {
    if (!isRecord(publish) || typeof publish.provider !== 'string' || !Array.isArray(publish.results)) {
      throw new Error('Malformed publish-existing response from the API.');
    }
    publishes.push({
      provider: publish.provider,
      success: publish.success === true,
      results: publish.results.map(narrowDirectPublishAccountResult),
    });
  }
  return {
    mode: 'asap',
    success: value.success === true,
    replayed: value.replayed === true,
    mediaKind: value.mediaKind as 'task' | 'upload' | 'image',
    publishes,
    logId: value.logId,
  };
}

export async function publishExisting(
  client: PostEngineerClient,
  input: PublishExistingInput,
): Promise<PublishExistingResult> {
  const providers = Object.keys(input.accounts);
  const publishing: Record<string, unknown> = { mode: input.mode, providers, accounts: input.accounts };
  if (input.mode === 'scheduled') {
    publishing.schedule = { publishAt: input.publishAt, timezone: input.timezone };
  }
  if (input.boardId !== undefined) publishing.pinterestBoardId = input.boardId;
  const body: Record<string, unknown> = {
    media: input.media,
    title: input.title,
    description: input.description,
    publishing,
    idempotencyKey: input.idempotencyKey,
  };
  if (input.personaId !== undefined) body.personaId = input.personaId;
  if (input.tags !== undefined) body.tags = input.tags;
  if (input.privacyStatus !== undefined) body.privacyStatus = input.privacyStatus;
  if (input.caption !== undefined) body.caption = input.caption;

  const result: unknown = await client.request(
    '/api/media/publish-existing',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'publish existing media',
    PUBLISH_EXISTING_TIMEOUT_MS,
  );
  return narrowPublishExistingResult(result);
}
