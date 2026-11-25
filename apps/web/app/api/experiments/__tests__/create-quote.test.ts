// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/persona-voice-validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/persona-voice-validate')>();
  return { ...actual, validatePersonaVoiceInput: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/lib/experiments/read-comparison', () => ({ readPromptComparison: vi.fn() }));

import { readPromptComparison } from '@/lib/experiments/read-comparison';
import type { AccountResult, PromptResult, UnversionedAccount } from '@/lib/experiments/prompt-comparison';
import { parseExperimentRequest } from '../create-plan';
import { quoteExperiment } from '../create-quote';
import { AUTH, USER_ID, VERSION_A, VERSION_B, VERSION_C, experimentBody, fakeDb, futureISO, segmentsFor, OFFICIAL_VERSIONS } from './create-fixtures';

const NOW = new Date();

function emptyComparison(accounts: AccountResult[] = [], unversioned: UnversionedAccount[] = []) {
  vi.mocked(readPromptComparison).mockResolvedValue({ ok: true, value: { window: '7d', accounts, truncated: false }, unversioned });
}

function testedPrompt(versionId: string | null): PromptResult {
  return { versionId, slug: null, title: null, version: null, source: null, videos: 9, medianViews: 1, lift: 1, pValue: 0.5, label: 'no_signal', direction: null };
}

async function quote(overrides: Parameters<typeof experimentBody>[0] = {}, db = fakeDb(), perVariant = 5, auth = AUTH) {
  const response = await quoteExperiment(db.client, auth, experimentBody(overrides, perVariant), NOW);
  return { response, json: await response.json(), db };
}

beforeEach(() => {
  vi.clearAllMocks();
  emptyComparison();
});

describe('quoteExperiment', () => {
  it('prices every video, rotates the variants over the slots and returns a key that expires in 15 minutes', async () => {
    const { response, json } = await quote();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, stage: 'quote', perVideoTokens: 1, totalTokens: 10, videos: 10 });
    expect(json.quoteKey).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(json.expiresAt) - NOW.getTime()).toBe(15 * 60 * 1000);
    expect(json.slots).toHaveLength(10);
    const perVersion = (versionId: string) => json.slots.filter((slot: { versionId: string }) => slot.versionId === versionId).length;
    expect(perVersion(VERSION_A)).toBe(5);
    expect(perVersion(VERSION_B)).toBe(5);
    expect(json.slots[0].slotAt < json.slots[9].slotAt).toBe(true);
  });

  it('never charges, never writes and never starts a video', async () => {
    const { db } = await quote();

    expect(db.rpcCalls.map((call) => call.name)).not.toContain('spend_tokens');
    expect(db.calls.filter((call) => call.op !== 'select')).toEqual([]);
  });

  it('returns the same key for the same request and a different one when a script changes', async () => {
    const body = experimentBody();
    const first = await (await quoteExperiment(fakeDb().client, AUTH, body, NOW)).json();
    const second = await (await quoteExperiment(fakeDb().client, AUTH, structuredClone(body), NOW)).json();
    const edited = structuredClone(body);
    edited.variants[0].videos[0].title = 'A different title';
    const third = await (await quoteExperiment(fakeDb().client, AUTH, edited, NOW)).json();

    expect(second.quoteKey).toBe(first.quoteKey);
    expect(third.quoteKey).not.toBe(first.quoteKey);
  });

  it('warns when the sample per variant is below the minimum that can read clear', async () => {
    const { json } = await quote();

    expect(json.warnings).toContainEqual({
      code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM',
      videosPerVariant: 5,
      minimumVideos: 7,
      groups: 2,
    });
  });

  it('counts the groups the account already tests when it sizes the warning', async () => {
    emptyComparison([
      {
        provider: 'youtube',
        accountId: 'acct-1',
        videos: 30,
        baselineViews: 10,
        prompts: [testedPrompt(null), testedPrompt(VERSION_C)],
      },
    ]);

    const { json } = await quote({}, fakeDb(), 7);

    expect(json.warnings).toContainEqual({
      code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM',
      videosPerVariant: 7,
      minimumVideos: 8,
      groups: 4,
    });
  });

  it('counts the no-prompt group of an account whose first experiment this is, which the comparison leaves out', async () => {
    const threeVariants = () => {
      const body = experimentBody({}, 7);
      body.variants.push({ versionId: VERSION_C, videos: structuredClone(body.variants[0].videos) });
      return body;
    };
    const without = await (await quoteExperiment(fakeDb().client, AUTH, threeVariants(), NOW)).json();
    emptyComparison([], [{ provider: 'youtube', accountId: 'acct-1', comparedVideos: 12 }]);

    const withHistory = await (await quoteExperiment(fakeDb().client, AUTH, threeVariants(), NOW)).json();

    expect(without.warnings).toEqual([]);
    expect(withHistory.warnings).toContainEqual({
      code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM',
      videosPerVariant: 7,
      minimumVideos: 8,
      groups: 4,
    });
  });

  it('has no sample warning when the sample reaches the minimum', async () => {
    const { json } = await quote({}, fakeDb(), 10);

    expect(json.warnings).toEqual([]);
  });

  it('still quotes when the history cannot be read, and says so', async () => {
    vi.mocked(readPromptComparison).mockResolvedValue({ ok: false, cause: new Error('db down') });

    const { response, json } = await quote({}, fakeDb(), 10);

    expect(response.status).toBe(200);
    expect(json.warnings).toEqual([{ code: 'EXPERIMENT_HISTORY_UNAVAILABLE' }]);
  });

  it('spreads 20 videos over several days instead of stacking them on one', async () => {
    const { json } = await quote({}, fakeDb(), 10);

    const days = new Set(json.slots.map((slot: { slotAt: string }) => slot.slotAt.slice(0, 10)));
    expect(json.videos).toBe(20);
    expect(days.size).toBeGreaterThanOrEqual(10);
  });

  it('rejects a quote whose slots leave the 30 day schedule window', async () => {
    const { response, json } = await quote({ times: ['09:00'], startAt: futureISO(48) }, fakeDb(), 15);

    expect(response.status).toBe(400);
    expect(json.code).toBe('SCHEDULE_OUT_OF_RANGE');
  });
});

describe('quoteExperiment prompt versions', () => {
  it('rejects a private version of another user as not found, naming the variant', async () => {
    const db = fakeDb({
      versions: { ...OFFICIAL_VERSIONS, [VERSION_B]: { source: 'user', owner_id: 'someone-else', prompt_id: 'prompt-9' } },
      prompts: { 'prompt-9': { visibility: 'private' } },
    });

    const { response, json } = await quote({}, db);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ code: 'PROMPT_NOT_FOUND', field: 'variants.1.versionId' });
  });

  it('rejects a version that was deleted as not found', async () => {
    const db = fakeDb({ versions: { [VERSION_A]: OFFICIAL_VERSIONS[VERSION_A] } });

    const { response, json } = await quote({}, db);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ code: 'PROMPT_NOT_FOUND', field: 'variants.1.versionId' });
  });

  it('accepts an own private version for a session user', async () => {
    const db = fakeDb({ versions: { ...OFFICIAL_VERSIONS, [VERSION_B]: { source: 'user', owner_id: USER_ID, prompt_id: 'prompt-1' } }, prompts: { 'prompt-1': { visibility: 'private' } } });

    const { response } = await quote({}, db);

    expect(response.status).toBe(200);
  });

  it('rejects an own private version for a persona-scoped API key', async () => {
    const db = fakeDb({ versions: { ...OFFICIAL_VERSIONS, [VERSION_B]: { source: 'user', owner_id: USER_ID, prompt_id: 'prompt-1' } }, prompts: { 'prompt-1': { visibility: 'private' } } });
    const scoped = { ...AUTH, isApiKey: true, personaIds: ['00000000-0000-4000-8000-000000000001'] };

    const { response, json } = await quote({}, db, 5, scoped);

    expect(response.status).toBe(404);
    expect(json.code).toBe('PROMPT_NOT_FOUND');
  });

  it('rejects the same version twice', async () => {
    const body = experimentBody();
    body.variants[1].versionId = VERSION_A;

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'variants.1.versionId' });
  });

  it('rejects variants with a different number of videos', async () => {
    const body = experimentBody();
    body.variants[1].videos.pop();

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'variants.1.videos' });
  });

  it('rejects more than 40 videos in total', async () => {
    const body = experimentBody({}, 14);
    body.variants.push({ versionId: VERSION_C, videos: structuredClone(body.variants[0].videos) });

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'variants' });
  });
});

describe('quoteExperiment account and media', () => {
  it('rejects an account the user does not own', async () => {
    const db = fakeDb({ accounts: [{ provider: 'youtube', provider_account_id: 'someone-elses' }] });

    const { response, json } = await quote({}, db);

    expect(response.status).toBe(400);
    expect(json.code).toBe('SOCIAL_ACCOUNT_NOT_OWNED');
  });

  it('rejects an uploaded mediaId when the videos span more than one day', async () => {
    const body = experimentBody();
    const segments = segmentsFor();
    segments[0].media = [{ mediaId: 'upload-1' }, ...(segments[0].media ?? []).slice(1)];
    body.variants[0].videos[2].segments = segments;

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'variants.0.videos.2.segments' });
  });

  it('rejects a script that breaks the segment rules, naming the video', async () => {
    const body = experimentBody();
    body.variants[1].videos[3].segments = [{ kind: 'content', text: 'no hook first' }];

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.field).toContain('variants.1.videos.3');
  });
});

describe('parseExperimentRequest', () => {
  function requestOf(body: unknown): Request {
    return new Request('https://app.test/api/experiments', { method: 'POST', body: JSON.stringify(body) });
  }

  it('accepts a valid body', async () => {
    const parsed = await parseExperimentRequest(requestOf(experimentBody()));

    expect(parsed).toMatchObject({ account: { provider: 'youtube', accountId: 'acct-1' } });
  });

  it('rejects two accounts: exactly one provider and one account id', async () => {
    const body = { ...experimentBody(), account: [{ provider: 'youtube', accountId: 'a' }, { provider: 'instagram', accountId: 'b' }] };

    const parsed = await parseExperimentRequest(requestOf(body));

    expect(parsed).toBeInstanceOf(Response);
    expect((parsed as Response).status).toBe(400);
  });

  it('rejects a per-variant override of a shared knob', async () => {
    const body = experimentBody();
    const variants = body.variants.map((variant) => ({ ...variant, videoType: 'hook_lipsync' }));

    const parsed = await parseExperimentRequest(requestOf({ ...body, variants }));

    expect((parsed as Response).status).toBe(400);
  });

  it('rejects a quoteKey without its expiresAt', async () => {
    const parsed = await parseExperimentRequest(requestOf({ ...experimentBody(), quoteKey: 'a'.repeat(64) }));

    expect((parsed as Response).status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const parsed = await parseExperimentRequest(new Request('https://app.test/api/experiments', { method: 'POST', body: '{nope' }));

    expect((parsed as Response).status).toBe(400);
  });
});
