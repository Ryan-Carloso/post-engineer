import { z } from 'zod';

export const ListSchedulesShape = {};

export const ListSchedulesSchema = z.object(ListSchedulesShape);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const isoInstant = (what: string) =>
  z.string().regex(ISO_INSTANT, `${what} must be an ISO-8601 timestamp with a UTC offset, e.g. 2026-11-01T00:00:00-03:00.`);

export const ListPostsShape = {
  limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500. Ignored when from/to are given.'),
  from: isoInstant('from').optional().describe('Range mode (with to): start of the window, inclusive. Returns every post of any status with slot_at in [from, to) as a single slots list, plus truncated=true when the cap was hit. At most 62 days.'),
  to: isoInstant('to').optional().describe('Range mode (with from): end of the window, exclusive.'),
};

export const ListPostsSchema = z.object(ListPostsShape).refine((value) => (value.from === undefined) === (value.to === undefined), {
  message: 'from and to must be provided together.',
});

export const CancelScheduleShape = {
  scheduleId: z
    .string()
    .min(1, 'scheduleId is required')
    .describe(
      'The ID of the schedule to cancel. Unpublished slots (ready) are removed. A post already publishing or published is not recalled.',
    ),
};

export const CancelScheduleSchema = z.object(CancelScheduleShape);

export const GetSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from posts (action: list) or publish_video (action: publish_existing)).'),
};

export const GetSlotSchema = z.object(GetSlotShape);

export const UpdateSlotTitleShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from posts (action: list) or publish_video (action: publish_existing)).'),
  title: z
    .string()
    .min(1, 'title is required')
    .describe('The new title text for the slot. Only a slot that is still ready (not yet publishing) can be edited; published or mid-flight slots are rejected.'),
};

export const UpdateSlotTitleSchema = z.object(UpdateSlotTitleShape);

export const DeleteSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe(
      'The slot ID to delete. Only ready or failed slots can be deleted; published or mid-flight slots are rejected. The schedule\'s last slot cannot be deleted — delete the whole schedule with schedules (action: cancel) instead.',
    ),
};

export const DeleteSlotSchema = z.object(DeleteSlotShape);
