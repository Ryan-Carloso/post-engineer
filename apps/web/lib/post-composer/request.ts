import { narrowFirstCommentWarnings } from '@/lib/first-comment/form-field';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

import type { MediaContentType, SubmissionPlan } from './compose';

export interface UploadedMedia {
  kind: 'upload';
  uploadId: string;
}

interface PublishAccountResult {
  accountId: string;
  success: boolean;
  error?: string;
  errorCode?: string;
  warnings?: ReturnType<typeof narrowFirstCommentWarnings>;
  videoUrl?: string;
  permalink?: string;
  postId?: string;
  videoId?: string;
}

export interface ReconnectWarning {
  code: 'account_needs_reconnect';
  accounts: { provider: string; accountId: string }[];
}

interface ProviderPublish {
  provider: string;
  success: boolean;
  results: PublishAccountResult[];
}

interface ScheduledSlotSummary {
  id: string;
  slotAt: string;
  title: string;
  status: string;
}

interface HeldSlotSummary {
  id: string;
  slotAt: string;
  status: string;
}

export type PublishResult =
  | { mode: 'asap'; success: boolean; replayed: boolean; publishes: ProviderPublish[] }
  | {
      mode: 'asap';
      held: true;
      approvalRequired: true;
      replayed: boolean;
      slot: HeldSlotSummary;
    }
  | {
      mode: 'asap';
      held: false;
      approvalRequired: false;
      replayed: boolean;
      slot: HeldSlotSummary;
    }
  | {
      mode: 'scheduled';
      replayed: boolean;
      scheduleId: string;
      slots: ScheduledSlotSummary[];
      warnings?: ReconnectWarning[];
    };

export type ComposerRequestStage = 'mint' | 'upload' | 'complete' | 'publish';

export class ComposerRequestError extends Error {
  constructor(
    public readonly stage: ComposerRequestStage,
    public readonly status: number | null,
    public readonly serverError: string | null,
    public readonly field: string | null,
    public readonly code: string | null,
  ) {
    super(`${stage} request failed`);
    this.name = 'ComposerRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
}

interface ServerErrorFields {
  error: string | null;
  field: string | null;
  code: string | null;
}

function readServerError(payload: unknown): ServerErrorFields {
  if (!isRecord(payload)) return { error: null, field: null, code: null };
  return {
    error: typeof payload.error === 'string' ? payload.error : null,
    field: typeof payload.field === 'string' ? payload.field : null,
    code: typeof payload.code === 'string' ? payload.code : null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readMintResponse(response: Response): Promise<{ uploadId: string; signedUrl: string }> {
  const payload = await readJson(response);
  if (
    !isRecord(payload) ||
    typeof payload.uploadId !== 'string' ||
    typeof payload.signedUrl !== 'string'
  ) {
    throw new ComposerRequestError('mint', response.status, null, null, null);
  }
  return { uploadId: payload.uploadId, signedUrl: payload.signedUrl };
}

function putBytes(
  signedUrl: string,
  file: File,
  contentType: MediaContentType,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', signedUrl);
    request.setRequestHeader('content-type', contentType);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new ComposerRequestError('upload', request.status, null, null, null));
    });
    request.addEventListener('error', () => {
      reject(new ComposerRequestError('upload', null, null, null, null));
    });
    request.addEventListener('abort', () => {
      reject(new ComposerRequestError('upload', null, null, null, null));
    });
    request.send(file);
  });
}

async function mintUpload(
  contentType: MediaContentType,
  sizeBytes: number,
): Promise<{ uploadId: string; signedUrl: string }> {
  let response: Response;
  try {
    response = await fetch('/api/videos/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType, sizeBytes }),
    });
  } catch {
    throw new ComposerRequestError('mint', null, null, null, null);
  }
  notifyIfSessionExpired(response);
  if (!response.ok) {
    const fields = readServerError(await readJson(response));
    throw new ComposerRequestError('mint', response.status, fields.error, fields.field, fields.code);
  }
  return readMintResponse(response);
}

async function completeUpload(uploadId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/videos/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
    });
  } catch {
    throw new ComposerRequestError('complete', null, null, null, null);
  }
  notifyIfSessionExpired(response);
  if (!response.ok) {
    const fields = readServerError(await readJson(response));
    throw new ComposerRequestError('complete', response.status, fields.error, fields.field, fields.code);
  }
}

export async function uploadMediaFile(
  file: File,
  contentType: MediaContentType,
  onProgress: (percent: number) => void,
): Promise<UploadedMedia> {
  const minted = await mintUpload(contentType, file.size);
  await putBytes(minted.signedUrl, file, contentType, onProgress);
  await completeUpload(minted.uploadId);
  return { kind: 'upload', uploadId: minted.uploadId };
}

export function buildPublishBody(
  plan: SubmissionPlan,
  media: UploadedMedia,
  idempotencyKey: string,
): Record<string, unknown> {
  const publishing: Record<string, unknown> = {
    mode: plan.mode,
    providers: plan.providers,
    accounts: plan.accounts,
  };
  if (plan.schedule !== null) publishing.schedule = plan.schedule;
  if (plan.pinterestBoardId !== null) publishing.pinterestBoardId = plan.pinterestBoardId;

  const body: Record<string, unknown> = {
    media: { kind: 'upload', uploadId: media.uploadId },
    title: plan.title,
    description: plan.description,
    publishing,
    idempotencyKey,
  };
  if (plan.personaId !== null) body.personaId = plan.personaId;
  if (plan.tags !== undefined) body.tags = plan.tags;
  if (plan.privacyStatus !== undefined) body.privacyStatus = plan.privacyStatus;
  if (plan.caption !== null) body.caption = plan.caption;
  if (plan.firstComment !== null) body.firstComment = plan.firstComment;
  return body;
}

function parseAccountResult(value: unknown): PublishAccountResult | null {
  if (!isRecord(value) || typeof value.accountId !== 'string') return null;
  const warnings = narrowFirstCommentWarnings(value.warnings);
  return {
    accountId: value.accountId,
    success: value.success === true,
    error: optionalString(value, 'error'),
    errorCode: optionalString(value, 'errorCode'),
    warnings: warnings.length > 0 ? warnings : undefined,
    videoUrl: optionalString(value, 'videoUrl'),
    permalink: optionalString(value, 'permalink'),
    postId: optionalString(value, 'postId'),
    videoId: optionalString(value, 'videoId'),
  };
}

function narrowReconnectWarnings(value: unknown): ReconnectWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: ReconnectWarning[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.code !== 'account_needs_reconnect' || !Array.isArray(item.accounts)) continue;
    const accounts = item.accounts
      .filter(
        (account): account is { provider: string; accountId: string } =>
          isRecord(account) && typeof account.provider === 'string' && typeof account.accountId === 'string',
      )
      .map((account) => ({ provider: account.provider, accountId: account.accountId }));
    warnings.push({ code: 'account_needs_reconnect', accounts });
  }
  return warnings;
}

function parsePublishes(value: unknown): ProviderPublish[] {
  if (!Array.isArray(value)) return [];
  const publishes: ProviderPublish[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.provider !== 'string') continue;
    const results = Array.isArray(item.results)
      ? item.results.map(parseAccountResult).filter((result): result is PublishAccountResult => result !== null)
      : [];
    publishes.push({ provider: item.provider, success: item.success === true, results });
  }
  return publishes;
}

function parseSlots(value: unknown): ScheduledSlotSummary[] {
  if (!Array.isArray(value)) return [];
  const slots: ScheduledSlotSummary[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.slot_at !== 'string') continue;
    slots.push({
      id: item.id,
      slotAt: item.slot_at,
      title: optionalString(item, 'title') ?? '',
      status: optionalString(item, 'status') ?? '',
    });
  }
  return slots;
}

function parseHeldSlot(value: unknown): HeldSlotSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.slotAt !== 'string') return null;
  return {
    id: value.id,
    slotAt: value.slotAt,
    status: optionalString(value, 'status') ?? '',
  };
}

export async function publishExisting(
  plan: SubmissionPlan,
  media: UploadedMedia,
  idempotencyKey: string,
): Promise<PublishResult> {
  let response: Response;
  try {
    response = await fetch('/api/media/publish-existing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPublishBody(plan, media, idempotencyKey)),
    });
  } catch {
    throw new ComposerRequestError('publish', null, null, null, null);
  }
  notifyIfSessionExpired(response);
  const payload = await readJson(response);
  if (!response.ok) {
    const fields = readServerError(payload);
    throw new ComposerRequestError('publish', response.status, fields.error, fields.field, fields.code);
  }
  if (!isRecord(payload)) {
    throw new ComposerRequestError('publish', response.status, null, null, null);
  }
  if (payload.mode === 'scheduled') {
    const schedule = payload.schedule;
    const scheduleId = isRecord(schedule) && typeof schedule.id === 'string' ? schedule.id : null;
    if (scheduleId === null) {
      throw new ComposerRequestError('publish', response.status, null, null, null);
    }
    const warnings = narrowReconnectWarnings(payload.warnings);
    return {
      mode: 'scheduled',
      replayed: payload.replayed === true,
      scheduleId,
      slots: parseSlots(payload.slots),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
  if (payload.mode !== 'asap') {
    throw new ComposerRequestError('publish', response.status, null, null, null);
  }
  const heldSlot = parseHeldSlot(payload.slot);
  if (heldSlot !== null && (payload.approvalRequired === true || payload.publishes === undefined)) {
    if (payload.approvalRequired === true) {
      return {
        mode: 'asap',
        held: true,
        approvalRequired: true,
        replayed: payload.replayed === true,
        slot: heldSlot,
      };
    }
    return {
      mode: 'asap',
      held: false,
      approvalRequired: false,
      replayed: payload.replayed === true,
      slot: heldSlot,
    };
  }
  return {
    mode: 'asap',
    success: payload.success === true,
    replayed: payload.replayed === true,
    publishes: parsePublishes(payload.publishes),
  };
}
