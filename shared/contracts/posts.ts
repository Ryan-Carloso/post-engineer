// Post detail contract: the single source of truth for GET /api/posts/[id].
// Both apps generate a copy of this file (see scripts/sync-contracts.mjs);
// never edit a generated copy by hand.
//
// One endpoint, two kinds: a scheduled slot (scheduled_posts id) or a
// direct video generation (video_generations generation_id). The route
// returns `{success: true, kind: 'generation', generation}` or
// `{success: true, kind: 'slot', ...slotDetail}`; a miss is a 404, never a
// 200, so the response schema below covers the 200 shape only. The detail
// shapes mirror apps/web/lib/post-detail.ts (SlotPostDetail,
// GenerationPostDetail) and the publish-link/notice shapes of
// apps/web/lib/publish-links.ts and publish-user-notice.ts. `success` is a
// literal `true`: the route never returns success:false with a 200.
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

/** Providers a publish link can name. Mirrors the PROVIDERS set of
 * apps/web/lib/publish-links.ts (resolvePublishLinks drops any other
 * provider before a link is built); pinned by
 * apps/web/lib/__tests__/contracts-shared.test.ts. */
export const PUBLISH_PROVIDERS = [
  'youtube',
  'instagram',
  'bluesky',
  'linkedin',
  'threads',
  'facebook',
  'pinterest',
  '3speak',
  'rumble',
  'fanvue',
] as const;

export const PublishLinkSchema = z.object({
  provider: z.enum(PUBLISH_PROVIDERS),
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
  timezone: z.string(),
  publishMode: z.enum(['scheduled', 'asap']),
});

export const SlotGenerationSchema = z.object({
  faceless: z.boolean(),
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
