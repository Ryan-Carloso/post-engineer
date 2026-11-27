import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';
import { FirstCommentWarningSchema } from './first-comment.js';
import { SOCIAL_PROVIDERS } from './providers.js';

const PublishLinkSchema = z.object({
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

export const SlotMediaSchema = z.object({
  kind: z.enum(['upload', 'image']),
  url: z.string().nullable(),
  contentType: z.string().nullable(),
});

const SlotPostSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  slotAt: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  error: z.string().nullable(),
  publishedAt: z.string().nullable(),
  publishLinks: z.array(PublishLinkSchema),
  userNotices: z.array(PublishUserNoticeSchema),
  providerFailures: z.array(PublishProviderFailureSchema),
  firstComment: z.string().nullable(),
  commentWarnings: z.array(FirstCommentWarningSchema),
  postUrl: z.string().nullable(),
  media: SlotMediaSchema.nullable().optional(),
});

const SlotScheduleSchema = z.object({
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

export const SlotDetailSchema = z.object({
  slot: SlotPostSchema,
  schedule: SlotScheduleSchema,
  persona: z.object({ id: z.string(), name: z.string() }).nullable(),
});

export const GetPostResponseSchema = z.object({
  success: z.literal(true),
  slot: SlotPostSchema,
  schedule: SlotScheduleSchema,
  persona: z.object({ id: z.string(), name: z.string() }).nullable(),
});

export const getPost = defineEndpoint({
  method: 'GET',
  path: '/api/posts/:id',
  response: GetPostResponseSchema,
});
