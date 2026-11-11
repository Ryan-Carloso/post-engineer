import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import {
  AddExperimentPairSchema,
  CreateExperimentSchema,
  handleAddExperimentPair,
  handleCreateExperiment,
  handleGetExperimentResults,
  handleListExperiments,
  shiftStartAt,
} from '../tools-experiments.js';

//---------------
// Paired A/B experiment tools (issue #476). The client is mocked at its
// boundary: request() for the /api/experiments routes and
// generatePersonaVideo() for the two videos of a pair.
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';

function scheduled(id: string) {
  return { success: true, schedule: { id, mode: 'scheduled' }, slots: [{ slotId: `slot-${id}`, slotAt: '2026-11-10T18:00:00Z', title: 'Gym', taskId: `task-${id}`, status: 'generating' }], replayed: false };
}

function failedSlot(id: string, replayed: boolean) {
  const base = scheduled(id);
  return { ...base, slots: [{ ...base.slots[0], status: 'failed' }], replayed };
}

function mockClient(overrides: Partial<Record<'request' | 'generatePersonaVideo', ReturnType<typeof vi.fn>>> = {}) {
  const client = {
    request: overrides.request ?? vi.fn(async () => ({ success: true })),
    getHeaders: () => ({ Authorization: 'Bearer k' }),
    generatePersonaVideo: overrides.generatePersonaVideo ?? vi.fn(async (input: { experiment: { variantId: string } }) => scheduled(input.experiment.variantId)),
  };
  return client as unknown as PostEngineerClient & typeof client;
}

function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const BODY = [
  { kind: 'body' as const, text: 'Most people bounce at the bottom of the squat, which moves the load off the legs and onto the lower back, so slow the last inch down and pause before you drive up again. Keep your chest tall, brace like someone is about to poke your stomach, and let the bar travel in a straight line over the middle of your foot on every single rep.', media: photos(9, 'body') },
  { kind: 'cta' as const, text: 'Follow for one fix a day.', media: photos(1, 'cta') },
];

function pairArgs(overrides: Record<string, unknown> = {}) {
  return AddExperimentPairSchema.parse({
    experimentId: EXPERIMENT_ID,
    pair: 1,
    title: 'Gym',
    description: 'Agent description.',
    segments: BODY,
    hooks: [
      { variantId: 'hook-calm', text: 'Here is a small squat detail that quietly changes how your legs grow over the next few months.', media: photos(3, 'hook-calm') },
      { variantId: 'hook-aggressive', text: 'Stop squatting like this right now, because you are wrecking your back and wasting every single leg day.', media: photos(3, 'hook-aggressive') },
    ],
    personaId: '11111111-2222-4333-8444-555555555555',
    providers: ['youtube'],
    youtubeAccountIds: ['chan-1'],
    startAt: '2026-11-10T18:00:00',
    times: ['18:00'],
    timezone: 'Europe/Lisbon',
    options: { videoType: 'hook_lipsync' as const },
    ...overrides,
  });
}

describe('shiftStartAt', () => {
  it('keeps a naive startAt naive (wall clock) and shifts an absolute one', () => {
    expect(shiftStartAt('2026-11-10T18:00:00', 24)).toBe('2026-11-11T18:00:00');
    expect(shiftStartAt('2026-11-10T18:00:00Z', 24)).toBe('2026-11-11T18:00:00.000Z');
    expect(shiftStartAt('2026-11-10T18:00:00+01:00', 2)).toBe('2026-11-10T19:00:00.000Z');
  });
});

describe('add_experiment_pair', () => {
  it('creates both videos: hook first, shared body and CTA, link, deterministic keys, second one spaced', async () => {
    const client = mockClient();
    const response = await handleAddExperimentPair(client, pairArgs());
    expect(response.isError).toBeUndefined();
    const calls = client.generatePersonaVideo.mock.calls.map((call) => call[0]);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.experiment)).toEqual([
      { experimentId: EXPERIMENT_ID, variantId: 'hook-calm', pair: 1 },
      { experimentId: EXPERIMENT_ID, variantId: 'hook-aggressive', pair: 1 },
    ]);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([
      `exp-${EXPERIMENT_ID}-p1-hook-calm`,
      `exp-${EXPERIMENT_ID}-p1-hook-aggressive`,
    ]);
    expect(calls.map((c) => c.startAt)).toEqual(['2026-11-10T18:00:00', '2026-11-11T18:00:00']);
    for (const call of calls) {
      expect(call.options.segments.slice(1)).toEqual(BODY);
      expect(call.options.segments[0].kind).toBe('hook');
      expect(call.title).toBe('Gym');
    }
    expect(calls[1].options.segments[0].text).toContain('Stop squatting');
    expect(response.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Pair 1 of experiment') });
  });

  it('alternates the order on even pairs and keeps asap videos unscheduled', async () => {
    const client = mockClient();
    await handleAddExperimentPair(client, pairArgs({ pair: 2 }));
    expect(client.generatePersonaVideo.mock.calls.map((call) => call[0].experiment.variantId)).toEqual(['hook-aggressive', 'hook-calm']);
    const asap = mockClient();
    await handleAddExperimentPair(asap, pairArgs({ mode: 'asap', startAt: undefined, times: undefined }));
    expect(asap.generatePersonaVideo.mock.calls.map((call) => call[0].startAt)).toEqual([undefined, undefined]);
  });

  it('stops at the first failure; a second-video failure says how to resume', async () => {
    const first = mockClient({ generatePersonaVideo: vi.fn(async () => { throw new Error('INSUFFICIENT_TOKENS'); }) });
    const failedFirst = await handleAddExperimentPair(first, pairArgs());
    expect(failedFirst.isError).toBe(true);
    expect(first.generatePersonaVideo).toHaveBeenCalledTimes(1);
    expect(failedFirst.content[0]).toMatchObject({ text: expect.not.stringContaining('call add_experiment_pair again') });

    const second = mockClient({
      generatePersonaVideo: vi.fn()
        .mockResolvedValueOnce(scheduled('hook-calm'))
        .mockRejectedValueOnce(new Error('This pair already has a video for this variant.')),
    });
    const failedSecond = await handleAddExperimentPair(second, pairArgs());
    expect(failedSecond.isError).toBe(true);
    expect(failedSecond.content[0]).toMatchObject({ text: expect.stringContaining('call add_experiment_pair again with the same arguments') });
  });

  it('treats a failed slot on the first video as a failure and stops before the second', async () => {
    const client = mockClient({ generatePersonaVideo: vi.fn(async () => failedSlot('hook-calm', true)) });
    const response = await handleAddExperimentPair(client, pairArgs());
    expect(response.isError).toBe(true);
    expect(client.generatePersonaVideo).toHaveBeenCalledTimes(1);
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    expect(text).toContain('slot slot-hook-calm');
    expect(text).toContain('NOT created');
    expect(text).toContain('next free pair number');
    expect(text).not.toContain('created (2 videos)');
    expect(text).not.toContain('was created and stays');
  });

  it('treats a failed slot on the second video as a failure and says the first one stays', async () => {
    const client = mockClient({
      generatePersonaVideo: vi.fn().mockResolvedValueOnce(scheduled('hook-calm')).mockResolvedValueOnce(failedSlot('hook-aggressive', false)),
    });
    const response = await handleAddExperimentPair(client, pairArgs());
    expect(response.isError).toBe(true);
    expect(client.generatePersonaVideo).toHaveBeenCalledTimes(2);
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    expect(text).toContain('slot slot-hook-aggressive');
    expect(text).toContain('The hook-calm video of pair 1 was created and stays');
  });

  it('a replayed failed second video (retry on the same keys) is still a failure, never "created"', async () => {
    const client = mockClient({
      generatePersonaVideo: vi.fn().mockResolvedValueOnce({ ...scheduled('hook-calm'), replayed: true }).mockResolvedValueOnce(failedSlot('hook-aggressive', true)),
    });
    const response = await handleAddExperimentPair(client, pairArgs());
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ text: expect.not.stringContaining('created (2 videos)') });
  });

  it('rejects a hook inside segments, identical hooks and one variant twice before any call', () => {
    expect(() => pairArgs({ segments: [{ kind: 'hook', text: 'x.' }, ...BODY] })).toThrow();
    expect(() => pairArgs({ hooks: [{ variantId: 'hook-calm', text: 'Same hook text.' }, { variantId: 'hook-aggressive', text: 'Same hook text.' }] })).toThrow();
    expect(() => pairArgs({ hooks: [{ variantId: 'hook-calm', text: 'One.' }, { variantId: 'hook-calm', text: 'Two.' }] })).toThrow();
  });
});

describe('create / list / results tools', () => {
  it('create_experiment posts the hook variable, null persona when omitted and both variants', async () => {
    const client = mockClient();
    const args = CreateExperimentSchema.parse({
      name: 'Hook test',
      variants: [
        { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
        { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
      ],
    });
    expect(args.targetPairs).toBe(6);
    await handleCreateExperiment(client, args);
    const [path, init] = client.request.mock.calls[0];
    expect(path).toBe('/api/experiments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, variants: args.variants });
    expect(() => CreateExperimentSchema.parse({ ...args, variants: [{ variantId: 'A', name: 'a', description: 'a' }, args.variants[1]] })).toThrow();
  });

  it('accepts a null persona (faceless) and rejects duplicate variant ids', async () => {
    const client = mockClient();
    const variants = [
      { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
      { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
    ];
    const args = CreateExperimentSchema.parse({ name: 'Hook test', personaId: null, variants });
    expect(args.personaId).toBeNull();
    await handleCreateExperiment(client, args);
    expect(JSON.parse(client.request.mock.calls[0][1].body).personaId).toBeNull();
    const duplicate = CreateExperimentSchema.safeParse({ name: 'Hook test', variants: [variants[0], { ...variants[1], variantId: 'hook-calm' }] });
    expect(duplicate.success).toBe(false);
    expect(JSON.stringify(duplicate.error?.issues)).toContain('variantId values must differ');
  });

  it('list_experiments and get_experiment_results call their routes', async () => {
    const client = mockClient();
    await handleListExperiments(client);
    await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID, window: '28d' });
    await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID });
    expect(client.request.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ['/api/experiments', 'GET'],
      [`/api/experiments/${EXPERIMENT_ID}?window=28d`, 'GET'],
      [`/api/experiments/${EXPERIMENT_ID}`, 'GET'],
    ]);
  });

  it('surfaces a route error as a tool error', async () => {
    const client = mockClient({ request: vi.fn(async () => { throw new Error('Experiment not found.'); }) });
    const response = await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID });
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ text: expect.stringContaining('Experiment not found.') });
  });
});
