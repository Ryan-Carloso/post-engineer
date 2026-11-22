import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const SHARE_LINK_MAX_ACTIVE = 10;
export const SHARE_LINK_MAX_EXPIRY_DAYS = 365;
export const SHARE_LINK_MAX_PERSONAS = 50;

export const CreateShareLinkBodySchema = z
  .object({
    personaIds: z.array(z.string()).min(1).max(SHARE_LINK_MAX_PERSONAS).optional(),
    expiresInDays: z.number().int().min(1).max(SHARE_LINK_MAX_EXPIRY_DAYS).optional(),
  })
  .strict();

export const ShareLinkSchema = z.object({
  id: z.string(),
  personaIds: z.array(z.string()).nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
});

export const CreateShareLinkResponseSchema = z.object({
  success: z.literal(true),
  id: z.string(),
  token: z.string(),
  path: z.string(),
  url: z.string(),
  personaIds: z.array(z.string()).nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const ListShareLinksResponseSchema = z.object({
  success: z.literal(true),
  links: z.array(ShareLinkSchema),
});

export const RevokeShareLinkResponseSchema = z.object({
  success: z.literal(true),
  alreadyRevoked: z.boolean(),
});

export const createShareLink = defineEndpoint({
  method: 'POST',
  path: '/api/share-links',
  body: CreateShareLinkBodySchema,
  response: CreateShareLinkResponseSchema,
});

export const listShareLinks = defineEndpoint({
  method: 'GET',
  path: '/api/share-links',
  response: ListShareLinksResponseSchema,
});

export const revokeShareLink = defineEndpoint({
  method: 'DELETE',
  path: '/api/share-links/:id',
  response: RevokeShareLinkResponseSchema,
});
