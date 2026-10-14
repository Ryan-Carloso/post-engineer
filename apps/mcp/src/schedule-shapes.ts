// Schedule/slot tool shapes.
//
// Extracted from tools.ts so the tools module stays under the file-size
// ratchet. tools.ts re-exports every name here, so existing import sites
// keep working.
import { z } from 'zod';

export const ListSchedulesShape = {};

export const ListSchedulesSchema = z.object(ListSchedulesShape);

export const ListPostsShape = {
  limit: z.number().int().min(1).max(500).default(20).describe('Max number of upcoming and past posts to return (each list). Default 20, max 500.'),
};

export const ListPostsSchema = z.object(ListPostsShape);

export const CancelScheduleShape = {
  scheduleId: z.string().min(1, 'scheduleId is required').describe('The ID of the schedule to cancel'),
};

export const CancelScheduleSchema = z.object(CancelScheduleShape);

export const GetSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from list_posts or generate_persona_videos).'),
};

export const GetSlotSchema = z.object(GetSlotShape);

export const UpdateSlotTopicShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe('The slot ID (the slotId field from list_posts or generate_persona_videos).'),
  topic: z
    .string()
    .min(1, 'topic is required')
    .describe('The new topic text for the slot. Only a slot that has not started generating (status pending/awaiting) can be edited; published or mid-flight slots are rejected.'),
};

export const UpdateSlotTopicSchema = z.object(UpdateSlotTopicShape);

export const DeleteSlotShape = {
  slotId: z
    .string()
    .min(1, 'slotId is required')
    .describe(
      'The slot ID to delete. Only pending (awaiting) or failed slots can be deleted; published or mid-flight slots are rejected. The schedule\'s last slot cannot be deleted — delete the whole schedule with cancel_schedule instead.',
    ),
};

export const DeleteSlotSchema = z.object(DeleteSlotShape);
