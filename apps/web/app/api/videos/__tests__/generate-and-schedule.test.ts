import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { findRepoRoot } from '@/test/repo-root';
import { GenerateAndScheduleResponseSchema } from '@/lib/contracts/videos';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({
    Authorization: 'Bearer engine-secret',
    'x-user-id': userId,
  }),
}));

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

const { capturedEvents, recordingClient } = vi.hoisted(() => {
  const capturedEvents: Array<{ distinctId: string; event: string; properties?: Record<string, unknown> }> = [];
  const recordingClient = {
    captureAs: (distinctId: string, event: string, properties?: Record<string, unknown>) => {
      capturedEvents.push({ distinctId, event, properties });
    },
  };
  return { capturedEvents, recordingClient };
});

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => recordingClient),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

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

vi.mock('@/lib/voice-catalog-fetch', () => ({
  fetchPersonaVoiceCatalogIds: vi.fn().mockResolvedValue(undefined),
  fetchPersonaVoiceOptions: vi.fn(),
}));

vi.mock('@/lib/engine-image-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engine-image-url')>();
  return {
    ...actual,
    ensureEngineImageUrl: vi.fn(async (url: string | null | undefined) => {
      const candidate = typeof url === 'string' ? url.trim() : '';
      if (candidate.length === 0) return undefined;
      if (candidate.startsWith('data:image/') || /^https?:\/\//i.test(candidate)) return candidate;
      return 'https://cdn.example/hosted.png';
    }),
  };
});

vi.mock('../generate-and-schedule/prompt-version', () => ({ checkPromptVersion: vi.fn().mockResolvedValue('ok') }));

import { POST } from '../generate-and-schedule/route';
import { checkPromptVersion } from '../generate-and-schedule/prompt-version';
import { getPostHogServer } from '@/lib/posthog-server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { isPersonaAllowed } from '@/lib/api-keys';
import { startEngineVideoTask, recordGenerationStart, recordGenerationUpdate } from '@/lib/generation/video-generation';
import { checkCustomAudioUrl } from '@/lib/generation/custom-audio';
import { resolveVideoImage, recordRecentImageId } from '@/lib/persona-images';
import { ensureEngineImageUrl } from '@/lib/engine-image-url';
import { fetchPersonaVoiceCatalogIds } from '@/lib/voice-catalog-fetch';
import { trackApiEvent } from '@/lib/analytics';
import { scrubSecrets } from '@/lib/scrub';
import { IDEMPOTENCY_NAMESPACE, deterministicUuid } from '@/lib/idempotency';
import { logger } from '@/lib/logger';

const USER_ID = 'user-uuid-1';

const PERSONA = {
  id: 'persona-1',
  user_id: USER_ID,
  name: 'Ana',
  photo_path: null,
  avatar_url: 'https://cdn.example/avatar.png',
  voice_id: 'chatterbox:kokoro_af_heart',
  voice_audio_path: null,
  language: 'en',
  video_aspect: '9:16',
  script_prompt: null,
  paragraph_number: 5,
  niche: 'fitness',
  face_quality: 'ok',
};

interface DbConfig {
  persona?: Record<string, unknown> | null;
  personaErrorCode?: string;
  socialAccounts?: Array<{ provider: string; provider_account_id: string; needs_reconnect?: boolean }>;
  personaDefaultAccounts?: Array<{ provider: string; provider_account_id: string }>;
  existingScheduleId?: string | null;
  existingSchedulePublishMode?: 'scheduled' | 'asap';
  scheduleLookupError?: boolean;
  replaySlots?: Array<{ id: string; slot_at: string; title: string; task_id: string | null; status: string }>;
  slotCount?: number | null;
  ledgerIds?: string[];
  ledgerRows?: Array<{ id: string; type: string; amount: number; reference_id?: string | null }>;
  ledgerFilters?: Array<{ op: string; column: string; value: unknown }>;
  slotCountError?: boolean;
  ledgerError?: boolean;
  spend?: { spent: boolean; balance: number };
  spendErrorCode?: string;
  scheduleInsertErrorCode?: string;
  scheduleInsertConstraint?: string;
  scheduleInsertDetails?: string;
  slotInsertFails?: boolean;
  engineFailSubjects?: string[];
  engineUnavailableSubjects?: string[];
  signUrlError?: boolean;
  signUrlThrows?: boolean;
  socialAccountsError?: boolean;
  spendErrorMessage?: string;
  updateErrorTables?: string[];
  updateThrowsTables?: string[];
  replaySlotsError?: boolean;
  engineNoTaskIdSubjects?: string[];
  refundBatchErrorCode?: string;
  cloneReady?: boolean;
  cloneReadyError?: boolean;
  cloneReadyThrows?: boolean;
  personaBindingLookup?: 'missing' | { message: string };
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
      eq: (column: string, value: unknown) => {
        if (name === 'token_transactions') cfg.ledgerFilters?.push({ op: 'eq', column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        if (name === 'token_transactions') cfg.ledgerFilters?.push({ op: 'in', column, value });
        return builder;
      },
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => {
        if (name === 'schedules') {
          if (cfg.scheduleLookupError) return { data: null, error: { code: 'XX000', message: 'db down' } };
          if (cfg.existingScheduleId) {
            return {
              data: { id: cfg.existingScheduleId, publish_mode: cfg.existingSchedulePublishMode ?? 'scheduled' },
              error: null,
            };
          }
          return { data: null, error: null };
        }
        if (name === 'personas') {
          if (cfg.personaBindingLookup === 'missing') return { data: null, error: null };
          if (cfg.personaBindingLookup) return { data: null, error: cfg.personaBindingLookup };
          if (cfg.personaErrorCode) return { data: null, error: { code: cfg.personaErrorCode, message: 'db down' } };
          return { data: cfg.persona ?? null, error: null };
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
        const insertError = (): { code: string; message: string; details?: string } => ({
          code: cfg.scheduleInsertErrorCode ?? '23505',
          message: cfg.scheduleInsertConstraint
            ? `duplicate key value violates unique constraint "${cfg.scheduleInsertConstraint}"`
            : 'conflict',
          ...(cfg.scheduleInsertDetails ? { details: cfg.scheduleInsertDetails } : {}),
        });
        const q: Record<string, unknown> = {
          select: () => q,
          single: async () => {
            if (name === 'schedules' && cfg.scheduleInsertErrorCode) {
              return { data: null, error: insertError() };
            }
            return { data: { id: 'new-id' }, error: null };
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            if (name === 'schedules' && cfg.scheduleInsertErrorCode) {
              return Promise.resolve({ data: null, error: insertError() }).then(resolve, reject);
            }
            if (name === 'scheduled_posts') {
              if (cfg.slotInsertFails) {
                return Promise.resolve({ data: null, error: { message: 'insert failed' } }).then(resolve, reject);
              }
              const data = (rows as Array<{ slot_at: string; title: string }>).map((r, i) => ({
                id: `slot-${i}`,
                slot_at: r.slot_at,
                title: r.title,
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
        const updateError = cfg.updateErrorTables?.includes(name)
          ? { code: 'XX000', message: 'update failed' }
          : null;
        const updateThrows = cfg.updateThrowsTables?.includes(name)
          ? new Error('update exploded')
          : null;
        const q: Record<string, unknown> = {
          eq: () => q,
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            updateThrows
              ? Promise.reject(updateThrows).then(resolve, reject)
              : Promise.resolve({ error: updateError }).then(resolve),
        };
        return q;
      },
      delete: () => {
        deletes.push(name);
        const q: Record<string, unknown> = {
          eq: () => q,
          in: () => q,
          then: (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
        };
        return q;
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (name === 'social_accounts') {
          if (cfg.socialAccountsError) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
          }
          return Promise.resolve({ data: cfg.socialAccounts ?? [], error: null }).then(resolve, reject);
        }
        if (name === 'persona_default_accounts') {
          return Promise.resolve({ data: cfg.personaDefaultAccounts ?? [], error: null }).then(resolve, reject);
        }
        if (name === 'cloned_voices') {
          if (cfg.cloneReadyError) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
          }
          if (cfg.cloneReadyThrows) {
            return Promise.reject(new Error('cloned_voices exploded')).then(resolve, reject);
          }
          return Promise.resolve({ data: cfg.cloneReady ? [{ engine_voice_key: 'x' }] : [], error: null }).then(resolve, reject);
        }
        if (name === 'token_transactions') {
          if (cfg.ledgerError) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
          }
          const rows =
            cfg.ledgerRows ?? (cfg.ledgerIds ?? []).map((id) => ({ id, type: 'video_generation', amount: -2 }));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        if (name === 'scheduled_posts') {
          if (isCountQuery) {
            if (cfg.slotCountError) {
              return Promise.resolve({ data: null, count: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
            }
            const count = cfg.slotCount === undefined ? (cfg.replaySlots ?? []).length : cfg.slotCount;
            return Promise.resolve({ data: [], count, error: null }).then(resolve, reject);
          }
          if (cfg.replaySlotsError && !isCountQuery) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject);
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
        if (cfg.spendErrorCode) {
          return { data: null, error: { code: cfg.spendErrorCode, message: cfg.spendErrorMessage ?? 'spend failed' } };
        }
        return { data: cfg.spend ?? { spent: true, balance: 100 }, error: null };
      }
      if (name === 'refund_batch_tokens') {
        if (cfg.refundBatchErrorCode) {
          return { data: null, error: { code: cfg.refundBatchErrorCode, message: 'refund failed' } };
        }
        return { data: { refunded: true }, error: null };
      }
      return { data: null, error: null };
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          if (cfg.signUrlThrows) throw new Error('storage down');
          if (cfg.signUrlError) return { data: null, error: { message: 'signing failed' } };
          return { data: { signedUrl: 'https://cdn.example/signed' }, error: null };
        },
      }),
    },
  };
}

function setup(cfg: DbConfig = {}): void {
  rpcCalls.length = 0;
  for (const key of Object.keys(inserts)) delete inserts[key];
  updates.length = 0;
  deletes.length = 0;
  capturedEvents.length = 0;

  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, personaIds: null },
    error: null,
  } as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(makeClient(cfg) as never);
  vi.mocked(isPersonaAllowed).mockReturnValue(true);
  vi.mocked(checkCustomAudioUrl).mockResolvedValue({ ok: true });
  vi.mocked(resolveVideoImage).mockResolvedValue({ ok: true, image: null });
  vi.mocked(startEngineVideoTask).mockImplementation(async (_userId: string, payload: object) => {
    const subject = (payload as { video_title?: string }).video_title ?? '';
    if (cfg.engineFailSubjects?.includes(subject)) {
      return { ok: false, response: NextResponse.json({}), upstreamStatus: 500, body: null };
    }
    if (cfg.engineUnavailableSubjects?.includes(subject)) {
      return { ok: false, response: NextResponse.json({}), body: null };
    }
    if (cfg.engineNoTaskIdSubjects?.includes(subject)) {
      return { ok: true, taskId: undefined, body: {} };
    }
    return { ok: true, taskId: `task-${subject}`, body: {} };
  });
}

const DEFAULT_SEGMENTS = [
  {
    kind: 'hook',
    text: 'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.',
    media: [0, 1, 2, 3, 4].map((photo) => ({ url: `https://e.com/h${photo}.jpg` })),
  },
  {
    kind: 'content',
    text: 'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.',
    media: [0, 1, 2, 3, 4, 5, 6, 7].map((photo) => ({ url: `https://e.com/b${photo}.jpg` })),
  },
  {
    kind: 'content',
    text: 'Save this video before your next trip to Porto.',
    cta: true,
    media: [0, 1].map((photo) => ({ url: `https://e.com/c${photo}.jpg` })),
  },
];

const NO_MEDIA_SEGMENTS = DEFAULT_SEGMENTS.map(({ kind, text, cta }) => ({ kind, text, ...(cta ? { cta } : {}) }));

const UNMARKED_SEGMENTS = DEFAULT_SEGMENTS.map(({ kind, text, media }) => ({ kind, text, media }));

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { options: optionsOverrides, ...rest } = overrides;
  return {
    personaId: 'persona-1',
    title: 'Porto trip',
    description: 'Agent description.',
    publishing: {
      providers: ['youtube'],
      accounts: { youtube: ['acct-1'] },
      schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
    },
    options: { videoType: 'hook_lipsync', segments: DEFAULT_SEGMENTS, ...((optionsOverrides ?? {}) as Record<string, unknown>) },
    ...rest,
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

function generationIdFor(key: string): string {
  return `batch:${deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`)}`;
}

function rollbackRefund(key: string, amount: number): { id: string; type: string; amount: number; reference_id: string } {
  return { id: 'tx-refund', type: 'generation_refund', amount, reference_id: `${generationIdFor(key)}:rollback:r-1` };
}

const DEFAULT_CFG: DbConfig = {
  persona: PERSONA,
  socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
  personaDefaultAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyRateLimit).mockResolvedValue(null);
  setup(DEFAULT_CFG);
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/api/v1/media/check')
        ? new Response(JSON.stringify({ status: 200, body: { code: 'ok', width: 1080, height: 1920 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
        : new Response('{}', { status: 200 }),
    ),
  );
});

describe('POST /api/videos/generate-and-schedule', () => {
  describe('happy path', () => {
    it('creates 1 schedule + 1 slot with a bound taskId for the title', async () => {
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.replayed).toBe(false);
      expect(GenerateAndScheduleResponseSchema.safeParse(json).success).toBe(true);
      expect(typeof json.schedule.id).toBe('string');
      expect(json.schedule.id.length).toBeGreaterThan(0);      expect(json.slots).toHaveLength(1);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: 'task-Porto trip', status: 'generating' });

      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(2);
      expect(spends[0].args.p_user_id).toBe(USER_ID);

      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0]).not.toHaveProperty('kind');
      expect(scheduleRows[0].scheduled_at).toBeNull();
      expect(scheduleRows[0].posts_per_day).toBe(1);
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-1']);

      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      expect(slotRows.map((r) => r.title)).toEqual(['Porto trip']);
      expect(slotRows.every((r) => r.status === 'pending')).toBe(true);
      expect(slotRows.map((r) => r.charged_tokens)).toEqual([spends[0].args.p_amount]);

      const binds = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'generating');
      expect(binds).toHaveLength(1);
      expect(binds[0].fields.task_id).toBe('task-Porto trip');
    });

    it('inserts only columns that exist on public.schedules', async () => {
      const { readFileSync, readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const migrationsDir = join(findRepoRoot(import.meta.url), 'supabase', 'migrations');
      const sqlPath = join(migrationsDir, '001_schema.sql');
      const sql = readFileSync(sqlPath, 'utf8');
      const tableMatch = sql.match(
        /create table if not exists public\.schedules \(([\s\S]*?)\n\);/i,
      );
      expect(tableMatch).not.toBeNull();
      const columnBlock = tableMatch?.[1] ?? '';
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
      const addColumnPattern =
        /alter table public\.schedules\s+add column if not exists\s+([a-z_][a-z0-9_]*)/gi;
      for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
        const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
        for (const match of migrationSql.matchAll(addColumnPattern)) {
          columns.add(match[1]);
        }
      }
      expect(columns.has('scheduled_at')).toBe(true);
      expect(columns.has('publish_mode')).toBe(true);

      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      for (const key of Object.keys(scheduleRows[0])) {
        expect(columns.has(key)).toBe(true);
      }
    });

    it('charges the voiceover rate (1 token/video) and skips image resolution', async () => {
      const res = await post(baseBody({ options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends[0].args.p_amount).toBe(1);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows.map((r) => r.charged_tokens)).toEqual([1]);
      expect(vi.mocked(resolveVideoImage)).not.toHaveBeenCalled();
    });

    it('stores the voiceover choice on every slot (the engine prices a slot from it)', async () => {
      const res = await post(baseBody({ options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(200);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      for (const row of slotRows) {
        expect(row).toMatchObject({ voiceover: true, video_type: 'voiceover' });
      }
    });

    it('stores the requested music mood on every slot (the engine rebuilds a requeued slot from it)', async () => {
      const res = await post(baseBody({ options: { musicMood: 'calm' } }));
      expect(res.status).toBe(200);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      for (const row of slotRows) {
        expect(row).toMatchObject({ music_mood: 'calm' });
      }
    });

    it('stores voiceover: false and video_type hook_lipsync for a post with the persona face', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      for (const row of slotRows) {
        expect(row).toMatchObject({ voiceover: false, video_type: 'hook_lipsync' });
        expect(row).not.toHaveProperty('voiceover_material');
      }
    });

    it('sends video_type hook_lipsync and the persona quality as the job resolution', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_type).toBe('hook_lipsync');
      expect(payload.video_quality).toBe('ok');
    });

    it('sends generation_id to the engine so PostHog events stay correlatable', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      const genInput = vi.mocked(recordGenerationStart).mock.calls[0][0] as { generationId: string };
      expect(payload.generation_id).toBe(genInput.generationId);
      expect(typeof payload.generation_id).toBe('string');
    });

    it('sends slot_id to the engine so boot orphan triage can requeue the task', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(typeof payload.slot_id).toBe('string');
      expect(payload.slot_id).toBeTruthy();
    });

    it('persists the full engine payload, publish mode and slot time on the video_generations row', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const genInput = vi.mocked(recordGenerationStart).mock.calls[0][0];
      const enginePayload = vi.mocked(startEngineVideoTask).mock.calls[0][1];
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(genInput.persistence?.params).toBe(enginePayload);
      expect(genInput.persistence).toEqual({
        params: enginePayload,
        mode: 'scheduled',
        slotAt: slotRows[0].slot_at,
      });
    });

    it("records mode 'asap' for generate-now posts (slot time stored as null)", async () => {
      const res = await post(
        baseBody({ publishing: { mode: 'asap', providers: ['youtube'], accounts: { youtube: ['acct-1'] } } }),
      );
      expect(res.status).toBe(200);
      const genInput = vi.mocked(recordGenerationStart).mock.calls[0][0];
      const enginePayload = vi.mocked(startEngineVideoTask).mock.calls[0][1];
      expect(genInput.persistence).toEqual({
        params: enginePayload,
        mode: 'asap',
        slotAt: expect.any(String),
      });
    });

    it('sends video_type voiceover and no material to the engine for a voiceover post', async () => {
      const res = await post(baseBody({ options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_type).toBe('voiceover');
      expect(payload).not.toHaveProperty('voiceover_material');
    });

    it('sends video_type hook_lipsync and no material for a with-face post', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_type).toBe('hook_lipsync');
      expect(payload).not.toHaveProperty('voiceover_material');
    });

    it('sends video_type voiceover and no persona quality for a voiceover post', async () => {
      const res = await post(baseBody({ options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_type).toBe('voiceover');
      expect(payload).not.toHaveProperty('video_quality');
      const serialized = JSON.parse(JSON.stringify(payload)) as { persona: Record<string, unknown> };
      expect(serialized.persona).not.toHaveProperty('photo_url');
    });

    it('forwards webhook_url to the engine payload and carries no script prompt', async () => {
      const res = await post(
        baseBody({ options: { webhookUrl: 'https://example.com/hook' } }),
      );
      expect(res.status).toBe(200);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
      const calls = vi.mocked(startEngineVideoTask).mock.calls;
      expect(calls).toHaveLength(1);
      expect((calls[0][1] as Record<string, unknown>).webhook_url).toBe('https://example.com/hook');
      expect((calls[0][1] as Record<string, unknown>).video_title).toBe('Porto trip');
      expect(calls[0][1] as Record<string, unknown>).not.toHaveProperty('video_script_prompt');
    });

    it('rejects options.scriptPrompt outright (scripts come from segments only)', async () => {
      const res = await post(baseBody({ options: { scriptPrompt: 'Be funny' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.scriptPrompt is no longer accepted: scripts come from options.segments only.');
      expect(json.field).toBe('options.scriptPrompt');
    });

    it('rejects options.scriptPrompts outright (scripts come from segments only)', async () => {
      const res = await post(baseBody({ options: { scriptPrompts: ['First script'] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.scriptPrompts is no longer accepted: scripts come from options.segments only.');
      expect(json.field).toBe('options.scriptPrompts');
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
    it('rejects a title over 100 characters before any charge (engine cap, mirrored pre-charge)', async () => {
      const res = await post(baseBody({ title: 'x'.repeat(101) }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('title');
      expect(json.error).toContain('at most 100 characters');
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
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-18T09:00:00.000Z'));
      try {
        const res = await post(
          baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-1'] }, schedule: { startAt: futureISO(0.5), times: [lisbonTimePlus(1)], timezone: 'Europe/Lisbon' } } }),
        );
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.code).toBe('SCHEDULE_OUT_OF_RANGE');
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

    it('sends video_type full_lipsync to the engine for an opt-in full-mode post', async () => {
      vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
      vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          String(url).includes('/api/v1/media/check')
            ? new Response(
              JSON.stringify({ status: 200, body: { code: 'ok', width: 1080, height: 1920, has_face: true } }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
            : new Response(JSON.stringify({ status: 200, body: { audio_duration_seconds: 51 } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      );
      try {
        const res = await post(baseBody({ options: { videoType: 'full_lipsync', segments: NO_MEDIA_SEGMENTS, lipsyncPhotos: [{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }] } }));
        expect(res.status).toBe(200);
        const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.video_type).toBe('full_lipsync');
        expect(payload.lipsync_photos).toEqual([{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }]);
        const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
        expect(spends).toHaveLength(1);
        expect(spends[0].args.p_amount).toBe(8);
        const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
        expect(slotRows.map((r) => r.charged_tokens)).toEqual([8]);
        expect(slotRows[0]?.lipsync_photos).toEqual([{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }]);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    });

    it('rejects an unknown videoType with a 400 listing the modes and costs', async () => {
      const res = await post(baseBody({ options: { videoType: 'sideways', segments: NO_MEDIA_SEGMENTS } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.videoType');
      expect(json.error).toContain("unknown video_type 'sideways'");
      expect(json.error).toContain('full_lipsync (8/15)');
      expect(json.error).toContain('hook_lipsync (2/3)');
      expect(json.error).toContain('voiceover (1)');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects imageId on voiceover requests', async () => {
      const res = await post(baseBody({ options: { videoType: 'voiceover', imageId: 'img-1' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.imageId');
    });

    it('sends video_type hook_lipsync and no material on a with-face request with lipsync', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).toMatchObject({ video_type: 'hook_lipsync' });
      expect(payload).not.toHaveProperty('voiceover_material');
    });

    it('rejects scriptPrompts with more than one entry (scripts come from segments only)', async () => {
      const res = await post(baseBody({ options: { scriptPrompts: ['one', 'two'] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.scriptPrompts');
    });

    const segmentsHook =
      'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
    const segmentsContent =
      'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
    const segmentsCtaTake = 'Save this video before your next trip to Porto.';
    const validSegments = [
      { kind: 'hook', text: segmentsHook, media: [0, 1, 2, 3, 4].map((photo) => ({ url: `https://e.com/h${photo}.jpg` })) },
      {
        kind: 'content',
        text: segmentsContent,
        media: [0, 1, 2, 3, 4, 5, 6, 7].map((photo) => ({ url: `https://e.com/b${photo}.jpg` })),
      },
      { kind: 'content', text: segmentsCtaTake, cta: true, media: [0, 1].map((photo) => ({ url: `https://e.com/c${photo}.jpg` })) },
    ];

    it('rejects invalid segments before any charge', async () => {
      const bad = [
        { kind: 'content', text: segmentsContent },
        { kind: 'hook', text: segmentsHook },
        { kind: 'content', text: segmentsCtaTake },
      ];
      const res = await post(baseBody({ options: { segments: bad } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(String(json.field)).toContain('segments');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a request without segments before any charge', async () => {
      const res = await post(baseBody({ options: { segments: undefined } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.segments');
      expect(json.error).toContain('options.segments is required');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an unknown segment key at parse time instead of stripping it', async () => {
      const withVoice = [
        { kind: 'hook', text: segmentsHook },
        { kind: 'content', text: segmentsContent, voice: 'narrator' },
        { kind: 'content', text: segmentsCtaTake },
      ];
      const res = await post(baseBody({ options: { segments: withVoice } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(String(json.field)).toContain('segments');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an unknown media key at parse time instead of stripping it', async () => {
      const withAlt = [
        { kind: 'hook', text: segmentsHook },
        { kind: 'content', text: segmentsContent, media: [{ mediaId: 'abc', alt: 'kitchen' }] },
        { kind: 'content', text: segmentsCtaTake },
      ];
      const res = await post(baseBody({ options: { segments: withAlt } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(String(json.field)).toContain('segments');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects per-segment terms at parse time (dead with the stock path)', async () => {
      const withTerms = [
        { kind: 'hook', text: segmentsHook },
        { kind: 'content', text: segmentsContent, terms: ['restaurant kitchen'] },
        { kind: 'content', text: segmentsCtaTake },
      ];
      const res = await post(baseBody({ options: { segments: withTerms } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'options.segments.1',
            message: expect.stringContaining('Unrecognized key: "terms"'),
          }),
        ]),
      );
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('forwards the joined segments script to the engine for a valid segments request', async () => {
      const res = await post(baseBody({ options: { segments: validSegments } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_script).toBe(`${segmentsHook}\n\n${segmentsContent}\n\n${segmentsCtaTake}`);
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

    it('404s with PERSONA_NOT_FOUND when the binding lookup cannot see the persona', async () => {
      setup({ ...DEFAULT_CFG, personaBindingLookup: 'missing' });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('PERSONA_NOT_FOUND');
      expect(json.field).toBe('personaId');
      expect(json.error).toBe('Persona does not exist or is not accessible.');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('logs the binding lookup error and answers 500', async () => {
      const dbError = { message: 'connection reset' };
      setup({ ...DEFAULT_CFG, personaBindingLookup: dbError });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(logger.error).toHaveBeenCalledWith(
        '[generate-and-schedule] persona binding lookup failed',
        expect.objectContaining({ message: 'Failed to load persona: connection reset' }),
        { userId: USER_ID, personaId: 'persona-1' },
      );
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
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
      setup({ ...DEFAULT_CFG, spend: { spent: false, balance: 1 } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(402);
      expect(json.code).toBe('INSUFFICIENT_TOKENS');
      expect(json.error).toBe('You need 2 tokens, but only have 1.');
      expect(json.have).toBe(1);
      expect(json.need).toBe(2);
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
          { id: 'slot-0', slot_at: futureISO(48), title: 'Porto trip', task_id: 'task-Porto trip', status: 'generating' },
        ],
      });
      const second = await post(baseBody({ idempotencyKey: key }));
      const json = await second.json();
      expect(second.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.schedule.mode).toBe('scheduled');
      expect(json.slots).toHaveLength(1);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('carries the dead-account warning on an idempotent replay', async () => {
      const key = 'idem-key-dead-account';
      const first = await post(baseBody({ idempotencyKey: key }));
      expect((await first.json()).replayed).toBe(false);
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);

      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1', needs_reconnect: true }],
        replaySlots: [
          { id: 'slot-0', slot_at: futureISO(48), title: 'Porto trip', task_id: 'task-Porto trip', status: 'generating' },
        ],
      });
      const second = await post(baseBody({ idempotencyKey: key }));
      const json = await second.json();
      expect(second.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'acct-1' }] },
      ]);
      expect(GenerateAndScheduleResponseSchema.safeParse(json).success).toBe(true);
    });

    it('re-charges when the prior spend was fully refunded', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2 },
          rollbackRefund('spent-and-refunded-key', 2),
        ],
      });
      const res = await post(baseBody({ idempotencyKey: 'spent-and-refunded-key' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });

    it('does not charge when the ledger holds an unrefunded spend row', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [{ id: 'tx-spend', type: 'video_generation', amount: -2 }],
      });
      const res = await post(baseBody({ idempotencyKey: 'spend-row-key' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('does not charge when the ledger holds a spend with only a partial refund', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2 },
          rollbackRefund('spend-partial-refund-key', 1),
        ],
      });
      const res = await post(baseBody({ idempotencyKey: 'spend-partial-refund-key' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('charges again when the key belongs to a schedule deleted after a full cancel refund and no slot survives', async () => {
      const key = 'deleted-after-cancel-key';
      const generationId = generationIdFor(key);
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null },
          { id: 'tx-refund', type: 'generation_refund', amount: 2, reference_id: `${generationId}:slot:slot-0` },
        ],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });

    it('409s without charging when a slot survives a refund and its schedule was deleted', async () => {
      const key = 'deleted-with-refunded-slot-key';
      const generationId = generationIdFor(key);
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null },
          { id: 'tx-refund', type: 'generation_refund', amount: 2, reference_id: `${generationId}:slot:slot-0` },
        ],
        replaySlots: [{ id: 'slot-failed', slot_at: futureISO(-24), title: 'Porto trip', task_id: 'task-1', status: 'failed' }],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('IDEMPOTENCY_KEY_CONSUMED');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
    });

    it('409s without charging or dispatching when the key belongs to a schedule deleted after delivery', async () => {
      const key = 'deleted-after-delivery-key';
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [{ id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null }],
        replaySlots: [{ id: 'slot-published', slot_at: futureISO(-24), title: 'Porto trip', task_id: 'task-1', status: 'published' }],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('IDEMPOTENCY_KEY_CONSUMED');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
      expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
    });

    it('returns 500 without charging when the orphan slot lookup fails', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [{ id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null }],
        slotCountError: true,
      });
      const res = await post(baseBody({ idempotencyKey: 'orphan-lookup-err-key' }));
      expect(res.status).toBe(500);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
      expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
    });

    it('resumes a charge whose schedule was never inserted, dispatching once without charging again', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [{ id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null }],
      });
      const res = await post(baseBody({ idempotencyKey: 'crash-before-schedule-key' }));
      expect(res.status).toBe(200);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toHaveLength(1);
      expect(vi.mocked(startEngineVideoTask)).toHaveBeenCalledTimes(1);
    });

    it('reads only charge and refund rows of this user for the generation id', async () => {
      const key = 'ledger-filter-key';
      const ledgerFilters: Array<{ op: string; column: string; value: unknown }> = [];
      setup({ ...DEFAULT_CFG, ledgerFilters });
      await post(baseBody({ idempotencyKey: key }));
      expect(ledgerFilters).toEqual([
        { op: 'eq', column: 'generation_id', value: generationIdFor(key) },
        { op: 'eq', column: 'user_id', value: USER_ID },
        { op: 'in', column: 'type', value: ['video_generation', 'generation_refund'] },
      ]);
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
      vi.mocked(logger.error).mockClear();
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_pkey',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_reason).toMatch(/PK race/);
      expect(refunds[0].args.p_amount).toBe(2);
      expect(String(refunds[0].args.p_refund_key)).toMatch(/^batch:.*:rollback:/);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        expect.stringMatching(/refunded redundant spend, replaying winner/),
        expect.anything(),
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('does not refund on a schedule PK conflict when we skipped our spend (already spent)', async () => {
      const key = 'race-key-2';
      setup({
        ...DEFAULT_CFG,
        ledgerIds: ['tx-old'],
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_pkey',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(0);
    });

    it('still replays the winner when the PK-race refund RPC fails', async () => {
      const key = 'race-key-3';
      vi.mocked(logger.error).mockClear();
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_pkey',
        refundBatchErrorCode: 'XX000',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        expect.stringMatching(/PK race refund failed/),
        expect.objectContaining({ code: 'XX000' }),
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('deletes a 0-slot zombie schedule (created an hour ago) and completes without charging twice', async () => {
      const key = 'zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: 0,
        ledgerIds: ['tx-old'],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(false);
      expect(json.slots).toHaveLength(1);
      expect(deletes).toContain('schedules');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('deletes a recent 0-slot zombie schedule and runs fresh without charging twice', async () => {
      const key = 'young-zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: 0,
        ledgerIds: ['tx-old'],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(false);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(1);
      expect(deletes).toContain('schedules');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('spends exactly once when a fresh 0-slot zombie had no prior spend', async () => {
      const key = 'young-zombie-key-2';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: 0,
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(false);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(1);
      expect(deletes).toContain('schedules');
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(2);
    });

    it('re-charges a 0-slot zombie whose slot was refunded instead of answering 409', async () => {
      const key = 'refunded-zombie-key';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: 0,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2, reference_id: null },
          { id: 'tx-refund', type: 'generation_refund', amount: 2, reference_id: `batch:${scheduleId}:slot:slot-0` },
        ],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(false);
      expect(deletes).toContain('schedules');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
      expect(vi.mocked(startEngineVideoTask)).toHaveBeenCalledTimes(1);
    });

    it('treats a null slot count as a 0-slot zombie and runs fresh', async () => {
      const key = 'null-count-zombie-key';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: null,
        ledgerIds: ['tx-old'],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(false);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(1);
      expect(deletes).toContain('schedules');
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

    it('409s with PERSONA_ALREADY_SCHEDULED instead of "replaying" a schedule it never inserted', async () => {
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_persona_owner',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: 'persona-owner-key' }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('PERSONA_ALREADY_SCHEDULED');
      expect(json.replayed).toBeUndefined();
      expect(json.slots).toBeUndefined();
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_batch_generation_id).toMatch(/^batch:/);
    });

    it('does not refund the persona-already-scheduled conflict when we skipped our spend', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerIds: ['tx-old'],
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_persona_owner',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: 'persona-owner-ledger-key' }));
      expect(res.status).toBe(409);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(0);
    });

    it('refunds and 500s on a unique violation from an unclassified constraint', async () => {
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'some_future_constraint',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: 'unknown-constraint-key' }));
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(1);
    });
  });

  describe('per-slot failures', () => {
    it('marks the failed slot failed+refunded', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: null, status: 'failed', tokensRefunded: true });

      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      const args = refunds[0].args;
      expect(args.p_amount).toBe(2);
      expect(args.p_refund_key).toMatch(/^batch:.*:slot:slot-0$/);
      expect(String(args.p_batch_generation_id)).toBe(String(args.p_refund_key).split(':slot:')[0]);

      const failedUpdates = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'failed');
      expect(failedUpdates).toHaveLength(1);

      const issued = capturedEvents.filter((entry) => entry.event === 'refund_issued');
      expect(issued).toHaveLength(1);
      expect(issued[0].properties).toMatchObject({
        kind: 'dispatch_failed',
        amount: 2,
        reason: 'Unified generate+schedule: slot dispatch failed; video refunded',
        slot_id: 'slot-0',
      });
      expect(issued[0].properties?.batch_generation_id).toMatch(/^batch:/);
    });

    it('reports refunded on the dispatch-failed video_creation_failed event', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      expect(res.status).toBe(502);
      const failedEvent = vi
        .mocked(trackApiEvent)
        .mock.calls.find((call) => call[0] === 'video_creation_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.[1]).toMatchObject({
        errorCode: 'ENGINE_UNAVAILABLE',
        failureStage: 'dispatch',
        refunded: true,
      });
      expect(scrubSecrets(failedEvent?.[1] as Record<string, unknown>)).toMatchObject({
        errorCode: 'ENGINE_UNAVAILABLE',
        failureStage: 'dispatch',
        refunded: true,
      });
    });

    it('refunds the re-charge when a fully-refunded retry fails dispatch', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2 },
          rollbackRefund('refunded-retry-dispatch-key', 2),
        ],
        engineFailSubjects: ['Porto trip'],
      });
      const res = await post(baseBody({ idempotencyKey: 'refunded-retry-dispatch-key' }));
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: null, status: 'failed' });
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_amount).toBe(2);
      expect(refunds[0].args.p_refund_key).toMatch(/^batch:.*:slot:slot-0$/);
    });

    it('returns 502 when the slot fails', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots).toHaveLength(1);
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(1);
    });

    it('reports the 502 to PostHog with route, code and user id', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const captureExceptionAs = vi.fn();
      vi.mocked(getPostHogServer).mockReturnValue({
        capture: vi.fn(),
        captureAs: vi.fn(),
        captureException: vi.fn(),
        captureExceptionAs,
      } as never);
      try {
        setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'] });
        const res = await post(baseBody());
        expect(res.status).toBe(502);
        await vi.waitFor(() => expect(captureExceptionAs).toHaveBeenCalledTimes(1));
        const [distinctId, error, properties] = captureExceptionAs.mock.calls[0] as [
          string,
          Error,
          Record<string, unknown>,
        ];
        expect(distinctId).toBe(USER_ID);
        expect(error).toBeInstanceOf(Error);
        expect(properties).toMatchObject({
          route: 'POST /api/videos/generate-and-schedule',
          status: 502,
          code: 'ENGINE_UNAVAILABLE',
          userId: USER_ID,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('validation branches (mutation hardening)', () => {
    it('rejects an empty provider list', async () => {
      const res = await post(
        baseBody({
          publishing: {
            providers: [],
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Select at least one provider.');
      expect(json.field).toBe('publishing.providers');
    });

    it('dedupes and trims providers before the schedule insert', async () => {
      const res = await post(
        baseBody({
          publishing: {
            providers: [' youtube ', 'youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(200);
      const rows = inserts.schedules as Array<{ providers: string[] }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].providers).toEqual(['youtube']);
    });

    it('rejects an empty imageId', async () => {
      const res = await post(baseBody({ options: { imageId: '   ' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.imageId must be a non-empty string.');
      expect(json.field).toBe('options.imageId');
    });

    it('rejects an invalid webhookUrl', async () => {
      const res = await post(baseBody({ options: { webhookUrl: 'ftp://example.com/hook' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.webhookUrl must be a public https URL.');
      expect(json.field).toBe('options.webhookUrl');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it.each([
      ['cleartext http', 'http://example.com/hook'],
      ['a private literal IP', 'https://10.0.0.5/hook'],
      ['localhost', 'https://localhost/hook'],
      ['a malformed value', 'not a url'],
    ])('rejects a webhookUrl with %s before any charge', async (_label, webhookUrl) => {
      const res = await post(baseBody({ options: { webhookUrl } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.webhookUrl must be a public https URL.');
      expect(json.field).toBe('options.webhookUrl');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an empty voiceId', async () => {
      const res = await post(baseBody({ options: { voiceId: '  ' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.voiceId must be a non-empty string.');
      expect(json.field).toBe('options.voiceId');
    });

    it('rejects an over-long scriptPrompt outright (no length cap anymore)', async () => {
      const res = await post(baseBody({ options: { scriptPrompt: 'x'.repeat(2001) } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.scriptPrompt is no longer accepted: scripts come from options.segments only.');
      expect(json.field).toBe('options.scriptPrompt');
    });

    it('rejects an over-long scriptPrompts entry outright (no length cap anymore)', async () => {
      const res = await post(baseBody({ options: { scriptPrompts: ['x'.repeat(2001)] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('options.scriptPrompts is no longer accepted: scripts come from options.segments only.');
      expect(json.field).toBe('options.scriptPrompts');
    });

    it('rejects a failing custom-audio SSRF check', async () => {
      vi.mocked(checkCustomAudioUrl).mockResolvedValueOnce({
        ok: false,
        error: 'audio_url must point to an accessible audio file.',
      });
      const res = await post(baseBody({ options: { audioUrl: 'https://example.com/a.mp3' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('audio_url must point to an accessible audio file.');
      expect(json.field).toBe('options.audioUrl');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an invalid startAt with the startAt field', async () => {
      const res = await post(
        baseBody({
          publishing: {
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: 'not-a-date', times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('publishing.schedule.startAt');
    });

    it('rejects empty times with INVALID_SCHEDULE_TIME', async () => {
      const res = await post(
        baseBody({
          publishing: {
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: [], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_SCHEDULE_TIME');
      expect(json.field).toBe('publishing.schedule.times');
    });

    it('schedules a known-dead account and warns instead of refusing the slot', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1', needs_reconnect: true }],
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'acct-1' }] },
      ]);
      expect(GenerateAndScheduleResponseSchema.safeParse(json).success).toBe(true);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });

    it('500s when the social accounts lookup fails', async () => {
      setup({ ...DEFAULT_CFG, socialAccountsError: true });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a provider with connected accounts but none selected', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
        personaDefaultAccounts: [{ provider: 'instagram', provider_account_id: 'ig-1' }],
      });
      const res = await post(
        baseBody({
          publishing: {
            providers: ['youtube'],
            accounts: {},
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_PROVIDER_ACCOUNT');
      expect(json.error).toBe('Select at least one youtube account bound to this persona.');
      expect(json.field).toBe('publishing.accounts.youtube');
    });

    it('ignores malformed social account rows and keeps the valid ones', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [
          { provider: 'youtube', provider_account_id: 'acct-1' },
          { provider: 'youtube', provider_account_id: 42 as unknown as string },
        ],
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
    });
  });

  describe('persona default publishing accounts (issue #212)', () => {
    const noAccountsBody = () =>
      baseBody({
        publishing: {
          providers: ['youtube'],
          schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
      });

    it('falls back to the persona defaults when publishing.accounts is omitted', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-default' }],
        personaDefaultAccounts: [{ provider: 'youtube', provider_account_id: 'acct-default' }],
      });
      const res = await post(noAccountsBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-default']);
    });

    it('explicit accounts win over the persona defaults', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [
          { provider: 'youtube', provider_account_id: 'acct-1' },
          { provider: 'youtube', provider_account_id: 'acct-default' },
        ],
        personaDefaultAccounts: [
          { provider: 'youtube', provider_account_id: 'acct-1' },
          { provider: 'youtube', provider_account_id: 'acct-default' },
        ],
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-1']);
    });

    it('keeps the 400 when accounts are omitted and the persona has no defaults', async () => {
      setup({ ...DEFAULT_CFG, personaDefaultAccounts: [] });
      const res = await post(noAccountsBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('PERSONA_NO_BOUND_ACCOUNTS');
      expect(json.error).toBe('This persona has no accounts bound. Bind at least one account before scheduling.');
    });

    it('does not consult persona defaults for voiceover posts without a persona', async () => {
      setup(DEFAULT_CFG);
      const res = await post(
        baseBody({
          personaId: null,
          options: { videoType: 'voiceover' },
          publishing: {
            providers: ['youtube'],
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  describe('persona account binding (issue #572)', () => {
    it('rejects an owned account the persona is not bound to, before any charge', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [
          { provider: 'youtube', provider_account_id: 'acct-1' },
          { provider: 'youtube', provider_account_id: 'acct-other' },
        ],
        personaDefaultAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
      });
      const res = await post(
        baseBody({ publishing: { providers: ['youtube'], accounts: { youtube: ['acct-other'] }, schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' } } }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('ACCOUNT_NOT_BOUND_TO_PERSONA');
      expect(json.error).toBe('Selected youtube account is not bound to this persona.');
      expect(json.field).toBe('publishing.accounts.youtube');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects explicit accounts when the persona has zero bound accounts', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
        personaDefaultAccounts: [],
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('ACCOUNT_NOT_BOUND_TO_PERSONA');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a provider the persona is not bound to when accounts are omitted for it', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [
          { provider: 'youtube', provider_account_id: 'acct-1' },
          { provider: 'instagram', provider_account_id: 'ig-1' },
        ],
        personaDefaultAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
      });
      const res = await post(
        baseBody({
          publishing: {
            providers: ['youtube', 'instagram'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_PROVIDER_ACCOUNT');
      expect(json.error).toBe('Select at least one instagram account bound to this persona.');
      expect(json.field).toBe('publishing.accounts.instagram');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('does not apply the binding check to voiceover posts without a persona', async () => {
      setup({
        ...DEFAULT_CFG,
        socialAccounts: [{ provider: 'youtube', provider_account_id: 'acct-1' }],
        personaDefaultAccounts: [],
      });
      const res = await post(
        baseBody({
          personaId: undefined,
          options: { videoType: 'voiceover', voiceId: 'chatterbox:kokoro_af_heart', segments: UNMARKED_SEGMENTS },
          publishing: {
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });
  });

  describe('persona branches (mutation hardening)', () => {
    it('rejects a persona niche over 300 characters', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, niche: 'x'.repeat(301) } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Persona niche must be at most 300 characters: update the persona.');
      expect(json.field).toBe('personaId');
    });

    it('rejects a persona language over 35 characters', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, language: 'x'.repeat(36) } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Persona language must be at most 35 characters: update the persona.');
      expect(json.field).toBe('personaId');
    });

    it('rejects a non-English persona language (English-only launch)', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, language: 'pt' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Only English videos are supported for now.');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('accepts a non-English persona when the request overrides the language with English', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, language: 'pt' } });
      const res = await post(baseBody({ options: { language: 'en' } }));
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_language).toBe('en');
    });

    it('rejects an out-of-range paragraph_number', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, paragraph_number: 11 } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Persona paragraph_number must be an integer between 1 and 10: update the persona.');
      expect(json.field).toBe('personaId');
    });

    it('rejects a non-integer paragraph_number', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, paragraph_number: 2.5 } });
      const res = await post(baseBody());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('personaId');
    });

    it('rejects a stored avatar_url the engine cannot use, before any charge', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'characters/ana.png' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Persona image URL must be a valid http(s) URL or a data:image/ URI: update the persona.');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts.schedules).toBeUndefined();
      expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
      expect(vi.mocked(trackApiEvent)).toHaveBeenCalledWith(
        'video_creation_validation_failed',
        expect.objectContaining({ errorCode: 'VALIDATION_FAILED', field: 'personaId' }),
      );
    });

    it('rejects a non-http(s) avatar_url scheme before any charge', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'ftp://cdn.example/avatar.png' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an avatar_url pointing at a private literal IP before any charge', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'http://127.0.0.1/avatar.png' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a data:image avatar_url without a payload separator', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'data:image/png;base64' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('accepts a data:image avatar_url and forwards it to the engine unchanged', async () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: dataUri } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe(dataUri);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });

    it('accepts a valid https avatar_url and forwards it to the engine unchanged', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'https://cdn.example/hosted-avatar.jpg' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe('https://cdn.example/hosted-avatar.jpg');
    });

    it('does not validate the persona image for voiceover posts', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'not-a-url' } });
      const res = await post(baseBody({ options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(200);
    });

    it('does not validate the persona image when a library image is pinned', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'not-a-url' } });
      vi.mocked(resolveVideoImage).mockResolvedValue({
        ok: true,
        image: { id: 'img-1', image_path: 'library/img-1.png' } as never,
      });
      const res = await post(baseBody({ options: { imageId: 'img-1' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe('https://cdn.example/signed');
    });

    it('503s when the persona voice audio cannot be signed', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_audio_path: 'voice.wav', voice_id: null },
        signUrlError: true,
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(503);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe(
        'Voice audio is configured for this persona but could not be loaded. Please try again.',
      );
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('503s when voice signing throws', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_audio_path: 'voice.wav', voice_id: null },
        signUrlThrows: true,
      });
      const res = await post(baseBody());
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
    });

    it('uses the signed persona voice audio in the engine payload', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_audio_path: 'voice.wav', voice_id: null },
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { voice_audio_url?: string; voice_id?: string };
      };
      expect(payload.persona.voice_audio_url).toBe('https://cdn.example/signed');
      expect(payload.persona.voice_id).toBeUndefined();
    });

    it('prefers the per-request audioUrl over the persona voice', async () => {
      const res = await post(baseBody({ options: { audioUrl: 'https://example.com/custom.mp3' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { voice_audio_url?: string; voice_id?: string };
      };
      expect(payload.persona.voice_audio_url).toBe('https://example.com/custom.mp3');
      expect(payload.persona.voice_id).toBeUndefined();
    });

    it('swaps a persona with no voice configured for the language default (issue #277)', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: null } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
      expect(GenerateAndScheduleResponseSchema.safeParse(json).success).toBe(true);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      const enginePersona = payload.persona as Record<string, unknown>;
      expect(enginePersona.voice_id).toBe('chatterbox:kokoro_af_heart');
      const swapUpdate = updates.find((u) => u.table === 'personas');
      expect(swapUpdate?.fields).toEqual({ voice_id: 'chatterbox:kokoro_af_heart' });
    });

    it('swaps an unrouteable persona voice for the language default and reports the swap', async () => {
      vi.mocked(getPostHogServer).mockReturnValue(recordingClient as never);
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: 'energetic', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox:kokoro_af_heart');
      const swapUpdate = updates.find((u) => u.table === 'personas');
      expect(swapUpdate?.fields).toEqual({ voice_id: 'chatterbox:kokoro_af_heart' });
      expect(capturedEvents.filter((entry) => entry.event === 'voice_fallback_applied')).toEqual([
        {
          distinctId: USER_ID,
          event: 'voice_fallback_applied',
          properties: {
            from_voice: 'energetic',
            to_voice: 'chatterbox:kokoro_af_heart',
            reason: 'unknown_voice',
            from_voice_present: true,
          },
        },
      ]);
    });

    it('scrubs credential fragments out of from_voice before the PostHog capture', async () => {
      vi.mocked(getPostHogServer).mockReturnValue(recordingClient as never);
      setup({
        ...DEFAULT_CFG,
        persona: {
          ...PERSONA,
          voice_id: `https://user:hunter2@voices.example/${'v'.repeat(520)}?api_key=supersecretvalue`,
        },
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const events = capturedEvents.filter((entry) => entry.event === 'voice_fallback_applied');
      expect(events).toHaveLength(1);
      const event = events[0];
      if (event === undefined) {
        throw new Error('expected a voice_fallback_applied capture');
      }
      const properties = event.properties;
      if (properties === undefined) {
        throw new Error('expected capture properties');
      }
      const fromVoice = String(properties.from_voice);
      expect(fromVoice).not.toContain('hunter2');
      expect(fromVoice).not.toContain('supersecretvalue');
      expect(fromVoice).toContain('[redacted]');
      expect(fromVoice.length).toBeLessThanOrEqual(500);
      expect(fromVoice.length).toBe(500);
      expect(event.distinctId).toBe(USER_ID);
    });

    it('keeps the gender a legacy -Female suffix spells out', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'zh-CN-XiaoyiNeural-Female' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: 'zh-CN-XiaoyiNeural-Female', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
    });

    it('swaps a male-suffixed legacy voice for the male default', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'default-Male' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: 'default-Male', toVoice: 'chatterbox:kokoro_am_michael' },
      ]);
    });

    it('survives a THROWING persist: the dispatch proceeds with the swapped voice (review MINOR)', async () => {
      vi.mocked(getPostHogServer).mockReturnValue(recordingClient as never);
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: null }, updateThrowsTables: ['personas'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
      expect(GenerateAndScheduleResponseSchema.safeParse(json).success).toBe(true);
      expect(updates.some((u) => u.table === 'personas')).toBe(true);
    });

    it('survives a throwing PostHog captureAs after a successful persist', async () => {
      vi.mocked(getPostHogServer).mockReturnValue({
        captureAs: () => {
          throw new Error('posthog down');
        },
      } as never);
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: 'energetic', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
    });

    it('does not persist a voice swap when spend returns spent !== true', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_id: 'energetic' },
        spend: { spent: false, balance: 2 },
      });
      const res = await post(baseBody());
      expect(res.status).toBe(402);
      expect(updates.filter((row) => row.table === 'personas')).toEqual([]);
    });

    it('survives a persist ERROR object the same way (no throw, warning kept)', async () => {
      vi.mocked(getPostHogServer).mockReturnValue(recordingClient as never);
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: null }, updateErrorTables: ['personas'] });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      expect((await res.json()).warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
    });

    it('rejects an explicit per-request voice the engine cannot route (400 before any charge)', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody({ options: { voiceId: 'also-invalid' } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('UNKNOWN_VOICE');
      expect(json.field).toBe('options.voiceId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
      expect(updates.find((u) => u.table === 'personas')).toBeUndefined();
    });

    it('passes an explicit valid per-request voice through untouched (no swap, no warning)', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody({ options: { voiceId: 'chatterbox:kokoro_af_heart' } }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.warnings).toBeUndefined();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox:kokoro_af_heart');
      expect(updates.find((u) => u.table === 'personas')).toBeUndefined();
    });

    it('swaps an unavailable clone for the language default', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb' },
        cloneReady: false,
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.warnings).toEqual([
        {
          code: 'voice_fallback_applied',
          fromVoice: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
          toVoice: 'chatterbox:kokoro_af_heart',
        },
      ]);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox:kokoro_af_heart');
      const swapUpdate = updates.find((u) => u.table === 'personas');
      expect(swapUpdate?.fields).toEqual({ voice_id: 'chatterbox:kokoro_af_heart' });
    });

    it('dispatches a ready clone untouched, with no swap and no warning', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb' },
        cloneReady: true,
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.warnings).toBeUndefined();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb');
      expect(updates.find((u) => u.table === 'personas')).toBeUndefined();
      expect(capturedEvents.filter((entry) => entry.event === 'voice_fallback_applied')).toEqual([]);
    });

    it('keeps the clone when the availability lookup FAILS: fail open into the engine guard', async () => {
      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb' },
        cloneReadyError: true,
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb');

      setup({
        ...DEFAULT_CFG,
        persona: { ...PERSONA, voice_id: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb' },
        cloneReadyThrows: true,
      });
      const second = await post(baseBody());
      expect(second.status).toBe(200);
      const secondPayload = vi.mocked(startEngineVideoTask).mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect((secondPayload.persona as Record<string, unknown>).voice_id).toBe('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb');
    });

    it('404s with the pinned-image status when the pinned image cannot be resolved', async () => {
      vi.mocked(resolveVideoImage).mockResolvedValueOnce({ ok: false, error: 'image gone', status: 404 });
      const res = await post(baseBody({ options: { imageId: 'img-1' } }));
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('image gone');
      expect(json.field).toBe('options.imageId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('swaps a house voice the served catalog no longer lists before the engine call', async () => {
      vi.mocked(fetchPersonaVoiceCatalogIds).mockResolvedValueOnce(
        new Set(['chatterbox:kokoro_af_heart', 'chatterbox:kokoro_am_michael']),
      );
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'chatterbox:retired_house' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.warnings).toEqual([
        {
          code: 'voice_fallback_applied',
          fromVoice: 'chatterbox:retired_house',
          toVoice: 'chatterbox:kokoro_af_heart',
        },
      ]);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('chatterbox:kokoro_af_heart');
      expect(updates.find((u) => u.table === 'personas')?.fields).toEqual({
        voice_id: 'chatterbox:kokoro_af_heart',
      });
    });

    it('does not persist a voice swap when a later validation still 400s', async () => {
      vi.mocked(resolveVideoImage).mockResolvedValueOnce({ ok: false, error: 'image gone', status: 404 });
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody({ options: { imageId: 'img-1' } }));
      expect(res.status).toBe(404);
      expect(updates.find((u) => u.table === 'personas')).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });
  });

  describe('spend and insert branches (mutation hardening)', () => {
    it('replays on a spend 23505 that names the generation constraint', async () => {
      setup({
        ...DEFAULT_CFG,
        spendErrorCode: '23505',
        spendErrorMessage:
          'duplicate key value violates unique constraint "token_transactions_generation_id_key"',
        replaySlots: [
          { id: 'slot-0', slot_at: futureISO(49), title: 'Porto trip', task_id: 'task-1', status: 'generating' },
        ],
      });
      const res = await post(baseBody({ idempotencyKey: 'spend-race-key' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.slots).toHaveLength(1);
      expect(json.slots[0]).toMatchObject({ slotId: 'slot-0', title: 'Porto trip', taskId: 'task-1' });
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    });

    it('500s when the spend-conflict replay fetch fails', async () => {
      setup({
        ...DEFAULT_CFG,
        spendErrorCode: '23505',
        spendErrorMessage:
          'duplicate key value violates unique constraint "token_transactions_generation_id_key"',
        replaySlotsError: true,
      });
      const res = await post(baseBody({ idempotencyKey: 'spend-race-broken-key' }));
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.replayed).toBeUndefined();
    });

    it('classifies the persona-owner constraint out of the error details field', async () => {
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertDetails:
          'Key (persona_id)=(persona-1) already exists. duplicate key value violates unique constraint "schedules_persona_owner"',
      });
      const res = await post(baseBody({ idempotencyKey: 'details-constraint-key' }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('PERSONA_ALREADY_SCHEDULED');
      expect(json.replayed).toBeUndefined();
    });

    it('refunds and 500s on a bare 23505 with no constraint name (violatedConstraint null)', async () => {
      setup({ ...DEFAULT_CFG, scheduleInsertErrorCode: '23505' });
      const res = await post(baseBody({ idempotencyKey: 'bare-23505-key' }));
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(1);
    });

    it('still 409s when the persona-owner refund fails', async () => {
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_persona_owner',
        refundBatchErrorCode: 'XX000',
      });
      const res = await post(baseBody({ idempotencyKey: 'owner-refund-fail-key' }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('PERSONA_ALREADY_SCHEDULED');
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(1);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        '[generate-and-schedule] persona-already-scheduled refund failed',
        expect.anything(),
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('rolls back the schedule and refunds when the slot insert fails', async () => {
      setup({ ...DEFAULT_CFG, slotInsertFails: true });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(deletes).not.toContain('scheduled_posts');
      expect(deletes).toContain('schedules');
      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_reason).toBe('Unified generate+schedule: slot insert failed; tokens refunded');
      expect(refunds[0].args.p_amount).toBe(2);
      expect(String(refunds[0].args.p_refund_key)).toMatch(/^batch:.*:rollback:/);
    });

    it('uses a fresh rollback refund key on each attempt', async () => {
      setup({
        ...DEFAULT_CFG,
        ledgerRows: [
          { id: 'tx-spend', type: 'video_generation', amount: -2 },
          rollbackRefund('rollback-key-freshness', 2),
        ],
        slotInsertFails: true,
      });
      const body = baseBody({ idempotencyKey: 'rollback-key-freshness' });
      const first = await post(body);
      expect((await first.json()).code).toBe('INTERNAL_ERROR');
      const second = await post(body);
      expect((await second.json()).code).toBe('INTERNAL_ERROR');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(2);
      const keys = rpcCalls
        .filter((c) => c.name === 'refund_batch_tokens')
        .map((c) => String(c.args.p_refund_key));
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(/^batch:.*:rollback:/);
      expect(keys[1]).toMatch(/^batch:.*:rollback:/);
      expect(keys[0]).not.toBe(keys[1]);
    });
  });

  describe('dispatch branches (mutation hardening)', () => {
    it("marks the slot bind_failed when the task_id bind errors", async () => {
      setup({ ...DEFAULT_CFG, updateErrorTables: ['scheduled_posts'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.slots).toHaveLength(1);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: null, status: 'failed', errorCode: 'bind_failed' });
      expect(vi.mocked(startEngineVideoTask)).toHaveBeenCalledTimes(1);
    });

    it('marks the slot engine_unavailable when the engine has no upstream status', async () => {
      setup({ ...DEFAULT_CFG, engineUnavailableSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', errorCode: 'engine_unavailable' });
    });

    it('marks the slot image_resolve_failed when dispatch-time resolution fails', async () => {
      vi.mocked(resolveVideoImage).mockResolvedValue({ ok: false, error: 'library down', status: 500 });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', errorCode: 'image_resolve_failed' });
    });

    it('marks the slot image_sign_failed when the selected image cannot be signed', async () => {
      setup({ ...DEFAULT_CFG, signUrlError: true });
      vi.mocked(resolveVideoImage).mockResolvedValue({
        ok: true,
        image: { id: 'img-1', image_path: 'library/img-1.png' } as never,
      });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', errorCode: 'image_sign_failed' });
    });

    it('rejects a face-mode request with 400 when no face source exists (pre-charge photo check)', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: null, photo_path: null } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.videoType');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });



    it('rejects a full lip-sync photo without a face with 400 before any charge', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: null, photo_path: 'personas/user-1/photo.jpg' } });
      vi.mocked(resolveVideoImage).mockResolvedValue({ ok: true, image: null });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          String(url).includes('/api/v1/media/check')
            ? new Response(
              JSON.stringify({ status: 200, body: { code: 'ok', width: 1080, height: 1920, has_face: false } }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
            : new Response(JSON.stringify({ status: 200, body: { audio_duration_seconds: 51 } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      );
      const res = await post(baseBody({ options: { videoType: 'full_lipsync', segments: NO_MEDIA_SEGMENTS, lipsyncPhotos: [{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.lipsyncPhotos.0');
      expect(json.error).toContain('options.lipsyncPhotos.0 has no detectable face');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('marks the slot no_task_id when the engine accepts without a task id', async () => {
      setup({ ...DEFAULT_CFG, engineNoTaskIdSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', errorCode: 'no_task_id' });
    });

    it('records tokensRefunded false when the per-slot refund fails', async () => {
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'], refundBatchErrorCode: 'XX000' });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', tokensRefunded: false });
      expect(capturedEvents.filter((entry) => entry.event === 'refund_issued')).toEqual([]);
      const failedCall = vi
        .mocked(recordGenerationUpdate)
        .mock.calls.find((call) => (call[0] as { status?: string }).status === 'failed');
      expect(failedCall).toBeDefined();
      expect(failedCall?.[0]).toMatchObject({ tokensRefunded: false });
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        '[generate-and-schedule] per-slot refund failed',
        expect.anything(),
        expect.objectContaining({ userId: USER_ID }),
      );
    });
  });

  describe('dispatch success branches (mutation hardening)', () => {
    it('records the picked library image in the anti-repeat history', async () => {
      setup({ ...DEFAULT_CFG });
      vi.mocked(resolveVideoImage).mockResolvedValue({
        ok: true,
        image: { id: 'img-7', image_path: 'library/img-7.png' } as never,
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      expect(vi.mocked(recordRecentImageId)).toHaveBeenCalledWith(
        expect.anything(),
        'persona-1',
        'img-7',
        USER_ID,
      );
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe('https://cdn.example/signed');
    });

    it('signs the legacy photo_path when no avatar_url exists', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: null, photo_path: 'legacy/photo.png' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe('https://cdn.example/signed');
    });

    it('re-hosts a relative house-character avatar so the engine can fetch it', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: '/caracter-samples/file-3.png', photo_path: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      expect(vi.mocked(ensureEngineImageUrl)).toHaveBeenCalledWith(
        '/caracter-samples/file-3.png',
        expect.objectContaining({ userId: USER_ID }),
      );
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { photo_url?: string };
      };
      expect(payload.persona.photo_url).toBe('https://cdn.example/hosted.png');
    });

    it('falls back to "Persona" when the persona row has no name', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, name: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as {
        persona: { name?: string };
      };
      expect(payload.persona.name).toBe('Persona');
    });

    it('trims the title before storing and dispatching', async () => {
      const res = await post(baseBody({ title: '  Porto trip  ' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.slots[0].title).toBe('Porto trip');
      const slotRows = inserts.scheduled_posts as Array<{ title: string }>;
      expect(slotRows.map((r) => r.title)).toEqual(['Porto trip']);
    });

    it('sorts and dedupes schedule times on insert', async () => {
      const res = await post(
        baseBody({
          publishing: {
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['19:00', '18:00', '19:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(200);
      const rows = inserts.schedules as Array<{ times: string[] }>;
      expect(rows[0].times).toEqual(['18:00', '19:00']);
    });

    it('tracks tasks_created with accepted and failed counts', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      expect(vi.mocked(trackApiEvent)).toHaveBeenCalledWith(
        'video_tasks_created',
        expect.objectContaining({ tasksAccepted: 1, tasksFailed: 0 }),
      );
      const completed = vi
        .mocked(trackApiEvent)
        .mock.calls.find((call) => call[0] === 'video_creation_completed');
      expect(completed).toBeDefined();
      expect((completed?.[1] as { durationMs: number }).durationMs).toBeLessThan(60_000);
    });
  });

  describe('auth and rate-limit branches (mutation hardening)', () => {
    it('returns the auth error when the session is missing', async () => {
      const authError = NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      vi.mocked(requireSupabaseSession).mockResolvedValueOnce({ auth: null, error: authError } as never);
      const res = await post(baseBody());
      expect(res.status).toBe(401);
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('defaults Retry-After to 60 when the limiter omits the header', async () => {
      vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }));
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(429);
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.headers.get('Retry-After')).toBe('60');
    });

    it('500s on a non-unique spend failure', async () => {
      setup({ ...DEFAULT_CFG, spendErrorCode: 'XX000' });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_batch_tokens')).toHaveLength(0);
    });
  });

  describe('post without a persona (migration 012)', () => {
    it('rejects a persona-less post that is not voiceover', async () => {
      const res = await post(baseBody({ personaId: undefined, options: {} }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.videoType');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a persona-less post with no voice', async () => {
      const res = await post(baseBody({ personaId: undefined, options: { videoType: 'voiceover' } }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.voiceId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects options.language over 32 characters', async () => {
      const res = await post(baseBody({ options: { language: 'x'.repeat(33) } }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.language');
    });

    it('rejects a non-English options.language (English-only launch)', async () => {
      const res = await post(baseBody({ options: { language: 'pt-BR' } }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.error).toBe('Only English videos are supported for now.');
      expect(json.field).toBe('options.language');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('accepts English regional variants in options.language', async () => {
      const res = await post(baseBody({ options: { language: 'en-GB' } }));
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_language).toBe('en-GB');
    });

    it('rejects options.niche over 300 characters', async () => {
      const res = await post(baseBody({ options: { niche: 'x'.repeat(301) } }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.niche');
    });

    it('treats an empty-string personaId as a persona-less post', async () => {
      const res = await post(baseBody({ personaId: '', options: { videoType: 'voiceover', voiceId: 'chatterbox:kokoro_af_heart', segments: UNMARKED_SEGMENTS } }));
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].persona_id).toBeNull();
    });

    it('creates a persona-less schedule with persona_id null and the identity snapshot', async () => {
      const res = await post(
        baseBody({
          personaId: undefined,
          options: {
            videoType: 'voiceover',
            voiceId: 'chatterbox:kokoro_af_heart',
            language: 'en',
            niche: 'comedy',
            videoAspect: '16:9',
            paragraphNumber: 3,
            segments: UNMARKED_SEGMENTS,
          },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].persona_id).toBeNull();
      expect(scheduleRows[0].post_voice_id).toBe('chatterbox:kokoro_af_heart');
      expect(scheduleRows[0].post_language).toBe('en');
      expect(scheduleRows[0].post_niche).toBe('comedy');
      expect(scheduleRows[0].post_video_aspect).toBe('16:9');
      expect(scheduleRows[0].post_paragraph_number).toBe(3);
      expect(scheduleRows[0]).not.toHaveProperty('post_script_prompt');
      expect(scheduleRows[0].post_cta_type).toBeNull();
      expect(scheduleRows[0].post_cta_url).toBeNull();
      expect(scheduleRows[0].post_cta_instruction).toBeNull();
      expect(scheduleRows[0].post_face_quality).toBe('ok');

      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      const persona = payload.persona as Record<string, unknown>;
      expect(persona.name).toBe('Post');
      expect(persona.voice_id).toBe('chatterbox:kokoro_af_heart');
      expect(payload.video_language).toBe('en');
      expect(payload.video_aspect).toBe('16:9');
      expect(payload.paragraph_number).toBe(3);
      expect(payload.video_type).toBe('voiceover');
    });

    it('accepts a square 1:1 videoAspect: it is a product aspect, not just an engine one', async () => {
      const res = await post(
        baseBody({
          personaId: undefined,
          options: {
            videoType: 'voiceover',
            voiceId: 'chatterbox:kokoro_af_heart',
            language: 'en',
            niche: 'comedy',
            videoAspect: '1:1',
            paragraphNumber: 3,
            segments: UNMARKED_SEGMENTS,
          },
        }),
      );
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_video_aspect).toBe('1:1');
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_aspect).toBe('1:1');
    });

    it('skips the persona scope check for a persona-less post', async () => {
      vi.mocked(isPersonaAllowed).mockReturnValue(false);
      const res = await post(baseBody({ personaId: undefined, options: { videoType: 'voiceover', voiceId: 'chatterbox:kokoro_af_heart', segments: UNMARKED_SEGMENTS } }));
      expect(res.status).toBe(200);
      expect(vi.mocked(isPersonaAllowed)).not.toHaveBeenCalled();
    });

    it('snapshots the audioUrl for a persona-less audio post so the engine tick can resolve its voice', async () => {
      const res = await post(
        baseBody({
          personaId: undefined,
          options: { videoType: 'voiceover', audioUrl: 'https://example.com/voice.mp3', segments: UNMARKED_SEGMENTS },
        }),
      );
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].persona_id).toBeNull();
      expect(scheduleRows[0].post_voice_id).toBeNull();
      expect(scheduleRows[0].post_voice_audio_url).toBe('https://example.com/voice.mp3');
    });

    it('does not snapshot a signed voice URL for a persona-backed audio-voice post', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: 'u/v.mp3' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_voice_audio_url).toBeNull();
      expect(scheduleRows[0].post_voice_id).toBeNull();
    });

    it('charges the voiceover rate and never touches library images for a persona-less post', async () => {
      const res = await post(baseBody({ personaId: undefined, options: { videoType: 'voiceover', voiceId: 'chatterbox:kokoro_af_heart', segments: UNMARKED_SEGMENTS } }));
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(1);
      expect(vi.mocked(resolveVideoImage)).not.toHaveBeenCalled();
      expect(vi.mocked(recordRecentImageId)).not.toHaveBeenCalled();
    });

    it('snapshots a null video_aspect when the persona has none', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, video_aspect: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].post_video_aspect).toBeNull();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('video_aspect');
    });

    it('prefers per-request editorial fields over the persona values', async () => {
      const res = await post(
        baseBody({
          options: { niche: 'tech', language: 'en-US', videoAspect: '16:9', paragraphNumber: 2 },
        }),
      );
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_niche).toBe('tech');
      expect(scheduleRows[0].post_language).toBe('en-US');
      expect(scheduleRows[0].post_video_aspect).toBe('16:9');
      expect(scheduleRows[0].post_paragraph_number).toBe(2);
      expect(scheduleRows[0]).not.toHaveProperty('post_script_prompt');
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_language).toBe('en-US');
      expect(payload.video_aspect).toBe('16:9');
      expect(payload.paragraph_number).toBe(2);
    });
  });

  describe('persona call to action', () => {
    it('snapshots the persona CTA intent and sends only its type to the engine', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'link', cta_url: 'https://example.com/course', cta_instruction: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_cta_type).toBe('link');
      expect(scheduleRows[0].post_cta_url).toBe('https://example.com/course');
      expect(scheduleRows[0].post_cta_instruction).toBeNull();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.cta_type).toBe('link');
      expect(payload).not.toHaveProperty('video_cta');
    });

    it('a stored empty URL fact snapshots as null, never an empty string', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'link', cta_url: '', cta_instruction: '' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_cta_type).toBe('link');
      expect(scheduleRows[0].post_cta_url).toBeNull();
      expect(scheduleRows[0].post_cta_instruction).toBeNull();
    });

    it('a per-video override wins over the persona CTA', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'follow', cta_url: null, cta_instruction: null } });
      const res = await post(baseBody({ cta: { type: 'comment' }, options: { segments: DEFAULT_SEGMENTS.map((segment) => (segment.cta ? { ...segment, text: 'What did your first trip to Porto taste like?' } : segment)) } }));
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_cta_type).toBe('comment');
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.cta_type).toBe('comment');
    });

    it('a null per-video override disables the CTA: no snapshot, no engine field, no 400', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'follow', cta_url: null, cta_instruction: null } });
      const res = await post(baseBody({ cta: null, options: { segments: UNMARKED_SEGMENTS } }));
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_cta_type).toBeNull();
      expect(scheduleRows[0].post_cta_url).toBeNull();
      expect(scheduleRows[0].post_cta_instruction).toBeNull();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('cta_type');
    });

    it('400s before any charge when a CTA applies but no take is marked', async () => {
      const res = await post(baseBody({ options: { segments: UNMARKED_SEGMENTS } }));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { field?: string; error?: string };
      expect(json.field).toBe('options.segments');
      expect(String(json.error)).toContain('cta: true');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('400s before any charge when a comment CTA take has no question', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'comment', cta_url: null, cta_instruction: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(400);
      const json = (await res.json()) as { field?: string; error?: string };
      expect(json.field).toBe('options.segments');
      expect(String(json.error)).toContain('must ask a question');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('400s before any charge when the hook is the marked take', async () => {
      const hookMarked = DEFAULT_SEGMENTS.map((segment) =>
        segment.kind === 'hook' ? { ...segment, cta: true } : { ...segment, cta: undefined },
      );
      const res = await post(baseBody({ options: { segments: hookMarked } }));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { field?: string; error?: string };
      expect(json.field).toBe('options.segments');
      expect(String(json.error)).toContain('hook cannot be the CTA take');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('400s before any charge when a take is marked but the CTA is disabled', async () => {
      const res = await post(baseBody({ cta: null }));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { field?: string; error?: string };
      expect(json.field).toBe('options.segments');
      expect(String(json.error)).toContain('CTA is disabled');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
      expect(inserts['schedules']).toBeUndefined();
    });

    it('editing the persona after scheduling does not rewrite the snapshot', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'link', cta_url: 'https://example.com/course', cta_instruction: null } });
      const first = await post(baseBody());
      expect(first.status).toBe(200);
      const firstRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(firstRows).toHaveLength(1);
      expect(firstRows[0].post_cta_type).toBe('link');
      expect(firstRows[0].post_cta_url).toBe('https://example.com/course');
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_type: 'comment', cta_url: null, cta_instruction: null } });
      const second = await post(baseBody({ title: 'Porto food', options: { segments: DEFAULT_SEGMENTS.map((segment) => (segment.cta ? { ...segment, text: 'What did your first trip to Porto taste like?' } : segment)) } }));
      expect(second.status).toBe(200);
      const secondRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(secondRows).toHaveLength(1);
      expect(secondRows[0].post_cta_type).toBe('comment');
      expect(secondRows[0].post_cta_url).toBeNull();
      expect(firstRows[0].post_cta_type).toBe('link');
      expect(firstRows[0].post_cta_url).toBe('https://example.com/course');
    });
  });

  describe('asap publish mode', () => {
    const asapBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
      baseBody({
        publishing: {
          mode: 'asap',
          providers: ['youtube'],
          accounts: { youtube: ['acct-1'] },
        },
        ...overrides,
      });

    it('publishes without a schedule: slots land at ~now, no window check', async () => {
      const before = Date.now();
      const res = await post(asapBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.schedule.mode).toBe('asap');
      expect(json.slots).toHaveLength(1);

      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      for (const row of slotRows) {
        const at = new Date(row.slot_at as string).getTime();
        expect(at).toBeGreaterThanOrEqual(before - 1000);
        expect(at).toBeLessThanOrEqual(Date.now() + 1000);
      }

      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].publish_mode).toBe('asap');
      expect(scheduleRows[0].times).toEqual([]);
    });

    it('replay preserves the asap publish mode', async () => {
      const key = 'idem-asap-1';
      const first = await post(asapBody({ idempotencyKey: key }));
      expect((await first.json()).replayed).toBe(false);
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);

      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        existingSchedulePublishMode: 'asap',
        replaySlots: [
          { id: 'slot-0', slot_at: new Date().toISOString(), title: 'Porto trip', task_id: 'task-1', status: 'generating' },
        ],
      });
      const second = await post(asapBody({ idempotencyKey: key }));
      const json = await second.json();
      expect(second.status).toBe(200);
      expect(json.replayed).toBe(true);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.schedule.mode).toBe('asap');
    });

    it('rejects a schedule payload combined with asap mode (no silent ignore)', async () => {
      const res = await post(
        asapBody({
          publishing: {
            mode: 'asap',
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('publishing.schedule');
    });

    it('rejects an unknown publish mode', async () => {
      const res = await post(
        baseBody({
          publishing: {
            mode: 'someday',
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('publishing.mode');
    });

    it('requires providers and accounts in asap mode too', async () => {
      const res = await post(asapBody({ publishing: { mode: 'asap', providers: [], accounts: {} } }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.field).toBe('publishing.providers');
    });

    it('charges the same per-video cost in asap mode', async () => {
      const res = await post(asapBody());
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(2);
    });

    it('defaults to scheduled and persists publish_mode=scheduled', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.schedule.mode).toBe('scheduled');
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].publish_mode).toBe('scheduled');
    });

    it('accepts an explicit scheduled mode with a schedule', async () => {
      const res = await post(
        baseBody({
          publishing: {
            mode: 'scheduled',
            providers: ['youtube'],
            accounts: { youtube: ['acct-1'] },
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.schedule.mode).toBe('scheduled');
    });

    it('still requires a schedule in scheduled mode', async () => {
      const res = await post(
        baseBody({
          publishing: { mode: 'scheduled', providers: ['youtube'], accounts: { youtube: ['acct-1'] } },
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.field).toBe('publishing.schedule');
    });
  });
});

describe('segments-only contract (Phase 4)', () => {
  const hook =
    'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
  const contentText =
    'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
  const ctaTake = 'Save this video before your next trip to Porto.';
  const segments = [
    { kind: 'hook', text: hook, media: [0, 1, 2, 3, 4].map((photo) => ({ url: `https://e.com/h${photo}.jpg` })) },
    {
      kind: 'content',
      text: contentText,
      media: [0, 1, 2, 3, 4, 5, 6, 7].map((photo) => ({ url: `https://e.com/b${photo}.jpg` })),
    },
    { kind: 'content', text: ctaTake, cta: true, media: [0, 1].map((photo) => ({ url: `https://e.com/c${photo}.jpg` })) },
  ];
  function singleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base: Record<string, unknown> = {
      personaId: 'persona-1',
      title: 'Porto trip',
      description: 'Agent description.',
      publishing: {
        providers: ['youtube'],
        accounts: { youtube: ['acct-1'] },
        schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
      },
      options: { videoType: 'hook_lipsync', segments },
    };
    return { ...base, ...overrides };
  }

  it('rejects a topics key with 400 naming the field and the fix, before any charge', async () => {
    const res = await post({ ...singleBody(), topics: ['Porto trip'] });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.field).toBe('topics');
    expect(String(json.error ?? json.message ?? '')).toMatch(/title/i);
    expect(String(json.error ?? json.message ?? '')).toMatch(/segments/i);
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('rejects a missing title with 400 naming title', async () => {
    const body = singleBody();
    delete body.title;
    const res = await post(body);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(String(json.field)).toContain('title');
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('rejects an empty title with 400 naming title', async () => {
    const res = await post(singleBody({ title: '   ' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(String(json.field)).toContain('title');
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('rejects missing segments with 400 naming options.segments, before any charge', async () => {
    const res = await post(singleBody({ options: { videoType: 'hook_lipsync' } }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(String(json.field)).toContain('options.segments');
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('creates exactly one slot titled by title, charging one video, with no topics anywhere', async () => {
    const res = await post(singleBody());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toHaveLength(1);
    expect(json.slots[0].title).toBe('Porto trip');
    expect(json.slots[0]).not.toHaveProperty('topic');
    expect(json.slots[0]).not.toHaveProperty('topics');
    const rows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Porto trip');
    expect(rows[0]).not.toHaveProperty('topic');
    const spend = rpcCalls.find((c) => c.name === 'spend_tokens');
    expect(spend?.args.p_amount).toBe(2);
    const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.video_title).toBe('Porto trip');
    expect(payload.video_script).toBe(`${hook}\n\n${contentText}\n\n${ctaTake}`);
  });
});

describe('full lip-sync preflight — pre-charge rejection', () => {
  function stubPreflight(duration: number): void {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/api/v1/media/check')
          ? new Response(
            JSON.stringify({ status: 200, body: { code: 'ok', width: 1080, height: 1920, has_face: true } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
          : new Response(JSON.stringify({ status: 200, body: { audio_duration_seconds: duration } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects a 61s full-mode narration with 400 and charges nothing', async () => {
    stubPreflight(61);
    const res = await post(baseBody({ options: { videoType: 'full_lipsync', segments: NO_MEDIA_SEGMENTS, lipsyncPhotos: [{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }] } }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(String(json.field)).toContain('options.videoType');
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.name.startsWith('refund'))).toHaveLength(0);
    expect(inserts['schedules']).toBeUndefined();
    expect(vi.mocked(startEngineVideoTask)).not.toHaveBeenCalled();
  });

  it('charges and dispatches a full-mode narration at exactly 60s', async () => {
    stubPreflight(60);
    const res = await post(baseBody({ options: { videoType: 'full_lipsync', segments: NO_MEDIA_SEGMENTS, lipsyncPhotos: [{ url: 'https://img.test/face-0.jpg' }, { url: 'https://img.test/face-1.jpg' }] } }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
    expect(vi.mocked(startEngineVideoTask)).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.video_type).toBe('full_lipsync');
  });

  it('skips the narration preflight for non-full videos but still checks segment ratios', async () => {
    const calls: Array<string> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({ status: 200, body: { code: 'ok', width: 1080, height: 1920 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const res = await post(baseBody());
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(16);
    expect(calls.every((url) => url.includes('/api/v1/media/check'))).toBe(true);
    expect(calls.some((url) => url.includes('preflight-duration'))).toBe(false);
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(1);
  });
});

describe('POST /api/videos/generate-and-schedule — prompt version', () => {
  const VERSION_ID = '7b0e6c1e-0000-4000-8000-000000000001';

  it('checks the prompt version and writes it on the slot', async () => {
    const res = await post(baseBody({ promptVersionId: VERSION_ID }));
    expect(res.status).toBe(200);
    expect(vi.mocked(checkPromptVersion).mock.calls[0][1]).toEqual({ versionId: VERSION_ID, userId: USER_ID, allowOwn: true });
    const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
    expect(slotRows[0]).toMatchObject({ prompt_version_id: VERSION_ID });
  });

  it('an unknown or unreadable version is a 404 PROMPT_NOT_FOUND before any charge or insert', async () => {
    vi.mocked(checkPromptVersion).mockResolvedValueOnce('not_found');
    const res = await post(baseBody({ promptVersionId: VERSION_ID }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'PROMPT_NOT_FOUND', field: 'promptVersionId' });
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    expect(inserts['schedules']).toBeUndefined();
  });

  it('a failed version lookup is a 500 INTERNAL_ERROR with no charge', async () => {
    vi.mocked(checkPromptVersion).mockResolvedValueOnce('error');
    const res = await post(baseBody({ promptVersionId: VERSION_ID }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL_ERROR');
    expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('a malformed version id is a 400 before the lookup; no version means no lookup and a null column', async () => {
    const bad = await post(baseBody({ promptVersionId: 'story-first' }));
    expect(bad.status).toBe(400);
    expect(checkPromptVersion).not.toHaveBeenCalled();
    const res = await post(baseBody());
    expect(res.status).toBe(200);
    expect(checkPromptVersion).not.toHaveBeenCalled();
    const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
    expect(slotRows[0]).toMatchObject({ prompt_version_id: null });
  });
});
