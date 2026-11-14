import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { PostEngineerClient } from '../client.js';
import { GenerateVideoSchema, handleGenerateVideo } from '../generate-video.js';
import type { McpToolResponse } from '../tools-call.js';

// generate_video (issue #566): one call generates one video or a batch, and
// the persona and accounts are given by name or id. Every reference of every
// video is resolved BEFORE the first video is created, and the result echoes
// what was resolved.

const MARIA = '11111111-1111-4111-8111-111111111111';
const JOAO = '22222222-2222-4222-8222-222222222222';

const HOOK = 'Most people burn out because they train every single day without any plan, and here is the simple weekly structure that fixes it for good.';
const CONTENT_1 = 'Start with three focused sessions a week, each one built around a single goal, so your body can recover and your progress keeps moving forward instead of stalling.';
const CONTENT_2 = 'Track every session in a simple notebook, review it on Sunday, and change only one thing at a time, because small and steady adjustments beat dramatic restarts.';
const SEGMENTS = [
  { kind: 'hook' as const, text: HOOK },
  { kind: 'content' as const, text: CONTENT_1 },
  { kind: 'content' as const, text: CONTENT_2 },
];

type Args = z.input<typeof GenerateVideoSchema>;
type Video = Args['videos'][number];

function video(overrides: Partial<Video> = {}): Video {
  return {
    persona: 'Maria',
    title: 'Training plan',
    description: 'A simple weekly structure.',
    segments: SEGMENTS,
    mode: 'asap',
    options: { videoType: 'full_lipsync' },
    ...overrides,
  };
}

function parse(args: Args): z.output<typeof GenerateVideoSchema> {
  return GenerateVideoSchema.parse(args);
}

function scheduled(id: string) {
  return { success: true, schedule: { id, mode: 'asap' }, slots: [{ slotId: `slot-${id}`, slotAt: null, title: 'Training plan', taskId: `task-${id}`, status: 'generating' }], replayed: false };
}

interface Fakes {
  client: PostEngineerClient;
  generatePersonaVideo: ReturnType<typeof vi.fn>;
  listPersonas: ReturnType<typeof vi.fn>;
  listSocialAccounts: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

function fakes(options: { personas?: unknown; accounts?: unknown; bound?: unknown; generate?: ReturnType<typeof vi.fn> } = {}): Fakes {
  const generatePersonaVideo = options.generate ?? vi.fn(async () => scheduled('s1'));
  const listPersonas = vi.fn(async () => options.personas ?? { personas: [{ id: MARIA, name: 'Maria' }, { id: JOAO, name: 'João' }] });
  const listSocialAccounts = vi.fn(async () => options.accounts ?? { accounts: [{ provider: 'youtube', channelId: 'UC1', channelName: 'Maria Cooks' }, { provider: '3speak', providerAccountId: 'maria-hive', accountName: 'Maria Hive' }] });
  const request = vi.fn(async (path: string) => {
    if (path.startsWith('/api/persona/publishing-accounts')) return options.bound ?? { success: true, defaults: { youtube: ['UC1'], bluesky: ['did:plc:abc'] } };
    if (path === '/api/videos/batch-discount') {
      return { success: true, faceVideos: 2, earnedFreeVideos: 0, freeVideos: [], discountTokens: 0, chargedTokens: 6, videos: 2, warnings: [] };
    }
    throw new Error(`unexpected request ${path}`);
  });
  const client = { generatePersonaVideo, listPersonas, listSocialAccounts, request, getHeaders: () => ({}) } as unknown as PostEngineerClient;
  return { client, generatePersonaVideo, listPersonas, listSocialAccounts, request };
}

const text = (response: McpToolResponse): string => response.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

describe('generate_video: one video', () => {
  it('creates the video in one call from a persona name, publishing to the bound accounts, and echoes what it resolved', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video()] }));
    expect(response.isError).not.toBe(true);
    expect(f.generatePersonaVideo).toHaveBeenCalledTimes(1);
    const sent = f.generatePersonaVideo.mock.calls[0][0];
    expect(sent.personaId).toBe(MARIA);
    expect(sent.providers).toEqual(['youtube', 'bluesky']);
    // Bound accounts are the server default: the account arrays stay unset.
    expect(sent.youtubeAccountIds).toBeUndefined();
    expect(text(response)).toContain(`Resolved: persona "Maria" → ${MARIA}`);
    expect(text(response)).toContain("publishing to the persona's bound accounts: youtube (UC1); bluesky (did:plc:abc)");
  });

  it('takes the persona id as given, without listing personas', async () => {
    const f = fakes();
    await handleGenerateVideo(f.client, parse({ videos: [video({ persona: MARIA, providers: ['youtube'] })] }));
    expect(f.listPersonas).not.toHaveBeenCalled();
    expect(f.generatePersonaVideo.mock.calls[0][0].personaId).toBe(MARIA);
  });

  it('resolves accounts by name, reads each network from the account and fills the per-provider arrays', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video({ accounts: ['Maria Cooks', 'maria-hive'] })] }));
    expect(response.isError).not.toBe(true);
    const sent = f.generatePersonaVideo.mock.calls[0][0];
    expect(sent.providers).toEqual(['youtube', '3speak']);
    expect(sent.youtubeAccountIds).toEqual(['UC1']);
    expect(sent.threespeakAccountIds).toEqual(['maria-hive']);
    expect(text(response)).toContain('account "Maria Cooks" → youtube UC1');
    expect(f.listSocialAccounts).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit providers without accounts (the server falls back to the bound ones) and never reads the binding', async () => {
    const f = fakes();
    await handleGenerateVideo(f.client, parse({ videos: [video({ providers: ['youtube'] })] }));
    expect(f.request).not.toHaveBeenCalled();
    expect(f.generatePersonaVideo.mock.calls[0][0].providers).toEqual(['youtube']);
  });

  it('rejects an account on a network outside the explicit providers, before creating anything', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video({ providers: ['instagram'], accounts: ['Maria Cooks'] })] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('Account "Maria Cooks" is on youtube, which is not in providers (instagram)');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('forwards the idempotencyKey of a single video', async () => {
    const f = fakes();
    await handleGenerateVideo(f.client, parse({ videos: [video({ providers: ['youtube'] })], idempotencyKey: 'once-1' }));
    expect(f.generatePersonaVideo.mock.calls[0][0].idempotencyKey).toBe('once-1');
  });

  it('answers an ambiguous persona with candidates and creates nothing', async () => {
    const f = fakes({ personas: { personas: [{ id: MARIA, name: 'Maria' }, { id: JOAO, name: 'maria' }] } });
    const response = await handleGenerateVideo(f.client, parse({ videos: [video()] }));
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(text(response))).toMatchObject({ ambiguous: true, actionTaken: false });
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('answers an unknown persona with the way to list them and creates nothing', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video({ persona: 'Ghost' })] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('No persona named "Ghost"');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('asks where to publish when a video has neither a persona nor providers or accounts', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video({ persona: undefined })] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('needs providers or accounts');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('fails when the persona has no bound accounts and none were given', async () => {
    const f = fakes({ bound: { success: true, defaults: { youtube: [] } } });
    const response = await handleGenerateVideo(f.client, parse({ videos: [video()] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('no bound publishing accounts');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('fails clearly when the binding cannot be read', async () => {
    const f = fakes();
    f.request.mockRejectedValueOnce(new Error('down'));
    const response = await handleGenerateVideo(f.client, parse({ videos: [video()] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain("Error reading the persona's publishing accounts: down");
  });

  it('treats a malformed binding as no binding', async () => {
    const f = fakes({ bound: { success: true } });
    const response = await handleGenerateVideo(f.client, parse({ videos: [video()] }));
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('no bound publishing accounts');
  });

  it('keeps a faceless video (no persona) working with explicit providers', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(f.client, parse({ videos: [video({ persona: undefined, providers: ['youtube'], segments: SEGMENTS.map((segment, index) => ({ ...segment, media: ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ url: `https://example.com/${index}-${name}.jpg` })) })), options: { videoType: 'faceless', audioUrl: 'https://example.com/voice.mp3' } })] }));
    expect(response.isError, text(response)).not.toBe(true);
    expect(f.generatePersonaVideo).toHaveBeenCalledTimes(1);
    expect(f.generatePersonaVideo.mock.calls[0][0].personaId).toBeUndefined();
    expect(text(response)).toContain('no references to resolve');
  });
});

describe('generate_video: batch', () => {
  it('requires a batchKey for several videos and rejects an idempotencyKey', async () => {
    const f = fakes();
    const two = [video({ providers: ['youtube'] }), video({ persona: 'João', providers: ['youtube'] })];
    const noKey = await handleGenerateVideo(f.client, parse({ videos: two }));
    expect(noKey.isError).toBe(true);
    expect(text(noKey)).toContain('batchKey is required with 2 videos');
    const both = await handleGenerateVideo(f.client, parse({ videos: two, batchKey: 'b1', idempotencyKey: 'x' }));
    expect(both.isError).toBe(true);
    expect(text(both)).toContain('idempotencyKey is for one video');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('rejects a batchKey on a single video and an experiment inside a batch', async () => {
    const f = fakes();
    const single = await handleGenerateVideo(f.client, parse({ videos: [video({ providers: ['youtube'] })], batchKey: 'b1' }));
    expect(single.isError).toBe(true);
    expect(text(single)).toContain('batchKey is for a batch of 2 or more videos');
    const experiment = { experimentId: '33333333-3333-4333-8333-333333333333', variantId: 'hook-calm', pair: 1 };
    const withExperiment = await handleGenerateVideo(
      f.client,
      parse({ videos: [video({ providers: ['youtube'], experiment }), video({ providers: ['youtube'] })], batchKey: 'b1' }),
    );
    expect(withExperiment.isError).toBe(true);
    expect(text(withExperiment)).toContain('experiments (action: add_pair)');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('creates every video with the deterministic batch key, applies the discount and echoes each video', async () => {
    const f = fakes({ generate: vi.fn(async (input: { personaId: string }) => scheduled(input.personaId === MARIA ? 'a' : 'b')) });
    const response = await handleGenerateVideo(
      f.client,
      parse({ videos: [video({ providers: ['youtube'] }), video({ persona: 'João', providers: ['youtube'] })], batchKey: 'launch-1' }),
    );
    expect(response.isError).not.toBe(true);
    const keys = f.generatePersonaVideo.mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys).toEqual(['batch-launch-1-v1', 'batch-launch-1-v2']);
    expect(f.generatePersonaVideo.mock.calls.map((call) => call[0].personaId)).toEqual([MARIA, JOAO]);
    expect(f.request).toHaveBeenCalledWith('/api/videos/batch-discount', expect.objectContaining({ method: 'POST' }), 'apply batch discount');
    expect(text(response)).toContain('Created 2 video(s) in batch launch-1.');
    expect(text(response)).toContain(`Video 1: persona "Maria" → ${MARIA}`);
    expect(text(response)).toContain(`Video 2: persona "João" → ${JOAO}`);
  });

  it('resolves every video before creating the first one: a bad persona in video 2 creates nothing, and says which video', async () => {
    const f = fakes();
    const response = await handleGenerateVideo(
      f.client,
      parse({ videos: [video({ providers: ['youtube'] }), video({ persona: 'Ghost', providers: ['youtube'] })], batchKey: 'launch-1' }),
    );
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('Video 2 of 2: No persona named "Ghost"');
    expect(f.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('reads the personas and accounts listings once for the whole batch', async () => {
    const f = fakes();
    await handleGenerateVideo(
      f.client,
      parse({ videos: [video({ accounts: ['Maria Cooks'] }), video({ persona: 'João', accounts: ['Maria Cooks'] })], batchKey: 'launch-1' }),
    );
    expect(f.listPersonas).toHaveBeenCalledTimes(1);
    expect(f.listSocialAccounts).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failing video and keeps the replay instructions of the batch', async () => {
    const f = fakes({ generate: vi.fn().mockResolvedValueOnce(scheduled('a')).mockRejectedValueOnce(new Error('INSUFFICIENT_TOKENS')) });
    const response = await handleGenerateVideo(
      f.client,
      parse({ videos: [video({ providers: ['youtube'] }), video({ providers: ['youtube'] })], batchKey: 'launch-1' }),
    );
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('Batch launch-1 stopped: 1 of 2 video(s) created.');
    expect(text(response)).toContain('same batchKey');
  });
});

describe('generate_video: schema', () => {
  it('has no per-network account arrays: accounts is one list of names or ids', () => {
    const shape = GenerateVideoSchema.shape.videos.element.shape;
    for (const key of ['youtubeAccountIds', 'instagramAccountIds', 'blueskyAccountIds', 'personaId']) {
      expect(shape, key).not.toHaveProperty(key);
    }
    expect(shape).toHaveProperty('accounts');
    expect(shape).toHaveProperty('persona');
  });

  it('allows 1 to 12 videos and no more', () => {
    expect(GenerateVideoSchema.safeParse({ videos: [] }).success).toBe(false);
    expect(GenerateVideoSchema.safeParse({ videos: Array.from({ length: 13 }, () => video()), batchKey: 'b' }).success).toBe(false);
    expect(GenerateVideoSchema.safeParse({ videos: Array.from({ length: 12 }, () => video()), batchKey: 'b' }).success).toBe(true);
  });

  it('rejects a field of the old per-network shape (strict item)', () => {
    expect(GenerateVideoSchema.safeParse({ videos: [{ ...video(), youtubeAccountIds: ['UC1'] }] }).success).toBe(false);
  });
});
