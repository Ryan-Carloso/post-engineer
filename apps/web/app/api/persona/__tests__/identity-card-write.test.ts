// @vitest-environment node
import { inspect } from 'node:util';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (callback: () => unknown) => { void Promise.resolve().then(() => callback()); } };
});
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

import { POST, PATCH } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { CARD_SENTINEL, FIXTURE_CARD, FIXTURE_CARD_V3, cardWithSentinel } from '@/test/identity-card-fixtures';

const USER_ID = 'user-uuid-1';
const spies = [
  vi.spyOn(logger, 'info'),
  vi.spyOn(logger, 'warn'),
  vi.spyOn(logger, 'error'),
  vi.spyOn(logger, 'debug'),
];

function observedOutput(): string {
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

const DB_ROW_SENTINEL = 'fake-row-sentinel-9c41';

function dbFailure(): { message: string; details: string; hint: null; code: string } {
  return {
    message: 'new row for relation "personas" violates check constraint "personas_identity_card_object_check"',
    details: `Failing row contains (persona-uuid-1, Maria, {"identity": {"face": {"eyes": "${DB_ROW_SENTINEL}"}}}).`,
    hint: null,
    code: '23514',
  };
}

function mockSupabase(options: { failWrite?: boolean } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const personas = {
    insert: vi.fn((values: Record<string, unknown>) => {
      inserted.push(values);
      return { select: vi.fn(() => ({ single: vi.fn(async () => (
        options.failWrite === true ? { data: null, error: dbFailure() } : { data: { id: 'persona-uuid-1' }, error: null }
      )) })) };
    }),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: 'persona-uuid-1' }, error: null })),
          single: vi.fn(async () => ({
            data: { id: 'persona-uuid-1', name: 'Maria', photo_path: 'u/p/photo.png', avatar_url: null, voice_id: 'v', voice_audio_path: null, cta_type: 'follow', cta_url: null, cta_instruction: null },
            error: null,
          })),
        })),
      })),
    })),
    update: vi.fn((values: Record<string, unknown>) => {
      updated.push(values);
      return { eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: options.failWrite === true ? dbFailure() : null })) })) };
    }),
  };
  const socialAccounts = {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({ data: [{ provider: 'youtube', provider_account_id: 'acct-1' }], error: null })),
    })),
  };
  const binding = {
    delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    insert: vi.fn(() => ({ error: null })),
  };
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
    storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ data: {}, error: null })), remove: vi.fn(async () => ({ error: null })) })) },
    from: vi.fn((table: string) => {
      if (table === 'personas') return personas;
      if (table === 'social_accounts') return socialAccounts;
      return binding;
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: USER_ID, accessToken: 't' }, error: null });
  return { inserted, updated };
}

function createRequest(card?: string): Request {
  const formData = new FormData();
  formData.set('name', 'Maria');
  formData.set('publishingAccounts', JSON.stringify({ youtube: ['acct-1'] }));
  if (card !== undefined) formData.set('identityCard', card);
  return new Request('http://localhost/api/persona', { method: 'POST', body: formData });
}

function patchRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new Request('http://localhost/api/persona?personaId=persona-uuid-1', { method: 'PATCH', body: formData });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/persona with an identity card', () => {
  it('stores a valid card on the new persona', async () => {
    const { inserted } = mockSupabase();
    const res = await POST(createRequest(JSON.stringify(FIXTURE_CARD)));
    expect(res.status).toBe(200);
    expect(inserted[0].identity_card).toEqual(FIXTURE_CARD);
  });

  it('stores a version 3 description card on the new persona', async () => {
    const { inserted } = mockSupabase();
    const res = await POST(createRequest(JSON.stringify(FIXTURE_CARD_V3)));
    expect(res.status).toBe(200);
    expect(inserted[0].identity_card).toEqual(FIXTURE_CARD_V3);
  });

  it('stores null when no card is sent', async () => {
    const { inserted } = mockSupabase();
    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(inserted[0].identity_card).toBeNull();
  });

  it.each([
    ['invalid JSON', '{nope', 'identityCard: not valid JSON'],
    ['a bad version', JSON.stringify({ ...FIXTURE_CARD, version: 4 }), 'identityCard.version: unsupported version'],
    ['an unknown key', JSON.stringify({ ...FIXTURE_CARD, extra: true }), 'identityCard: unknown field'],
    ['an over-size card', 'x'.repeat(5000), 'identityCard: at most 4096 bytes'],
  ])('rejects %s with a 400 and inserts nothing', async (_name, raw, message) => {
    const { inserted } = mockSupabase();
    const res = await POST(createRequest(raw));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(message);
    expect(inserted).toHaveLength(0);
  });

  it('treats the literal null as no card', async () => {
    const { inserted } = mockSupabase();
    const res = await POST(createRequest('null'));
    expect(res.status).toBe(200);
    expect(inserted[0].identity_card).toBeNull();
  });
});

describe('PATCH /api/persona with an identity card', () => {
  it('stores a valid card', async () => {
    const { updated } = mockSupabase();
    const res = await PATCH(patchRequest({ identityCard: JSON.stringify(FIXTURE_CARD) }));
    expect(res.status).toBe(200);
    expect(updated[0]).toEqual({ identity_card: FIXTURE_CARD });
  });

  it('clears the card on the JSON literal null', async () => {
    const { updated } = mockSupabase();
    const res = await PATCH(patchRequest({ identityCard: 'null' }));
    expect(res.status).toBe(200);
    expect(updated[0]).toEqual({ identity_card: null });
  });

  it('leaves the card alone when the field is absent or empty', async () => {
    const { updated } = mockSupabase();
    const res = await PATCH(patchRequest({ name: 'Nova', identityCard: '' }));
    expect(res.status).toBe(200);
    expect(updated[0]).toEqual({ name: 'Nova' });
    expect(updated[0]).not.toHaveProperty('identity_card');
  });

  it('answers "Nothing to update" when only an empty card field is sent', async () => {
    mockSupabase();
    const res = await PATCH(patchRequest({ identityCard: '' }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Nothing to update.');
  });

  it.each([
    ['invalid JSON', '[1,', 'identityCard: not valid JSON'],
    ['a bad version', JSON.stringify({ ...FIXTURE_CARD, version: '1' }), 'identityCard.version: unsupported version'],
    ['an unknown nested key', JSON.stringify({ ...FIXTURE_CARD, identity: { ...FIXTURE_CARD.identity, mind: 'x' } }), 'identityCard.identity: unknown field'],
    ['an over-size card', 'x'.repeat(4097), 'identityCard: at most 4096 bytes'],
  ])('rejects %s with a 400 and updates nothing', async (_name, raw, message) => {
    const { updated } = mockSupabase();
    const res = await PATCH(patchRequest({ identityCard: raw }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(message);
    expect(updated).toHaveLength(0);
  });
});

describe('identity card privacy on the persona routes', () => {
  it('never logs, tracks or reports a card value, on success or failure', async () => {
    mockSupabase();
    await POST(createRequest(JSON.stringify(cardWithSentinel())));
    await PATCH(patchRequest({ identityCard: JSON.stringify(cardWithSentinel()) }));
    const tooLong = { version: 1, identity: { face: { eyes: `${CARD_SENTINEL}${'x'.repeat(100)}` } } };
    const rejectedPost = await POST(createRequest(JSON.stringify(tooLong)));
    const rejectedPatch = await PATCH(patchRequest({ identityCard: JSON.stringify(tooLong) }));
    const unknownKey = await PATCH(patchRequest({ identityCard: JSON.stringify({ ...cardWithSentinel(), [CARD_SENTINEL]: CARD_SENTINEL }) }));

    expect(rejectedPost.status).toBe(400);
    expect(rejectedPatch.status).toBe(400);
    expect(unknownKey.status).toBe(400);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(observedOutput()).not.toContain(CARD_SENTINEL);
    expect(await errorOf(unknownKey)).not.toContain(CARD_SENTINEL.slice(0, 20) + CARD_SENTINEL.slice(20));
  });
});

describe('persona DB failures keep the failing row out of every sink', () => {
  it('POST insert failure answers 500 and never emits the row details', async () => {
    mockSupabase({ failWrite: true });
    const res = await POST(createRequest(JSON.stringify(cardWithSentinel())));
    expect(res.status).toBe(500);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(observedOutput()).toContain('23514');
    expect(observedOutput()).not.toContain(DB_ROW_SENTINEL);
    expect(observedOutput()).not.toContain('Failing row contains');
    expect(JSON.stringify(await res.json())).not.toContain(DB_ROW_SENTINEL);
  });

  it('PATCH update failure answers 500 and never emits the row details', async () => {
    mockSupabase({ failWrite: true });
    const res = await PATCH(patchRequest({ identityCard: JSON.stringify(cardWithSentinel()) }));
    expect(res.status).toBe(500);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(observedOutput()).toContain('23514');
    expect(observedOutput()).not.toContain(DB_ROW_SENTINEL);
    expect(observedOutput()).not.toContain('Failing row contains');
    expect(JSON.stringify(await res.json())).not.toContain(DB_ROW_SENTINEL);
  });
});
