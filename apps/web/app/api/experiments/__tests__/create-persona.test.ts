// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/experiments/read-comparison', () => ({ readPromptComparison: vi.fn() }));
vi.mock('@/lib/generation/custom-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/generation/custom-audio')>()),
  checkCustomAudioUrl: vi.fn(),
}));
vi.mock('@/lib/persona-publishing-accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/persona-publishing-accounts')>()),
  getPersonaDefaultAccounts: vi.fn(),
}));
vi.mock('../../videos/generate-and-schedule/aspect-preflight', () => ({ checkPreChargePreflights: vi.fn().mockResolvedValue(null) }));
vi.mock('../../videos/generate-and-schedule/library-photo', () => ({ validatePreChargeImageId: vi.fn().mockResolvedValue(null) }));
vi.mock('../../videos/generate-and-schedule/prepare-persona', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../videos/generate-and-schedule/prepare-persona')>();
  return { ...actual, preparePost: vi.fn(), persistVoiceSwap: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('@/lib/generation/video-generation', () => ({
  startEngineVideoTask: vi.fn(),
  recordGenerationStart: vi.fn().mockResolvedValue(undefined),
  recordGenerationUpdate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/billing/refund-tokens', () => ({
  refundSlotTokens: vi.fn().mockResolvedValue({ refunded: true, alreadyRefunded: false }),
}));

import { checkCustomAudioUrl } from '@/lib/generation/custom-audio';
import { startEngineVideoTask } from '@/lib/generation/video-generation';
import { readPromptComparison } from '@/lib/experiments/read-comparison';
import { emptyPersonaDefaultAccounts, getPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { VOICE_FALLBACK_REASONS } from '@/lib/voice-fallback';
import { resolvePostWithoutPersona, type PersonaPrep } from '../../videos/generate-and-schedule/persona-prep';
import { persistVoiceSwap, preparePost } from '../../videos/generate-and-schedule/prepare-persona';
import { confirmExperiment } from '../create-confirm';
import { quoteExperiment } from '../create-quote';
import { AUTH, TEST_ENCRYPTION_KEY, USER_ID, experimentBody, fakeDb, segmentsFor } from './create-fixtures';

const PERSONA = '11111111-2222-4333-8444-555555555555';
const OTHER_PERSONA = '99999999-2222-4333-8444-555555555555';
const NOW = new Date();
const SCOPED = { ...AUTH, isApiKey: true, personaIds: [PERSONA, 'not-a-uuid'] };

function prep(overrides: Partial<PersonaPrep> = {}): PersonaPrep {
  return { ...resolvePostWithoutPersona({}), personaName: 'Maria', ...overrides };
}

function withCtaTake(segments: ReturnType<typeof segmentsFor>): ReturnType<typeof segmentsFor> {
  return segments.map((segment, index) => (index === segments.length - 1 ? { ...segment, cta: true } : segment));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', TEST_ENCRYPTION_KEY);
  vi.mocked(readPromptComparison).mockResolvedValue({ ok: true, value: { window: '7d', accounts: [], truncated: false }, unversioned: [] });
  vi.mocked(preparePost).mockResolvedValue(prep());
  vi.mocked(checkCustomAudioUrl).mockResolvedValue({ ok: true });
  vi.mocked(getPersonaDefaultAccounts).mockResolvedValue({ ...emptyPersonaDefaultAccounts(), youtube: ['acct-1'] });
  vi.mocked(startEngineVideoTask).mockImplementation(async (_userId, payload) => ({
    ok: true,
    taskId: `task-${(payload as { slot_id: string }).slot_id}`,
    body: {},
  }));
});

describe('persona scope', () => {
  it('answers 403 PERSONA_SCOPE_DENIED for a persona outside the key scope, before anything is prepared', async () => {
    const response = await quoteExperiment(fakeDb().client, SCOPED, experimentBody({ personaId: OTHER_PERSONA }), NOW);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PERSONA_SCOPE_DENIED', field: 'personaId' });
    expect(preparePost).not.toHaveBeenCalled();
  });

  it('quotes a persona inside the key scope', async () => {
    const response = await quoteExperiment(fakeDb().client, SCOPED, experimentBody({ personaId: PERSONA }), NOW);

    expect(response.status).toBe(200);
    expect(preparePost).toHaveBeenCalledTimes(1);
  });

  it('reads the history of a scoped key through its well-formed persona ids only', async () => {
    await quoteExperiment(fakeDb().client, SCOPED, experimentBody({ personaId: PERSONA }), NOW);

    expect(vi.mocked(readPromptComparison).mock.calls[0]?.[1]).toMatchObject({ userId: USER_ID, personaIds: [PERSONA] });
  });

  it('reads the whole history of an unscoped caller', async () => {
    await quoteExperiment(fakeDb().client, AUTH, experimentBody({ personaId: PERSONA }), NOW);

    expect(vi.mocked(readPromptComparison).mock.calls[0]?.[1]).toMatchObject({ personaIds: null });
  });
});

describe('custom audio', () => {
  const audioBody = () => experimentBody({ options: { audioUrl: 'https://cdn.test/narration.mp3' } });

  it('refuses a quote whose audioUrl fails the check, naming the field', async () => {
    vi.mocked(checkCustomAudioUrl).mockResolvedValue({ ok: false, error: 'audioUrl must be a public file.' });

    const response = await quoteExperiment(fakeDb().client, AUTH, audioBody(), NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'options.audioUrl', error: 'audioUrl must be a public file.' });
    expect(preparePost).not.toHaveBeenCalled();
  });

  it('checks the audioUrl once for the whole experiment, not once per video', async () => {
    const response = await quoteExperiment(fakeDb().client, AUTH, audioBody(), NOW);

    expect(response.status).toBe(200);
    expect(checkCustomAudioUrl).toHaveBeenCalledTimes(1);
    expect(checkCustomAudioUrl).toHaveBeenCalledWith('https://cdn.test/narration.mp3');
  });

  it('does not call the check when no audioUrl is sent', async () => {
    await quoteExperiment(fakeDb().client, AUTH, experimentBody(), NOW);

    expect(checkCustomAudioUrl).not.toHaveBeenCalled();
  });
});

describe('persona CTA take', () => {
  const cta = { type: 'follow', url: null, instruction: null } as const;

  function ctaBody(markedFrom: number) {
    const body = experimentBody({ personaId: PERSONA });
    let index = 0;
    for (const variant of body.variants) {
      for (const video of variant.videos) {
        video.segments = index >= markedFrom ? withCtaTake(segmentsFor()) : segmentsFor();
        index += 1;
      }
    }
    return body;
  }

  it('refuses a video with no CTA take when the persona has a CTA, naming that video', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ cta }));
    const body = experimentBody({ personaId: PERSONA });
    for (const variant of body.variants) for (const video of variant.videos) video.segments = withCtaTake(segmentsFor());
    body.variants[1].videos[2].segments = segmentsFor();

    const response = await quoteExperiment(fakeDb().client, AUTH, body, NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'variants.1.videos.2.segments' });
  });

  it('refuses a marked take on a persona whose CTA is off', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ cta: null }));

    const response = await quoteExperiment(fakeDb().client, AUTH, ctaBody(0), NOW);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'variants.0.videos.0.segments' });
  });

  it('quotes when every video carries its CTA take', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ cta }));

    const response = await quoteExperiment(fakeDb().client, AUTH, ctaBody(0), NOW);

    expect(response.status).toBe(200);
  });
});

describe('voice fallback', () => {
  const fallback = { fromVoice: 'chatterbox:gone', toVoice: 'chatterbox:kokoro_af_heart', reason: VOICE_FALLBACK_REASONS.VOICE_MISSING };

  async function confirmed(personaId: string | null) {
    const body = experimentBody(personaId === null ? {} : { personaId });
    const quote = await (await quoteExperiment(fakeDb().client, AUTH, body, NOW)).json();
    const db = fakeDb();
    const response = await confirmExperiment(db.client, AUTH, { ...body, quoteKey: quote.quoteKey, expiresAt: quote.expiresAt }, NOW);
    return { response, db };
  }

  it('persists the swapped voice on the persona after the charge', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ voiceFallback: fallback }));

    const { response, db } = await confirmed(PERSONA);

    expect(response.status).toBe(200);
    expect(persistVoiceSwap).toHaveBeenCalledTimes(1);
    expect(persistVoiceSwap).toHaveBeenCalledWith(db.client, USER_ID, PERSONA, fallback);
    expect(db.rpcCalls.map((call) => call.name)).toContain('spend_tokens');
  });

  it('warns about the swapped voice in the quote', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ voiceFallback: fallback }));
    const body = experimentBody({ personaId: PERSONA });

    const quote = await (await quoteExperiment(fakeDb().client, AUTH, body, NOW)).json();

    expect(quote.warnings.map((warning: { code: string }) => warning.code)).toContain('voice_fallback_applied');
  });

  it('persists nothing when there is no swap', async () => {
    const { response } = await confirmed(PERSONA);

    expect(response.status).toBe(200);
    expect(persistVoiceSwap).not.toHaveBeenCalled();
  });

  it('persists nothing for a swap without a persona', async () => {
    vi.mocked(preparePost).mockResolvedValue(prep({ voiceFallback: fallback }));

    const { response } = await confirmed(null);

    expect(response.status).toBe(200);
    expect(persistVoiceSwap).not.toHaveBeenCalled();
  });
});
