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
vi.mock('../../videos/generate-and-schedule/aspect-preflight', () => ({ checkPreChargePreflights: vi.fn().mockResolvedValue(null) }));
vi.mock('../../videos/generate-and-schedule/library-photo', () => ({ validatePreChargeImageId: vi.fn().mockResolvedValue(null) }));
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

import { createHash } from 'node:crypto';
import { canonicalJson } from '@/lib/experiments/quote-key';
import { NextResponse } from 'next/server';
import { checkPreChargePreflights } from '../../videos/generate-and-schedule/aspect-preflight';
import { validatePreChargeImageId } from '../../videos/generate-and-schedule/library-photo';
import { trackApiEvent } from '@/lib/analytics';
import { readPromptComparison } from '@/lib/experiments/read-comparison';
import { refundSlotTokens } from '@/lib/billing/refund-tokens';
import { startEngineVideoTask } from '@/lib/generation/video-generation';
import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { confirmExperiment, experimentScheduleId } from '../create-confirm';
import { quoteExperiment } from '../create-quote';
import { TEST_ENCRYPTION_KEY, AUTH, USER_ID, VERSION_A, VERSION_B, OFFICIAL_VERSIONS, experimentBody, fakeDb, type DbConfig, type FakeDb } from './create-fixtures';

const NOW = new Date();
const TOTAL = 10;

interface Quoted {
  body: CreateExperimentBody;
  confirmBody: CreateExperimentBody;
  quoteKey: string;
  expiresAt: string;
  slots: Array<{ slotAt: string; versionId: string }>;
}

async function quoted(body = experimentBody()): Promise<Quoted> {
  const json = await (await quoteExperiment(fakeDb().client, AUTH, body, NOW)).json();
  return { body, confirmBody: { ...body, quoteKey: json.quoteKey, expiresAt: json.expiresAt }, quoteKey: json.quoteKey, expiresAt: json.expiresAt, slots: json.slots };
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
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', TEST_ENCRYPTION_KEY);
  vi.mocked(checkPreChargePreflights).mockResolvedValue(null);
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
    const ledgerRead = db.calls.find((call) => call.table === 'token_transactions' && call.op === 'select');
    expect(ledgerRead?.filters).toEqual(
      expect.arrayContaining([
        ['generation_id', `batch:${experimentScheduleId(USER_ID, confirmBody.quoteKey ?? '')}`],
        ['user_id', USER_ID],
      ]),
    );
  });

  it('deletes an empty schedule left by an earlier confirm, then creates the experiment', async () => {
    const { confirmBody } = await quoted();
    const scheduleId = experimentScheduleId(USER_ID, confirmBody.quoteKey ?? '');
    const db = fakeDb();
    db.state.schedule = { id: scheduleId };

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(200);
    expect(json.replayed).toBe(false);
    const order = db.calls.filter((call) => call.table === 'schedules' && call.op !== 'select').map((call) => call.op);
    expect(order).toEqual(['delete', 'insert']);
    const removal = db.calls.find((call) => call.table === 'schedules' && call.op === 'delete');
    expect(removal?.filters).toEqual([['id', scheduleId], ['user_id', USER_ID]]);
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

  it('rejects a key a caller computed itself for an expiry it chose', async () => {
    const { body, expiresAt, slots } = await quoted();
    const chosenExpiry = new Date(Date.parse(expiresAt) + 24 * 3_600_000).toISOString();
    const selfSigned = createHash('sha256')
      .update(
        canonicalJson({
          userId: USER_ID,
          request: { ...body, quoteKey: undefined, expiresAt: undefined },
          perVideoCost: 1,
          totalTokens: TOTAL,
          slots: slots.map((slot) => ({ slotAt: slot.slotAt, versionId: slot.versionId })),
          expiresAt: chosenExpiry,
        }),
      )
      .digest('hex');

    const { response, json, db } = await confirm({ ...body, quoteKey: selfSigned, expiresAt: chosenExpiry });

    expect(response.status).toBe(409);
    expect(json.code).toBe('QUOTE_CHANGED');
    expect(spends(db)).toHaveLength(0);
  });

  it('rejects a real key presented with a later expiry than the one it was issued for', async () => {
    const { body, quoteKey, expiresAt } = await quoted();
    const later = new Date(Date.parse(expiresAt) + 24 * 3_600_000).toISOString();

    const { response, json, db } = await confirm({ ...body, quoteKey, expiresAt: later });

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

  it('runs no media preflight for a forged key, a stale price or a key of the wrong length', async () => {
    const { confirmBody } = await quoted();
    price.perVideo = 2;
    vi.mocked(checkPreChargePreflights).mockClear();
    vi.mocked(validatePreChargeImageId).mockClear();

    const stale = await confirm(confirmBody);
    price.perVideo = null;
    const forged = await confirm({ ...confirmBody, quoteKey: 'f'.repeat(64) });
    const short = await confirm({ ...confirmBody, quoteKey: 'abc' });

    expect([stale.json.code, forged.json.code, short.json.code]).toEqual(['QUOTE_CHANGED', 'QUOTE_CHANGED', 'QUOTE_CHANGED']);
    expect(checkPreChargePreflights).not.toHaveBeenCalled();
    expect(validatePreChargeImageId).not.toHaveBeenCalled();
  });

  it('runs the media preflights of a matching key before it charges, and charges nothing when one fails', async () => {
    const { confirmBody } = await quoted();
    vi.mocked(checkPreChargePreflights).mockClear();
    vi.mocked(checkPreChargePreflights).mockResolvedValue(
      NextResponse.json({ success: false, error: 'Segment 0 image 0 is 1:1.', code: 'VALIDATION_FAILED', field: 'options.segments' }, { status: 400 }),
    );

    const { response, json, db } = await confirm(confirmBody);

    expect(response.status).toBe(400);
    expect(json.field).toMatch(/^variants\.\d+\.videos\.\d+\.segments$/);
    expect(checkPreChargePreflights).toHaveBeenCalled();
    expect(spends(db)).toHaveLength(0);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
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

  it('re-runs the media preflights at confirm: a video that fails one is refused with nothing charged', async () => {
    const { confirmBody } = await quoted();
    vi.mocked(checkPreChargePreflights).mockResolvedValue(
      NextResponse.json({ success: false, error: 'Segment 0 image 0 is too small.', code: 'VALIDATION_FAILED', field: 'options.segments' }, { status: 400 }),
    );

    const { response, json, db } = await confirm(confirmBody);

    expect(response.status).toBe(400);
    expect(json.field).toMatch(/^variants\.\d+\.videos\.\d+\.segments$/);
    expect(spends(db)).toHaveLength(0);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
    expect(startEngineVideoTask).not.toHaveBeenCalled();
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

  it('keeps the charge of a failed video whose refund did not land', async () => {
    vi.mocked(startEngineVideoTask).mockImplementation(async (_userId, payload) =>
      (payload as { video_title: string }).video_title === 'A video 1'
        ? { ok: false, response: new Response(null) as never }
        : { ok: true, taskId: `task-${(payload as { slot_id: string }).slot_id}`, body: {} },
    );
    vi.mocked(refundSlotTokens).mockResolvedValue({ refunded: false, alreadyRefunded: false, error: 'rpc down' });
    const { confirmBody } = await quoted();

    const { response, json } = await confirm(confirmBody);

    expect(response.status).toBe(200);
    expect(json.chargedTokens).toBe(TOTAL);
    expect(json.slots.filter((slot: { status: string }) => slot.status === 'failed')).toEqual([
      expect.objectContaining({ tokensRefunded: false }),
    ]);
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

  it('refunds the redundant charge and answers 409 when the persona already has a schedule', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({
      scheduleInsertError: { code: '23505', message: 'duplicate key value violates unique constraint "schedules_persona_owner"' },
    });

    const { response, json, db: used } = await confirm(confirmBody, db);

    expect(response.status).toBe(409);
    expect(json.code).toBe('PERSONA_ALREADY_SCHEDULED');
    expect(used.rpcCalls.find((call) => call.name === 'refund_batch_tokens')?.args).toMatchObject({ p_amount: TOTAL });
    expect(used.state.slots).toEqual([]);
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('does not refund a persona-already-scheduled confirm when an earlier attempt already charged', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({
      scheduleInsertError: { code: '23505', message: 'duplicate key value violates unique constraint "schedules_persona_owner"' },
      ledger: [{ type: 'video_generation', amount: -TOTAL, reference_id: null }],
    });

    const { response, db: used } = await confirm(confirmBody, db);

    expect(response.status).toBe(409);
    expect(used.rpcCalls.map((call) => call.name)).not.toContain('refund_batch_tokens');
  });

  it('replays the winner when the spend collides with a confirm that already ran', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ spendError: { code: '23505', message: 'duplicate key value violates unique constraint "token_transactions_generation_key"' } });
    db.state.slots = [
      { id: 'winner-1', slot_at: '2030-01-01T09:00:00.000Z', title: 'A video 1', task_id: 't', status: 'generating', prompt_version_id: VERSION_A, charged_tokens: 1 },
    ];

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, replayed: true, scheduleId: experimentScheduleId(USER_ID, confirmBody.quoteKey ?? '') });
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('answers 500 and writes nothing when the spend fails for another reason', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ spendError: { code: '57014', message: 'canceling statement due to statement timeout' } });
    db.state.slots = [
      { id: 'other', slot_at: '2030-01-01T09:00:00.000Z', title: 'x', task_id: null, status: 'pending', prompt_version_id: null, charged_tokens: 0 },
    ];

    const { response, json } = await confirm(confirmBody, db);

    expect(response.status).toBe(500);
    expect(json.code).toBe('INTERNAL_ERROR');
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('answers 500 when the spend collides but no winner rows exist to replay', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ spendError: { code: '23505', message: 'duplicate key value violates unique constraint "token_transactions_generation_key"' } });

    const { response } = await confirm(confirmBody, db);

    expect(response.status).toBe(500);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('pairs each inserted row with its own video by slot id, whatever order the insert returns them in', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ insertedOrder: 'reversed' });

    const { response } = await confirm(confirmBody, db);

    expect(response.status).toBe(200);
    for (const call of vi.mocked(startEngineVideoTask).mock.calls) {
      const payload = call[1] as { slot_id: string; video_title: string };
      const row = db.state.slots.find((slot) => slot.id === payload.slot_id);
      expect(row?.title).toBe(payload.video_title);
    }
    expect(vi.mocked(startEngineVideoTask)).toHaveBeenCalledTimes(TOTAL);
  });

  it('gives every slot an id derived from the schedule and its position, stable across retries', async () => {
    const first = await quoted();
    const dbOne = fakeDb();
    const dbTwo = fakeDb();

    await confirm(first.confirmBody, dbOne);
    await confirm(first.confirmBody, dbTwo);

    const ids = dbOne.state.slots.map((slot) => slot.id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(dbTwo.state.slots.map((slot) => slot.id)).toEqual(ids);
  });

  it('rolls back when the insert returns a row that is not one of its slots', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb({ insertedIds: (ids) => [...ids.slice(0, -1), 'someone-elses-slot'] });

    const { response, db: used } = await confirm(confirmBody, db);

    expect(response.status).toBe(500);
    expect(used.state.schedule).toBeNull();
    expect(used.rpcCalls.find((call) => call.name === 'refund_batch_tokens')?.args).toMatchObject({ p_amount: TOTAL });
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('does not read the prompt history again at confirm: the quote already showed its warnings', async () => {
    const { confirmBody } = await quoted();
    vi.mocked(readPromptComparison).mockClear();

    const { json } = await confirm(confirmBody);

    expect(readPromptComparison).not.toHaveBeenCalled();
    expect(json.warnings).toEqual([]);
  });

  it('reports the funnel from validation to completion and a replay on a retry', async () => {
    const { confirmBody } = await quoted();
    const db = fakeDb();

    await confirm(confirmBody, db);
    await confirm(confirmBody, db);

    const events = vi.mocked(trackApiEvent).mock.calls.map((call) => call[0]);
    expect(events).toEqual([
      'video_creation_started',
      'video_creation_validated',
      'video_tokens_calculated',
      'video_tokens_spent',
      'video_schedule_created',
      'video_slots_created',
      'video_tasks_created',
      'video_creation_completed',
      'video_creation_started',
      'video_creation_replayed',
    ]);
    expect(vi.mocked(trackApiEvent).mock.calls.find((call) => call[0] === 'video_creation_started')?.[1]).toMatchObject({
      userId: USER_ID,
      personaId: null,
      numberOfVideos: TOTAL,
      providers: ['youtube'],
      videoType: 'voiceover',
    });
    expect(vi.mocked(trackApiEvent).mock.calls.find((call) => call[0] === 'video_creation_completed')?.[1]).toMatchObject({
      userId: USER_ID,
      numberOfVideos: TOTAL,
      tasksAccepted: TOTAL,
      tasksFailed: 0,
      tokenCost: TOTAL,
    });
  });

  it('reports a failed dispatch of every video as a failed creation', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: false, response: new Response(null) as never, upstreamStatus: 503 });
    const { confirmBody } = await quoted();
    vi.mocked(trackApiEvent).mockClear();

    await confirm(confirmBody);

    expect(vi.mocked(trackApiEvent).mock.calls.find((call) => call[0] === 'video_creation_failed')?.[1]).toMatchObject({
      errorCode: 'ENGINE_UNAVAILABLE',
      failureStage: 'dispatch',
      refunded: true,
    });
  });

  it('rejects a confirm that carries no quote key', async () => {
    const { response } = await confirm(experimentBody());

    expect(response.status).toBe(400);
  });
});
