import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const VIDEO_GENERATIONS_DEFAULT_LIMIT = 50;
export const VIDEO_GENERATIONS_MAX_LIMIT = 200;

export function parseGenerationsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return VIDEO_GENERATIONS_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return VIDEO_GENERATIONS_DEFAULT_LIMIT;
  return Math.min(parsed, VIDEO_GENERATIONS_MAX_LIMIT);
}

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
