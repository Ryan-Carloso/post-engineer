import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { buildPairFacts, checkExperimentLink, ExperimentLinkSchema, pairMismatch, verifyExperimentPairAfterInsert, type PairFacts } from '../experiment-link';
import type { PersonaPrep } from '../persona-prep';

//---------------
// Experiment link checks for generate-and-schedule (issue #476). The
// Supabase mock records each query's filters and answers per table, like
// PostgREST: a select chain ending in maybeSingle() or awaited directly.
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';
const USER_ID = 'user-1';
const SCHEDULE_ID = 'sched-current';

const SEGMENTS = [
  { kind: 'hook', text: 'Stop doing squats like this.' },
  { kind: 'body', text: 'Your knees track over your toes and the load moves.', media: [{ url: 'https://x/a.png' }] },
  { kind: 'cta', text: 'Follow for more.' },
];

function facts(overrides: Partial<PairFacts> = {}): PairFacts {
  return {
    providers: ['youtube'],
    accountIds: { youtube: ['chan-1'] },
    pinterestBoardId: null,
    voiceId: 'kokoro:af_heart',
    videoType: 'hook_lipsync',
    segments: [{ ...SEGMENTS[0], text: 'Your squat is hurting you.' }, SEGMENTS[1], SEGMENTS[2]],
    title: 'Squat form',
    voiceAudioUrl: null,
    videoAspect: '9:16',
    videoLayout: 'standard',
    paragraphNumber: 3,
    faceQuality: 'ok',
    language: 'en-US',
    niche: 'fitness',
    ctaText: 'Follow for more.',
    ...overrides,
  };
}

interface Tables {
  experiment?: { data: unknown; error: unknown };
  variants?: { data: unknown; error: unknown };
  slots?: { data: unknown; error: unknown };
  schedule?: { data: unknown; error: unknown };
}

function supabaseMock(tables: Tables) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const answers: Record<string, { data: unknown; error: unknown } | undefined> = {
    experiments: tables.experiment,
    experiment_variants: tables.variants,
    scheduled_posts: tables.slots,
    schedules: tables.schedule,
  };
  const client = {
    from(table: string) {
      const answer = answers[table] ?? { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push({ table, column, value });
          return chain;
        },
        maybeSingle: () => Promise.resolve(answer),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve),
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, filters };
}

const OK_EXPERIMENT = { data: { id: EXPERIMENT_ID, persona_id: 'persona-1', target_pairs: 6 }, error: null };
const OK_VARIANTS = { data: [{ variant_id: 'hook-calm' }, { variant_id: 'hook-aggressive' }], error: null };
const PARTNER_SCHEDULE = {
  data: {
    providers: ['youtube'],
    post_voice_id: 'kokoro:af_heart',
    post_voice_audio_url: null,
    post_video_aspect: '9:16',
    post_video_layout: 'standard',
    post_paragraph_number: 3,
    post_face_quality: 'ok',
    post_language: 'en-US',
    post_niche: 'fitness',
    post_cta_text: 'Follow for more.',
    youtube_account_ids: ['chan-1'],
    instagram_account_ids: [],
    linkedin_account_ids: [],
    bluesky_account_ids: [],
    threads_account_ids: [],
  },
  error: null,
};
// jsonb reorders keys: the stored partner segments come back reordered.
const PARTNER_SLOT = {
  schedule_id: 'sched-partner',
  variant_id: 'hook-calm',
  video_type: 'hook_lipsync',
  title: 'Squat form',
  segments: [
    { text: SEGMENTS[0].text, kind: 'hook' },
    { media: [{ url: 'https://x/a.png' }], text: SEGMENTS[1].text, kind: 'body' },
    { text: SEGMENTS[2].text, kind: 'cta' },
  ],
};

function run(tables: Tables, overrides: { personaId?: string | null; pair?: number; variantId?: string; facts?: PairFacts } = {}) {
  const mock = supabaseMock(tables);
  const promise = checkExperimentLink(mock.client, {
    link: { experimentId: EXPERIMENT_ID, variantId: overrides.variantId ?? 'hook-aggressive', pair: overrides.pair ?? 1 },
    userId: USER_ID,
    personaId: overrides.personaId === undefined ? 'persona-1' : overrides.personaId,
    replayScheduleId: SCHEDULE_ID,
    facts: overrides.facts ?? facts(),
  });
  return { promise, filters: mock.filters };
}

describe('ExperimentLinkSchema', () => {
  it('accepts a uuid, a slug and a pair in range; rejects the rest and unknown keys', () => {
    expect(ExperimentLinkSchema.safeParse({ experimentId: EXPERIMENT_ID, variantId: 'hook-calm', pair: 1 }).success).toBe(true);
    expect(ExperimentLinkSchema.safeParse({ experimentId: 'nope', variantId: 'hook-calm', pair: 1 }).success).toBe(false);
    expect(ExperimentLinkSchema.safeParse({ experimentId: EXPERIMENT_ID, variantId: 'A', pair: 1 }).success).toBe(false);
    expect(ExperimentLinkSchema.safeParse({ experimentId: EXPERIMENT_ID, variantId: 'hook-calm', pair: 0 }).success).toBe(false);
    expect(ExperimentLinkSchema.safeParse({ experimentId: EXPERIMENT_ID, variantId: 'hook-calm', pair: 21 }).success).toBe(false);
    expect(ExperimentLinkSchema.safeParse({ experimentId: EXPERIMENT_ID, variantId: 'hook-calm', pair: 1, extra: 1 }).success).toBe(false);
  });
});

describe('checkExperimentLink', () => {
  it('accepts the first video of a pair and scopes every query to the user', async () => {
    const { promise, filters } = run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [], error: null } });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(filters).toContainEqual({ table: 'experiments', column: 'user_id', value: USER_ID });
    // The variants query is scoped through the experiment id the ownership query used.
    const ownedId = filters.find((f) => f.table === 'experiments' && f.column === 'id')?.value;
    expect(ownedId).toBe(EXPERIMENT_ID);
    expect(filters).toContainEqual({ table: 'experiment_variants', column: 'experiment_id', value: ownedId });
    expect(filters).toContainEqual({ table: 'scheduled_posts', column: 'user_id', value: USER_ID });
    expect(filters).toContainEqual({ table: 'scheduled_posts', column: 'experiment_pair', value: 1 });
  });

  it('accepts the second video when only the hook differs (jsonb key order ignored)', async () => {
    const { promise, filters } = run({
      experiment: OK_EXPERIMENT,
      variants: OK_VARIANTS,
      slots: { data: [PARTNER_SLOT], error: null },
      schedule: PARTNER_SCHEDULE,
    });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(filters).toContainEqual({ table: 'schedules', column: 'id', value: 'sched-partner' });
    expect(filters).toContainEqual({ table: 'schedules', column: 'user_id', value: USER_ID });
  });

  it('404 for an unknown or foreign experiment', async () => {
    await expect(run({ experiment: { data: null, error: null } }).promise).resolves.toMatchObject({
      ok: false, status: 404, field: 'experiment.experimentId',
    });
  });

  it('400 when the persona differs from the experiment persona (null included)', async () => {
    await expect(run({ experiment: OK_EXPERIMENT }, { personaId: 'persona-2' }).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'personaId' });
    await expect(run({ experiment: OK_EXPERIMENT }, { personaId: null }).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'personaId' });
    const faceless = { data: { id: EXPERIMENT_ID, persona_id: null, target_pairs: 3 }, error: null };
    await expect(
      run({ experiment: faceless, variants: OK_VARIANTS, slots: { data: [], error: null } }, { personaId: null }).promise,
    ).resolves.toEqual({ ok: true });
  });

  it('400 when the pair is past target_pairs', async () => {
    await expect(run({ experiment: OK_EXPERIMENT }, { pair: 7 }).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'experiment.pair' });
  });

  it('400 for a variant that is not part of the experiment', async () => {
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS }, { variantId: 'hook-other' }).promise).resolves.toMatchObject({
      ok: false, status: 400, field: 'experiment.variantId',
    });
  });

  it('409 for a second video of the same variant in the pair; a same-schedule replay passes', async () => {
    const taken = { data: [{ ...PARTNER_SLOT, variant_id: 'hook-aggressive' }], error: null };
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: taken }).promise).resolves.toMatchObject({ ok: false, status: 409 });
    const replay = { data: [{ ...PARTNER_SLOT, variant_id: 'hook-aggressive', schedule_id: SCHEDULE_ID }], error: null };
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: replay }).promise).resolves.toEqual({ ok: true });
  });

  it('409 on a failed same-variant slot of another schedule says the video failed and how to clear it; any other status keeps the plain message', async () => {
    const failedSlot = { data: [{ ...PARTNER_SLOT, variant_id: 'hook-aggressive', status: 'failed' }], error: null };
    const failed = await run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: failedSlot }).promise;
    expect(failed).toMatchObject({ ok: false, status: 409, field: 'experiment.variantId', message: expect.stringContaining('failed') });
    expect(failed).toMatchObject({ message: expect.stringContaining('delete_slot') });
    const generating = { data: [{ ...PARTNER_SLOT, variant_id: 'hook-aggressive', status: 'generating' }], error: null };
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: generating }).promise).resolves.toMatchObject({
      ok: false, status: 409, message: 'This pair already has a video for this variant.',
    });
  });

  it('a failed slot on the same schedule is still a replay', async () => {
    const replay = { data: [{ ...PARTNER_SLOT, variant_id: 'hook-aggressive', schedule_id: SCHEDULE_ID, status: 'failed' }], error: null };
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: replay }).promise).resolves.toEqual({ ok: true });
  });

  it('treats null query data as empty and a null experiment persona as no persona', async () => {
    const nullData = { data: null, error: null };
    await expect(run({ experiment: OK_EXPERIMENT, variants: nullData }).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'experiment.variantId' });
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: nullData }).promise).resolves.toEqual({ ok: true });
    const faceless = { data: { id: EXPERIMENT_ID, persona_id: null, target_pairs: 3 }, error: null };
    await expect(run({ experiment: faceless, variants: OK_VARIANTS, slots: nullData }, { personaId: null }).promise).resolves.toEqual({ ok: true });
  });

  it('500 when the partner schedule lookup returns an error alongside data', async () => {
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule: { data: PARTNER_SCHEDULE.data, error: { message: 'boom' } } };
    await expect(run(tables).promise).resolves.toMatchObject({ ok: false, status: 500, field: 'experiment.pair' });
  });

  it('500 when the stored partner slot carries an unknown video_type (corrupt row, never a mode to compare)', async () => {
    const corrupt = { data: [{ ...PARTNER_SLOT, video_type: 'sideways' }], error: null };
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: corrupt, schedule: PARTNER_SCHEDULE };
    await expect(run(tables).promise).resolves.toMatchObject({ ok: false, status: 500, field: 'experiment.pair' });
  });

  it('accepts a two-provider pair whose second provider has no account list on either side', async () => {
    const schedule = { data: { ...PARTNER_SCHEDULE.data, providers: ['youtube', 'bluesky'] }, error: null };
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule };
    await expect(run(tables, { facts: facts({ providers: ['youtube', 'bluesky'], accountIds: { youtube: ['chan-1'] } }) }).promise).resolves.toEqual({ ok: true });
  });

  it('400 when the second video breaks pair fairness', async () => {
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule: PARTNER_SCHEDULE };
    await expect(run(tables, { facts: facts({ segments: SEGMENTS }) }).promise).resolves.toMatchObject({
      ok: false, status: 400, field: 'options.segments', message: expect.stringContaining('hook must differ'),
    });
    await expect(run(tables, { facts: facts({ accountIds: { youtube: ['chan-2'] } }) }).promise).resolves.toMatchObject({
      ok: false, status: 400, field: 'publishing.accounts.youtube',
    });
  });

  it('500 (logged) when a lookup fails, never a silent pass', async () => {
    const failed = { data: null, error: { message: 'boom' } };
    await expect(run({ experiment: failed }).promise).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(run({ experiment: OK_EXPERIMENT, variants: failed }).promise).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: failed }).promise).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(
      run({ experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule: { data: null, error: null } }).promise,
    ).resolves.toMatchObject({ ok: false, status: 500 });
  });
});

describe('pairMismatch', () => {
  const partner = facts({ segments: SEGMENTS });

  it('passes when only the hook differs', () => {
    expect(pairMismatch(partner, facts())).toBeNull();
  });

  it('names the first differing field', () => {
    expect(pairMismatch(partner, facts({ providers: ['youtube', 'bluesky'] }))?.field).toBe('publishing.providers');
    expect(pairMismatch(partner, facts({ voiceId: 'other' }))?.field).toBe('options.voiceId');
    expect(pairMismatch(partner, facts({ videoType: 'faceless' }))?.field).toBe('options.videoType');
    expect(pairMismatch(partner, facts({ videoType: 'full_lipsync' }))?.field).toBe('options.videoType');
    expect(pairMismatch(partner, facts({ title: 'Other title' }))?.field).toBe('title');
    expect(pairMismatch(partner, facts({ voiceAudioUrl: 'https://x/v.mp3' }))?.field).toBe('options.audioUrl');
    expect(pairMismatch(partner, facts({ videoAspect: '16:9' }))?.field).toBe('options.videoAspect');
    expect(pairMismatch(partner, facts({ videoLayout: 'react' }))?.field).toBe('options.videoLayout');
    expect(pairMismatch(partner, facts({ paragraphNumber: 4 }))?.field).toBe('options.paragraphNumber');
    expect(pairMismatch(partner, facts({ faceQuality: 'very_good' }))?.field).toBe('options.faceQuality');
    expect(pairMismatch(partner, facts({ language: 'pt-BR' }))?.field).toBe('options.language');
    expect(pairMismatch(partner, facts({ niche: 'cooking' }))?.field).toBe('options.niche');
    expect(pairMismatch(partner, facts({ ctaText: 'Subscribe.' }))?.field).toBe('options.ctaText');
    const pinterestPartner = facts({ providers: ['pinterest'], accountIds: { pinterest: ['u1'] }, pinterestBoardId: 'b1', segments: SEGMENTS });
    expect(pairMismatch(pinterestPartner, facts({ providers: ['pinterest'], accountIds: { pinterest: ['u1'] }, pinterestBoardId: 'b2' }))?.field).toBe('publishing.pinterestBoardId');
    expect(pairMismatch(pinterestPartner, facts({ providers: ['pinterest'], accountIds: { pinterest: ['u1'] }, pinterestBoardId: 'b1' }))).toBeNull();
    const otherBody = facts({ segments: [{ kind: 'hook', text: 'New hook.' }, { kind: 'body', text: 'Different body.' }, SEGMENTS[2]] });
    expect(pairMismatch(partner, otherBody)?.message).toContain('body and CTA segments must be identical');
  });

  it('compares account lists regardless of order', () => {
    const two = facts({ accountIds: { youtube: ['chan-1', 'chan-2'] } });
    expect(pairMismatch(two, facts({ accountIds: { youtube: ['chan-2', 'chan-1'] }, segments: [{ kind: 'hook', text: 'x.' }, SEGMENTS[1], SEGMENTS[2]] }))).toBeNull();
  });
});

describe('checkExperimentLink partner settings', () => {
  it('400 on options.videoAspect when the stored partner schedule differs', async () => {
    const schedule = { data: { ...PARTNER_SCHEDULE.data, post_video_aspect: '16:9' }, error: null };
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule };
    await expect(run(tables).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'options.videoAspect' });
  });

  it('400 on title when the stored partner slot differs', async () => {
    const slots = { data: [{ ...PARTNER_SLOT, title: 'Another topic' }], error: null };
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots, schedule: PARTNER_SCHEDULE };
    await expect(run(tables).promise).resolves.toMatchObject({ ok: false, status: 400, field: 'title' });
  });

  it('400 on publishing.pinterestBoardId when the stored partner schedule uses another board', async () => {
    const schedule = { data: { ...PARTNER_SCHEDULE.data, providers: ['pinterest'], pinterest_account_ids: ['u1'], pinterest_board_id: 'b1' }, error: null };
    const tables = { experiment: OK_EXPERIMENT, variants: OK_VARIANTS, slots: { data: [PARTNER_SLOT], error: null }, schedule };
    await expect(
      run(tables, { facts: facts({ providers: ['pinterest'], accountIds: { pinterest: ['u1'] }, pinterestBoardId: 'b2' }) }).promise,
    ).resolves.toMatchObject({ ok: false, status: 400, field: 'publishing.pinterestBoardId' });
  });
});

describe('verifyExperimentPairAfterInsert', () => {
  function verify(tables: Tables, overrides: { facts?: PairFacts } = {}) {
    const mock = supabaseMock(tables);
    const promise = verifyExperimentPairAfterInsert(mock.client, {
      link: { experimentId: EXPERIMENT_ID, variantId: 'hook-aggressive', pair: 1 },
      userId: USER_ID,
      facts: overrides.facts ?? facts(),
    });
    return { promise, filters: mock.filters };
  }
  const OWN_SLOT = { ...PARTNER_SLOT, schedule_id: SCHEDULE_ID, variant_id: 'hook-aggressive' };

  it('passes when no partner exists yet (only the own slot is visible)', async () => {
    const { promise, filters } = verify({ slots: { data: [OWN_SLOT], error: null } });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(filters).toContainEqual({ table: 'scheduled_posts', column: 'user_id', value: USER_ID });
    expect(filters).toContainEqual({ table: 'scheduled_posts', column: 'experiment_pair', value: 1 });
  });

  it('passes when the committed partner differs only in the hook', async () => {
    const { promise, filters } = verify({ slots: { data: [OWN_SLOT, PARTNER_SLOT], error: null }, schedule: PARTNER_SCHEDULE });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(filters).toContainEqual({ table: 'schedules', column: 'id', value: 'sched-partner' });
  });

  it('400 with the field when a partner that committed meanwhile mismatches', async () => {
    const schedule = { data: { ...PARTNER_SCHEDULE.data, post_niche: 'cooking' }, error: null };
    const { promise } = verify({ slots: { data: [OWN_SLOT, PARTNER_SLOT], error: null }, schedule });
    await expect(promise).resolves.toMatchObject({ ok: false, status: 400, field: 'options.niche' });
  });

  it('treats null pair data as no partner', async () => {
    await expect(verify({ slots: { data: null, error: null } }).promise).resolves.toEqual({ ok: true });
  });

  it('fails closed (500) when the pair or partner schedule cannot be read', async () => {
    await expect(verify({ slots: { data: null, error: { message: 'boom' } } }).promise).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(
      verify({ slots: { data: [OWN_SLOT, PARTNER_SLOT], error: null }, schedule: { data: null, error: null } }).promise,
    ).resolves.toMatchObject({ ok: false, status: 500 });
  });
});

describe('buildPairFacts', () => {
  it('defaults a missing voice id and audio URL to null and keeps the requested video type', () => {
    const prep = { faceless: false, faceQuality: null, voiceIdValue: undefined, niche: null, ctaText: null, language: null, videoAspect: null, videoLayout: null, paragraphNumber: null } as unknown as PersonaPrep;
    expect(buildPairFacts({ providers: [], accountIds: {}, pinterestBoardId: undefined, prep, title: 'T', segments: [], videoType: 'hook_lipsync', audioUrl: 'https://x/v.mp3' })).toMatchObject({
      voiceId: null, videoType: 'hook_lipsync', voiceAudioUrl: 'https://x/v.mp3', pinterestBoardId: null,
    });
  });

  it('maps the resolved request values exactly as the route stores them', () => {
    const prep = {
      faceless: true, faceQuality: 'ok', voiceIdValue: 'v1', niche: 'fitness', ctaText: 'Go.', language: 'en-US',
      videoAspect: '9:16', videoLayout: 'standard', paragraphNumber: 3,
    } as unknown as PersonaPrep;
    expect(
      buildPairFacts({ providers: ['youtube'], accountIds: { youtube: ['a'] }, pinterestBoardId: 'b1', prep, title: 'T', segments: [], videoType: 'full_lipsync', audioUrl: undefined }),
    ).toEqual({
      providers: ['youtube'], accountIds: { youtube: ['a'] }, pinterestBoardId: 'b1', voiceId: 'v1', videoType: 'full_lipsync', segments: [], title: 'T',
      voiceAudioUrl: null, videoAspect: '9:16', videoLayout: 'standard', paragraphNumber: 3, faceQuality: 'ok',
      language: 'en-US', niche: 'fitness', ctaText: 'Go.',
    });
  });
});
