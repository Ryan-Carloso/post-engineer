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
  { kind: 'body', text: 'Your knees track over your toes and the load moves.', media: { url: 'https://x/a.png' } },
  { kind: 'cta', text: 'Follow for more.' },
];

function facts(overrides: Partial<PairFacts> = {}): PairFacts {
  return {
    providers: ['youtube'],
    accountIds: { youtube: ['chan-1'] },
    voiceId: 'kokoro:af_heart',
    faceless: false,
    fullLipsync: false,
    segments: [{ ...SEGMENTS[0], text: 'Your squat is hurting you.' }, SEGMENTS[1], SEGMENTS[2]],
    title: 'Squat form',
    facelessMaterial: null,
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
  faceless: false,
  full_lipsync: false,
  title: 'Squat form',
  faceless_material: 'broll',
  segments: [
    { text: SEGMENTS[0].text, kind: 'hook' },
    { media: { url: 'https://x/a.png' }, text: SEGMENTS[1].text, kind: 'body' },
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
    expect(pairMismatch(partner, facts({ faceless: true }))?.field).toBe('options');
    expect(pairMismatch(partner, facts({ fullLipsync: true }))?.field).toBe('options');
    expect(pairMismatch(partner, facts({ title: 'Other title' }))?.field).toBe('title');
    expect(pairMismatch(partner, facts({ facelessMaterial: 'svg' }))?.field).toBe('options.facelessMaterial');
    expect(pairMismatch(partner, facts({ voiceAudioUrl: 'https://x/v.mp3' }))?.field).toBe('options.audioUrl');
    expect(pairMismatch(partner, facts({ videoAspect: '16:9' }))?.field).toBe('options.videoAspect');
    expect(pairMismatch(partner, facts({ videoLayout: 'react' }))?.field).toBe('options.videoLayout');
    expect(pairMismatch(partner, facts({ paragraphNumber: 4 }))?.field).toBe('options.paragraphNumber');
    expect(pairMismatch(partner, facts({ faceQuality: 'very_good' }))?.field).toBe('options.faceQuality');
    expect(pairMismatch(partner, facts({ language: 'pt-BR' }))?.field).toBe('options.language');
    expect(pairMismatch(partner, facts({ niche: 'cooking' }))?.field).toBe('options.niche');
    expect(pairMismatch(partner, facts({ ctaText: 'Subscribe.' }))?.field).toBe('options.ctaText');
    const otherBody = facts({ segments: [{ kind: 'hook', text: 'New hook.' }, { kind: 'body', text: 'Different body.' }, SEGMENTS[2]] });
    expect(pairMismatch(partner, otherBody)?.message).toContain('body and CTA segments must be identical');
  });

  it('compares account lists regardless of order', () => {
    const two = facts({ accountIds: { youtube: ['chan-1', 'chan-2'] } });
    expect(pairMismatch(two, facts({ accountIds: { youtube: ['chan-2', 'chan-1'] }, segments: [{ kind: 'hook', text: 'x.' }, SEGMENTS[1], SEGMENTS[2]] }))).toBeNull();
  });
});

describe('pairMismatch faceless material default', () => {
  it('treats an omitted material as the stored default broll', () => {
    const partner = facts({ facelessMaterial: 'broll', segments: SEGMENTS });
    expect(pairMismatch(partner, facts({ facelessMaterial: null }))).toBeNull();
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

  it('fails closed (500) when the pair or partner schedule cannot be read', async () => {
    await expect(verify({ slots: { data: null, error: { message: 'boom' } } }).promise).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(
      verify({ slots: { data: [OWN_SLOT, PARTNER_SLOT], error: null }, schedule: { data: null, error: null } }).promise,
    ).resolves.toMatchObject({ ok: false, status: 500 });
  });
});

describe('buildPairFacts', () => {
  it('maps the resolved request values exactly as the route stores them', () => {
    const prep = {
      faceless: true, faceQuality: 'ok', voiceIdValue: 'v1', niche: 'fitness', ctaText: 'Go.', language: 'en-US',
      videoAspect: '9:16', videoLayout: 'standard', paragraphNumber: 3,
    } as unknown as PersonaPrep;
    expect(
      buildPairFacts({ providers: ['youtube'], accountIds: { youtube: ['a'] }, prep, title: 'T', segments: [], fullLipsync: true, facelessMaterial: undefined, audioUrl: undefined }),
    ).toEqual({
      providers: ['youtube'], accountIds: { youtube: ['a'] }, voiceId: 'v1', faceless: true, fullLipsync: true, segments: [], title: 'T',
      facelessMaterial: null, voiceAudioUrl: null, videoAspect: '9:16', videoLayout: 'standard', paragraphNumber: 3, faceQuality: 'ok',
      language: 'en-US', niche: 'fitness', ctaText: 'Go.',
    });
  });
});
