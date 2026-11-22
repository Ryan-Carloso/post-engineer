import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createShareLink as createShareLinkContract,
  listShareLinks as listShareLinksContract,
  revokeShareLink as revokeShareLinkContract,
} from './contracts/share-links.js';
import type { ResponseOf } from './contracts/endpoint.js';

export interface CreateShareLinkInput {
  personaId?: string;
  expiresInDays?: number;
}

export async function createShareLink(
  client: PostEngineerClient,
  input: CreateShareLinkInput,
): Promise<ResponseOf<typeof createShareLinkContract>> {
  const body: Record<string, unknown> = {};
  if (input.personaId !== undefined) body.personaIds = [input.personaId];
  if (input.expiresInDays !== undefined) body.expiresInDays = input.expiresInDays;
  const raw = await client.request(
    '/api/share-links',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'create share link',
  );
  return parseContractResponse(createShareLinkContract, raw);
}

export async function listShareLinks(client: PostEngineerClient): Promise<ResponseOf<typeof listShareLinksContract>> {
  const raw = await client.request(
    '/api/share-links',
    { method: 'GET', headers: client.getHeaders() },
    'list share links',
  );
  return parseContractResponse(listShareLinksContract, raw);
}

export async function revokeShareLink(
  client: PostEngineerClient,
  id: string,
): Promise<ResponseOf<typeof revokeShareLinkContract>> {
  const raw = await client.request(
    `/api/share-links/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: client.getHeaders() },
    'revoke share link',
  );
  return parseContractResponse(revokeShareLinkContract, raw);
}
