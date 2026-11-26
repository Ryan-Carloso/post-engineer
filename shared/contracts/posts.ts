import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { SOCIAL_PROVIDERS } from './providers.js';

export const PublishLinkSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  url: z.string(),
});

export const PublishUserNoticeSchema = z.object({
  provider: z.string(),
  accountId: z.string(),
  code: z.string(),
  requiresUser: z.literal(true),
  notice: z.string(),
});

export const PublishProviderFailureSchema = z.object({
  provider: z.string(),
  accountId: z.string(),
  code: z.string(),
  requiresUser: z.boolean(),
  notice: z.string(),
});

export const SlotProgressHistoryEntrySchema = z.object({
  progress: z.number(),
  stage: z.string().nullable(),
  recordedAt: z.string(),
});

export const SlotPostSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  slotAt: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  error: z.string().nullable(),
  publishedAt: z.string().nullable(),
  taskId: z.string().nullable(),
  media: z
    .object({
      kind: z.enum(['upload', 'image']),
      url: z.string().nullable(),
      contentType: z.string().nullable(),
    })
    .nullable()
    .optional(),
  progress: z.number(),
  stage: z.string().nullable(),
  retryable: z.boolean().nullable(),
  scriptAngle: z.string().nullable(),
  publishLinks: z.array(PublishLinkSchema),
  progressHistory: z.array(SlotProgressHistoryEntrySchema),
  userNotices: z.array(PublishUserNoticeSchema),
  providerFailures: z.array(PublishProviderFailureSchema),
  queuePosition: z.null(),
  queueTotal: z.null(),
  postUrl: z.string().nullable(),
});

export const SlotScheduleSchema = z.object({
  id: z.string(),
  personaId: z.string().nullable(),
  providers: z.array(z.string()),
  youtubeAccountIds: z.array(z.string()),
  instagramAccountIds: z.array(z.string()),
  linkedinAccountIds: z.array(z.string()),
  blueskyAccountIds: z.array(z.string()),
  threadsAccountIds: z.array(z.string()),
  facebookAccountIds: z.array(z.string()),
  pinterestAccountIds: z.array(z.string()),
  pinterestBoardId: z.string().nullable(),
  threespeakAccountIds: z.array(z.string()),
  rumbleAccountIds: z.array(z.string()),
  fanvueAccountIds: z.array(z.string()),
  telegramAccountIds: z.array(z.string()),
  timezone: z.string(),
  publishMode: z.enum(['scheduled', 'asap']),
});

export const SlotGenerationSchema = z.object({
  voiceover: z.boolean(),
  mediaKind: z.enum(['upload', 'image']).nullable().optional(),
  language: z.string().nullable(),
  voiceId: z.string().nullable(),
  videoAspect: z.string().nullable(),
  videoLayout: z.string().nullable(),
  niche: z.string().nullable(),
  paragraphNumber: z.number().nullable(),
  faceQuality: z.string().nullable(),
});

export const SlotDetailSchema = z.object({
  slot: SlotPostSchema,
  schedule: SlotScheduleSchema,
  persona: z.object({ id: z.string(), name: z.string() }).nullable(),
  generation: SlotGenerationSchema,
});

export const GenerationPostDetailSchema = z.object({
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
  progress: z.number(),
  stage: z.string().nullable(),
  scriptAngle: z.string().nullable(),
});

export const GetPostResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    success: z.literal(true),
    kind: z.literal('generation'),
    generation: GenerationPostDetailSchema,
  }),
  z.object({
    success: z.literal(true),
    kind: z.literal('slot'),
    slot: SlotPostSchema,
    schedule: SlotScheduleSchema,
    persona: z.object({ id: z.string(), name: z.string() }).nullable(),
    generation: SlotGenerationSchema,
  }),
]);

export const getPost = defineEndpoint({
  method: 'GET',
  path: '/api/posts/:id',
  response: GetPostResponseSchema,
});
