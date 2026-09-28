import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostEngineerClient } from '../client.js';

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
    expect(formData.get('personaMode')).toBe('persona');
    expect(formData.get('faceQuality')).toBe('very_good');
    expect(new Headers(request?.headers).get('content-type')).toBeNull();
    expect(result).toEqual(mockResponse);
  });

  it('creates a faceless persona when no avatar is provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(({ success: true, personaId: 'persona-123' })),
    });

    await client.createPersona({ name: 'Faceless Creator' });

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const formData = request?.body as FormData;
    expect(formData.get('personaMode')).toBe('faceless');
    expect(formData.get('faceMixPercent')).toBe('0');
    expect(formData.get('avatarUrl')).toBeNull();
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

  it('triggers video job from persona successfully', async () => {
    const mockJob = {
      success: true,
      taskId: 'task-abc-123',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockJob),
    });

    const result = await client.generateVideoJob({
      personaId: 'persona-123',
      scriptPrompt: 'Custom prompt for this specific video',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/video-job`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          personaId: 'persona-123',
          video_script_prompt: 'Custom prompt for this specific video',
        }),
      })
    );
    expect(result).toEqual(mockJob);
  });

  it('sends custom audio_url in the video job payload', async () => {
    const mockJob = {
      success: true,
      taskId: 'task-audio-1',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockJob),
    });

    const result = await client.generateVideoJob({
      personaId: 'persona-123',
      audioUrl: 'https://cdn.example.com/narracao.mp3',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/video-job`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          personaId: 'persona-123',
          audio_url: 'https://cdn.example.com/narracao.mp3',
        }),
      })
    );
    expect(result).toEqual(mockJob);
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

  it('accepts an injected clock for schedule validation instead of a test-only input field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, scheduleId: 'sched-1' }),
    });
    const now = new Date('2026-09-18T09:00:00.000Z');
    const clientWithClock = new PostEngineerClient({ apiKey: 'k', now: () => now });

    // 2026-09-20 is >= 24h after the injected now, but in the past relative
    // to the real clock: only the injected clock can make this call succeed.
    await clientWithClock.createSchedule({
      personaId: 'persona-123',
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
      scheduledAt: new Date('2026-09-20T10:00:00.000Z').toISOString(),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects schedule if target slot is less than 24h away without calling API', async () => {
    global.fetch = vi.fn();
    const now = new Date('2026-09-18T09:00:00.000Z');
    const tooSoon = new Date('2026-09-18T18:00:00.000Z').toISOString();
    const clockClient = new PostEngineerClient({ apiKey: 'k', now: () => now });

    await expect(
      clockClient.createSchedule({
        personaId: 'persona-123',
        providers: ['youtube'],
        youtubeAccountIds: ['yt-1'],
        scheduledAt: tooSoon,
      })
    ).rejects.toThrow(/at least 24 hours/i);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls schedule API when scheduledAt is >= 24h away', async () => {
    const mockSchedule = { success: true, scheduleId: 'sched-123' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockSchedule),
    });

    const now = new Date('2026-09-18T09:00:00.000Z');
    const validTime = new Date('2026-09-20T10:00:00.000Z').toISOString();
    const clockClient = new PostEngineerClient({ apiKey: 'k', now: () => now });

    const result = await clockClient.createSchedule({
      personaId: 'persona-123',
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
      scheduledAt: validTime,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule`,
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(result).toEqual(mockSchedule);
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

  it('createPersona rejects library images without an avatar (persona mode required)', async () => {
    await expect(
      client.createPersona({ name: 'X', images: [{ path: '/tmp/img.jpg' }] })
    ).rejects.toThrow(/require a persona avatar/);
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

  it('addPersonaImage rejects unsupported file extensions', async () => {
    const path = await writeTempImage('x.bmp');
    await expect(client.addPersonaImage('p-1', { path })).rejects.toThrow(
      /JPG, PNG, or WebP/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('addPersonaImage rejects library images larger than 10MB', async () => {
    const path = await writeTempImage('big.png', 11 * 1024 * 1024);
    await expect(client.addPersonaImage('p-1', { path })).rejects.toThrow(/10MB/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('generateVideoJob sends image_id when provided', async () => {
    await client.generateVideoJob({ personaId: 'p-1', imageId: 'img-123' });
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.image_id).toBe('img-123');
    expect(body.personaId).toBe('p-1');
  });

  it('generateVideoJob omits image_id when not provided', async () => {
    await client.generateVideoJob({ personaId: 'p-1' });
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect('image_id' in body).toBe(false);
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
