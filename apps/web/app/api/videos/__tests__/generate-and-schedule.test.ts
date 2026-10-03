//---------------
// Tests for POST /api/videos/generate-and-schedule.
//
// Supabase (service client), the engine client, the audio SSRF check and
// analytics are mocked boundaries; slot math (distributeSlots), the payload
// builder and zod parsing are real.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  // Rate limiting is bypassed for payload-behavior tests; one dedicated
  // test below covers the 429 path.
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

vi.mock('@/lib/api-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-keys')>();
  return { ...actual, isPersonaAllowed: vi.fn().mockReturnValue(true) };
});

vi.mock('@/lib/generation/video-generation', () => ({
  startEngineVideoTask: vi.fn(),
  recordGenerationStart: vi.fn().mockResolvedValue(undefined),
  recordGenerationUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/generation/custom-audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/generation/custom-audio')>();
  return { ...actual, checkCustomAudioUrl: vi.fn().mockResolvedValue({ ok: true }) };
});

vi.mock('@/lib/persona-images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/persona-images')>();
  return {
    ...actual,
    resolveVideoImage: vi.fn().mockResolvedValue({ ok: true, image: null }),
    recordRecentImageId: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST } from '../generate-and-schedule/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { isPersonaAllowed } from '@/lib/api-keys';
import { startEngineVideoTask } from '@/lib/generation/video-generation';
import { checkCustomAudioUrl } from '@/lib/generation/custom-audio';
import { resolveVideoImage } from '@/lib/persona-images';
import { IDEMPOTENCY_NAMESPACE, deterministicUuid } from '@/lib/idempotency';

const USER_ID = 'user-uuid-1';

const PERSONA = {
  id: 'persona-1',
  user_id: USER_ID,
  name: 'Ana',
  photo_path: null,
  avatar_url: 'https://cdn.example/avatar.png',
  voice_id: 'voice-1',
  voice_audio_path: null,
  language: 'en',
  video_aspect: '9:16',
  script_prompt: null,
  paragraph_number: 5,
  niche: 'fitness',
  face_mix_percent: 100,
  face_quality: 'ok',
};

interface DbConfig {
  persona?: Record<string, unknown> | null;
  personaErrorCode?: string;
  socialAccounts?: Array<{ provider: string; provider_account_id: string }>;
  existingScheduleId?: string | null;
  existingScheduleCreatedAt?: string;
  scheduleLookupError?: boolean;
  replaySlots?: Array<{ id: string; slot_at: string; topic: string; task_id: string | null; status: string }>;
  slotCount?: number;
  ledgerIds?: string[];
  ledgerError?: boolean;
  spend?: { spent: boolean; balance: number };
  spendErrorCode?: string;
  scheduleInsertErrorCode?: string;
  slotInsertFails?: boolean;
  engineFailSubjects?: string[];
}

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inserts: Record<string, unknown[]> = {};
const updates: Array<{ table: string; fields: Record<string, unknown> }> = [];
const deletes: string[] = [];

function futureISO(hoursAhead: number): string {
  return new Date(Date.now() + hoursAhead * 3600 * 1000).toISOString();
}

function lisbonTimePlus(hoursAhead: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(Date.now() + hoursAhead * 3600 * 1000));
}

function makeClient(cfg: DbConfig): unknown {
  const table = (name: string): unknown => {
    let isCountQuery = false;
    const builder: Record<string, unknown> = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        isCountQuery = opts?.count === 'exact' && opts?.head === true;
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => {
        if (name === 'schedules') {
          if (cfg.scheduleLookupError) return { data: null, error: { code: 'XX000', message: 'db down' } };
          if (cfg.existingScheduleId) {
            return {
              data: { id: cfg.existingScheduleId, created_at: cfg.existingScheduleCreatedAt ?? new Date().toISOString() },
              error: null,
            };
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (name === 'personas') {
          if (cfg.personaErrorCode) return { data: null, error: { code: cfg.personaErrorCode, message: 'db down' } };
          if (!cfg.persona) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          return { data: cfg.persona, error: null };
        }
        return { data: null, error: null };
      },
      insert: (rows: unknown) => {
        inserts[name] = Array.isArray(rows) ? rows : [rows];
        const q: Record<string, unknown> = {
          select: () => q,
          single: async () => {
            if (name === 'schedules' && cfg.scheduleInsertErrorCode) {
              return { data: null, error: { code: cfg.scheduleInsertErrorCode, message: 'conflict' } };
            }
            return { data: { id: 'new-id' }, error: null };
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            if (name === 'schedules' && cfg.scheduleInsertErrorCode) {
              return Promise.resolve({ data: null, error: { code: cfg.scheduleInsertErrorCode, message: 'conflict' } }).then(resolve, reject);
            }
            if (name === 'scheduled_posts') {
              if (cfg.slotInsertFails) {
                return Promise.resolve({ data: null, error: { message: 'insert failed' } }).then(resolve, reject);
              }
              const data = (rows as Array<{ slot_at: string; topic: string }>).map((r, i) => ({
                id: `slot-${i}`,
                slot_at: r.slot_at,
                topic: r.topic,
              }));
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return q;
      },
      update: (fields: Record<string, unknown>) => {
        updates.push({ table: name, fields });
        const q: Record<string, unknown> = {
          eq: () => q,
          then: (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
        };
        return q;
      },
      delete: () => {
        deletes.push(name);
        const q: Record<string, unknown> = {
          eq: () => q,
          then: (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
        };
        return q;
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (name === 'social_accounts') {
          return Promise.resolve({ data: cfg.socialAccounts ?? [], error: null }).then(resolve, reject);
        }
        if (name === 'token_transactions') {
          if (cfg.ledgerError) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
          }
          return Promise.resolve({ data: (cfg.ledgerIds ?? []).map((id) => ({ id })), error: null }).then(resolve, reject);
        }
        if (name === 'scheduled_posts') {
          if (isCountQuery) {
            const count = cfg.slotCount ?? (cfg.replaySlots ?? []).length;
            return Promise.resolve({ data: [], count, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: cfg.replaySlots ?? [], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    from: vi.fn(table),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'spend_tokens') {
        if (cfg.spendErrorCode) return { data: null, error: { code: cfg.spendErrorCode, message: 'spend failed' } };
        return { data: cfg.spend ?? { spent: true, balance: 100 }, error: null };
      }
      if (name === 'refund_batch_tokens' || name === 'refund_generation_tokens') {
        return { data: { refunded: true }, error: null };
      }
      return { data: null, error: null };
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://cdn.example/signed' }, error: null }),
      }),
    },
  };
}

function setup(cfg: DbConfig = {}): void {
  rpcCalls.length = 0;
  for (const key of Object.keys(inserts)) delete inserts[key];
  updates.length = 0;
  deletes.length = 0;

  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, personaIds: null },
    error: null,
  } as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(makeClient(cfg) as never);
  vi.mocked(isPersonaAllowed).mockReturnValue(true);
  vi.mocked(checkCustomAudioUrl).mockResolvedValue({ ok: true });
  vi.mocked(resolveVideoImage).mockResolvedValue({ ok: true, image: null });
  vi.mocked(startEngineVideoTask).mockImplementation(async (_userId: string, payload: object) => {
    const subject = (payload as { video_subject?: string }).video_subject ?? '';
    if (cfg.engineFailSubjects?.includes(subject)) {
      return { ok: false, response: NextResponse.json({}), upstreamStatus: 500, body: null };
    }
    return { ok: true, taskId: `task-${subject}`, body: {} };
  });
}

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    personaId: 'persona-1',
    topics: ['Idea 1', 'Idea 2'],
    publishing: {
      providers: ['youtube'],
      accounts: { youtube: ['acct-1'] },
      schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
    },
    options: {},
    ...overrides,
  };
}

function post(body: unknown, headers?: Record<string, string>): Promise<NextResponse> {
  return POST(
    new Request('http://localhost/api/videos/generate-and-schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body),
    }),
  ) as Promise<NextResponse>;
}

const DEFAULT_CFG: DbConfig = {
  persona: PERSONA,
  socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyRateLimit).mockResolvedValue(null);
  setup(DEFAULT_CFG);
});

describe('POST /api/videos/generate-and-schedule', () => {
  describe('happy path', () => {
    it('creates 1 schedule + N slots with bound taskIds for 2 topics', async () => {
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.replayed).toBe(false);
      expect(typeof json.schedule.id).toBe('string');
      expect(json.schedule.id.length).toBeGreaterThan(0);      expect(json.slots).toHaveLength(2);
      expect(json.slots[0]).toMatchObject({ topic: 'Idea 1', taskId: 'task-Idea 1', status: 'generating' });
      expect(json.slots[1]).toMatchObject({ topic: 'Idea 2', taskId: 'task-Idea 2', status: 'generating' });

      // ONE atomic spend for the whole operation: 2 videos x 2 tokens.
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(4);
      expect(spends[0].args.p_user_id).toBe(USER_ID);

      // Schedule row: deterministic id; scheduled_at is the legacy column
      // and the insert pins it NULL. No 'kind' key: the schedules table
      // has no kind column (it never landed in the schema), and inserting
      // an unknown key makes PostgREST reject the whole insert (500).
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0]).not.toHaveProperty('kind');
      expect(scheduleRows[0].scheduled_at).toBeNull();
      expect(scheduleRows[0].posts_per_day).toBe(2);
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-1']);

      // Slots carry topics in order.
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(2);
      expect(slotRows.map((r) => r.topic)).toEqual(['Idea 1', 'Idea 2']);
      expect(slotRows.every((r) => r.status === 'pending')).toBe(true);

      // Each slot was flipped to generating with its task_id.
      const binds = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'generating');
      expect(binds).toHaveLength(2);
      expect(binds[0].fields.task_id).toBe('task-Idea 1');
    });

    it('inserts only columns that exist on public.schedules', async () => {
      // Sync test: the supabase-js mock records any payload key, so a
      // speculative key (like the removed 'kind') sailed through tests and
      // 500d every production call — PostgREST rejects unknown keys. Parse
      // the canonical schema and assert every insert key is a real column,
      // so the next phantom key fails CI instead of production.
      const { readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const sqlPath = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'supabase',
        'migrations',
        '001_schema.sql',
      );
      const sql = readFileSync(sqlPath, 'utf8');
      const tableMatch = sql.match(
        /create table if not exists public\.schedules \(([\s\S]*?)\n\);/i,
      );
      expect(tableMatch).not.toBeNull();
      const columnBlock = tableMatch?.[1] ?? '';
      // Table-level constraints (e.g. `unique (user_id, persona_id),`) start
      // with a keyword, not a column name — filter them so a future phantom
      // key named like a SQL keyword can't false-pass.
      const constraintKeywords = new Set([
        'primary',
        'unique',
        'foreign',
        'check',
        'constraint',
        'exclude',
      ]);
      const columns = new Set(
        columnBlock
          .split('\n')
          .map((line) => line.trim().split(/\s+/)[0]?.replace(/["`,]/g, ''))
          .filter(
            (name) =>
              name && !name.startsWith('--') && !constraintKeywords.has(name),
          ),
      );
      // Sentinel: guards against a degraded parse passing vacuously.
      expect(columns.has('scheduled_at')).toBe(true);

      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      for (const key of Object.keys(scheduleRows[0])) {
        expect(columns.has(key)).toBe(true);
      }
    });

    it('distributes 10 topics across days preserving order', async () => {
      const topics = Array.from({ length: 10 }, (_, i) => `Topic ${i + 1}`);
      const res = await post(baseBody({ topics }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.slots).toHaveLength(10);
      expect(json.slots.map((s: { topic: string }) => s.topic)).toEqual(topics);
      const instants = json.slots.map((s: { slotAt: string }) => new Date(s.slotAt).getTime());
      for (let i = 1; i < instants.length; i += 1) {
        expect(instants[i]).toBeGreaterThan(instants[i - 1]);
      }
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends[0].args.p_amount).toBe(20);
    });

    it('charges the faceless rate (1 token/video) and skips image resolution', async () => {
      const res = await post(baseBody({ options: { faceless: true } }));
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends[0].args.p_amount).toBe(2);
      expect(vi.mocked(resolveVideoImage)).not.toHaveBeenCalled();
    });

    it('forwards webhook_url and per-topic script prompts to the engine payload', async () => {
      const res = await post(
        baseBody({ options: { webhookUrl: 'https://example.com/hook', scriptPrompts: ['First script', 'Second script'] } }),
      );
      expect(res.status).toBe(200);
      const calls = vi.mocked(startEngineVideoTask).mock.calls;
      expect(calls).toHaveLength(2);
      expect((calls[0][1] as Record<string, unknown>).webhook_url).toBe('https://example.com/hook');
      expect((calls[0][1] as Record<string, unknown>).video_subject).toBe('Idea 1');
      expect((calls[1][1] as Record<string, unknown>).video_script_prompt).toBe('Second script');
    });

    it('forwards the persona language, video_aspect and paragraph_number to the engine payload', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const calls = vi.mocked(startEngineVideoTask).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const payload = calls[0][1] as Record<string, unknown>;
      expect(payload.video_language).toBe('en');
      expect(payload.video_aspect).toBe('9:16');
      expect(payload.paragraph_number).toBe(5);
    });
  });

  describe('validation', () => {
    it('rejects 0 topics with TOPICS_REQUIRED and charges nothing', async () => {
      const res = await post(baseBody({ topics: [] }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('TOPICS_REQUIRED');
      expect(json.field).toBe('topics');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('rejects 11 topics with TOPICS_LIMIT_EXCEEDED', async () => {
      const res = await post(baseBody({ topics: Array.from({ length: 11 }, (_, i) => `T${i}`) }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('TOPICS_LIMIT_EXCEEDED');
      expect(json.field).toBe('topics');
    });

    it('rejects an invalid provider', async () => {
      const res = await post(
        baseBody({ publishing: { providers: ['myspace'], accounts: {}, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('publishing.providers');
    });

    it('rejects malformed times with INVALID_SCHEDULE_TIME', async () => {
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-1'] }, schedule: { startAt: futureISO(48), times: ['25:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_SCHEDULE_TIME');
      expect(json.field).toBe('publishing.schedule.times');
    });

    it('rejects an unknown timezone with the timezone field', async () => {
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-1'] }, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Mars/Olympus' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('publishing.schedule.timezone');
    });

    it('rejects slots outside the 3h-30d window', async () => {
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-1'] }, schedule: { startAt: futureISO(31 * 24), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('SCHEDULE_OUT_OF_RANGE');
    });

    it('rejects a slot less than 3 hours in the future', async () => {
      // Pin the clock to a mid-day instant: the wall-clock arithmetic below
      // must stay deterministic no matter when the suite runs (midnight
      // crossings and DST shifts would otherwise move the slot).
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-18T09:00:00.000Z'));
      try {
        const res = await post(
          baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-1'] }, schedule: { startAt: futureISO(0.5), times: [lisbonTimePlus(1)], timezone: 'Europe/Lisbon' } } }),
        );
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.code).toBe('SCHEDULE_OUT_OF_RANGE');
        // The validator's message (with the interpolated window constants)
        // is the copy clients receive — pin it so the code and the returned
        // message can't silently diverge.
        expect(json.error).toMatch(/at least 3 hours in advance/i);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects a non-http audioUrl', async () => {
      const res = await post(baseBody({ options: { audioUrl: 'ftp://example.com/a.mp3' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.audioUrl');
    });

    it('rejects imageId on faceless requests', async () => {
      const res = await post(baseBody({ options: { faceless: true, imageId: 'img-1' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.imageId');
    });

    it('rejects scriptPrompts with the wrong length', async () => {
      const res = await post(baseBody({ options: { scriptPrompts: ['only one'] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.scriptPrompts');
    });
  });

  describe('authorization', () => {
    it('404s with PERSONA_NOT_FOUND for an unknown persona', async () => {
      setup({ ...DEFAULT_CFG, persona: null });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('PERSONA_NOT_FOUND');
      expect(json.field).toBe('personaId');
    });

    it('500s with INTERNAL_ERROR (not 404) when the persona lookup fails', async () => {
      setup({ ...DEFAULT_CFG, personaErrorCode: 'XX000' });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
    });

    it('403s with PERSONA_SCOPE_DENIED for an out-of-scope API key', async () => {
      vi.mocked(isPersonaAllowed).mockReturnValue(false);
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.code).toBe('PERSONA_SCOPE_DENIED');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it("rejects another user's account with SOCIAL_ACCOUNT_NOT_OWNED", async () => {
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-evil'] }, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('SOCIAL_ACCOUNT_NOT_OWNED');
      expect(json.field).toBe('publishing.accounts.youtube');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an account bound to another provider with INVALID_PROVIDER_ACCOUNT', async () => {
      setup({ ...DEFAULT_CFG, socialAccounts: [{ provider: 'instagram', provider_account_id: 'acct-ig' }] });
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-ig'] }, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_PROVIDER_ACCOUNT');
      expect(json.field).toBe('publishing.accounts.youtube');
    });

    it('rejects a provider with no connected accounts', async () => {
      setup({ ...DEFAULT_CFG, socialAccounts: [] });
      const res = await post(
        baseBody({ publishing: { providers: ['bluesky'], accounts: {}, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('NO_CONNECTED_ACCOUNTS');
      expect(json.field).toBe('publishing.accounts.bluesky');
    });

    it('429s with RATE_LIMIT_EXCEEDED when the limiter fires', async () => {
      vi.mocked(applyRateLimit).mockResolvedValueOnce(
        NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': '30' } }),
      );
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(429);
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.headers.get('Retry-After')).toBe('30');
    });
  });

  describe('billing', () => {
    it('returns INSUFFICIENT_TOKENS with have/need and creates nothing', async () => {
      setup({ ...DEFAULT_CFG, spend: { spent: false, balance: 2 } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(402);
      expect(json.code).toBe('INSUFFICIENT_TOKENS');
      expect(json.error).toBe('You need 4 tokens, but only have 2.');
      expect(json.have).toBe(2);
      expect(json.need).toBe(4);
      expect(inserts['schedules']).toBeUndefined();
      expect(inserts['scheduled_posts']).toBeUndefined();
    });
  });

  describe('idempotency', () => {
    it('replays the existing schedule without spending again', async () => {
      const key = 'idem-key-1';
      const first = await post(baseBody({ idempotencyKey: key }));
      expect((await first.json()).replayed).toBe(false);
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);

      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [
          { id: 'slot-0', slot_at: futureISO(48), topic: 'Idea 1', task_id: 'task-Idea 1', status: 'generating' },
          { id: 'slot-1', slot_at: futureISO(49), topic: 'Idea 2', task_id: 'task-Idea 2', status: 'generating' },
        ],
      });
      const second = await post(baseBody({ idempotencyKey: key }));
      const json = await second.json();
      expect(second.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(2);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('accepts the Idempotency-Key header', async () => {
      const key = 'header-key-9';
      const expectedId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      const first = await post(baseBody(), { 'Idempotency-Key': key });
      const json = await first.json();
      expect(json.schedule.id).toBe(expectedId);
      expect(json.replayed).toBe(false);
    });

    it('refunds our spend on a schedule PK conflict (we did not create the schedule)', async () => {
      const key = 'race-key-1';
      // Step 7 misses the schedule (race), we spend, then the insert hits
      // the PK: our spend is redundant, refund it before replaying.
      setup({ ...DEFAULT_CFG, scheduleInsertErrorCode: '23505', replaySlots: [] });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      // Our spend did not create the schedule: undo it so the retry is not
      // charged twice. The winner's own spend under the same generation_id
      // is the single charge.
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_reason).toMatch(/PK race/);
    });

    it('deletes a zombie schedule (0 slots, old) and completes without charging twice', async () => {
      const key = 'zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        existingScheduleCreatedAt: hourAgo,
        replaySlots: [],
        slotCount: 0,
        // A previous attempt spent but died before creating slots.
        ledgerIds: ['tx-old'],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      // Not a replay: the zombie was cleared and the operation ran fresh.
      expect(json.replayed).toBe(false);
      expect(json.slots).toHaveLength(2);
      // The zombie schedule row was deleted.
      expect(deletes).toContain('schedules');
      // No second charge: the ledger already had this generation_id.
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('replays (does not delete) a recent 0-slot schedule that may still be in flight', async () => {
      const key = 'young-zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        existingScheduleCreatedAt: new Date().toISOString(),
        replaySlots: [],
        slotCount: 0,
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.slots).toHaveLength(0);
      expect(deletes).not.toContain('schedules');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('returns 500 without charging when the idempotency schedule lookup fails', async () => {
      setup({ ...DEFAULT_CFG, scheduleLookupError: true });
      const res = await post(baseBody({ idempotencyKey: 'lookup-err-key' }));
      expect(res.status).toBe(500);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('returns 500 without charging when the spend ledger lookup fails', async () => {
      setup({ ...DEFAULT_CFG, ledgerError: true });
      const res = await post(baseBody({ idempotencyKey: 'ledger-err-key' }));
      expect(res.status).toBe(500);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });
  });

  describe('per-slot failures', () => {
    it('marks the failed slot failed+refunded and continues the rest', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Idea 1'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.slots[0]).toMatchObject({ topic: 'Idea 1', taskId: null, status: 'failed' });
      expect(json.slots[1]).toMatchObject({ topic: 'Idea 2', taskId: 'task-Idea 2', status: 'generating' });

      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      const args = refunds[0].args;
      expect(args.p_amount).toBe(2);
      expect(args.p_refund_key).toMatch(/^batch:.*:slot:slot-0$/);
      expect(String(args.p_batch_generation_id)).toBe(String(args.p_refund_key).split(':slot:')[0]);

      const failedUpdates = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'failed');
      expect(failedUpdates).toHaveLength(1);
    });

    it('returns 502 when every slot fails', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Idea 1', 'Idea 2'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots).toHaveLength(2);
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(2);
    });
  });
});
