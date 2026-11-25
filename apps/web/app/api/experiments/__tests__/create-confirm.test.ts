// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { price } = vi.hoisted(() => ({ price: { perVideo: null as number | null } }));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/persona-voice-validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/persona-voice-validate')>();
  return { ...actual, validatePersonaVoiceInput: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/lib/experiments/read-comparison', () => ({ readPromptComparison: vi.fn() }));
vi.mock('@/lib/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tokens')>();
  return {
    ...actual,
    computeVideoTokens: (...args: Parameters<typeof actual.computeVideoTokens>) => price.perVideo ?? actual.computeVideoTokens(...args),
  };
});
vi.mock('@/lib/generation/video-generation', () => ({
  startEngineVideoTask: vi.fn(),
  recordGenerationStart: vi.fn().mockResolvedValue(undefined),
  recordGenerationUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/billing/refund-tokens', () => ({
  refundSlotTokens: vi.fn().mockResolvedValue({ refunded: true, alreadyRefunded: false }),
}));

import { readPromptComparison } from '@/lib/experiments/read-comparison';
import { refundSlotTokens } from '@/lib/billing/refund-tokens';
import { startEngineVideoTask } from '@/lib/generation/video-generation';
import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { confirmExperiment, experimentScheduleId } from '../create-confirm';
import { quoteExperiment } from '../create-quote';
import { AUTH, USER_ID, VERSION_A, VERSION_B, OFFICIAL_VERSIONS, experimentBody, fakeDb, type DbConfig, type FakeDb } from './create-fixtures';

const NOW = new Date();
const TOTAL = 10;

interface Quoted {
  body: CreateExperimentBody;
  confirmBody: CreateExperimentBody;
  quoteKey: string;
  expiresAt: string;
}

async function quoted(body = experimentBody()): Promise<Quoted> {
  const json = await (await quoteExperiment(fakeDb().client, AUTH, body, NOW)).json();
  return { body, confirmBody: { ...body, quoteKey: json.quoteKey, expiresAt: json.expiresAt }, quoteKey: json.quoteKey, expiresAt: json.expiresAt };
}

async function confirm(confirmBody: CreateExperimentBody, db: FakeDb = fakeDb(), now = NOW) {
  const response = await confirmExperiment(db.client, AUTH, confirmBody, now);
  return { response, json: await response.json(), db };
}

function spends(db: FakeDb) {
  return db.rpcCalls.filter((call) => call.name === 'spend_tokens');
}

beforeEach(() => {
  vi.clearAllMocks();
  price.perVideo = null;
  vi.mocked(readPromptComparison).mockResolvedValue({ ok: true, value: { window: '7d', accounts: [], truncated: false }, unversioned: [] });
  vi.mocked(startEngineVideoTask).mockImplementation(async (_userId, payload) => ({
    ok: true,
    taskId: `task-${(payload as { slot_id: string }).slot_id}`,
    body: {},
  }));
  vi.mocked(refundSlotTokens).mockResolvedValue({ refunded: true, alreadyRefunded: false });
});

describe('confirmExperiment', () => {
  it('charges the whole experiment once, then writes one schedule with a slot per video', async () => {
    const { confirmBody, quoteKey } = await quoted();

    const { response, json, db } = await confirm(confirmBody);

    const scheduleId = experimentScheduleId(USER_ID, quoteKey);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, stage: 'confirmed', scheduleId, replayed: false, chargedTokens: TOTAL });
    expect(spends(db)).toHaveLength(1);
    expect(spends(db)[0].args).toMatchObject({ p_user_id: USER_ID, p_amount: TOTAL, p_generation_id: `batch:${scheduleId}` });
    expect(db.state.schedule).toMatchObject({
      id: scheduleId,
      user_id: USER_ID,
      providers: ['youtube'],
      youtube_account_ids: ['acct-1'],
      times: ['09:00', '18:00'],
      timezone: 'UTC',
      publish_mode: 'scheduled',
      posts_per_day: 2,
    });
    expect(db.state.slots).toHaveLength(TOTAL);
    expect(new Set(db.state.slots.map((slot) => slot.schedule_id))).toEqual(new Set([scheduleId]));
  });

  it('stores each video with its own title, script and the prompt version of its variant', async () => {
    const { confirmBody } = await quoted();

    const { db, json } = await confirm(confirmBody);

    const rows = db.state.slots;
    expect(new Set(rows.map((row) => row.title)).size).toBe(TOTAL);
    expect(rows.filter((row) => row.prompt_version_id === VERSION_A)).toHaveLength(5);
    expect(rows.filter((row) => row.prompt_version_id === VERSION_B)).toHaveLength(5);
    for (const row of rows) {
      expect(row.segments).toEqual(expect.any(Array));
      expect(String(row.title).startsWith(row.prompt_version_id === VERSION_A ? 'A video' : 'B video')).toBe(true);
    }
    const dispatched = vi.mocked(startEngineVideoTask).mock.calls.map((call) => (call[1] as { video_title: string }).video_title);
    expect(new Set(dispatched).size).toBe(TOTAL);
    expect(json.slots.every((slot: { status: string }) => slot.status === 'generating')).toBe(true);
    expect(json.slots.map((slot: { versionId: string }) => slot.versionId).sort()).toEqual(
      [...Array(5).fill(VERSION_A), ...Array(5).fill(VERSION_B)].sort(),
    );
  });

  it('replays a retried confirm without charging or dispatching again', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb();

    await confirm(confirmBody, db);
    const second = await confirm(confirmBody, db);

    expect(second.response.status).toBe(200);
    expect(second.json).toMatchObject({ success: true, replayed: true, chargedTokens: TOTAL });
    expect(second.json.slots).toHaveLength(TOTAL);
    expect(spends(db)).toHaveLength(1);
    expect(startEngineVideoTask).toHaveBeenCalledTimes(TOTAL);
  });

  it('replays a retry even after the quote expired', async () => {
    const { confirmBody, expiresAt } = await quoted();
    const db = fakeDb();
    await confirm(confirmBody, db);

    const later = await confirm(confirmBody, db, new Date(Date.parse(expiresAt) + 60_000));

    expect(later.json).toMatchObject({ success: true, replayed: true });
    expect(spends(db)).toHaveLength(1);
  });

  it('resumes without a second charge when the ledger already holds this experiment spend', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ ledger: [{ type: 'video_generation', amount: -TOTAL, reference_id: null }] });

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(200);
    expect(json.replayed).toBe(false);
    expect(spends(db)).toHaveLength(0);
    expect(db.state.slots).toHaveLength(TOTAL);
  });

  it('rejects a confirm after the quote expired and charges nothing', async () => {
    const { confirmBody, expiresAt } = await quoted();

    const { response, json, db } = await confirm(confirmBody, fakeDb(), new Date(Date.parse(expiresAt)));

    expect(response.status).toBe(409);
    expect(json.code).toBe('QUOTE_EXPIRED');
    expect(spends(db)).toHaveLength(0);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('rejects a confirm whose price changed since the quote', async () => {
    const { confirmBody } = await quoted();
    price.perVideo = 2;

    const { response, json, db } = await confirm(confirmBody);

    expect(response.status).toBe(409);
    expect(json.code).toBe('QUOTE_CHANGED');
    expect(spends(db)).toHaveLength(0);
  });

  it('rejects a confirm whose scripts changed since the quote', async () => {
    const { confirmBody } = await quoted();
    const edited = structuredClone(confirmBody);
    edited.variants[0].videos[0].description = 'Edited after the quote.';

    const { response, json, db } = await confirm(edited);

    expect(response.status).toBe(409);
    expect(json.code).toBe('QUOTE_CHANGED');
    expect(spends(db)).toHaveLength(0);
  });

  it('rejects a forged quote key', async () => {
    const { confirmBody } = await quoted();

    const { response, json } = await confirm({ ...confirmBody, quoteKey: 'f'.repeat(64) });

    expect(response.status).toBe(409);
    expect(json.code).toBe('QUOTE_CHANGED');
  });

  it('re-checks every prompt version: one deleted after the quote is a 404 with nothing charged', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ versions: { [VERSION_A]: OFFICIAL_VERSIONS[VERSION_A] } });

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ code: 'PROMPT_NOT_FOUND', field: 'variants.1.versionId' });
    expect(spends(db)).toHaveLength(0);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('answers 402 and writes nothing when the balance is short', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ spend: { spent: false, balance: 3 } });

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(402);
    expect(json).toMatchObject({ code: 'INSUFFICIENT_TOKENS', have: 3, need: TOTAL });
    expect(db.state.schedule).toBeNull();
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('refunds every slot and answers 502 when the engine rejects every video', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: false, response: new Response(null) as never, upstreamStatus: 503 });
    const { confirmBody } = await quoted();

    const { response, json } = await confirm(confirmBody);

    expect(response.status).toBe(502);
    expect(json).toMatchObject({ success: false, code: 'ENGINE_UNAVAILABLE', chargedTokens: 0 });
    const refunded = vi.mocked(refundSlotTokens).mock.calls.map((call) => call[0].slotId);
    expect(refunded).toHaveLength(TOTAL);
    expect(new Set(refunded).size).toBe(TOTAL);
    expect(vi.mocked(refundSlotTokens).mock.calls.every((call) => call[0].amount === 1)).toBe(true);
  });

  it('keeps the experiment when only some videos fail, refunding just those', async () => {
    let calls = 0;
    vi.mocked(startEngineVideoTask).mockImplementation(async (_userId, payload) => {
      calls += 1;
      if (calls === 3) return { ok: false, response: new Response(null) as never };
      return { ok: true, taskId: `task-${(payload as { slot_id: string }).slot_id}`, body: {} };
    });
    const { confirmBody } = await quoted();

    const { response, json } = await confirm(confirmBody);

    expect(response.status).toBe(200);
    expect(json.chargedTokens).toBe(TOTAL - 1);
    expect(json.slots.filter((slot: { status: string }) => slot.status === 'failed')).toHaveLength(1);
    expect(refundSlotTokens).toHaveBeenCalledTimes(1);
  });

  it('refunds the whole charge and removes the schedule when the slots cannot be inserted', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ slotInsertError: { message: 'insert failed' } });

    const { response, db: used } = await confirm(confirmBody, db);

    expect(response.status).toBe(500);
    expect(used.state.schedule).toBeNull();
    const refund = used.rpcCalls.find((call) => call.name === 'refund_batch_tokens');
    expect(refund?.args).toMatchObject({ p_user_id: USER_ID, p_amount: TOTAL });
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('refunds the whole charge when the schedule cannot be inserted', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ scheduleInsertError: { code: '42P01', message: 'boom' } });

    const { response, db: used } = await confirm(confirmBody, db);

    expect(response.status).toBe(500);
    expect(used.rpcCalls.find((call) => call.name === 'refund_batch_tokens')?.args).toMatchObject({ p_amount: TOTAL });
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('refunds the duplicate charge and replays the winner when two confirms race on the schedule id', async () => {
    const { confirmBody } = await quoted();
    const config: DbConfig = {
      scheduleInsertError: { code: '23505', message: 'duplicate key value violates unique constraint "schedules_pkey"' },
    };
    const db = fakeDb(config);
    db.state.slots = [
      { id: 'winner-1', slot_at: '2030-01-01T09:00:00.000Z', title: 'A video 1', task_id: 't', status: 'generating', prompt_version_id: VERSION_A, charged_tokens: 1 },
    ];

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ replayed: true });
    expect(db.rpcCalls.find((call) => call.name === 'refund_batch_tokens')?.args).toMatchObject({ p_amount: TOTAL });
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('rejects a confirm that carries no quote key', async () => {
    const { response } = await confirm(experimentBody());

    expect(response.status).toBe(400);
  });
});
