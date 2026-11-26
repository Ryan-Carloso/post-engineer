import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, errorMessage, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { SCHEDULE_ACCOUNT_COLUMNS, SOCIAL_PROVIDERS } from '@/lib/contracts/providers';
import { isUserAccountErrorCode } from '@/lib/upload/account-error-codes';
import {
  VIDEO_UPLOAD_TTL_MS,
  VideoUploadError,
  createSupabaseVideoUploadStore,
} from '@/lib/videos/signed-upload';
import {
  asapScopeKey,
  claimAsapLedger,
  hasGrantedAccounts,
  publishHeldMedia,
  type AsapLedger,
  type ProviderPublish,
} from '@/app/api/media/publish-existing/asap';
import type { PublishExistingContext } from '@/app/api/media/publish-existing/context';
import { ExistingMediaError, SCHEDULED_IMAGE_BUCKET } from '@/app/api/media/publish-existing/media-resolve';
import type { PublishExistingRequest } from '@/app/api/media/publish-existing/schema';
import type { Provider } from '@/app/api/media/publish-existing/providers-validation';

export interface HeldSlot {
  id: string;
  schedule_id: string;
  status: string;
  title: string | null;
  description: string | null;
  slot_at: string;
  media_ref: string | null;
  media_kind: string | null;
  media_content_type: string | null;
}

interface PublishScheduleRow {
  id: string;
  user_id: string;
  persona_id: string | null;
  providers: string[] | null;
  pinterest_board_id: string | null;
  [column: string]: unknown;
}

type SlotOutcome = Record<string, unknown>;

function toSlotOutcomes(publishes: ProviderPublish[]): SlotOutcome[] {
  const outcomes: SlotOutcome[] = [];
  for (const publish of publishes) {
    for (const result of publish.results) {
      const code = result.success ? null : (result.errorCode ?? 'publish_unknown');
      const outcome: SlotOutcome = {
        provider: publish.provider,
        accountId: result.accountId,
        status: result.success ? 'published' : 'failed',
        code,
        requiresUser: result.success ? false : isUserAccountErrorCode(code ?? 'publish_unknown'),
        notice: null,
        error: result.success ? null : (result.error ?? null),
      };
      for (const field of ['videoUrl', 'permalink', 'postId', 'videoId'] as const) {
        const value = result[field];
        if (typeof value === 'string' && value.length > 0) outcome[field] = value;
      }
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

async function loadPublishSchedule(
  supabase: SupabaseClient,
  scheduleId: string,
  userId: string,
  route: string,
): Promise<PublishScheduleRow | NextResponse> {
  const columns = ['id', 'user_id', 'persona_id', 'providers', 'pinterest_board_id', ...Object.values(SCHEDULE_ACCOUNT_COLUMNS)].join(', ');
  const { data: schedule, error } = await supabase
    .from('schedules')
    .select(columns)
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    logger.error('[api/schedule/slots] publish schedule lookup failed', error, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  if (!schedule) {
    return apiErrorResponse(404, 'Slot not found.', { route });
  }
  return schedule as unknown as PublishScheduleRow;
}

async function resolveHeldMedia(
  supabase: SupabaseClient,
  userId: string,
  slot: HeldSlot,
): Promise<{ uploadRow: NonNullable<PublishExistingContext['uploadRow']>; image: null } | { uploadRow: null; image: NonNullable<PublishExistingContext['image']> }> {
  if (slot.media_kind === 'upload' && slot.media_ref !== null) {
    const store = createSupabaseVideoUploadStore();
    const uploadRow = await store.getUpload(slot.media_ref);
    if (uploadRow === null || uploadRow.user_id !== userId) {
      throw new VideoUploadError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
    }
    return { uploadRow, image: null };
  }
  if (slot.media_kind === 'image' && slot.media_ref !== null) {
    const contentType = slot.media_content_type;
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw new ExistingMediaError(formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), 500, 'MEDIA_CONTENT_TYPE_UNKNOWN');
    }
    const { data, error } = await supabase.storage.from(SCHEDULED_IMAGE_BUCKET).download(slot.media_ref);
    if (error !== null || data === null) {
      throw new VideoUploadError('No uploaded file was found for this upload. Upload the video first.', 400, 'VIDEO_UPLOAD_FILE_MISSING');
    }
    return { uploadRow: null, image: { buffer: Buffer.from(await data.arrayBuffer()), contentType } };
  }
  throw new VideoUploadError('This slot has no uploaded media.', 400, 'VIDEO_UPLOAD_NOT_FOUND');
}

function mediaErrorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof ExistingMediaError || error instanceof VideoUploadError) {
    return apiErrorResponse(error.status, error.message, { route, code: error.code });
  }
  return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
    route,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
}

export async function publishHeldSlot(options: {
  request: Request;
  serviceClient: SupabaseClient;
  userId: string;
  slot: HeldSlot;
  route: string;
}): Promise<NextResponse> {
  const { request, serviceClient, userId, slot, route } = options;
  const scheduleOrError = await loadPublishSchedule(serviceClient, slot.schedule_id, userId, route);
  if (scheduleOrError instanceof NextResponse) return scheduleOrError;
  const schedule = scheduleOrError;
  const knownProviders = SOCIAL_PROVIDERS as ReadonlyArray<string>;
  const providers = (schedule.providers ?? []).filter((provider): provider is Provider => knownProviders.includes(provider));
  if (providers.length === 0) {
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  const accountIds = {} as Record<Provider, string[]>;
  for (const [provider, column] of Object.entries(SCHEDULE_ACCOUNT_COLUMNS) as Array<[Provider, string]>) {
    const value = schedule[column];
    accountIds[provider] = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  }

  if (slot.media_kind === 'upload' && slot.media_ref !== null) {
    const uploadStore = createSupabaseVideoUploadStore();
    const extended = await uploadStore.updateUpload(slot.media_ref, 'ready', {
      expires_at: new Date(Date.now() + VIDEO_UPLOAD_TTL_MS).toISOString(),
    });
    if (!extended) {
      return apiErrorResponse(409, errorMessage(ERROR_CODES.VIDEO_UPLOAD_CONSUMED), {
        route,
        code: ERROR_CODES.VIDEO_UPLOAD_CONSUMED,
      });
    }
  }

  let media: Awaited<ReturnType<typeof resolveHeldMedia>>;
  let aiLabel = false;
  try {
    media = await resolveHeldMedia(serviceClient, userId, slot);
    if (schedule.persona_id !== null) {
      const { data: personaRow, error: personaError } = await serviceClient
        .from('personas')
        .select('ai_label')
        .eq('id', schedule.persona_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (personaError) throw personaError;
      aiLabel = (personaRow as { ai_label?: unknown } | null)?.ai_label === true;
    }
  } catch (error) {
    if (error instanceof ExistingMediaError || error instanceof VideoUploadError) {
      return mediaErrorResponse(error, route);
    }
    logger.error('[api/schedule/slots] held media lookup failed', error, { slotId: slot.id, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const input: PublishExistingRequest = {
    media:
      slot.media_kind === 'upload' && slot.media_ref !== null
        ? { kind: 'upload', uploadId: slot.media_ref }
        : { kind: 'image', imageData: '', contentType: media.image?.contentType ?? 'image/jpeg' },
    title: slot.title ?? '',
    description: slot.description ?? '',
    personaId: schedule.persona_id,
    publishing: {
      mode: 'asap',
      providers,
      accounts: undefined,
      schedule: undefined,
      pinterestBoardId: schedule.pinterest_board_id,
    },
    tags: undefined,
    privacyStatus: undefined,
    caption: undefined,
    promptVersionId: undefined,
    idempotencyKey: undefined,
  };
  const ctx: PublishExistingContext = {
    aiLabel,
    approvalMode: 'approval',
    route,
    supabase: serviceClient,
    userId,
    request,
    input,
    accountIds,
    reconnectWarning: null,
    uploadRow: media.uploadRow,
    image: media.image,
    logId: logger.generateLogId(),
    startTime: Date.now(),
  };

  let ledger: AsapLedger | null = null;
  try {
    ledger = await claimAsapLedger(asapScopeKey(slot.id), userId, providers, accountIds);
  } catch (error) {
    logger.error('[api/schedule/slots] publish ledger claim failed', error, { slotId: slot.id, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  if (!hasGrantedAccounts(ledger)) {
    return apiErrorResponse(409, 'The accounts for this post are busy with another publish. Try again in a moment.', {
      route,
    });
  }

  const { error: claimError } = await serviceClient
    .from('scheduled_posts')
    .update({ status: 'publishing' })
    .eq('id', slot.id)
    .eq('user_id', userId)
    .in('status', ['awaiting_approval'])
    .select('id')
    .single();
  if (claimError) {
    if ((claimError as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(409, 'Only an awaiting-approval slot can be approved.', {
        route,
        metadata: { status: slot.status },
      });
    }
    logger.error('[api/schedule/slots] held slot claim failed', claimError, { slotId: slot.id, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  let publishes: ProviderPublish[];
  try {
    publishes = await publishHeldMedia(ctx, ledger);
  } catch (error) {
    await serviceClient
      .from('scheduled_posts')
      .update({ status: 'awaiting_approval' })
      .eq('id', slot.id)
      .eq('user_id', userId)
      .in('status', ['publishing']);
    return mediaErrorResponse(error, route);
  }

  const outcomes = toSlotOutcomes(publishes);
  const anyPublished = outcomes.some((outcome) => outcome.status === 'published');
  const finalStatus = anyPublished ? 'published' : 'failed';
  const { error: finalError } = await serviceClient
    .from('scheduled_posts')
    .update({
      status: finalStatus,
      publish_outcomes: outcomes,
      ...(anyPublished ? { published_at: new Date().toISOString() } : {}),
    })
    .eq('id', slot.id)
    .eq('user_id', userId)
    .in('status', ['publishing'])
    .select('id')
    .single();
  if (finalError) {
    logger.error('[api/schedule/slots] held slot outcome save failed', finalError, { slotId: slot.id, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  return NextResponse.json({ success: true, status: finalStatus, publishes });
}
