import type { PostEngineerClient } from './client.js';
import type { DirectPublishAccountResult, PublishExistingInput, PublishExistingResult } from './client-types.js';
import { isRecord, narrowDirectPublishAccountResult } from './direct-publish-narrowing.js';
import { MAX_SEGMENT_MEDIA_BYTES, MAX_SEGMENT_MEDIA_MB } from './limits.js';

//---------------
// Publish-existing client call (issue #384). Standalone function (not a
// client method) because client.ts is grandfathered over the 500-line cap
// and may not grow — the same pattern as client-publish-uploaded.ts. One
// call publishes or schedules media that already exists (a finished engine
// video, a ready signed-upload video, or an inline image) with no
// generation and no token charge. JSON only: no local path ever crosses
// this surface.
//---------------

const PUBLISH_EXISTING_TIMEOUT_MS = 120_000;
const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'];

/** Base64 strictness is a length + round-trip check, never a regex: the alphabet pattern backtracks on multi-megabyte input. */
function decodedImageBytes(imageData: string): Buffer | null {
  const compact = imageData.replace(/\s/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0) return null;
  const buffer = Buffer.from(compact, 'base64');
  return buffer.toString('base64') === compact ? buffer : null;
}

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
    mediaKind: value.mediaKind as 'task' | 'upload' | 'image',
    publishes,
    logId: value.logId,
  };
}

export async function publishExisting(
  client: PostEngineerClient,
  input: PublishExistingInput,
): Promise<PublishExistingResult> {
  // Mirrors the server-side 400s before any fetch: the media reference for
  // the kind, the single-provider shape, and the schedule fields fail fast
  // here, exactly like publishUploadedVideo.
  if (!VALID_PROVIDERS.includes(input.provider)) {
    throw new Error(`provider must be one of: ${VALID_PROVIDERS.join(', ')}.`);
  }
  if (input.accountIds.length === 0) {
    throw new Error('At least one account ID is required.');
  }
  if (input.title.trim().length === 0) {
    throw new Error('title is required.');
  }
  if (input.description.trim().length === 0) {
    throw new Error('description is required.');
  }
  if (input.mediaKind === 'task' && (input.taskId === undefined || input.taskId.trim().length === 0)) {
    throw new Error('taskId is required when mediaKind is task.');
  }
  if (input.mediaKind === 'upload' && (input.uploadId === undefined || input.uploadId.trim().length === 0)) {
    throw new Error('uploadId is required when mediaKind is upload.');
  }
  let media: Record<string, unknown>;
  if (input.mediaKind === 'task') {
    media = { kind: 'task', taskId: input.taskId };
  } else if (input.mediaKind === 'upload') {
    media = { kind: 'upload', uploadId: input.uploadId };
  } else {
    if (input.provider !== 'instagram') {
      throw new Error('Images can only be published to instagram for now.');
    }
    if (input.imageData === undefined || input.imageContentType === undefined) {
      throw new Error('imageData and imageContentType are required when mediaKind is image.');
    }
    const bytes = decodedImageBytes(input.imageData);
    if (bytes === null) {
      throw new Error('imageData must be base64-encoded bytes.');
    }
    if (bytes.length > MAX_SEGMENT_MEDIA_BYTES) {
      throw new Error(`Image is too large. Maximum is ${MAX_SEGMENT_MEDIA_MB} MB.`);
    }
    media = { kind: 'image', imageData: input.imageData, contentType: input.imageContentType };
  }
  const mode = input.mode ?? 'scheduled';
  if (mode === 'scheduled' && (input.startAt === undefined || input.times === undefined)) {
    throw new Error('startAt and times are required when mode is scheduled.');
  }
  if (mode === 'asap' && (input.startAt !== undefined || input.times !== undefined)) {
    throw new Error('startAt and times must not be set when mode is asap.');
  }
  const publishing: Record<string, unknown> = {
    mode,
    providers: [input.provider],
    accounts: { [input.provider]: input.accountIds },
  };
  if (mode === 'scheduled') {
    publishing.schedule = { startAt: input.startAt, times: input.times, timezone: input.timezone ?? 'UTC' };
  }
  if (input.boardId !== undefined) publishing.pinterestBoardId = input.boardId;
  const body: Record<string, unknown> = {
    media,
    title: input.title,
    description: input.description,
    publishing,
  };
  if (input.personaId !== undefined) body.personaId = input.personaId;
  if (input.tags !== undefined) body.tags = input.tags;
  if (input.privacyStatus !== undefined) body.privacyStatus = input.privacyStatus;
  if (input.caption !== undefined) body.caption = input.caption;
  if (input.idempotencyKey !== undefined) body.idempotencyKey = input.idempotencyKey;

  const result: unknown = await client.request(
    '/api/media/publish-existing',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'publish existing media',
    PUBLISH_EXISTING_TIMEOUT_MS,
  );
  return narrowPublishExistingResult(result);
}
