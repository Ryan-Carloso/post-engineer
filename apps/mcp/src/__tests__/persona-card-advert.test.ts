import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';
import { CreatePersonaRemoteSchema, UpdatePersonaRemoteSchema } from '../remote-shapes.js';
import { CARD_STYLES, IdentityCardV2Schema, OUTFIT_SLOTS } from '../contracts/persona-identity-card.js';

const MARIA = '11111111-1111-4111-8111-111111111111';
const V1_CARD = {
  version: 1,
  identity: { face: { eyes: 'green' }, body: { height: 'tall' } },
  defaults: { outfit: { top: 'shirt' } },
};
const V2_CARD = {
  version: 2,
  identity: { face: { eyes: 'green', jawline: 'soft', hair: { texture: 'fine' } }, body: { posture: 'upright' } },
  defaults: { style: 'business' },
};

async function personasInputSchema(kind: 'stdio' | 'http'): Promise<{ properties: Record<string, Record<string, unknown>> }> {
  const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: 'https://api.example.test' });
  const server = createPostEngineerMcpServer(api, kind);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0.0.0' });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const tool = (await client.listTools()).tools.find((candidate) => candidate.name === 'personas');
    return z.object({ properties: z.record(z.string(), z.record(z.string(), z.unknown())) }).parse(tool?.inputSchema);
  } finally {
    await client.close();
  }
}

function leafNames(schema: unknown): string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const properties: unknown = Reflect.get(schema, 'properties');
  if (typeof properties !== 'object' || properties === null) return [];
  return Object.entries(properties).flatMap(([name, child]) => [name, ...leafNames(child)]);
}

describe('identityCard as advertised on personas create and update', () => {
  it.each(['stdio', 'http'] as const)('names every v2 leaf, every style and every outfit slot on the %s server', async (kind) => {
    const { properties } = await personasInputSchema(kind);
    const advertised = z.array(z.record(z.string(), z.unknown())).parse(properties.identityCard.anyOf)[0];
    expect(advertised.type).toBe('object');
    expect(advertised.required).toEqual(['version', 'identity']);
    const description = String(advertised.description);
    const names = new Set([...leafNames(z.toJSONSchema(IdentityCardV2Schema)), ...OUTFIT_SLOTS, ...CARD_STYLES]);
    expect(names.size).toBeGreaterThan(40);
    for (const name of names) expect(description).toContain(name);
    expect(description).toContain('version 2');
    expect(description).toContain('version 1');
  });

  it('accepts a v1 card and a v2 card on create and update, locally and hosted', () => {
    const create = { name: 'Maria', avatarUrl: 'https://example.com/a.png', voiceId: 'v1', accounts: { youtube: ['UC1'] } };
    for (const card of [V1_CARD, V2_CARD]) {
      expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(true);
      expect(UpdatePersonaRemoteSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(true);
      expect(CreatePersonaSchema.safeParse({ ...create, identityCard: card }).success).toBe(true);
      expect(CreatePersonaRemoteSchema.safeParse({ ...create, identityCard: card }).success).toBe(true);
    }
  });

  it.each([
    ['a v2 card with empty defaults', { ...V2_CARD, defaults: {} }],
    ['a v2 card with an unknown style', { ...V2_CARD, defaults: { style: 'bikini' } }],
    ['a v1 card with a style', { ...V1_CARD, defaults: { style: 'business' } }],
    ['a v2 card with an unknown leaf', { ...V2_CARD, identity: { face: { mood: 'calm' } } }],
    ['version 3', { ...V2_CARD, version: 3 }],
  ])('rejects %s before any request is sent', (_name, card) => {
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(false);
    expect(UpdatePersonaRemoteSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(false);
  });
});
