import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostEngineerClient } from '../client.js';

describe('generatePersonaVideo pacing options', () => {
  let client: PostEngineerClient;

  beforeEach(() => {
    client = new PostEngineerClient({ apiKey: 'test-token-123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          schedule: { id: 'sch-1', mode: 'scheduled' },
          slots: [],
          replayed: false,
        }),
    });
  });

  it('forwards the clip duration, transition mode and variation seed in the request body', async () => {
    await client.generatePersonaVideo({
      personaId: 'persona-123',
      title: 'Launch a SaaS in days',
      description: 'Agent description.',
      providers: ['youtube'],
      youtubeAccountIds: ['chan-1'],
      startAt: '2026-10-05T20:00:00',
      times: ['20:00'],
      timezone: 'Europe/Lisbon',
      options: {
        videoType: 'voiceover',
        videoClipDuration: 4,
        videoTransitionMode: 'Crossfade',
        videoVariationSeed: 7,
      },
    });
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { options: Record<string, unknown> };
    expect(body.options.videoClipDuration).toBe(4);
    expect(body.options.videoTransitionMode).toBe('Crossfade');
    expect(body.options.videoVariationSeed).toBe(7);
  });

  it('forwards the subtitle position and custom height in the request body', async () => {
    await client.generatePersonaVideo({
      personaId: 'persona-123',
      title: 'Launch a SaaS in days',
      description: 'Agent description.',
      providers: ['youtube'],
      youtubeAccountIds: ['chan-1'],
      startAt: '2026-10-05T20:00:00',
      times: ['20:00'],
      timezone: 'Europe/Lisbon',
      options: {
        videoType: 'voiceover',
        subtitlePosition: 'top',
      },
    });
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { options: Record<string, unknown> };
    expect(body.options.subtitlePosition).toBe('top');
    await client.generatePersonaVideo({
      personaId: 'persona-123',
      title: 'Launch a SaaS in days',
      description: 'Agent description.',
      providers: ['youtube'],
      youtubeAccountIds: ['chan-1'],
      startAt: '2026-10-05T20:00:00',
      times: ['20:00'],
      timezone: 'Europe/Lisbon',
      options: {
        videoType: 'voiceover',
        subtitlePosition: 'custom',
        subtitleCustomPosition: 20,
      },
    });
    const second = vi.mocked(global.fetch).mock.calls[1]?.[1];
    const secondBody = JSON.parse(String(second?.body)) as { options: Record<string, unknown> };
    expect(secondBody.options.subtitlePosition).toBe('custom');
    expect(secondBody.options.subtitleCustomPosition).toBe(20);
  });
});
