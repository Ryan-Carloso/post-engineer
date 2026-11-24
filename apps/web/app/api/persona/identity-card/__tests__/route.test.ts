// @vitest-environment node
import { inspect } from 'node:util';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn(async () => null) };
});
const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
  captureAs: vi.fn(),
  captureException: vi.fn(),
  captureExceptionAs: vi.fn(),
}));
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn(() => posthogMock) }));

import { GET, POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';
import { applyRateLimit, CALLER_RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { IDENTITY_CARD_MISSING_CODE, SCENE_MAX_BYTES } from '@/lib/contracts/persona-identity-card';
import { GetIdentityCardResponseSchema, RenderIdentityPromptResponseSchema } from '@/lib/contracts/persona-identity-card';
import { buildIdentityPrompt } from '@/lib/persona-identity-prompt';
import { CARD_SENTINEL, FIXTURE_CARD, FIXTURE_SCENE, cardWithSentinel } from '@/test/identity-card-fixtures';

const SCENE_SENTINEL = 'sentinel-scene-9c1d';
const USER_ID = 'user-uuid-1';
const PERSONA_ID = '11111111-1111-4111-8111-111111111111';
const spies = [vi.spyOn(logger, 'info'), vi.spyOn(logger, 'warn'), vi.spyOn(logger, 'error'), vi.spyOn(logger, 'debug')];

interface Setup {
  row?: { id: string; identity_card: unknown } | null;
  error?: { code: string; message: string } | null;
  auth?: { isApiKey?: boolean; isOAuth?: boolean; personaIds?: string[] };
}

function setup(options: Setup = {}) {
  const eqCalls: Array<[string, unknown]> = [];
  const selects: string[] = [];
  const row = options.row === undefined ? { id: PERSONA_ID, identity_card: FIXTURE_CARD } : options.row;
  const builder = {
    select: vi.fn((columns: string) => {
      selects.push(columns);
      return builder;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    }),
    single: vi.fn(async () => ({ data: options.error ? null : row, error: options.error ?? null })),
  };
  const client = { from: vi.fn(() => builder) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'token', ...options.auth },
    error: null,
  } as never);
  return { client, eqCalls, selects };
}

function getRequest(personaId: string | null = PERSONA_ID): Request {
  const query = personaId === null ? '' : `?personaId=${personaId}`;
  return new Request(`http://localhost/api/persona/identity-card${query}`);
}

function postRequest(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/persona/identity-card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function everythingObserved(): string {
  const calls = [
    ...spies.flatMap((spy) => spy.mock.calls),
    ...vi.mocked(trackApiEvent).mock.calls,
    ...posthogMock.capture.mock.calls,
    ...posthogMock.captureAs.mock.calls,
    ...posthogMock.captureException.mock.calls,
    ...posthogMock.captureExceptionAs.mock.calls,
  ];
  return inspect(calls, { depth: 10, maxStringLength: null });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/persona/identity-card', () => {
  it('answers 401 without a session', async () => {
    setup();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    } as never);
    expect((await GET(getRequest())).status).toBe(401);
  });

  it('returns the stored card and nothing else', async () => {
    const { eqCalls, selects } = setup();
    const res = await GET(getRequest());
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(GetIdentityCardResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, identityCard: FIXTURE_CARD });
    expect(selects).toEqual(['id, identity_card']);
    expect(eqCalls).toEqual([['id', PERSONA_ID], ['user_id', USER_ID]]);
  });

  it('returns null for a persona without a card', async () => {
    setup({ row: { id: PERSONA_ID, identity_card: null } });
    const body = await json(await GET(getRequest()));
    expect(body).toEqual({ success: true, identityCard: null });
  });

  it('re-checks ownership on the service-client branch for an API key', async () => {
    const { eqCalls } = setup({ auth: { isApiKey: true } });
    await GET(getRequest());
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(eqCalls).toContainEqual(['user_id', USER_ID]);
  });

  it('uses the service client for an OAuth caller too', async () => {
    setup({ auth: { isOAuth: true } });
    await GET(getRequest());
    expect(createSupabaseServiceClient).toHaveBeenCalled();
  });

  it('answers 400 when personaId is missing', async () => {
    setup();
    const res = await GET(getRequest(null));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('personaId is required.');
  });

  it('answers 403 for a key scoped to other personas', async () => {
    const { client } = setup({ auth: { isApiKey: true, personaIds: ['22222222-2222-4222-8222-222222222222'] } });
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown or foreign persona (PGRST116)', async () => {
    setup({ row: null, error: { code: 'PGRST116', message: 'no rows' } });
    expect((await GET(getRequest())).status).toBe(404);
  });

  it('answers 500 and logs for any other lookup error', async () => {
    setup({ row: null, error: { code: '57014', message: 'timeout' } });
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
    expect(spies[2]).toHaveBeenCalled();
  });

  it('answers 500 without echoing a stored card that no longer validates', async () => {
    setup({ row: { id: PERSONA_ID, identity_card: { version: 1, identity: { face: { eyes: CARD_SENTINEL, extra: CARD_SENTINEL } } } } });
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain(CARD_SENTINEL);
    expect(everythingObserved()).not.toContain(CARD_SENTINEL);
  });

  it('spends the identity-card rate limit with the browser or machine profile', async () => {
    setup();
    await GET(getRequest());
    expect(applyRateLimit).toHaveBeenLastCalledWith(expect.anything(), CALLER_RATE_LIMITS.personaIdentityCard.browser, USER_ID);
    setup({ auth: { isApiKey: true } });
    await GET(getRequest());
    expect(applyRateLimit).toHaveBeenLastCalledWith(expect.anything(), CALLER_RATE_LIMITS.personaIdentityCard.machine, USER_ID);
  });

  it('returns the limiter response when the budget is spent', async () => {
    setup();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }));
    expect((await GET(getRequest())).status).toBe(429);
  });
});

describe('POST /api/persona/identity-card', () => {
  it('answers 401 without a session', async () => {
    setup();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    } as never);
    expect((await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }))).status).toBe(401);
  });

  it("returns the builder's exact output and writes nothing", async () => {
    const { client } = setup();
    const res = await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }));
    const body = await json(res);
    const expected = buildIdentityPrompt(FIXTURE_CARD, FIXTURE_SCENE);
    expect(res.status).toBe(200);
    expect(RenderIdentityPromptResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, prompt: expected.prompt, suggestedDescription: expected.suggestedDescription, cardVersion: 1 });
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(Object.keys(client.from.mock.results[0].value)).not.toContain('update');
  });

  it('answers 409 with the stable code when the persona has no card', async () => {
    setup({ row: { id: PERSONA_ID, identity_card: null } });
    const res = await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }));
    const body = await json(res);
    expect(res.status).toBe(409);
    expect(body.code).toBe(IDENTITY_CARD_MISSING_CODE);
  });

  it('answers 404 for an unknown or foreign persona', async () => {
    setup({ row: null, error: { code: 'PGRST116', message: 'no rows' } });
    expect((await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }))).status).toBe(404);
  });

  it('answers 403 for a scoped key before reading anything', async () => {
    const { client } = setup({ auth: { isApiKey: true, personaIds: ['22222222-2222-4222-8222-222222222222'] } });
    const res = await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }));
    expect(res.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-JSON body', 'not json', true, 'Request body must be valid JSON.'],
    ['a non-object body', '[]', true, 'Request body must be a JSON object.'],
    ['a missing personaId', { scene: FIXTURE_SCENE }, false, 'personaId is required.'],
    ['a missing scene', { personaId: PERSONA_ID }, false, 'scene: required'],
    ['an unknown body field', { personaId: PERSONA_ID, scene: FIXTURE_SCENE, card: {} }, false, 'body: unknown field'],
    ['a full card passed as the scene', { personaId: PERSONA_ID, scene: FIXTURE_CARD }, false, 'scene: unknown fields'],
    ['an invalid lighting', { personaId: PERSONA_ID, scene: { ...FIXTURE_SCENE, lighting: 'soft warm' } }, false, 'scene.lighting: not an allowed value'],
    ['identity words in the pose', { personaId: PERSONA_ID, scene: { ...FIXTURE_SCENE, pose: 'standing, red hair' } }, false, 'scene.pose: must describe the scene only, not the person (face, hair, skin, body)'],
  ])('answers 400 for %s', async (_name, body, raw, message) => {
    const { client } = setup();
    const res = await POST(postRequest(body, raw));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(message);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('answers 400 for an over-size scene without reading the persona', async () => {
    const { client } = setup();
    const padded = { personaId: PERSONA_ID, scene: { lighting: 'studio', framing: 'close_up', pad: 'x'.repeat(SCENE_MAX_BYTES) } };
    const res = await POST(postRequest(padded));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(`scene: at most ${SCENE_MAX_BYTES} bytes`);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('answers 400 for a body far beyond the scene cap without parsing it', async () => {
    setup();
    const res = await POST(postRequest(`{"personaId":"${PERSONA_ID}","scene":"${'x'.repeat(20_000)}"}`, true));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/^body: at most \d+ bytes$/);
  });

  it('never logs, tracks or reports card or scene values', async () => {
    setup({ row: { id: PERSONA_ID, identity_card: cardWithSentinel() } });
    const ok = await POST(postRequest({ personaId: PERSONA_ID, scene: { ...FIXTURE_SCENE, setting: SCENE_SENTINEL } }));
    const bad = await POST(postRequest({ personaId: PERSONA_ID, scene: { ...FIXTURE_SCENE, setting: `${SCENE_SENTINEL} hair` } }));
    const unknown = await POST(postRequest({ personaId: PERSONA_ID, scene: { ...FIXTURE_SCENE, [SCENE_SENTINEL]: SCENE_SENTINEL } }));
    expect(ok.status).toBe(200);
    expect((await json(ok)).prompt).toContain(CARD_SENTINEL);
    expect(bad.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    const observed = everythingObserved();
    expect(observed).not.toContain(CARD_SENTINEL);
    expect(observed).not.toContain(SCENE_SENTINEL);
    expect(JSON.stringify(await json(bad))).not.toContain(SCENE_SENTINEL);
    expect(JSON.stringify(await json(unknown))).not.toContain(SCENE_SENTINEL);
  });

  it('spends the identity-card rate limit', async () => {
    setup();
    await POST(postRequest({ personaId: PERSONA_ID, scene: FIXTURE_SCENE }));
    expect(applyRateLimit).toHaveBeenLastCalledWith(expect.anything(), CALLER_RATE_LIMITS.personaIdentityCard.browser, USER_ID);
  });
});
