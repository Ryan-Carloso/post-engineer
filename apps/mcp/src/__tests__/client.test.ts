import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      json: async () => mockResponse,
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
      json: async () => ({ success: true, personaId: 'persona-123' }),
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
      json: async () => mockList,
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
      json: async () => mockVoices,
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
      json: async () => mockFaces,
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
      json: async () => ({ success: true }),
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
      json: async () => mockAccounts,
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
      json: async () => mockSchedules,
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
      json: async () => mockPosts,
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
      json: async () => ({ success: true, upcoming: [], recent: [] }),
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
      json: async () => ({ success: true }),
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
      json: async () => mockBalance,
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
      json: async () => mockJob,
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
      json: async () => mockJob,
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
      json: async () => mockStatus,
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

  it('rejects schedule if target slot is less than 24h away without calling API', async () => {
    global.fetch = vi.fn();
    const now = new Date('2026-09-18T09:00:00.000Z');
    const tooSoon = new Date('2026-09-18T18:00:00.000Z').toISOString();

    await expect(
      client.createSchedule({
        personaId: 'persona-123',
        providers: ['youtube'],
        youtubeAccountIds: ['yt-1'],
        scheduledAt: tooSoon,
        _nowForTesting: now,
      })
    ).rejects.toThrow(/at least 24 hours/i);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls schedule API when scheduledAt is >= 24h away', async () => {
    const mockSchedule = { success: true, scheduleId: 'sched-123' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSchedule,
    });

    const now = new Date('2026-09-18T09:00:00.000Z');
    const validTime = new Date('2026-09-20T10:00:00.000Z').toISOString();

    const result = await client.createSchedule({
      personaId: 'persona-123',
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
      scheduledAt: validTime,
      _nowForTesting: now,
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
      json: async () => mockResponse,
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
      json: async () => mockResponse,
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
