import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { POST, parseBatchBody, computeBatchSlotDatetimes } from '../route';
import { isValidTimezone } from '@/lib/timezone';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PERSONA_ID = '22222222-2222-2222-2222-222222222222';

//---------------
// Pure helper tests (no supabase involved)
//---------------

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Europe/Lisbon')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('UTC+3')).toBe(false);
  });
});

describe('parseBatchBody', () => {
  const valid = {
    personaId: PERSONA_ID,
    items: [{ topic: 'Topic one' }, { topic: 'Topic two' }],
    providers: ['youtube', 'linkedin'],
    times: ['09:00', '18:00'],
    timezone: 'Europe/Lisbon',
  };

  it('accepts a valid body', () => {
    const parsed = parseBatchBody(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.items).toHaveLength(2);
      expect(parsed.value.providers).toEqual(['youtube', 'linkedin']);
      expect(parsed.value.times).toEqual(['09:00', '18:00']);
    }
  });

  it('rejects missing personaId', () => {
    expect(parseBatchBody({ ...valid, personaId: undefined }).ok).toBe(false);
  });

  it('rejects an empty items array', () => {
    const parsed = parseBatchBody({ ...valid, items: [] });
    expect(parsed.ok).toBe(false);
  });

  it('rejects more than 30 items', () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ topic: `Topic ${i}` }));
    expect(parseBatchBody({ ...valid, items }).ok).toBe(false);
  });

  it('rejects blank topics', () => {
    expect(parseBatchBody({ ...valid, items: [{ topic: '   ' }] }).ok).toBe(false);
  });

  it('rejects empty providers', () => {
    expect(parseBatchBody({ ...valid, providers: [] }).ok).toBe(false);
  });

  it('rejects unknown providers', () => {
    expect(parseBatchBody({ ...valid, providers: ['tiktok'] }).ok).toBe(false);
  });

  it('rejects malformed times', () => {
    expect(parseBatchBody({ ...valid, times: ['25:00'] }).ok).toBe(false);
    expect(parseBatchBody({ ...valid, times: ['9am'] }).ok).toBe(false);
    expect(parseBatchBody({ ...valid, times: [] }).ok).toBe(false);
  });

  it('rejects an invalid timezone', () => {
    expect(parseBatchBody({ ...valid, timezone: 'Nowhere/Here' }).ok).toBe(false);
  });
});

describe('computeBatchSlotDatetimes', () => {
  // 2026-09-25 10:00 UTC = 11:00 in Europe/Lisbon (WEST, UTC+1)
  const now = new Date('2026-09-25T10:00:00.000Z');

  it('takes the next N occurrences in order, skipping times already past today', () => {
    const slots = computeBatchSlotDatetimes(['09:00', '18:00'], 'Europe/Lisbon', 4, now);
    expect(slots).toHaveLength(4);
    // 09:00 Lisbon (10:00 UTC) is not after 10:00 UTC -> skipped; first is 18:00 Lisbon
    expect(slots[0].toISOString()).toBe('2026-09-25T17:00:00.000Z');
    expect(slots[1].toISOString()).toBe('2026-09-26T08:00:00.000Z');
    expect(slots[2].toISOString()).toBe('2026-09-26T17:00:00.000Z');
    expect(slots[3].toISOString()).toBe('2026-09-27T08:00:00.000Z');
  });

  it('is strictly increasing and all in the future', () => {
    const slots = computeBatchSlotDatetimes(['00:00', '12:00', '23:59'], 'UTC', 7, now);
    expect(slots).toHaveLength(7);
    for (let i = 0; i < slots.length; i++) {
      expect(slots[i].getTime()).toBeGreaterThan(now.getTime());
      if (i > 0) expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
    }
  });

  it('handles a negative-offset timezone (America/Sao_Paulo, UTC-3)', () => {
    // 10:00 UTC = 07:00 Sao Paulo; 09:00 local (12:00 UTC) is still ahead.
    const slots = computeBatchSlotDatetimes(['09:00', '18:00'], 'America/Sao_Paulo', 2, now);
    expect(slots[0].toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(slots[1].toISOString()).toBe('2026-09-25T21:00:00.000Z');
  });
});

//---------------
// POST handler tests (mocked supabase)
//---------------

interface RpcHandler {
  spend?: { data: unknown; error: unknown };
  grant?: { data: unknown; error: unknown };
  refund?: { data: unknown; error: unknown };
}

function mockSupabase(handlers: {
  persona?: { data: unknown };
  rpc?: RpcHandler;
  scheduleInsert?: { data: unknown; error: unknown };
  slotsInsert?: { data: unknown; error: unknown };
  socialAccounts?: Record<string, string[]>;
}) {
  const calls = {
    rpc: [] as { name: string; params: unknown }[],
    scheduleRows: [] as unknown[],
    slotRows: [] as unknown[],
  };
  const rpcImpl = async (name: string, params: unknown) => {
    calls.rpc.push({ name, params });
    if (name === 'spend_tokens') return handlers.rpc?.spend ?? { data: { spent: true }, error: null };
    if (name === 'grant_signup_bonus') return handlers.rpc?.grant ?? { data: {}, error: null };
    if (name === 'refund_generation_tokens')
      return handlers.rpc?.refund ?? { data: { refunded: true }, error: null };
    return { data: null, error: null };
  };
  const client = {
    rpc: vi.fn(rpcImpl),
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(handlers.persona ?? { data: null }),
        };
      }
      if (table === 'schedules') {
        const deleteChain = {
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        return {
          insert: vi.fn((rows: unknown) => {
            calls.scheduleRows.push(rows);
            const res = handlers.scheduleInsert ?? { data: [{ id: 'sched-1' }], error: null };
            return { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(res) };
          }),
          delete: vi.fn(() => deleteChain),
        };
      }
      if (table === 'scheduled_posts') {
        const deleteChain = {
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        return {
          insert: vi.fn((rows: unknown) => {
            calls.slotRows.push(rows);
            const res = handlers.slotsInsert ?? { data: [], error: null };
            return Promise.resolve(res);
          }),
          delete: vi.fn(() => deleteChain),
        };
      }
      if (table === 'social_accounts') {
        let provider = '';
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: unknown) => {
            if (col === 'provider') provider = val as string;
            return chain;
          }),
          // Supabase builders are thenable: awaiting resolves the rows for
          // the provider captured by the .eq('provider', ...) call above.
          then: (
            resolve: (v: { data: unknown; error: null }) => void,
            reject?: (e: unknown) => void,
          ) => {
            const rows = (handlers.socialAccounts?.[provider] ?? []).map((id) => ({
              provider_account_id: id,
            }));
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client, calls };
}

function mockAuth(personaIds: string[] | null = null) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: true, personaIds },
    error: null,
  } as never);
}

const PERSONA_ROW = {
  id: PERSONA_ID,
  user_id: USER_ID,
  face_mix_percent: 50,
  face_quality: 'ok',
};

function validRequest() {
  return new Request('http://localhost/api/schedule/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personaId: PERSONA_ID,
      items: [{ topic: 'Topic one' }, { topic: 'Topic two' }],
      providers: ['youtube'],
      times: ['09:00'],
      timezone: 'UTC',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/schedule/batch', () => {
  it('returns 400 without touching tokens when the body is invalid', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({});
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const req = new Request('http://localhost/api/schedule/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: PERSONA_ID, items: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.scheduleRows).toHaveLength(0);
  });

  it('returns 403 when the API key scope does not include the persona', async () => {
    mockAuth(['other-persona']);
    const { client } = mockSupabase({});
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const res = await POST(validRequest());
    expect(res.status).toBe(403);
  });

  it('returns 404 when the persona does not belong to the user', async () => {
    mockAuth();
    const { client } = mockSupabase({ persona: { data: null } });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const res = await POST(validRequest());
    expect(res.status).toBe(404);
  });

  it('returns 400 INSUFFICIENT with have/need and creates nothing when tokens are short', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      rpc: { spend: { data: { spent: false, balance: 3, free_balance: 3 }, error: null } },
      socialAccounts: { youtube: ['ch-1'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const res = await POST(validRequest());
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('INSUFFICIENT');
    // 2 items x 2 tokens (50% mix @ ok) = 4 needed, 3 available
    expect(body.need).toBe(4);
    expect(body.have).toBe(3);
    expect(calls.scheduleRows).toHaveLength(0);
    expect(calls.slotRows).toHaveLength(0);
  });

  it('deducts the total upfront, inserts one batch schedule and N slots in topic order', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      rpc: { spend: { data: { spent: true, balance: 96 }, error: null } },
      socialAccounts: { youtube: ['ch-1'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const res = await POST(validRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.tokensSpent).toBe(4);

    // Single atomic spend of the whole batch
    const spendCalls = calls.rpc.filter((c) => c.name === 'spend_tokens');
    expect(spendCalls).toHaveLength(1);
    expect((spendCalls[0].params as Record<string, unknown>).p_amount).toBe(4);
    const generationId = (spendCalls[0].params as Record<string, unknown>).p_generation_id as string;
    expect(generationId.startsWith('batch:')).toBe(true);

    // One schedule row
    expect(calls.scheduleRows).toHaveLength(1);
    const scheduleRow = calls.scheduleRows[0] as Record<string, unknown>;
    expect(scheduleRow.persona_id).toBe(PERSONA_ID);
    expect(scheduleRow.providers).toEqual(['youtube']);
    // kind='batch': never the kind='recurring' default, or the partial
    // unique index schedules_persona_owner_recurring would reject the
    // persona's next schedule with a 500.
    //
    // DB schema anchor: the `schedules.kind` CHECK constraint (applied
    // manually in the Supabase dashboard SQL editor; the repo tracks only
    // supabase/persona-images.sql in-repo) allows 'recurring' and 'batch'.
    // The load-bearing assertion is the toBe('batch') below.
    expect(scheduleRow.kind).toBe('batch');

    // N slots, topics in request order, future datetimes
    expect(calls.slotRows).toHaveLength(1);
    const slotRows = calls.slotRows[0] as Record<string, unknown>[];
    expect(slotRows).toHaveLength(2);
    expect(slotRows[0].topic).toBe('Topic one');
    expect(slotRows[1].topic).toBe('Topic two');
    expect(slotRows[0].status).toBe('pending');
    const at0 = new Date(slotRows[0].slot_at as string).getTime();
    const at1 = new Date(slotRows[1].slot_at as string).getTime();
    expect(at1).toBeGreaterThan(at0);
    expect(at0).toBeGreaterThan(Date.now());
  });

  it('refunds the batch spend when slot insertion fails', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      rpc: { spend: { data: { spent: true, balance: 96 }, error: null } },
      slotsInsert: { data: null, error: { message: 'db down' } },
      socialAccounts: { youtube: ['ch-1'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const res = await POST(validRequest());
    expect(res.status).toBe(500);
    const refundCalls = calls.rpc.filter((c) => c.name === 'refund_generation_tokens');
    expect(refundCalls).toHaveLength(1);
  });

  it('collects connected bluesky accounts and persists bluesky_account_ids', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      rpc: { spend: { data: { spent: true, balance: 96 }, error: null } },
      socialAccounts: { bluesky: ['did:plc:abc'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const req = new Request('http://localhost/api/schedule/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: PERSONA_ID,
        items: [{ topic: 'Bluesky topic' }],
        providers: ['bluesky'],
        times: ['09:00'],
        timezone: 'UTC',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const scheduleRow = calls.scheduleRows[0] as Record<string, unknown>;
    expect(scheduleRow.providers).toEqual(['bluesky']);
    expect(scheduleRow.bluesky_account_ids).toEqual(['did:plc:abc']);
  });

  it('returns 400 when bluesky is requested but no account is connected', async () => {
    mockAuth();
    const { client } = mockSupabase({
      persona: { data: PERSONA_ROW },
      socialAccounts: {},
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const req = new Request('http://localhost/api/schedule/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: PERSONA_ID,
        items: [{ topic: 'Bluesky topic' }],
        providers: ['bluesky'],
        times: ['09:00'],
        timezone: 'UTC',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('NO_CONNECTED_ACCOUNTS');
  });

  it('stores the derived connected account ids on the batch schedule', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      rpc: { spend: { data: { spent: true, balance: 96 }, error: null } },
      socialAccounts: { youtube: ['ch-1', 'ch-2'], instagram: ['ig-1'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const req = new Request('http://localhost/api/schedule/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: PERSONA_ID,
        items: [{ topic: 'Topic one' }],
        providers: ['youtube', 'instagram'],
        times: ['09:00'],
        timezone: 'UTC',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(calls.scheduleRows).toHaveLength(1);
    const scheduleRow = calls.scheduleRows[0] as Record<string, unknown>;
    expect(scheduleRow.youtube_account_ids).toEqual(['ch-1', 'ch-2']);
    expect(scheduleRow.instagram_account_ids).toEqual(['ig-1']);
    expect(scheduleRow.linkedin_account_ids).toEqual([]);
  });

  it('returns 400 without charging when a requested provider has no connected accounts', async () => {
    mockAuth();
    const { client, calls } = mockSupabase({
      persona: { data: PERSONA_ROW },
      socialAccounts: { youtube: ['ch-1'] },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const req = new Request('http://localhost/api/schedule/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: PERSONA_ID,
        items: [{ topic: 'Topic one' }],
        providers: ['youtube', 'linkedin'],
        times: ['09:00'],
        timezone: 'UTC',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('NO_CONNECTED_ACCOUNTS');
    // Fail-fast: no spend, no schedule, no slots.
    expect(calls.rpc.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    expect(calls.scheduleRows).toHaveLength(0);
    expect(calls.slotRows).toHaveLength(0);
  });
});

describe('parseBatchBody bluesky', () => {
  it('accepts bluesky as a provider (engine publishes to Bluesky)', () => {
    const parsed = parseBatchBody({
      personaId: PERSONA_ID,
      items: [{ topic: 'Bluesky topic' }],
      providers: ['bluesky'],
      times: ['09:00'],
      timezone: 'Europe/Lisbon',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.providers).toEqual(['bluesky']);
  });
});
