import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPostEngineerMcpServer } from '../index.js';
import { PostEngineerClient } from '../client.js';
import { MalformedContractResponseError } from '../contract-response.js';
import { getPersonaIdentityCard, renderPersonaIdentityPrompt } from '../client-persona-card.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';
import { CreatePersonaRemoteSchema, UpdatePersonaRemoteSchema } from '../remote-shapes.js';
import { SceneSchema } from '../contracts/persona-identity-card.js';

const MARIA = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://api.example.test';

const CARD = {
  version: 1,
  identity: {
    face: { eyes: 'blue-grey, wide-set', hair: { color: 'blonde', style: 'long wavy' } },
    body: { build: 'athletic', height: 'tall' },
  },
  defaults: { outfit: { top: 'sage-green t-shirt', bottom: 'jeans' } },
} as const;
const CARD_V2 = {
  version: 2,
  identity: {
    face: { eyes: 'blue-grey, wide-set', jawline: 'soft', hair: { color: 'blonde', texture: 'fine', parting: 'left side' } },
    body: { build: 'athletic', posture: 'upright', proportions: 'long legs, short torso' },
  },
  defaults: { style: 'business', outfit: { footwear: 'black loafers' } },
} as const;
const SCENE = { lighting: 'golden_hour', framing: 'waist_up', setting: 'city street', outfit: { top: 'navy blazer' } } as const;

interface Seen {
  method: string;
  path: string;
  body: unknown;
  form: Record<string, string> | undefined;
}

function formEntries(body: unknown): Record<string, string> | undefined {
  if (!(body instanceof FormData)) return undefined;
  return Object.fromEntries([...body.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function setup(routes: Record<string, unknown>, kind: 'stdio' | 'http' = 'stdio') {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      seen.push({ method, path: `${parsed.pathname}${parsed.search}`, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, form: formEntries(init.body) });
      const payload = routes[`${method} ${parsed.pathname}`] ?? { success: true };
      return Response.json(payload);
    }),
  );
  const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
  return {
    seen,
    api,
    async call(name: string, args: Record<string, unknown>) {
      const server = createPostEngineerMcpServer(api, kind);
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        const result = await client.callTool({ name, arguments: args });
        const content = result.content as Array<{ type: string; text?: string }>;
        return { isError: result.isError === true, text: content.map((part) => part.text ?? '').join('\n') };
      } finally {
        await client.close();
      }
    },
    async tools() {
      const server = createPostEngineerMcpServer(api, kind);
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '0.0.0' });
      await Promise.all([server.connect(b), client.connect(a)]);
      try {
        return (await client.listTools()).tools;
      } finally {
        await client.close();
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persona_media get_card and render_prompt registration', () => {
  it('offers both actions with their required fields in the description', async () => {
    const { tools } = setup({});
    const media = (await tools()).find((tool) => tool.name === 'persona_media');
    const schema = JSON.stringify(media?.inputSchema);
    expect(schema).toContain('get_card');
    expect(schema).toContain('render_prompt');
    expect(media?.description).toContain('get_card (persona)');
    expect(media?.description).toContain('render_prompt (persona, scene)');
    expect(media?.description).toContain('advice');
  });

  it('offers identityCard on personas create and update', async () => {
    const { tools } = setup({});
    const personas = (await tools()).find((tool) => tool.name === 'personas');
    expect(JSON.stringify(personas?.inputSchema)).toContain('identityCard');
  });

  it('offers the actions on the hosted server too', async () => {
    const { tools } = setup({}, 'http');
    const all = await tools();
    expect(JSON.stringify(all.find((tool) => tool.name === 'persona_media')?.inputSchema)).toContain('render_prompt');
    expect(JSON.stringify(all.find((tool) => tool.name === 'personas')?.inputSchema)).toContain('identityCard');
  });
});

describe('persona_media get_card', () => {
  it('reads the card of a persona given by id', async () => {
    const { call, seen } = setup({ 'GET /api/persona/identity-card': { success: true, identityCard: CARD } });
    const result = await call('persona_media', { action: 'get_card', persona: MARIA });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'GET', path: `/api/persona/identity-card?personaId=${MARIA}`, body: undefined, form: undefined }]);
    expect(JSON.parse(result.text)).toEqual({ success: true, identityCard: CARD });
  });

  it.each([
    ['a v1 card', CARD],
    ['a v2 card with a style', CARD_V2],
    ['a v2 card with only a style default', { ...CARD_V2, defaults: { style: 'sensual' } }],
  ])('reads %s without altering it', async (_name, card) => {
    const { call } = setup({ 'GET /api/persona/identity-card': { success: true, identityCard: card } });
    const result = await call('persona_media', { action: 'get_card', persona: MARIA });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ success: true, identityCard: card });
  });

  it.each([
    ['a v2 card with empty defaults', { ...CARD_V2, defaults: {} }],
    ['a v2 card with an unknown style', { ...CARD_V2, defaults: { style: 'bikini' } }],
    ['a v1 card with a style', { ...CARD, defaults: { style: 'business' } }],
  ])('reports %s as a malformed response', async (_name, card) => {
    const { call } = setup({ 'GET /api/persona/identity-card': { success: true, identityCard: card } });
    const result = await call('persona_media', { action: 'get_card', persona: MARIA });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Malformed response');
  });

  it('returns null for a persona without a card', async () => {
    const { call } = setup({ 'GET /api/persona/identity-card': { success: true, identityCard: null } });
    const result = await call('persona_media', { action: 'get_card', persona: MARIA });
    expect(JSON.parse(result.text)).toEqual({ success: true, identityCard: null });
  });

  it('reports a malformed card as an error instead of passing it on', async () => {
    const { call } = setup({ 'GET /api/persona/identity-card': { success: true, identityCard: { version: 3 } } });
    const result = await call('persona_media', { action: 'get_card', persona: MARIA });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Malformed response');
  });
});

describe('persona_media render_prompt', () => {
  const rendered = { success: true, prompt: 'Edit the reference photo.', suggestedDescription: 'navy blazer, city street', cardVersion: 1 };

  it('posts the persona id and the scene and returns the rendered prompt', async () => {
    const { call, seen } = setup({ 'POST /api/persona/identity-card': rendered });
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene: SCENE });
    expect(result.isError).toBe(false);
    expect(seen).toEqual([{ method: 'POST', path: '/api/persona/identity-card', body: { personaId: MARIA, scene: SCENE }, form: undefined }]);
    expect(JSON.parse(result.text)).toEqual(rendered);
  });

  it.each([1, 2])('returns cardVersion %i as the server reports it', async (cardVersion) => {
    const { call } = setup({ 'POST /api/persona/identity-card': { ...rendered, cardVersion } });
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene: SCENE });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ ...rendered, cardVersion });
  });

  it('reports a card version the contract does not know as a malformed response', async () => {
    const { call } = setup({ 'POST /api/persona/identity-card': { ...rendered, cardVersion: 3 } });
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene: SCENE });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Malformed response');
  });

  it('posts a scene that holds only a style and every pose phrase the filter allows', async () => {
    const { call, seen } = setup({ 'POST /api/persona/identity-card': { ...rendered, cardVersion: 2 } });
    const scene = { style: 'streetwear', lighting: 'golden_hour', framing: 'waist_up', pose: 'arms crossed, smiling' };
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene });
    expect(result.isError).toBe(false);
    expect(seen[0].body).toEqual({ personaId: MARIA, scene });
  });

  it('posts a scene outfit that holds a high waist phrase', async () => {
    const { call, seen } = setup({ 'POST /api/persona/identity-card': { ...rendered, cardVersion: 2 } });
    const scene = { ...SCENE, outfit: { bottom: 'high waist trousers' } };
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene });
    expect(result.isError).toBe(false);
    expect(seen[0].body).toEqual({ personaId: MARIA, scene });
  });

  it.each([
    ['an unknown style', { ...SCENE, style: 'bikini' }],
    ['a style with the wrong case', { ...SCENE, style: 'Business' }],
    ['a bare identity claim in the pose', { ...SCENE, pose: 'long legs' }],
    ['a one-piece with a top in the scene outfit', { ...SCENE, outfit: { one_piece: 'dress', top: 'tee' } }],
  ])('rejects a scene with %s before any request', async (_name, scene) => {
    const { call, seen } = setup({});
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it('rejects a full identity card passed as the scene before any request', async () => {
    const { call, seen } = setup({});
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene: CARD });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['an identity key', { ...SCENE, identity: { face: { eyes: 'green' } } }],
    ['a body key', { ...SCENE, body: { height: 'tall' } }],
    ['a version key', { ...SCENE, version: 1 }],
    ['a free-form lighting', { ...SCENE, lighting: 'soft warm' }],
    ['identity words in the pose', { ...SCENE, pose: 'standing, red hair' }],
    ['no framing', { lighting: 'studio' }],
  ])('rejects a scene with %s before any request', async (_name, scene) => {
    const { call, seen } = setup({});
    const result = await call('persona_media', { action: 'render_prompt', persona: MARIA, scene });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it('turns a 409 into an error that names the missing card', async () => {
    const { api } = setup({});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'This persona has no identity card.', code: 'IDENTITY_CARD_MISSING' }, { status: 409 })));
    await expect(renderPersonaIdentityPrompt(api, MARIA, SceneSchema.parse(SCENE))).rejects.toThrow(/identity card/);
  });
});

describe('the identity-card client calls', () => {
  it('turns an empty 2xx body into { ok: true } and the contract rejects it loudly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    await expect(api.request('/api/persona/identity-card', { method: 'GET' }, 'get card')).resolves.toEqual({ ok: true });
    await expect(getPersonaIdentityCard(api, MARIA)).rejects.toBeInstanceOf(MalformedContractResponseError);
  });

  it('treats a non-JSON 2xx body as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy</html>', { status: 200 })));
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    await expect(getPersonaIdentityCard(api, MARIA)).rejects.toThrow(/not valid JSON/);
    await expect(renderPersonaIdentityPrompt(api, MARIA, SceneSchema.parse(SCENE))).rejects.toThrow(/not valid JSON/);
  });

  it('sends an AbortSignal timeout with each call', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true, identityCard: null }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new PostEngineerClient({ apiKey: 'pe_test', baseUrl: BASE });
    await getPersonaIdentityCard(api, MARIA);
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('identityCard on personas create and update', () => {
  it('sends the card as a JSON string in the multipart update', async () => {
    const { call, seen } = setup({ 'PATCH /api/persona': { success: true } });
    const result = await call('personas', { action: 'update', persona: MARIA, identityCard: CARD });
    expect(result.isError).toBe(false);
    expect(seen[0].method).toBe('PATCH');
    expect(seen[0].path).toBe(`/api/persona?personaId=${MARIA}`);
    expect(JSON.parse(seen[0].form?.identityCard ?? 'null')).toEqual(CARD);
  });

  it('sends a v2 card with a style as a JSON string in the multipart update', async () => {
    const { call, seen } = setup({ 'PATCH /api/persona': { success: true } });
    const result = await call('personas', { action: 'update', persona: MARIA, identityCard: CARD_V2 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(seen[0].form?.identityCard ?? 'null')).toEqual(CARD_V2);
  });

  it('refuses a v2 card without a style or an outfit before any request', async () => {
    const { call, seen } = setup({ 'PATCH /api/persona': { success: true } });
    const result = await call('personas', { action: 'update', persona: MARIA, identityCard: { ...CARD_V2, defaults: {} } });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it('sends the JSON literal null to remove the card', async () => {
    const { call, seen } = setup({ 'PATCH /api/persona': { success: true } });
    const result = await call('personas', { action: 'update', persona: MARIA, identityCard: null });
    expect(result.isError).toBe(false);
    expect(seen[0].form?.identityCard).toBe('null');
  });

  it('sends no card field when the update leaves it out', async () => {
    const { call, seen } = setup({ 'PATCH /api/persona': { success: true } });
    await call('personas', { action: 'update', persona: MARIA, niche: 'travel' });
    expect(seen[0].form).toBeDefined();
    expect(seen[0].form).not.toHaveProperty('identityCard');
  });

  it('sends the card with a create', async () => {
    const { api, seen } = setup({ 'POST /api/persona': { success: true, personaId: MARIA, imageIds: [] } });
    await api.createPersona({ name: 'Maria', avatarUrl: 'https://example.com/a.png', voiceId: 'v1', accounts: { youtube: ['UC1'] }, identityCard: CARD });
    expect(JSON.parse(seen[0].form?.identityCard ?? 'null')).toEqual(CARD);
    seen.length = 0;
    await api.createPersona({ name: 'Maria', avatarUrl: 'https://example.com/a.png', voiceId: 'v1', accounts: { youtube: ['UC1'] } });
    expect(seen[0].form).not.toHaveProperty('identityCard');
  });

  it('rejects an unknown key at every level of the card, locally and hosted', () => {
    const bad = { ...CARD, identity: { ...CARD.identity, face: { ...CARD.identity.face, mood: 'calm' } } };
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: bad }).success).toBe(false);
    expect(UpdatePersonaRemoteSchema.safeParse({ personaId: MARIA, identityCard: bad }).success).toBe(false);
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: { ...CARD, extra: 1 } }).success).toBe(false);
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: { ...CARD, version: 3 } }).success).toBe(false);
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: CARD }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ personaId: MARIA, identityCard: null }).success).toBe(true);
    const create = { name: 'Maria', avatarUrl: 'https://example.com/a.png', voiceId: 'v1', accounts: { youtube: ['UC1'] } };
    expect(CreatePersonaRemoteSchema.safeParse({ ...create, identityCard: bad }).success).toBe(false);
    expect(CreatePersonaRemoteSchema.safeParse({ ...create, identityCard: CARD }).success).toBe(true);
    expect(CreatePersonaSchema.safeParse({ ...create, identityCard: { ...CARD, extra: 1 } }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ ...create, identityCard: null }).success).toBe(true);
  });
});
