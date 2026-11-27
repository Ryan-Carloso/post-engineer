import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { FIRST_COMMENT_MAX_LENGTH } from './first-comment.js';
import {
  PublishProviderFailureSchema,
  PublishUserNoticeSchema,
  SlotDetailSchema,
  SlotMediaSchema,
} from './posts.js';

export const ScheduleRowSchema = z.object({
  id: z.string(),
  persona_id: z.string().nullable(),
  providers: z.array(z.string()),
  youtube_account_ids: z.array(z.string()),
  instagram_account_ids: z.array(z.string()),
  linkedin_account_ids: z.array(z.string()),
  bluesky_account_ids: z.array(z.string()),
  threads_account_ids: z.array(z.string()),
  facebook_account_ids: z.array(z.string()),
  pinterest_account_ids: z.array(z.string()),
  pinterest_board_id: z.string().nullable(),
  threespeak_account_ids: z.array(z.string()),
  rumble_account_ids: z.array(z.string()),
  fanvue_account_ids: z.array(z.string()),
  telegram_account_ids: z.array(z.string()),
  days_of_week: z.array(z.number()).nullable(),
  start_hour: z.number().nullable(),
  end_hour: z.number().nullable(),
  posts_per_day: z.number(),
  timezone: z.string(),
  active: z.boolean(),
  created_at: z.string(),
  publish_mode: z.enum(['scheduled', 'asap']),
});

export const ListSchedulesResponseSchema = z.object({
  success: z.literal(true),
  schedules: z.array(ScheduleRowSchema),
});

export function parseCancelScheduleQuery(params: URLSearchParams):
  | { ok: true; query: { id: string } }
  | { ok: false; error: string } {
  const id = params.get('id');
  if (!id) {
    return { ok: false, error: 'id query param is required.' };
  }
  return { ok: true, query: { id } };
}

export const CancelScheduleResponseSchema = z.object({
  success: z.literal(true),
  cancelledSlotIds: z.array(z.string()),
});

export const STATUS_LIMIT_DEFAULT = 10;
export const STATUS_LIMIT_MAX = 500;

export function parseStatusLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return STATUS_LIMIT_DEFAULT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return STATUS_LIMIT_DEFAULT;
  return Math.min(parsed, STATUS_LIMIT_MAX);
}

export const RANGE_MAX_SPAN_DAYS = 62;
export const RANGE_MAX_SLOTS = 1000;
export const RANGE_STATUSES = [
  'ready',
  'awaiting_approval',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

export type RangeParseResult =
  | { kind: 'none' }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'error'; message: string };

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: string): Date | null {
  if (!ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseStatusRange(params: URLSearchParams): RangeParseResult {
  const from = params.get('from');
  const to = params.get('to');
  if (from === null && to === null) return { kind: 'none' };
  if (from === null || to === null) {
    return { kind: 'error', message: 'from and to must be provided together.' };
  }
  if (params.has('limit')) {
    return { kind: 'error', message: 'limit cannot be combined with from/to.' };
  }
  const fromDate = parseInstant(from);
  const toDate = parseInstant(to);
  if (fromDate === null || toDate === null) {
    return {
      kind: 'error',
      message: 'from and to must be ISO-8601 timestamps with a UTC offset.',
    };
  }
  if (fromDate.getTime() >= toDate.getTime()) {
    return { kind: 'error', message: 'from must be before to.' };
  }
  if (toDate.getTime() - fromDate.getTime() > RANGE_MAX_SPAN_DAYS * 86_400_000) {
    return { kind: 'error', message: `The range cannot exceed ${RANGE_MAX_SPAN_DAYS} days.` };
  }
  return { kind: 'range', from: fromDate.toISOString(), to: toDate.toISOString() };
}

export function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

export const StatusSlotSchema = z.object({
  id: z.string(),
  slot_at: z.string(),
  status: z.enum([
    'ready',
    'awaiting_approval',
    'publishing',
    'published',
    'failed',
    'cancelled',
  ]),
  title: z.string().nullable(),
  description: z.string().nullable().optional(),
  error: z.string().nullable(),
  published_at: z.string().nullable(),
  schedule_id: z.string(),
  postUrl: z.string().nullable(),
  media: SlotMediaSchema.nullable().optional(),
  userNotices: z.array(PublishUserNoticeSchema).optional(),
  providerFailures: z.array(PublishProviderFailureSchema).optional(),
});

export const ListPostsResponseSchema = z.object({
  success: z.literal(true),
  upcoming: z.array(StatusSlotSchema),
  recent: z.array(StatusSlotSchema),
  hasAnyPost: z.boolean(),
  awaitingCount: z.number(),
});

export const ListPostsInRangeResponseSchema = z.object({
  success: z.literal(true),
  slots: z.array(StatusSlotSchema),
  truncated: z.boolean(),
});

export const GetSlotResponseSchema = SlotDetailSchema.extend({
  success: z.literal(true),
});

function nonBlank(message: string) {
  return z.string().min(1, message).refine((value) => value.trim().length > 0, message);
}

export const UpdateSlotBodySchema = z
  .object({
    title: nonBlank('title must be a non-empty string.').optional(),
    slotAt: z
      .string()
      .refine((value) => hasExplicitOffset(value), {
        message: 'slotAt must carry an explicit timezone offset (Z or ±hh:mm).',
      })
      .optional(),
    firstComment: z
      .string()
      .max(FIRST_COMMENT_MAX_LENGTH, `firstComment must be at most ${FIRST_COMMENT_MAX_LENGTH} characters.`)
      .nullable()
      .optional(),
  })
  .refine((value) => value.title !== undefined || value.slotAt !== undefined || value.firstComment !== undefined, {
    message: 'Provide title, slotAt or firstComment to update.',
  });

export const UpdateSlotResponseSchema = z.object({
  success: z.literal(true),
  title: z.string().optional(),
  slotAt: z.string().optional(),
  firstComment: z.string().nullable().optional(),
});

export const DeleteSlotResponseSchema = z.object({
  success: z.literal(true),
});

export const listSchedules = defineEndpoint({
  method: 'GET',
  path: '/api/schedule',
  response: ListSchedulesResponseSchema,
});

export const cancelSchedule = defineEndpoint({
  method: 'DELETE',
  path: '/api/schedule',
  response: CancelScheduleResponseSchema,
});

export const listPosts = defineEndpoint({
  method: 'GET',
  path: '/api/schedule/status',
  response: ListPostsResponseSchema,
});

export const listPostsInRange = defineEndpoint({
  method: 'GET',
  path: '/api/schedule/status',
  response: ListPostsInRangeResponseSchema,
});

export const getSlot = defineEndpoint({
  method: 'GET',
  path: '/api/schedule/slots/:slotId',
  response: GetSlotResponseSchema,
});

export const updateSlotTitle = defineEndpoint({
  method: 'PATCH',
  path: '/api/schedule/slots/:slotId',
  body: UpdateSlotBodySchema,
  response: UpdateSlotResponseSchema,
});

export const deleteSlot = defineEndpoint({
  method: 'DELETE',
  path: '/api/schedule/slots/:slotId',
  response: DeleteSlotResponseSchema,
});
