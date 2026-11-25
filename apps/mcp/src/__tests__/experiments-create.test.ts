import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostEngineerClient } from '../client.js';
import { handleCreateExperiment, withExperimentRefs, type CreateExperimentArgs, type CreateExperimentInput } from '../tools-experiments.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const QUOTE_KEY = 'a'.repeat(64);
const EXPIRES_AT = '2030-01-01T00:15:00.000Z';

function videos(label: string, count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    title: `${label} ${index + 1}`,
    description: `${label} copy ${index + 1}`,
    segments: [{ kind: 'hook', text: `${label} hook ${index + 1}.` }],
  }));
}

function args(overrides: Partial<CreateExperimentArgs> = {}): CreateExperimentArgs {
  return {
    account: { provider: 'youtube', accountId: 'acct-1' },
    videoType: 'voiceover',
    options: { voiceId: 'chatterbox:kokoro_af_heart' },
    startAt: '2030-01-01T00:00:00.000Z',
    times: ['09:00', '18:00'],
    timezone: 'UTC',
    variants: [
      { versionId: VERSION_A, videos: videos('A') },
      { versionId: VERSION_B, videos: videos('B') },
    ],
    ...overrides,
  };
}

const QUOTE_RESPONSE = {
  success: true,
  stage: 'quote',
  quoteKey: QUOTE_KEY,
  expiresAt: EXPIRES_AT,
  perVideoTokens: 1,
  totalTokens: 10,
  videos: 10,
  slots: [{ slotAt: '2030-01-01T09:00:00.000Z', versionId: VERSION_A, title: 'A 1' }],
  warnings: [{ code: 'EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM', videosPerVariant: 5, minimumVideos: 7, groups: 2 }],
};

const CONFIRMED_RESPONSE = {
  success: true,
  stage: 'confirmed',
  scheduleId: 'schedule-1',
  replayed: false,
  chargedTokens: 10,
  slots: [
    { slotId: 'slot-1', slotAt: '2030-01-01T09:00:00.000Z', title: 'A 1', versionId: VERSION_A, taskId: 'task-1', status: 'generating' },
  ],
  warnings: [],
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function client(): PostEngineerClient {
  return new PostEngineerClient({ apiKey: 'key-1', baseUrl: 'https://api.test' });
}

describe('experiments create handler', () => {
  it('posts the arguments to /api/experiments as a quote and tells the agent how to confirm', async () => {
    fetchMock.mockResolvedValue(respond(200, QUOTE_RESPONSE));

    const result = await handleCreateExperiment(client(), args());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/experiments');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-1');
    expect(JSON.parse(String(init.body))).toMatchObject({ account: { provider: 'youtube', accountId: 'acct-1' }, videoType: 'voiceover' });
    expect(JSON.parse(String(init.body)).quoteKey).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(result.isError).toBeUndefined();
    expect(text).toContain('nothing was charged');
    expect(text).toContain('quoteKey');
    expect(text).toContain(QUOTE_KEY);
    expect(text).toContain('EXPERIMENT_SAMPLE_BELOW_CLEAR_MINIMUM');
  });

  it('confirms with the quote key and expiry and reports the schedule to cancel', async () => {
    fetchMock.mockResolvedValue(respond(200, CONFIRMED_RESPONSE));

    const result = await handleCreateExperiment(client(), args({ quoteKey: QUOTE_KEY, expiresAt: EXPIRES_AT }));

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ quoteKey: QUOTE_KEY, expiresAt: EXPIRES_AT });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Experiment created');
    expect(text).toContain('schedule-1');
    expect(text).toContain('schedules (action: cancel)');
  });

  it('sends one script per video untouched', async () => {
    fetchMock.mockResolvedValue(respond(200, QUOTE_RESPONSE));

    await handleCreateExperiment(client(), args());

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const sent = args();
    expect(body.variants).toEqual(sent.variants);
    const titles = body.variants.flatMap((variant: { videos: Array<{ title: string }> }) => variant.videos.map((video) => video.title));
    expect(new Set(titles).size).toBe(10);
  });

  it('refuses a quoteKey without its expiresAt before any request', async () => {
    const result = await handleCreateExperiment(client(), args({ quoteKey: QUOTE_KEY }));

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('quoteKey');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a body that breaks the contract before any request', async () => {
    const result = await handleCreateExperiment(client(), args({ variants: [{ versionId: VERSION_A, videos: videos('A') }] }));

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('variants');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a variant that overrides a shared knob', async () => {
    const result = await handleCreateExperiment(
      client(),
      args({ variants: [{ versionId: VERSION_A, videoType: 'hook_lipsync', videos: videos('A') }, { versionId: VERSION_B, videos: videos('B') }] }),
    );

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a changed quote as an error the agent can act on', async () => {
    fetchMock.mockResolvedValue(
      respond(409, { success: false, error: 'The price or the plan changed since the quote. Ask for a new quote and confirm that one.', code: 'QUOTE_CHANGED' }),
    );

    const result = await handleCreateExperiment(client(), args({ quoteKey: QUOTE_KEY, expiresAt: EXPIRES_AT }));

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Ask for a new quote');
  });

  it('rejects a 200 that is not a quote or a created experiment', async () => {
    fetchMock.mockResolvedValue(respond(200, { success: true, stage: 'other' }));

    const result = await handleCreateExperiment(client(), args());

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Malformed response');
  });
});

const PERSONA_ID = '33333333-3333-4333-8333-333333333333';

function listings(client: PostEngineerClient, accountEntries: Array<Record<string, unknown>>): void {
  vi.spyOn(client, 'listPersonas').mockResolvedValue({ authenticated: true, personas: [{ id: PERSONA_ID, name: 'Maria', niche: 'cooking' }] } as never);
  vi.spyOn(client, 'listSocialAccounts').mockResolvedValue({ authenticated: true, accounts: accountEntries } as never);
}

function input(overrides: Partial<CreateExperimentInput> = {}): CreateExperimentInput {
  const { personaId: _unused, ...rest } = args();
  return { ...rest, ...overrides };
}

describe('experiments create refs', () => {
  const run = vi.fn(async (_resolved: CreateExperimentArgs) => ({ content: [{ type: 'text' as const, text: 'ran' }] }));

  beforeEach(() => {
    run.mockClear();
  });

  it('resolves the persona and the account by name before anything is sent', async () => {
    const api = client();
    listings(api, [{ provider: 'youtube', channelId: 'UC-maria', channelName: 'Maria Cooks' }]);

    const result = await withExperimentRefs(api, input({ persona: 'maria', account: { provider: 'youtube', accountId: 'Maria Cooks' } }), run);

    expect(result.isError).toBeUndefined();
    const resolved = run.mock.calls[0]?.[0];
    expect(resolved?.personaId).toBe(PERSONA_ID);
    expect(resolved?.account).toEqual({ provider: 'youtube', accountId: 'UC-maria' });
    expect(resolved).not.toHaveProperty('persona');
  });

  it('passes an account id and a persona id through unchanged', async () => {
    const api = client();
    listings(api, [{ provider: 'youtube', channelId: 'UC-maria', channelName: 'Maria Cooks' }]);

    await withExperimentRefs(api, input({ persona: PERSONA_ID, account: { provider: 'youtube', accountId: 'UC-maria' } }), run);

    expect(run.mock.calls[0]?.[0]).toMatchObject({ personaId: PERSONA_ID, account: { provider: 'youtube', accountId: 'UC-maria' } });
  });

  it('keeps the account of the named provider when another network has the same name', async () => {
    const api = client();
    listings(api, [
      { provider: 'youtube', channelId: 'UC-maria', channelName: 'Maria' },
      { provider: 'instagram', igUserId: '9', username: 'maria' },
    ]);

    await withExperimentRefs(api, input({ account: { provider: 'instagram', accountId: 'Maria' } }), run);

    expect(run.mock.calls[0]?.[0].account).toEqual({ provider: 'instagram', accountId: '9' });
  });

  it('answers an unknown account name with an error and runs nothing', async () => {
    const api = client();
    listings(api, [{ provider: 'youtube', channelId: 'UC-maria', channelName: 'Maria Cooks' }]);

    const result = await withExperimentRefs(api, input({ account: { provider: 'youtube', accountId: 'Nobody' } }), run);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('No account matches "Nobody"');
    expect(run).not.toHaveBeenCalled();
  });

  it('answers an ambiguous account name with the candidates and runs nothing', async () => {
    const api = client();
    listings(api, [
      { provider: 'youtube', channelId: 'UC-1', channelName: 'Maria' },
      { provider: 'youtube', channelId: 'UC-2', channelName: 'maria' },
    ]);

    const result = await withExperimentRefs(api, input({ account: { provider: 'youtube', accountId: 'Maria' } }), run);

    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ ambiguous: true, actionTaken: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers an unknown persona name with an error and runs nothing', async () => {
    const api = client();
    listings(api, []);

    const result = await withExperimentRefs(api, input({ persona: 'Nobody' }), run);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('No persona named "Nobody"');
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves an account without a provider string to the contract check', async () => {
    const api = client();
    const accounts = vi.spyOn(api, 'listSocialAccounts');

    await withExperimentRefs(api, input({ account: { accountId: 'x' } }), run);

    expect(accounts).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
