// Video-tasks contract: the single source of truth for the video generation
// history and task-status exchanges. Both apps generate a copy of this file
// (see scripts/sync-contracts.mjs); never edit a generated copy by hand.
//
// GET /api/persona/video-generations returns the user's generation history,
// newest first, paginated. The ?limit= query is LENIENT by design
// (long-standing route behavior): an invalid or out-of-range limit falls
// back to the default instead of failing, so the query schema below only
// names the param and the parse helper carries the fallback. `success` is
// a literal `true`: the routes never return success:false with a 200.
//
// GET /api/persona/video-status/[taskId] proxies the engine's task record
// inside the engine BaseResponse envelope {status, message, body},
// attaching postUrl to the task body (issue #555). The MCP wait tool reads
// task_id/state/progress/stage/error/postUrl from the body; anything else
// the engine adds rides through unparsed (plain object, extras ignored).
// A 410 Gone (engine lost the task) is a transport error, not a 200, so
// it is not modelled here — the MCP maps it to a terminal verdict.
//
// DELETE /api/persona/video-task/[taskId] passes the engine's
// TaskDeletionResponse through verbatim; the engine model leaves every
// field optional, so the contract does too.
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

/** Generation-history paging defaults (also the MCP client's fail-fast bound). */
export const VIDEO_GENERATIONS_DEFAULT_LIMIT = 50;
export const VIDEO_GENERATIONS_MAX_LIMIT = 200;

//---------------
// parseGenerationsLimit — validates the ?limit= query param; invalid or
// out-of-range values fall back to the default instead of failing.
//---------------
export function parseGenerationsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return VIDEO_GENERATIONS_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return VIDEO_GENERATIONS_DEFAULT_LIMIT;
  return Math.min(parsed, VIDEO_GENERATIONS_MAX_LIMIT);
}

/** One video_generations row, camelCase. No errorMessage: the raw
 * engine/upstream text may contain paths or upstream bodies and is kept
 * server-side (DB) for support only — the UI renders the categorized
 * errorCode. */
export const VideoGenerationRowSchema = z.object({
  id: z.string(),
  generationId: z.string(),
  engineTaskId: z.string().nullable(),
  personaName: z.string().nullable(),
  videoSubject: z.string().nullable(),
  status: z.string(),
  errorCode: z.string().nullable(),
  tokensRefunded: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export type VideoGenerationRow = z.infer<typeof VideoGenerationRowSchema>;

/** Raw paging params as the MCP sends them (strings in the query). Plain
 * object, not strict: the route ignores unknown query params. */
export const ListVideoGenerationsQuerySchema = z.object({
  limit: z.string().optional(),
});

export const ListVideoGenerationsResponseSchema = z.object({
  success: z.literal(true),
  generations: z.array(VideoGenerationRowSchema),
});

export const GetVideoGenerationResponseSchema = z.object({
  success: z.literal(true),
  generation: VideoGenerationRowSchema,
});

/** The engine task record as the MCP wait tool reads it. `state` is the
 * numeric progress state (-1 failed, 1 complete, 3 queued, 4 processing);
 * `stage` is the engine's current step (null once finished); `error`
 * carries the engine failure reason; `postUrl` is the slot detail link
 * the web route attaches (null for direct generations). */
export const VideoTaskProgressBodySchema = z.object({
  task_id: z.string(),
  state: z.number().optional(),
  progress: z.number().optional(),
  stage: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  postUrl: z.string().nullable().optional(),
});

export type VideoTaskProgressBody = z.infer<typeof VideoTaskProgressBodySchema>;

export const GetVideoStatusResponseSchema = z.object({
  status: z.number(),
  message: z.string().nullable(),
  body: VideoTaskProgressBodySchema,
});

export const CancelVideoTaskResponseSchema = z.object({
  status: z.number().optional(),
  message: z.string().nullable().optional(),
  body: z.unknown().optional(),
});

export const listVideoGenerations = defineEndpoint({
  method: 'GET',
  path: '/api/persona/video-generations',
  query: ListVideoGenerationsQuerySchema,
  response: ListVideoGenerationsResponseSchema,
});

export const getVideoGeneration = defineEndpoint({
  method: 'GET',
  path: '/api/persona/video-generations/:generationId',
  response: GetVideoGenerationResponseSchema,
});

export const getVideoStatus = defineEndpoint({
  method: 'GET',
  path: '/api/persona/video-status/:taskId',
  response: GetVideoStatusResponseSchema,
});

export const cancelVideoTask = defineEndpoint({
  method: 'DELETE',
  path: '/api/persona/video-task/:taskId',
  response: CancelVideoTaskResponseSchema,
});
