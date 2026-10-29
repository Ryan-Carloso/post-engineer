//---------------
// Tests for POST /api/videos/generate-and-schedule.
//
// Supabase (service client), the engine client, the audio SSRF check and
// analytics are mocked boundaries; slot math (distributeSlots), the payload
// builder and zod parsing are real.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  // Rate limiting is bypassed for payload-behavior tests; one dedicated
  // test below covers the 429 path.
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
    // Faithful routing of the real helper: absolute/data URLs pass through,
    // empty input resolves to nothing, a relative site path is re-hosted.
    // The fetch + bucket upload are the part that cannot run in a unit test.
    ensureEngineImageUrl: vi.fn(async (url: string | null | undefined) => {
      const candidate = typeof url === 'string' ? url.trim() : '';
      if (candidate.length === 0) return undefined;
      if (candidate.startsWith('data:image/') || /^https?:\/\//i.test(candidate)) return candidate;
      return 'https://cdn.example/hosted.png';
    }),
  };
});

import { POST } from '../generate-and-schedule/route';
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
  socialAccounts?: Array<{ provider: string; provider_account_id: string }>;
  /** Per-persona default publishing accounts (issue #212). */
  personaDefaultAccounts?: Array<{ provider: string; provider_account_id: string }>;
  existingScheduleId?: string | null;
  /** publish_mode the mocked schedules row carries (replay envelope test). */
  existingSchedulePublishMode?: 'scheduled' | 'asap';
  scheduleLookupError?: boolean;
  replaySlots?: Array<{ id: string; slot_at: string; title: string; task_id: string | null; status: string }>;
  slotCount?: number | null;
  ledgerIds?: string[];
  ledgerError?: boolean;
  spend?: { spent: boolean; balance: number };
  spendErrorCode?: string;
  refundErrorCode?: string;
  scheduleInsertErrorCode?: string;
  /** Constraint named by a 23505 on the schedule insert, mirroring the
   *  Postgres message (`duplicate key value violates unique constraint "…"`). */
  scheduleInsertConstraint?: string;
  /** PostgREST error `details` field for the schedule insert failure; the
   *  route reads the constraint name out of `message + details`. */
  scheduleInsertDetails?: string;
  slotInsertFails?: boolean;
  engineFailSubjects?: string[];
  /** Subjects for which the engine task is unreachable (no upstreamStatus),
   *  exercising the 'engine_unavailable' per-slot code. */
  engineUnavailableSubjects?: string[];
  /** Makes storage.createSignedUrl resolve with an error. */
  signUrlError?: boolean;
  /** Makes storage.createSignedUrl throw. */
  signUrlThrows?: boolean;
  /** Makes the social_accounts lookup fail with a DB error. */
  socialAccountsError?: boolean;
  /** Full message for the spend_tokens RPC failure. */
  spendErrorMessage?: string;
  /** Tables for which update() resolves with an error (bind-failure path). */
  updateErrorTables?: string[];
  /** Tables for which update() THROWS (network crash) — bind-failure paths
   *  must catch it instead of failing the dispatch (voice-swap persist). */
  updateThrowsTables?: string[];
  /** Makes the scheduled_posts replay select fail (fetchReplay error path). */
  replaySlotsError?: boolean;
  /** Subjects for which the engine accepts but returns no task id. */
  engineNoTaskIdSubjects?: string[];
  /** Makes the per-slot refund_batch_tokens RPC fail. */
  refundBatchErrorCode?: string;
  /** Whether the user's cloned_voices table has a ready row (issue #277
   *  clone-availability lookup). Default: no rows. */
  cloneReady?: boolean;
  /** Makes the cloned_voices availability lookup fail / throw (its
   *  fail-open paths must keep the dispatch alive). */
  cloneReadyError?: boolean;
  cloneReadyThrows?: boolean;
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
              data: { id: cfg.existingScheduleId, publish_mode: cfg.existingSchedulePublishMode ?? 'scheduled' },
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
        // Postgres names the constraint in the message of a 23505; the route
        // classifies the failure by that name, so the mock must carry it.
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
          // The clone availability lookup (issue #277) resolves a ready row
          // only when the fixture says so; anything else is unavailable.
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
          return Promise.resolve({ data: (cfg.ledgerIds ?? []).map((id) => ({ id })), error: null }).then(resolve, reject);
        }
        if (name === 'scheduled_posts') {
          if (isCountQuery) {
            // An explicit null pins the DB returning a null count without
            // an error (undefined falls back to the replay fixture length).
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
      if (name === 'refund_batch_tokens' || name === 'refund_generation_tokens') {
        if (name === 'refund_generation_tokens' && cfg.refundErrorCode) {
          return { data: null, error: { code: cfg.refundErrorCode, message: 'refund failed' } };
        }
        if (name === 'refund_batch_tokens' && cfg.refundBatchErrorCode) {
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
    const subject = (payload as { video_subject?: string }).video_subject ?? '';
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
    text: 'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.',
  },
  {
    kind: 'body',
    text: 'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.',
  },
  { kind: 'cta', text: 'Save this video before your next trip to Porto.' },
];

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { options: optionsOverrides, ...rest } = overrides;
  return {
    personaId: 'persona-1',
    title: 'Porto trip',
    publishing: {
      providers: ['youtube'],
      accounts: { youtube: ['acct-1'] },
      schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
    },
    options: { segments: DEFAULT_SEGMENTS, ...((optionsOverrides ?? {}) as Record<string, unknown>) },
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
    it('creates 1 schedule + 1 slot with a bound taskId for the title', async () => {
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.replayed).toBe(false);
      expect(typeof json.schedule.id).toBe('string');
      expect(json.schedule.id.length).toBeGreaterThan(0);      expect(json.slots).toHaveLength(1);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: 'task-Porto trip', status: 'generating' });

      // ONE atomic spend for the whole operation: 1 video x 2 tokens.
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(2);
      expect(spends[0].args.p_user_id).toBe(USER_ID);

      // Schedule row: deterministic id; scheduled_at is the legacy column
      // and the insert pins it NULL. No 'kind' key: the schedules table
      // has no kind column (it never landed in the schema), and inserting
      // an unknown key makes PostgREST reject the whole insert (500).
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0]).not.toHaveProperty('kind');
      expect(scheduleRows[0].scheduled_at).toBeNull();
      expect(scheduleRows[0].posts_per_day).toBe(1);
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-1']);

      // The slot carries the title.
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      expect(slotRows.map((r) => r.title)).toEqual(['Porto trip']);
      expect(slotRows.every((r) => r.status === 'pending')).toBe(true);

      // The slot was flipped to generating with its task_id.
      const binds = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'generating');
      expect(binds).toHaveLength(1);
      expect(binds[0].fields.task_id).toBe('task-Porto trip');
    });

    it('inserts only columns that exist on public.schedules', async () => {
      // Sync test: the supabase-js mock records any payload key, so a
      // speculative key (like the removed 'kind') sailed through tests and
      // 500d every production call — PostgREST rejects unknown keys. Parse
      // the canonical schema AND every migration's added columns, then assert
      // every insert key is a real column, so the next phantom key fails CI
      // instead of production.
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
      // Later migrations add columns with `alter table ... add column if not
      // exists <name>` (e.g. migration 015's publish_mode): those are real
      // columns too.
      const addColumnPattern =
        /alter table public\.schedules\s+add column if not exists\s+([a-z_][a-z0-9_]*)/gi;
      for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
        const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
        for (const match of migrationSql.matchAll(addColumnPattern)) {
          columns.add(match[1]);
        }
      }
      // Sentinel: guards against a degraded parse passing vacuously.
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

    it('charges the faceless rate (1 token/video) and skips image resolution', async () => {
      const res = await post(baseBody({ options: { faceless: true } }));
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends[0].args.p_amount).toBe(1);
      expect(vi.mocked(resolveVideoImage)).not.toHaveBeenCalled();
    });

    it('stores the faceless choice on every slot (the engine prices a slot from it)', async () => {
      // scheduled_posts.faceless is where the per-post choice lives: the
      // engine's batch pipeline reads it when it refunds a failed slot. A
      // slot created without it would be re-priced as a faced video.
      const res = await post(baseBody({ options: { faceless: true, facelessMaterial: 'svg' } }));
      expect(res.status).toBe(200);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      expect(slotRows).toHaveLength(1);
      for (const row of slotRows) {
        expect(row).toMatchObject({ faceless: true, faceless_material: 'svg' });
      }
    });

    it('stores faceless: false and the default broll material for a post with the persona face', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const slotRows = inserts['scheduled_posts'] as Array<Record<string, unknown>>;
      for (const row of slotRows) {
        expect(row).toMatchObject({ faceless: false, faceless_material: 'broll' });
      }
    });

    it('sends lipsync: true and the persona quality as the job resolution', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.lipsync_enabled).toBe(true);
      // The persona's face quality becomes the job resolution.
      expect(payload.video_quality).toBe('ok');
    });

    it('sends generation_id to the engine so PostHog events stay correlatable', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      // recordGenerationStart is mocked, but its recorded input carries the
      // generation_id the route computed for the video_generations row.
      const genInput = vi.mocked(recordGenerationStart).mock.calls[0][0] as { generationId: string };
      // The engine payload carries the same generation_id: the engine tags
      // its PostHog events with it.
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
      // The exact payload dispatched to the engine is what the boot triage
      // rebuilds from: same object, not a re-serialization.
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

    it('sends faceless_material svg to the engine for an illustration-only faceless post', async () => {
      const res = await post(baseBody({ options: { faceless: true, facelessMaterial: 'svg' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.faceless_material).toBe('svg');
    });

    it('defaults a faceless post without a material choice to broll', async () => {
      const res = await post(baseBody({ options: { faceless: true } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.faceless_material).toBe('broll');
    });

    it('defaults a with-face post without a material choice to broll', async () => {
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.faceless_material).toBe('broll');
    });

    it('sends lipsync: false and no persona quality for a faceless post', async () => {
      const res = await post(baseBody({ options: { faceless: true } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.lipsync_enabled).toBe(false);
      // No face to resolve: the persona's face quality does not apply, and no
      // image travels to the engine. Asserted on the serialized payload —
      // that is what the engine receives (an undefined key is dropped).
      expect(payload).not.toHaveProperty('video_quality');
      const serialized = JSON.parse(JSON.stringify(payload)) as { persona: Record<string, unknown> };
      expect(serialized.persona).not.toHaveProperty('photo_url');
    });

    it('forwards webhook_url to the engine payload and carries no script prompt', async () => {
      const res = await post(
        baseBody({ options: { webhookUrl: 'https://example.com/hook' } }),
      );
      expect(res.status).toBe(200);
      const calls = vi.mocked(startEngineVideoTask).mock.calls;
      expect(calls).toHaveLength(1);
      expect((calls[0][1] as Record<string, unknown>).webhook_url).toBe('https://example.com/hook');
      expect((calls[0][1] as Record<string, unknown>).video_subject).toBe('Porto trip');
      // Phase 5-4: scripts come from options.segments only — no prompt
      // rides the engine payload anymore.
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

    it('accepts facelessMaterial svg on a with-face request and sends it with lipsync', async () => {
      const res = await post(baseBody({ options: { facelessMaterial: 'svg' } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).toMatchObject({ faceless_material: 'svg', lipsync_enabled: true });
    });

    it('rejects an unknown facelessMaterial value', async () => {
      const res = await post(baseBody({ options: { faceless: true, facelessMaterial: 'stock' } }));
      expect(res.status).toBe(400);
    });

    it('rejects scriptPrompts with more than one entry (scripts come from segments only)', async () => {
      const res = await post(baseBody({ options: { scriptPrompts: ['one', 'two'] } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.field).toBe('options.scriptPrompts');
    });

    const segmentsHook =
      'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
    const segmentsBody =
      'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
    const segmentsCta = 'Save this video before your next trip to Porto.';
    const validSegments = [
      { kind: 'hook', text: segmentsHook },
      { kind: 'body', text: segmentsBody },
      { kind: 'cta', text: segmentsCta },
    ];

    it('rejects invalid segments before any charge', async () => {
      const bad = [
        { kind: 'body', text: segmentsBody },
        { kind: 'hook', text: segmentsHook },
        { kind: 'cta', text: segmentsCta },
      ];
      const res = await post(baseBody({ options: { segments: bad } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(String(json.field)).toContain('segments');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects an unknown segment key at parse time instead of stripping it', async () => {
      const withVoice = [
        { kind: 'hook', text: segmentsHook },
        { kind: 'body', text: segmentsBody, voice: 'narrator' },
        { kind: 'cta', text: segmentsCta },
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
        { kind: 'body', text: segmentsBody, media: { mediaId: 'abc', alt: 'kitchen' } },
        { kind: 'cta', text: segmentsCta },
      ];
      const res = await post(baseBody({ options: { segments: withAlt } }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(String(json.field)).toContain('segments');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('forwards the joined segments script to the engine for a valid segments request', async () => {
      const res = await post(baseBody({ options: { segments: validSegments } }));
      expect(res.status).toBe(200);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_script).toBe(`${segmentsHook}\n\n${segmentsBody}\n\n${segmentsCta}`);
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
      // Our spend did not create the schedule: undo it so the retry is not
      // charged twice. The winner's own spend under the same generation_id
      // is the single charge.
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_reason).toMatch(/PK race/);
    });

    it('does not refund on a schedule PK conflict when we skipped our spend (already spent)', async () => {
      const key = 'race-key-2';
      // The ledger already holds this generation_id, so this request skips
      // its spend. If the schedule insert then PK-conflicts with a concurrent
      // winner, there is no redundant spend of ours to undo: refunding would
      // steal the legitimate prior spend.
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
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(0);
    });

    it('still replays the winner when the PK-race refund RPC fails', async () => {
      const key = 'race-key-3';
      // The refund RPC reports { data, error } without throwing, so a
      // failed refund used to be swallowed while the log claimed success.
      // The failure must be logged loudly, but the winner's schedule still
      // exists — return it instead of a 500 that hides it.
      vi.mocked(logger.error).mockClear();
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_pkey',
        refundErrorCode: 'XX000',
        replaySlots: [],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.replayed).toBe(true);
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(1);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        expect.stringMatching(/PK race refund failed/),
        expect.objectContaining({ code: 'XX000' }),
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('deletes a 0-slot zombie schedule (created an hour ago) and completes without charging twice', async () => {
      // Age no longer matters: a 0-slot schedule is a zombie whether it is
      // an hour or a minute old.
      const key = 'zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
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
      expect(json.slots).toHaveLength(1);
      // The zombie schedule row was deleted.
      expect(deletes).toContain('schedules');
      // No second charge: the ledger already had this generation_id.
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('deletes a recent 0-slot zombie schedule and runs fresh without charging twice', async () => {
      // Regression: a retry while the zombie was still fresh used to replay
      // the empty schedule ("0 publish slot(s)") instead of running fresh.
      // A 0-slot schedule can never produce videos, so it is a zombie at any
      // age: delete it and run fresh.
      const key = 'young-zombie-key-1';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
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
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(1);
      // The zombie schedule row was deleted.
      expect(deletes).toContain('schedules');
      // No second charge: the ledger already had this generation_id.
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('spends exactly once when a fresh 0-slot zombie had no prior spend', async () => {
      // Same zombie path, but the dead attempt died before spending: the
      // fresh run must charge exactly once — no double charge, no free run.
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

    it('treats a null slot count as a 0-slot zombie and runs fresh', async () => {
      // The count query can return a null count without an error; the route
      // coerces null to 0 so a count-less schedule is treated as a zombie
      // and deleted instead of being replayed empty.
      const key = 'null-count-zombie-key';
      const scheduleId = deterministicUuid(IDEMPOTENCY_NAMESPACE, `${USER_ID}:${key}`);
      setup({
        ...DEFAULT_CFG,
        existingScheduleId: scheduleId,
        replaySlots: [],
        slotCount: null,
        // A previous attempt spent but died before creating slots.
        ledgerIds: ['tx-old'],
      });
      const res = await post(baseBody({ idempotencyKey: key }));
      const json = await res.json();
      expect(res.status).toBe(200);
      // Not a replay: the zombie was cleared and the operation ran fresh.
      expect(json.replayed).toBe(false);
      expect(json.schedule.id).toBe(scheduleId);
      expect(json.slots).toHaveLength(1);
      // The zombie schedule row was deleted.
      expect(deletes).toContain('schedules');
      // No second charge: the ledger already had this generation_id.
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
      // The regression this pins: the persona already owns a schedule row, so
      // the insert violates schedules_persona_owner. That is not a PK race —
      // nothing of ours exists to replay. Answering `{slots: [],
      // replayed: true}` reported a successful batch of videos that was never
      // generated, which is how every MCP generate call for this persona
      // silently no-opped.
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
      // The lie is the point of the test: no empty "replay" success.
      expect(json.replayed).toBeUndefined();
      expect(json.slots).toBeUndefined();
      // Our spend bought nothing: give it back.
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_generation_id).toMatch(/^batch:/);
    });

    it('does not refund the persona-already-scheduled conflict when we skipped our spend', async () => {
      // alreadySpent: this request charged nothing, so the prior charge under
      // the same generation_id is legitimate and refunding would steal it.
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
      expect(rpcCalls.filter((c) => c.name === 'refund_generation_tokens')).toHaveLength(0);
    });

    it('refunds and 500s on a unique violation from an unclassified constraint', async () => {
      // An unrecognized constraint is not a race and not a known business
      // rule: fail loudly instead of guessing a replay.
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
      expect(rpcCalls.filter((c) => c.name === 'refund_generation_tokens')).toHaveLength(1);
    });
  });

  describe('per-slot failures', () => {
    it('marks the failed slot failed+refunded', async () => {
      // One call is one video: the single slot failing means every slot
      // failed, so the honest answer is 502 — with the refund still issued.
      setup({ ...DEFAULT_CFG, engineFailSubjects: ['Porto trip'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('ENGINE_UNAVAILABLE');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: null, status: 'failed' });

      const refunds = rpcCalls.filter((c) => c.name === 'refund_batch_tokens');
      expect(refunds).toHaveLength(1);
      const args = refunds[0].args;
      expect(args.p_amount).toBe(2);
      expect(args.p_refund_key).toMatch(/^batch:.*:slot:slot-0$/);
      expect(String(args.p_batch_generation_id)).toBe(String(args.p_refund_key).split(':slot:')[0]);

      const failedUpdates = updates.filter((u) => u.table === 'scheduled_posts' && u.fields.status === 'failed');
      expect(failedUpdates).toHaveLength(1);
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
      expect(json.error).toBe('options.webhookUrl must be a valid http(s) URL.');
      expect(json.field).toBe('options.webhookUrl');
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

    it('500s when the social accounts lookup fails', async () => {
      setup({ ...DEFAULT_CFG, socialAccountsError: true });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a provider with connected accounts but none selected', async () => {
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
      expect(json.error).toBe('Select at least one youtube account to publish to.');
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
      // The malformed row is skipped; the valid acct-1 still authorizes.
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
        personaDefaultAccounts: [{ provider: 'youtube', provider_account_id: 'acct-default' }],
      });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].youtube_account_ids).toEqual(['acct-1']);
    });

    it('keeps the 400 when accounts are omitted and the persona has no defaults', async () => {
      setup(DEFAULT_CFG);
      const res = await post(noAccountsBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_PROVIDER_ACCOUNT');
      expect(json.error).toBe('Select at least one youtube account to publish to.');
    });

    it('does not consult persona defaults for faceless posts without a persona', async () => {
      setup(DEFAULT_CFG);
      const res = await post(
        baseBody({
          personaId: null,
          options: { faceless: true },
          publishing: {
            providers: ['youtube'],
            schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
          },
        }),
      );
      // Still a 400 (missing accounts) — a null persona never triggers the
      // defaults lookup. The exact code depends on faceless validation order.
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
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
      // A relative path that is not one of our own site assets can never be
      // fetched by the engine: it used to die at ~75% of the pipeline as
      // "persona image download rejected", after the tokens were charged.
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
      // The engine's SSRF guard rejects private addresses; a literal private
      // IP is rejected there deterministically, so the pre-flight mirrors it.
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'http://127.0.0.1/avatar.png' } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('personaId');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a data:image avatar_url without a payload separator', async () => {
      // The engine splits a data URI on the first comma and decodes the
      // payload; without the separator it raises "invalid persona image
      // data URI" mid-pipeline.
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

    it('does not validate the persona image for faceless posts', async () => {
      // A faceless post never sends a photo to the engine, so a stored bad
      // avatar_url must not block it.
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: 'not-a-url' } });
      const res = await post(baseBody({ options: { faceless: true } }));
      expect(res.status).toBe(200);
    });

    it('does not validate the persona image when a library image is pinned', async () => {
      // A pinned imageId replaces the persona photo for every slot (the
      // pinned image itself is resolved and checked before the charge), so
      // the stored avatar_url never reaches the engine.
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
      // No voice is NOT a failure: the persona's language (English) has a
      // house default, so the dispatch proceeds with it before any spend.
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      const enginePersona = payload.persona as Record<string, unknown>;
      expect(enginePersona.voice_id).toBe('chatterbox:kokoro_af_heart');
      // The swap is persisted on the persona, in one user-scoped update.
      const swapUpdate = updates.find((u) => u.table === 'personas');
      expect(swapUpdate?.fields).toEqual({ voice_id: 'chatterbox:kokoro_af_heart' });
    });

    it('swaps an unrouteable persona voice for the language default and reports the swap', async () => {
      // Capture through the shared recording client: a prior test's
      // mockReturnValue must not leak into this one's assertions.
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
      // The swap is telemetry, never silence: the PostHog event carries the
      // voice ids and the reason, and no personal data. (withApiErrorReporting
      // also captures its own success event; only the fallback event is
      // pinned here.)
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
      // A failed persist must not break the dispatch: the engine payload
      // already carries the working voice, and the swap repeats next post.
      vi.mocked(getPostHogServer).mockReturnValue(recordingClient as never);
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: null }, updateThrowsTables: ['personas'] });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.warnings).toEqual([
        { code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' },
      ]);
      // The mock records the attempted personas update; no DB row was
      // committed (the client threw). Dispatch still uses the swapped voice.
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

    it('never swaps an explicit per-request voice: the engine fails loudly on it', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: 'energetic' } });
      const res = await post(baseBody({ options: { voiceId: 'also-invalid' } }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.warnings).toBeUndefined();
      // The persona's stored (invalid) voice is NOT swapped either: the
      // explicit request voice is what this post speaks with.
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect((payload.persona as Record<string, unknown>).voice_id).toBe('also-invalid');
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
      // The clone-availability lookup has two fail-open paths (DB error and
      // thrown client). Either keeps the clone — a transient DB outage must
      // not fail a dispatch the engine's ownership guard would accept.
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
      // A concurrent duplicate spent under the same generation_id first:
      // classify the 23505 by its constraint name and replay instead of
      // double-charging.
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
      // PostgREST surfaces the constraint name in `details` when the
      // message is generic: the classification must read both.
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
      // Neither message nor details names a constraint: not a PK race, not a
      // known business rule — refund loudly instead of guessing a replay.
      setup({ ...DEFAULT_CFG, scheduleInsertErrorCode: '23505' });
      const res = await post(baseBody({ idempotencyKey: 'bare-23505-key' }));
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_generation_tokens')).toHaveLength(1);
    });

    it('still 409s when the persona-owner refund fails', async () => {
      // A failed refund is a billing discrepancy, not a request failure: the
      // conflict is real either way, so the 409 stands and the failure is
      // logged loudly for investigation.
      setup({
        ...DEFAULT_CFG,
        scheduleInsertErrorCode: '23505',
        scheduleInsertConstraint: 'schedules_persona_owner',
        refundErrorCode: 'XX000',
      });
      const res = await post(baseBody({ idempotencyKey: 'owner-refund-fail-key' }));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('PERSONA_ALREADY_SCHEDULED');
      expect(json.replayed).toBeUndefined();
      expect(rpcCalls.filter((c) => c.name === 'refund_generation_tokens')).toHaveLength(1);
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
      // Compensating rollback: no half-created schedule survives.
      expect(deletes).toContain('scheduled_posts');
      expect(deletes).toContain('schedules');
      const refunds = rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].args.p_reason).toBe('Unified generate+schedule: slot insert failed; tokens refunded');
    });
  });

  describe('dispatch branches (mutation hardening)', () => {
    it("marks the slot bind_failed when the task_id bind errors", async () => {
      setup({ ...DEFAULT_CFG, updateErrorTables: ['scheduled_posts'] });
      const res = await post(baseBody());
      const json = await res.json();
      // The slot failed, none with an engine code: honest 502, internal.
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.slots).toHaveLength(1);
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', taskId: null, status: 'failed', errorCode: 'bind_failed' });
      // The engine accepted the task: the task id was preserved for
      // recovery instead of being orphaned.
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

    it('marks the slot photo_missing when no face source exists', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, avatar_url: null, photo_path: null } });
      const res = await post(baseBody());
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.success).toBe(false);
      expect(json.code).toBe('INTERNAL_ERROR');
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed', errorCode: 'photo_missing' });
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
      expect(json.slots[0]).toMatchObject({ title: 'Porto trip', status: 'failed' });
      // The slot still reports failed; the history marks the refund as not
      // delivered so the discrepancy stays visible.
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
      // One call is one video: the success case pins accepted 1, failed 0.
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      expect(vi.mocked(trackApiEvent)).toHaveBeenCalledWith(
        'video_tasks_created',
        expect.objectContaining({ tasksAccepted: 1, tasksFailed: 0 }),
      );
      // durationMs is wall-clock elapsed (Date.now() - startedAt), not a sum.
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
      expect(rpcCalls.filter((c) => c.name === 'refund_generation_tokens')).toHaveLength(0);
    });
  });

  describe('post without a persona (migration 012)', () => {
    it('rejects a persona-less post that is not faceless', async () => {
      const res = await post(baseBody({ personaId: undefined, options: {} }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('options.faceless');
      expect(rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
    });

    it('rejects a persona-less post with no voice', async () => {
      const res = await post(baseBody({ personaId: undefined, options: { faceless: true } }));
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
      // Null is the only accepted spelling: a blank string cannot
      // half-intend a persona, it becomes the persona-less path (and must
      // still satisfy it).
      const res = await post(baseBody({ personaId: '', options: { faceless: true, voiceId: 'voice-eleven' } }));
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
            faceless: true,
            voiceId: 'voice-eleven',
            language: 'en',
            niche: 'comedy',
            videoAspect: '16:9',
            paragraphNumber: 3,
          },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // The schedule carries the priced identity: null persona plus the
      // snapshot the engine re-reads at tick time.
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].persona_id).toBeNull();
      expect(scheduleRows[0].post_voice_id).toBe('voice-eleven');
      expect(scheduleRows[0].post_language).toBe('en');
      expect(scheduleRows[0].post_niche).toBe('comedy');
      expect(scheduleRows[0].post_video_aspect).toBe('16:9');
      expect(scheduleRows[0].post_paragraph_number).toBe(3);
      // Phase 5-4: no script prompt is snapshotted onto the schedule —
      // the script lives on the slot's segments.
      expect(scheduleRows[0]).not.toHaveProperty('post_script_prompt');
      // No persona, no persona call to action: the engine picks a generic one.
      expect(scheduleRows[0].post_cta_text).toBeNull();
      expect(scheduleRows[0].post_face_quality).toBe('ok');

      // The engine payload identifies the post by its own shape: no persona
      // name, the request's editorial values, no face.
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      const persona = payload.persona as Record<string, unknown>;
      expect(persona.name).toBe('Post');
      expect(persona.voice_id).toBe('voice-eleven');
      expect(payload.video_language).toBe('en');
      expect(payload.video_aspect).toBe('16:9');
      expect(payload.paragraph_number).toBe(3);
      expect(payload.lipsync_enabled).toBe(false);
    });

    it('skips the persona scope check for a persona-less post', async () => {
      // A scoped API key that allows nothing still creates a persona-less
      // post: there is no persona to scope against.
      vi.mocked(isPersonaAllowed).mockReturnValue(false);
      const res = await post(baseBody({ personaId: undefined, options: { faceless: true, voiceId: 'voice-eleven' } }));
      expect(res.status).toBe(200);
      expect(vi.mocked(isPersonaAllowed)).not.toHaveBeenCalled();
    });

    it('snapshots the audioUrl for a persona-less audio post so the engine tick can resolve its voice', async () => {
      // Without this column the engine's voice_for pre-dispatch check would
      // fail every slot of an audioUrl post with "post resolves no voice".
      const res = await post(
        baseBody({
          personaId: undefined,
          options: { faceless: true, audioUrl: 'https://example.com/voice.mp3' },
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
      // preparePersona signs voice_audio_path into a 1-hour URL for the
      // direct dispatch; snapshotting it would store an expired URL that
      // shadows the fresh re-signing at tick time. The tick must re-sign
      // from the persona embed instead.
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, voice_id: null, voice_audio_path: 'u/v.mp3' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_voice_audio_url).toBeNull();
      expect(scheduleRows[0].post_voice_id).toBeNull();
    });

    it('charges the faceless rate and never touches library images for a persona-less post', async () => {
      const res = await post(baseBody({ personaId: undefined, options: { faceless: true, voiceId: 'voice-eleven' } }));
      expect(res.status).toBe(200);
      const spends = rpcCalls.filter((c) => c.name === 'spend_tokens');
      expect(spends).toHaveLength(1);
      expect(spends[0].args.p_amount).toBe(1);
      // No persona means no library to resolve from and no anti-repeat
      // history to record into.
      expect(vi.mocked(resolveVideoImage)).not.toHaveBeenCalled();
      expect(vi.mocked(recordRecentImageId)).not.toHaveBeenCalled();
    });

    it('snapshots a null video_aspect when the persona has none', async () => {
      // A legacy persona row can carry a null video_aspect: the snapshot
      // must store null, not crash on the missing value.
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, video_aspect: null } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows).toHaveLength(1);
      expect(scheduleRows[0].post_video_aspect).toBeNull();
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      // The payload builder strips null preference fields: the engine
      // would reject an explicit null with the opaque 502, so absence is
      // the contract, not null.
      expect(payload).not.toHaveProperty('video_aspect');
    });

    it('prefers per-request editorial fields over the persona values', async () => {
      const res = await post(
        baseBody({
          options: { niche: 'tech', language: 'en-US', videoAspect: '16:9', paragraphNumber: 2 },
        }),
      );
      expect(res.status).toBe(200);
      // The snapshot on the schedule is the priced identity: overrides win
      // over the persona's stored definition.
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_niche).toBe('tech');
      expect(scheduleRows[0].post_language).toBe('en-US');
      expect(scheduleRows[0].post_video_aspect).toBe('16:9');
      expect(scheduleRows[0].post_paragraph_number).toBe(2);
      // Phase 5-4: no script prompt is snapshotted onto the schedule.
      expect(scheduleRows[0]).not.toHaveProperty('post_script_prompt');
      // And the engine payload carries the same resolved values.
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_language).toBe('en-US');
      expect(payload.video_aspect).toBe('16:9');
      expect(payload.paragraph_number).toBe(2);
    });
  });

  describe('persona call to action', () => {
    it('snapshots the persona call to action and sends it to the engine', async () => {
      setup({ ...DEFAULT_CFG, persona: { ...PERSONA, cta_text: 'Link na bio' } });
      const res = await post(baseBody());
      expect(res.status).toBe(200);
      const scheduleRows = inserts['schedules'] as Array<Record<string, unknown>>;
      expect(scheduleRows[0].post_cta_text).toBe('Link na bio');
      const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.video_cta).toBe('Link na bio');
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

      // slot_at is the request time, not a distributed future slot: the
      // engine's tick publishes ready slots with slot_at <= now, so these
      // go out the moment generation finishes. The 3h window never applies.
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
    'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
  const bodyText =
    'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
  const cta = 'Save this video before your next trip to Porto.';
  const segments = [
    { kind: 'hook', text: hook },
    { kind: 'body', text: bodyText },
    { kind: 'cta', text: cta },
  ];
  function singleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base: Record<string, unknown> = {
      personaId: 'persona-1',
      title: 'Porto trip',
      publishing: {
        providers: ['youtube'],
        accounts: { youtube: ['acct-1'] },
        schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
      },
      options: { segments },
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
    const res = await post(singleBody({ options: {} }));
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
    expect(payload.video_subject).toBe('Porto trip');
    expect(payload.video_script).toBe(`${hook}\n\n${bodyText}\n\n${cta}`);
  });
});
