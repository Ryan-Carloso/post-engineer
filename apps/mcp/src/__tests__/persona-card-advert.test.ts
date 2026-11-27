import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';
import { CreatePersonaRemoteSchema, UpdatePersonaRemoteSchema } from '../remote-shapes.js';
import { CARD_STYLES, IDENTITY_CARD_MAX_BYTES, IDENTITY_DESCRIPTION_MAX_LENGTH, OUTFIT_SLOTS } from '../contracts/persona-identity-card.js';

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
const V3_CARD = {
  version: 3,
  identity: { description: 'Deep-set brown eyes, straight nose, oval face, dark wavy hair, athletic build.' },
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

describe('identityCard as advertised on personas create and update', () => {
  it.each(['stdio', 'http'] as const)('advertises version 3, its description limit, every style and the accepted legacy versions on the %s server', async (kind) => {
    const { properties } = await personasInputSchema(kind);
    const advertised = z.array(z.record(z.string(), z.unknown())).parse(properties.identityCard.anyOf)[0];
    expect(advertised.type).toBe('object');
    expect(advertised.required).toEqual(['version', 'identity']);
    const description = String(advertised.description);
    for (const name of ['version 3', 'description', 'version 1 or 2', ...CARD_STYLES]) expect(description).toContain(name);
    expect(description).toContain(String(IDENTITY_DESCRIPTION_MAX_LENGTH));
    expect(description).toContain(String(IDENTITY_CARD_MAX_BYTES));
  });

  it('accepts a v1, a v2 and a v3 card on create and update, locally and hosted', () => {
    const create = { name: 'Maria', accounts: { youtube: ['UC1'] } };
    for (const card of [V1_CARD, V2_CARD, V3_CARD]) {
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
    ['a v3 card without a description', { ...V3_CARD, identity: {} }],
    ['a v3 card with an empty description', { ...V3_CARD, identity: { description: '   ' } }],
    ['a v3 card over 800 characters', { ...V3_CARD, identity: { description: 'x'.repeat(801) } }],
    ['a v3 card with an unknown style', { ...V3_CARD, defaults: { style: 'bikini' } }],
    ['version 4', { ...V3_CARD, version: 4 }],
  ])('rejects %s before any request is sent', (_name, card) => {
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(false);
    expect(UpdatePersonaRemoteSchema.safeParse({ personaId: MARIA, identityCard: card }).success).toBe(false);
  });
});

describe('the README identity card section', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const section = readme.slice(readme.indexOf('### Identity card'));

  it('names version 3, the description limit, every style and every legacy outfit slot of the contract', () => {
    expect(section).toContain('version 3');
    expect(section).toContain('version 1 or 2');
    expect(section).toContain(`at most ${IDENTITY_DESCRIPTION_MAX_LENGTH} characters`);
    expect(section).toContain(`at most ${IDENTITY_CARD_MAX_BYTES} bytes`);
    for (const name of [...CARD_STYLES, ...OUTFIT_SLOTS]) expect(section).toContain(`\`${name}\``);
  });
});
