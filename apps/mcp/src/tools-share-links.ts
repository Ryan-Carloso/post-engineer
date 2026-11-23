import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { createShareLink, listShareLinks, revokeShareLink } from './client-share-links.js';
import { SHARE_LINK_MAX_EXPIRY_DAYS } from './contracts/share-links.js';
import { optionalPersonaRefShape, withOptionalPersona } from './refs.js';
import { handleLibraryCall, type McpToolResponse } from './tools-call.js';

export const CreateShareLinkShape = optionalPersonaRefShape({
  personaId: z.string().optional(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(SHARE_LINK_MAX_EXPIRY_DAYS)
    .optional()
    .describe(`Optional lifetime of the link in days (1-${SHARE_LINK_MAX_EXPIRY_DAYS}). Without it the link never expires.`),
});

export const CreateShareLinkSchema = z.object(CreateShareLinkShape);

export const ListShareLinksShape = {};

export const RevokeShareLinkShape = {
  id: z.string().min(1, 'id is required').describe('The share link id (id from insights (action: share_link_list)).'),
};

export const RevokeShareLinkSchema = z.object(RevokeShareLinkShape);

export async function handleCreateShareLink(
  client: PostEngineerClient,
  args: z.infer<typeof CreateShareLinkSchema>,
): Promise<McpToolResponse> {
  return withOptionalPersona(client, args, (resolved) =>
    handleLibraryCall(
      () => createShareLink(client, { personaId: resolved.personaId, expiresInDays: resolved.expiresInDays }),
      'creating share link',
    ),
  );
}

export async function handleListShareLinks(client: PostEngineerClient): Promise<McpToolResponse> {
  return handleLibraryCall(() => listShareLinks(client), 'listing share links');
}

export async function handleRevokeShareLink(
  client: PostEngineerClient,
  args: z.infer<typeof RevokeShareLinkSchema>,
): Promise<McpToolResponse> {
  return handleLibraryCall(() => revokeShareLink(client, args.id), 'revoking share link');
}
