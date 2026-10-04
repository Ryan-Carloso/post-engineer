import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PostEngineerClient,
  assertImageSize,
  MAX_LIBRARY_IMAGE_BYTES,
  MAX_LIBRARY_TAG_LENGTH,
  MAX_LIBRARY_DESCRIPTION_LENGTH,
} from '../client.js';
import { ImageTooLargeError } from '../errors.js';

describe('PostEngineerClient', () => {
  let client: PostEngineerClient;
  const baseUrl = 'https://post-engineer.com';
  const apiKey = 'test-token-123';

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey });
  });

  it('creates persona successfully', async () => {
    const mockResponse = {
      success: true,
      personaId: 'persona-123',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.createPersona({
      name: 'Tech Creator',
      avatarUrl: 'https://example.com/avatar.png',
      voiceId: 'voice-alloy',
      language: 'pt-BR',
      videoAspect: '9:16',
      scriptPrompt: 'Create tech reviews',
      niche: 'Technology',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    const formData = request?.body as FormData;
    expect(formData.get('name')).toBe('Tech Creator');
    expect(formData.get('avatarUrl')).toBe('https://example.com/avatar.png');
    // Faceless is a per-video choice now, never a persona field: the persona
    // payload carries no mode or mix fields at all.
    expect(formData.get('personaMode')).toBeNull();
    expect(formData.get('faceMixPercent')).toBeNull();
    expect(formData.get('faceQuality')).toBe('very_good');
    expect(new Headers(request?.headers).get('content-type')).toBeNull();
    expect(result).toEqual(mockResponse);
  });

  it('createPersona rejects a missing avatarUrl before any fetch', async () => {
    // Every persona has a face: the client fails fast with an actionable
    // error instead of uploading bytes the server would reject.
    global.fetch = vi.fn();
    await expect(client.createPersona({ name: 'No Face' } as never)).rejects.toThrow(
      /avatarUrl is required/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lists personas successfully', async () => {
    const mockList = {
      success: true,
      personas: [
        { id: 'p1', name: 'Persona 1' },
        { id: 'p2', name: 'Persona 2' },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockList),
    });

    const result = await client.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/list`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(result).toEqual(mockList);
  });

  it('lists voices successfully', async () => {
    const mockVoices = {
      voices: [{ id: 'calm' }, { id: 'energetic' }],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockVoices),
    });

    const result = await client.listVoices();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/voices`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(result).toEqual(mockVoices);
  });

  it('throws when listing voices fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Voices unavailable.',
    });

    await expect(client.listVoices()).rejects.toThrow(/Failed to list voices: 502/);
  });


  it('lists faces successfully', async () => {
    const mockFaces = {
      faces: [
        {
          id: 'file-1',
          url: 'https://post-engineer.com/caracter-samples/file-1.png',
          name: 'Character 1',
          gender: 'female',
          age: 23,
          ethnicity: 'White',
          hair: 'shoulder-length wavy blonde',
          description: 'Young blonde woman with light eyes, smiling in a casual selfie wearing a white tank top.',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockFaces),
    });

    const result = await client.listFaces();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/faces`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(result).toEqual(mockFaces);
  });

  it('throws when listing faces fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Faces unavailable.',
    });

    await expect(client.listFaces()).rejects.toThrow(/Failed to list faces: 502/);
  });

  it('updates persona with only provided fields as multipart', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ success: true })),
    });

    const result = await client.updatePersona({ personaId: 'persona-123', voiceId: 'energetic' });

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona?personaId=persona-123`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    const formData = request?.body as FormData;
    expect(formData.get('voiceId')).toBe('energetic');
    expect(formData.get('name')).toBeNull();
    expect(new Headers(request?.headers).get('content-type')).toBeNull();
    expect(result).toEqual({ success: true });
  });

  it('updatePersona omits empty-string avatarUrl (consistent with createPersona faceless mode)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ success: true })),
    });

    const result = await client.updatePersona({ personaId: 'persona-123', avatarUrl: '' });

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const formData = request?.body as FormData;
    expect(formData.has('avatarUrl')).toBe(false);
    expect(result).toEqual({ success: true });
  });

  it('throws when updating persona fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Persona not found.',
    });

    await expect(client.updatePersona({ personaId: 'missing' })).rejects.toThrow(
      /Failed to update persona: 404/
    );
  });

  it('lists social accounts successfully', async () => {
    const mockAccounts = {
      authenticated: true,
      accounts: [{ provider: 'youtube', channelId: 'chan-1' }],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockAccounts),
    });

    const result = await client.listSocialAccounts();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/account`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(result).toEqual(mockAccounts);
  });

  it('lists schedules successfully', async () => {
    const mockSchedules = { success: true, schedules: [{ id: 'sched-1' }] };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockSchedules),
    });

    const result = await client.listSchedules();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual(mockSchedules);
  });

  it('lists posts with the default limit', async () => {
    const mockPosts = {
      success: true,
      upcoming: [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending' }],
      recent: [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published' }],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockPosts),
    });

    const result = await client.listPosts();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule/status?limit=20`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
        }),
      })
    );
    expect(result).toEqual(mockPosts);
  });

  it('lists posts with a custom limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ success: true, upcoming: [], recent: [] })),
    });

    await client.listPosts(50);
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule/status?limit=50`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws a clear error when listing posts fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(client.listPosts()).rejects.toThrow('Failed to list posts: 401 Unauthorized');
  });

  it('cancels a schedule by id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ success: true })),
    });

    await client.cancelSchedule('sched-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule?id=sched-1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('gets the token balance successfully', async () => {
    const mockBalance = { success: true, balance: 8, free: 3 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockBalance),
    });

    const result = await client.getTokenBalance();
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/billing/tokens`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual(mockBalance);
  });

describe('generate and schedule videos client', () => {
  const baseUrl = 'https://post-engineer.com';
  let client: PostEngineerClient;

  const baseInput = {
    personaId: 'persona-123',
    topics: ['Launch a SaaS in days', 'Pricing lessons'],
    providers: ['youtube', 'bluesky'] as ('youtube' | 'bluesky')[],
    youtubeAccountIds: ['chan-1'],
    blueskyAccountIds: ['did:plc:abc'],
    startAt: '2026-10-05T20:00:00',
    times: ['20:00'],
    timezone: 'Europe/Lisbon',
  };

  beforeEach(() => {
    client = new PostEngineerClient({ apiKey: 'test-token-123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  function requestBody(callIndex = 0): Record<string, unknown> {
    const request = vi.mocked(global.fetch).mock.calls[callIndex]?.[1];
    return JSON.parse(String(request?.body)) as Record<string, unknown>;
  }

  function lastRequestBody(): Record<string, unknown> {
    const calls = vi.mocked(global.fetch).mock.calls;
    return requestBody(calls.length - 1);
  }

  it('posts to the unified generate-and-schedule endpoint with the mapped body', async () => {
    const result = await client.generatePersonaVideos(baseInput);

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/videos/generate-and-schedule`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
    const body = lastRequestBody();
    expect(body.personaId).toBe('persona-123');
    expect(body.topics).toEqual(['Launch a SaaS in days', 'Pricing lessons']);
    expect(body.publishing).toEqual({
      providers: ['youtube', 'bluesky'],
      accounts: { youtube: ['chan-1'], bluesky: ['did:plc:abc'] },
      schedule: {
        startAt: '2026-10-05T20:00:00',
        times: ['20:00'],
        timezone: 'Europe/Lisbon',
      },
    });
    expect(result).toEqual({ success: true });
  });

  it('nests each provider account array under publishing.accounts', async () => {
    await client.generatePersonaVideos({
      ...baseInput,
      instagramAccountIds: ['ig-1'],
      linkedinAccountIds: ['li-1'],
    });
    const publishing = lastRequestBody().publishing as Record<string, unknown>;
    expect(publishing.accounts).toEqual({
      youtube: ['chan-1'],
      bluesky: ['did:plc:abc'],
      instagram: ['ig-1'],
      linkedin: ['li-1'],
    });
  });

  it('sends an empty accounts record when no account arrays are provided', async () => {
    const { youtubeAccountIds: _yt, blueskyAccountIds: _bsky, ...rest } = baseInput;
    await client.generatePersonaVideos(rest);
    const publishing = lastRequestBody().publishing as Record<string, unknown>;
    expect(publishing.accounts).toEqual({});
  });

  it('defaults the schedule timezone to UTC when omitted', async () => {
    const { timezone: _timezone, ...rest } = baseInput;
    await client.generatePersonaVideos(rest);
    const publishing = lastRequestBody().publishing as Record<string, unknown>;
    expect((publishing.schedule as Record<string, unknown>).timezone).toBe('UTC');
  });

  it('forwards options and omits the key when options are absent', async () => {
    await client.generatePersonaVideos({
      ...baseInput,
      options: { faceless: true, voiceId: 'v-1' },
    });
    expect(lastRequestBody().options).toEqual({ faceless: true, voiceId: 'v-1' });

    await client.generatePersonaVideos(baseInput);
    expect('options' in lastRequestBody()).toBe(false);
  });

  it('forwards a caller-supplied idempotencyKey', async () => {
    await client.generatePersonaVideos({ ...baseInput, idempotencyKey: 'key-123' });
    expect(lastRequestBody().idempotencyKey).toBe('key-123');
  });

  it('generates a UUID idempotencyKey per call when omitted', async () => {
    await client.generatePersonaVideos(baseInput);
    const first = requestBody(0).idempotencyKey;
    await client.generatePersonaVideos(baseInput);
    const second = requestBody(1).idempotencyKey;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(first).toMatch(uuid);
    expect(second).toMatch(uuid);
    expect(first).not.toBe(second);
  });

  it('throws a structured ApiError carrying code and field on API errors', async () => {
    const { ApiError } = await import('../errors.js');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          success: false,
          error: 'Provide at least one video topic.',
          code: 'TOPICS_REQUIRED',
          field: 'topics',
        }),
    });

    const error: unknown = await client
      .generatePersonaVideos(baseInput)
      .catch((e: unknown) => e);

    if (!(error instanceof ApiError)) {
      throw new Error(`expected ApiError, got: ${String(error)}`);
    }
    expect(error.code).toBe('TOPICS_REQUIRED');
    expect(error.field).toBe('topics');
    expect(error.message).toContain('Failed to generate and schedule videos: 422');
    expect(error.message).toContain('Provide at least one video topic.');
  });
});

  it('retrieves video task status', async () => {
    const mockStatus = {
      success: true,
      status: 'completed',
      videoUrl: 'https://cdn.example.com/video.mp4',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockStatus),
    });

    const result = await client.getVideoStatus('task-abc-123');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/video-status/task-abc-123`,
      expect.objectContaining({
        method: 'GET',
      })
    );
    expect(result).toEqual(mockStatus);
  });


  it('gets the OAuth connect URL for a provider', async () => {
    const mockResponse = {
      success: true,
      auth_url: 'https://www.instagram.com/oauth/authorize?state=abc',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.getOAuthConnectUrl('instagram');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/account/connect-url`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ provider: 'instagram' }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws a clear error when the connect-url request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Authentication required.',
    });

    await expect(client.getOAuthConnectUrl('youtube')).rejects.toThrow(
      /Failed to get OAuth connect URL: 401/
    );
  });

  it('connects a Bluesky account with handle + app password', async () => {
    const mockResponse = { success: true, accountId: 'acc-1', did: 'did:plc:xyz' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.connectBlueskyAccount('user.bsky.social', 'app-password-123');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/bluesky-connect`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ handle: 'user.bsky.social', appPassword: 'app-password-123' }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws a clear error when the Bluesky connect request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid handle or app password.',
    });

    await expect(
      client.connectBlueskyAccount('user.bsky.social', 'wrong')
    ).rejects.toThrow(/Failed to connect Bluesky account: 400/);
  });
});

describe('PostEngineerClient configuration', () => {
  it('uses the default production URL when no override is given', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ ok: true })),
    });
    const c = new PostEngineerClient({ apiKey: 'k' });
    await c.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://post-engineer.com/api/persona/list',
      expect.anything()
    );
  });

  it('accepts a baseUrl override via options', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ ok: true })),
    });
    const c = new PostEngineerClient({ apiKey: 'k', baseUrl: 'https://staging.example.test' });
    await c.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://staging.example.test/api/persona/list',
      expect.anything()
    );
  });

  it('accepts a baseUrl override via POST_ENGINEER_API_URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ ok: true })),
    });
    const c = new PostEngineerClient({ apiKey: 'k' });
    const prev = process.env.POST_ENGINEER_API_URL;
    process.env.POST_ENGINEER_API_URL = 'https://env.example.test';
    try {
      const c2 = new PostEngineerClient({ apiKey: 'k' });
      await c2.listPersonas();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://env.example.test/api/persona/list',
        expect.anything()
      );
    } finally {
      if (prev === undefined) delete process.env.POST_ENGINEER_API_URL;
      else process.env.POST_ENGINEER_API_URL = prev;
    }
    void c;
  });

  it('never echoes the Bluesky app password when the API error body reflects the payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => `{"error":"invalid appPassword value 'hunter2-secret'"}`,
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    const error = await c.connectBlueskyAccount('user.bsky.social', 'hunter2-secret').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('hunter2-secret');
    expect((error as Error).message).toContain('[redacted]');
  });

  it('never echoes the percent-encoded Bluesky app password either', async () => {
    const password = 'p@ss word/123';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => `{"error":"bad value '${encodeURIComponent(password)}'"}`,
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    const error = await c.connectBlueskyAccount('user.bsky.social', password).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(encodeURIComponent(password));
    expect((error as Error).message).toContain('[redacted]');
  });

  it('never echoes the JSON-escaped Bluesky app password either', async () => {
    const password = 'p@ss"word\\123';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => `{"error":"bad value '${JSON.stringify(password).slice(1, -1)}'"}`,
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    const error = await c.connectBlueskyAccount('user.bsky.social', password).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(JSON.stringify(password).slice(1, -1));
    expect((error as Error).message).not.toContain(password);
    expect((error as Error).message).toContain('[redacted]');
  });

  it('rejects a non-http(s) POST_ENGINEER_API_URL override', () => {
    expect(() => new PostEngineerClient({ apiKey: 'k', baseUrl: 'javascript:alert(1)' })).toThrow(
      /POST_ENGINEER_API_URL/
    );
    expect(() => new PostEngineerClient({ apiKey: 'k', baseUrl: 'not-a-url' })).toThrow(
      /POST_ENGINEER_API_URL/
    );
  });

  it('rejects non-loopback http: base URLs (bearer key would travel in cleartext)', () => {
    expect(() => new PostEngineerClient({ apiKey: 'k', baseUrl: 'http://staging.example.com' })).toThrow(
      /POST_ENGINEER_API_URL/
    );
    // Loopback http is fine for local staging.
    expect(() => new PostEngineerClient({ apiKey: 'k', baseUrl: 'http://localhost:3000' })).not.toThrow();
    expect(() => new PostEngineerClient({ apiKey: 'k', baseUrl: 'http://127.0.0.1:8080' })).not.toThrow();
  });

  it('never echoes credentials embedded in a rejected base URL', () => {
    let message = '';
    try {
      new PostEngineerClient({ apiKey: 'k', baseUrl: 'javascript://user:s3cret@example.com/x' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/POST_ENGINEER_API_URL/);
    expect(message).not.toContain('s3cret');
  });

  it('cancelSchedule resolves an ok sentinel on 204 No Content instead of undefined', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.cancelSchedule('sched-123')).resolves.toEqual({ ok: true });
  });

  it('resolves an ok sentinel on 200 with an empty body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.listPersonas()).resolves.toEqual({ ok: true });
  });

  it('rejects a 200 response with a non-JSON body instead of reporting success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>proxy error page</html>',
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.cancelSchedule('sched-123')).rejects.toThrow(/not valid JSON/);
  });

  it('drops credentials embedded in the base URL userinfo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const c = new PostEngineerClient({ apiKey: 'k', baseUrl: 'https://user:pass@api.example.com/' });
    await c.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/api/persona/list', expect.anything());
  });

  it('strips a trailing slash from the base URL override', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const c = new PostEngineerClient({ apiKey: 'k', baseUrl: 'https://staging.example.com/' });
    await c.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://staging.example.com/api/persona/list',
      expect.anything()
    );
  });

  it('sends an abort signal so hung requests cannot block forever', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ ok: true })),
    });
    const c = new PostEngineerClient({ apiKey: 'k' });
    await c.listPersonas();
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('PostEngineerClient error truncation', () => {
  it('truncates long upstream error bodies', async () => {
    const longBody = 'x'.repeat(5000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => longBody,
    });
    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.listPersonas()).rejects.toThrow(/Failed to list personas: 500 /);
    try {
      await c.listPersonas();
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(1000);
    }
  });
});

describe('PostEngineerClient persona image library', () => {
  let client: PostEngineerClient;
  const baseUrl = 'https://post-engineer.com';
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey: 'test-token-123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTempImage(name: string, size = 4): Promise<string> {
    const { mkdtempSync } = await import('node:fs');
    const { writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pe-mcp-test-'));
    tempDirs.push(dir);
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(size, 0xff));
    return path;
  }

  function formDataOf(): FormData {
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    return request?.body as FormData;
  }

  it('createPersona uploads library images with parallel tags and descriptions', async () => {
    const first = await writeTempImage('a.jpg');
    const second = await writeTempImage('b.png');
    await client.createPersona({
      name: 'Tech Creator',
      avatarUrl: 'https://example.com/avatar.png',
      images: [
        { path: first, tag: 'casual', description: 'smiling at the beach' },
        { path: second, tag: 'formal' },
      ],
      imagePrimaryIndex: 1,
    });

    const formData = formDataOf();
    expect(formData.getAll('images')).toHaveLength(2);
    expect(JSON.parse(String(formData.get('imageTags')))).toEqual(['casual', 'formal']);
    expect(JSON.parse(String(formData.get('imageDescriptions')))).toEqual(['smiling at the beach', '']);
    expect(formData.get('imagePrimaryIndex')).toBe('1');
  });

  it('createPersona rejects more than 10 library images', async () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ path: `/tmp/img-${i}.jpg` }));
    await expect(
      client.createPersona({ name: 'X', avatarUrl: 'https://example.com/a.png', images })
    ).rejects.toThrow(/At most 10 library images/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona rejects an out-of-range imagePrimaryIndex', async () => {
    const path = await writeTempImage('a.jpg');
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path }],
        imagePrimaryIndex: 1,
      })
    ).rejects.toThrow(/out of range/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona validates imagePrimaryIndex before reading any file', async () => {
    // A nonexistent path would fail the read; the range error must win,
    // proving no file is read before the pure-argument check.
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path: '/tmp/does-not-exist.jpg' }],
        imagePrimaryIndex: 5,
      })
    ).rejects.toThrow(/out of range/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona normalizes whitespace-only tag/description to empty strings (server stores \'\' on both paths)', async () => {
    const path = await writeTempImage('a.jpg');
    await client.createPersona({
      name: 'Tech Creator',
      avatarUrl: 'https://example.com/avatar.png',
      images: [{ path, tag: '  casual  ', description: '   ' }],
    });

    const formData = formDataOf();
    expect(JSON.parse(String(formData.get('imageTags')))).toEqual(['casual']);
    expect(JSON.parse(String(formData.get('imageDescriptions')))).toEqual(['']);
  });

  it('createPersona rejects an oversized tag before uploading', async () => {
    const path = await writeTempImage('a.jpg');
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path, tag: 'x'.repeat(101) }],
      })
    ).rejects.toThrow(/exceeds 100 characters/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona rejects an oversized description before uploading', async () => {
    const path = await writeTempImage('a.jpg');
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path, description: 'x'.repeat(501) }],
      })
    ).rejects.toThrow(/exceeds 500 characters/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona rejects imagePrimaryIndex when no images are supplied', async () => {
    // A lone index with no images is a caller bug: fail fast instead of a
    // silent successful creation with no primary image.
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        imagePrimaryIndex: 0,
      })
    ).rejects.toThrow(/requires images/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona reports the full path for zero-byte image files', async () => {
    const path = await writeTempImage('empty.jpg', 0);
    // The full path (not just the basename) is reported so the agent can
    // find the offending file when several images are uploaded at once.
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path }],
      })
    ).rejects.toThrow(path);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona rejects library images larger than 10MB', async () => {
    const path = await writeTempImage('big.jpg', 11 * 1024 * 1024);
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path }],
      })
    ).rejects.toThrow(/10MB/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona rejects oversized images with the typed ImageTooLargeError (never re-wrapped)', async () => {
    // The stat pre-check throws inside the try/catch that wraps stat
    // failures as "Failed to read image": the typed error must pass through
    // by instanceof, not by matching the message text.
    const path = await writeTempImage('big.jpg', 11 * 1024 * 1024);
    const error: unknown = await client
      .createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path }],
      })
      .catch((e: unknown) => e);
    if (!(error instanceof ImageTooLargeError)) {
      throw new Error(`expected ImageTooLargeError, got: ${String(error)}`);
    }
    expect(error.path).toBe(path);
    expect(error.sizeBytes).toBe(11 * 1024 * 1024);
    expect(error.message).toContain(path);
    expect(error.message).not.toContain('Failed to read image');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona still wraps stat failures as "Failed to read image"', async () => {
    // A nonexistent path fails stat(): the typed size error is not involved,
    // so the catch must still produce the actionable read-failure message.
    await expect(
      client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path: '/tmp/pe-mcp-test-does-not-exist.jpg' }],
      })
    ).rejects.toThrow(/Failed to read image/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('assertImageSize throws the typed error with the full path and a unified message', () => {
    const size = MAX_LIBRARY_IMAGE_BYTES + 1;
    let error: unknown;
    try {
      assertImageSize(size, '/tmp/photos/a.jpg');
    } catch (e: unknown) {
      error = e;
    }
    if (!(error instanceof ImageTooLargeError)) {
      throw new Error(`expected ImageTooLargeError, got: ${String(error)}`);
    }
    expect(error.path).toBe('/tmp/photos/a.jpg');
    expect(error.sizeBytes).toBe(size);
    expect(error.message).toBe(
      `Image "/tmp/photos/a.jpg" is too large (${size} bytes; max 10MB).`
    );
  });

  it('assertImageSize accepts sizes at or under the limit', () => {
    expect(() => assertImageSize(MAX_LIBRARY_IMAGE_BYTES, '/tmp/photos/a.jpg')).not.toThrow();
    expect(() => assertImageSize(0, '/tmp/photos/a.jpg')).not.toThrow();
  });

  it('addPersonaImage rejects unsupported file extensions', async () => {
    const path = await writeTempImage('x.bmp');
    await expect(client.addPersonaImage('p-1', { path })).rejects.toThrow(
      /JPG\/JPEG, PNG, or WebP/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage rejects an oversized tag before uploading', async () => {
    const path = await writeTempImage('a.jpg');
    await expect(
      client.addPersonaImage('p-1', { path, tag: 'x'.repeat(101) })
    ).rejects.toThrow(/exceeds 100 characters/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage rejects an oversized description before uploading', async () => {
    const path = await writeTempImage('a.jpg');
    await expect(
      client.addPersonaImage('p-1', { path, description: 'x'.repeat(501) })
    ).rejects.toThrow(/exceeds 500 characters/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage rejects library images larger than 10MB', async () => {
    const path = await writeTempImage('big.png', 11 * 1024 * 1024);
    await expect(client.addPersonaImage('p-1', { path })).rejects.toThrow(/10MB/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('listPersonaImages hits the library endpoint', async () => {
    await client.listPersonaImages('p-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/images?personaId=p-1`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('addPersonaImage uploads a single image as multipart', async () => {
    const path = await writeTempImage('c.webp');
    await client.addPersonaImage('p-1', { path, tag: 'gym', description: 'training', isPrimary: true });

    const request = vi.mocked(global.fetch).mock.calls[0];
    expect(request?.[0]).toBe(`${baseUrl}/api/persona/images`);
    expect(request?.[1]).toMatchObject({ method: 'POST' });
    const formData = request?.[1]?.body as FormData;
    expect(formData.get('personaId')).toBe('p-1');
    expect(formData.getAll('image')).toHaveLength(1);
    expect(formData.get('tag')).toBe('gym');
    expect(formData.get('description')).toBe('training');
    expect(formData.get('isPrimary')).toBe('true');
  });

  it('addPersonaImage omits empty tag/description keys (the server stores \'\' on both upload paths)', async () => {
    // An empty tag can never match the deterministic keyword selection;
    // the server stores metadata verbatim, so the client must normalize.
    const path = await writeTempImage('d.png');
    await client.addPersonaImage('p-1', { path, tag: '   ', description: '' });

    const request = vi.mocked(global.fetch).mock.calls[0];
    const formData = request?.[1]?.body as FormData;
    expect(formData.has('tag')).toBe(false);
    expect(formData.has('description')).toBe(false);
  });

  it('updatePersonaImage sends a PATCH with the metadata', async () => {
    await client.updatePersonaImage({ id: 'img-1', tag: 'casual', isPrimary: true });
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/images`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ id: 'img-1', tag: 'casual', isPrimary: true }),
      })
    );
  });

  it('updatePersonaImage throws client-side when no fields are provided', async () => {
    await expect(client.updatePersonaImage({ id: 'img-1' })).rejects.toThrow(
      /at least one of tag, description, or isPrimary/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage rejects a dotfile (".PNG") as an unsupported extension', async () => {
    // Node's extname('.PNG') is '' (a leading dot with no other dots is not
    // an extension), so dotfiles are rejected here — the fail-fast promise
    // holds, just via the unsupported-extension branch.
    const path = await writeTempImage('.PNG');
    await expect(client.addPersonaImage('p-1', { path })).rejects.toThrow(
      /Unsupported image extension "\(none\)"/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('updatePersonaImage rejects an over-length tag locally instead of a server 400', async () => {
    // Symmetric with the add/create paths: fail fast before the round-trip.
    await expect(
      client.updatePersonaImage({ id: 'img-1', tag: 'x'.repeat(MAX_LIBRARY_TAG_LENGTH + 1) })
    ).rejects.toThrow(/tag.*exceeds/);
    await expect(
      client.updatePersonaImage({
        id: 'img-1',
        description: 'y'.repeat(MAX_LIBRARY_DESCRIPTION_LENGTH + 1),
      })
    ).rejects.toThrow(/description.*exceeds/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('updatePersonaImage rejects isPrimary:false locally instead of a server 400', async () => {
    // The server PATCH is swap-only: isPrimary:false always 400s there.
    // Failing fast here keeps the message actionable and avoids the
    // wasted round-trip.
    await expect(
      client.updatePersonaImage({ id: 'img-1', isPrimary: false })
    ).rejects.toThrow(/cannot be false.*mark another image/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage wraps a missing file in an actionable error', async () => {
    await expect(
      client.addPersonaImage('p-1', { path: '/tmp/does-not-exist-a1b2c3.jpg' })
    ).rejects.toThrow(/Failed to read image "\/tmp\/does-not-exist-a1b2c3\.jpg"/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('createPersona uses the longer upload timeout for file-carrying requests', async () => {
    const path = await writeTempImage('a.jpg');
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout;
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) => {
        timeouts.push(ms);
        return realTimeout(ms);
      });
    try {
      await client.createPersona({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path }],
      });
    } finally {
      spy.mockRestore();
    }
    expect(timeouts).toContain(120_000);
  });

  it('createPersona always uses the upload timeout (multipart request)', async () => {
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout;
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) => {
        timeouts.push(ms);
        return realTimeout(ms);
      });
    try {
      await client.createPersona({ name: 'X', avatarUrl: 'https://example.com/a.png' });
    } finally {
      spy.mockRestore();
    }
    expect(timeouts).toEqual([120_000]);
  });

  it('listPersonas uses the default timeout', async () => {
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout;
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) => {
        timeouts.push(ms);
        return realTimeout(ms);
      });
    try {
      await client.listPersonas();
    } finally {
      spy.mockRestore();
    }
    expect(timeouts).toEqual([30_000]);
  });

  it('deletePersonaImage sends a DELETE with the id query', async () => {
    await client.deletePersonaImage('img-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/images?id=img-1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
