import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectTelegramAccount } from '../client-telegram.js';
import { PostEngineerClient } from '../client.js';

describe('PostEngineerClient', () => {
  let client: PostEngineerClient;
  const baseUrl = 'https://post-engineer.com';
  const apiKey = 'test-token-123';

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey });
  });

  it.each([
    ['missing', undefined],
    ['empty map', {}],
    ['all providers empty', { youtube: [] }],
  ])('createPersona rejects %s accounts before any fetch', async (_label, accounts) => {
    global.fetch = vi.fn();
    await expect(
      client.createPersona({
        accounts,
        name: 'No Binding',
        avatarUrl: 'https://example.com/avatar.png',
        voiceId: 'voice-alloy',
      } as never),
    ).rejects.toThrow(/Select at least one publishing account for this persona/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('updatePersona sends only the given name', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await client.updatePersona({ personaId: 'p-1', name: 'Renamed' });

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    const formData = request?.body as FormData;
    expect([...formData.keys()]).toEqual(['name']);
  });

  it('createPersona posts the name, the AI label and the binding with no photo when no avatarPath is given', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, personaId: 'persona-123' }),
    });

    const result = await client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'No Photo' });

    expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/api/persona`, expect.objectContaining({ method: 'POST' }));
    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('name')).toBe('No Photo');
    expect(JSON.parse(String(formData.get('publishingAccounts')))).toEqual({ youtube: ['acct-1'] });
    expect(formData.has('photo')).toBe(false);
    expect([...formData.keys()].sort()).toEqual(['aiLabel', 'name', 'publishingAccounts']);
    expect(result).toEqual({ success: true, personaId: 'persona-123' });
  });

  it('rejects a malformed create 200 without a personaId', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
    await expect(client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'X' })).rejects.toThrow(
      'Malformed response from POST /api/persona',
    );
  });

  it('lists personas successfully', async () => {
    const emptyAccounts = {
      youtube: [],
      instagram: [],
      bluesky: [],
      linkedin: [],
      threads: [],
      facebook: [],
      pinterest: [],
      '3speak': [],
      rumble: [],
      fanvue: [],
      telegram: [],
    };
    const mockList = {
      authenticated: true,
      personas: [
        { id: 'p1', name: 'Persona 1', createdAt: '2026-01-01T00:00:00Z', aiLabel: false, boundAccounts: emptyAccounts },
        { id: 'p2', name: 'Persona 2', createdAt: '2026-01-02T00:00:00Z', aiLabel: false, boundAccounts: emptyAccounts },
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

  it('rejects a malformed list 200 with a partial persona', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ authenticated: true, personas: [{ id: 'p1', name: 'Persona 1' }] }),
    });
    await expect(client.listPersonas()).rejects.toThrow(
      'Malformed response from GET /api/persona/list',
    );
  });


  it('throws when updating persona fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
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
      accounts: [
        {
          provider: 'youtube',
          recordId: 'rec-1',
          channelId: 'chan-1',
          channelName: 'Chan',
          connectedAt: 1700000000000,
          lastUsed: 1700000000000,
        },
      ],
      message: 'Accounts retrieved from Supabase',
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
    const mockSchedules = {
      success: true,
      schedules: [
        {
          id: 'sched-1',
          persona_id: 'persona-123',
          providers: ['youtube'],
          youtube_account_ids: ['yt-1'],
          instagram_account_ids: [],
          linkedin_account_ids: [],
          bluesky_account_ids: [],
          threads_account_ids: [],
          facebook_account_ids: [],
          pinterest_account_ids: [],
          pinterest_board_id: null,
          threespeak_account_ids: [],
          rumble_account_ids: [],
          fanvue_account_ids: [],
          telegram_account_ids: [],
          days_of_week: [1, 3, 5],
          start_hour: 9,
          end_hour: 17,
          posts_per_day: 2,
          timezone: 'Europe/Lisbon',
          active: true,
          created_at: '2026-10-01T00:00:00Z',
          publish_mode: 'scheduled',
        },
      ],
    };

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
      upcoming: [
        {
          id: 'up-1',
          slot_at: '2026-09-24T10:00:00Z',
          status: 'ready',
          title: 'Next',
          error: null,
          published_at: null,
          schedule_id: 's1',
          postUrl: null,
        },
      ],
      recent: [
        {
          id: 're-1',
          slot_at: '2026-09-20T10:00:00Z',
          status: 'published',
          title: 'Old',
          error: null,
          published_at: '2026-09-20T10:05:00Z',
          schedule_id: 's1',
          postUrl: 'https://post-engineer.com/posts/re-1',
        },
      ],
      hasAnyPost: true,
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
      text: async () => JSON.stringify(({ success: true, upcoming: [], recent: [], hasAnyPost: false })),
    });

    await client.listPosts(50);
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule/status?limit=50`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws a clear error when listing posts fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(client.listPosts()).rejects.toThrow('Failed to list posts: 401 Unauthorized');
  });

  it('cancels a schedule by id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          cancelledSlotIds: ['slot-1'],
          refunds: [{ slotId: 'slot-1', refunded: true, alreadyRefunded: false, reason: 'not_generated' }],
          batchDiscountWithheld: 0,
        }),
    });

    await client.cancelSchedule('sched-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule?id=sched-1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('gets one slot by id', async () => {
    const mockSlot = {
      success: true,
      slot: {
        id: 'slot-1',
        scheduleId: 'sched-1',
        slotAt: '2026-10-10T20:00:00Z',
        status: 'ready',
        title: 'Hello',
        error: null,
        publishedAt: null,
        postUrl: null,
        publishLinks: [],
        userNotices: [],
        providerFailures: [],
        firstComment: null,
        commentWarnings: [],
      },
      schedule: {
        id: 'sched-1',
        personaId: null,
        providers: ['youtube'],
        youtubeAccountIds: [],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        threadsAccountIds: [],
        facebookAccountIds: [],
        pinterestAccountIds: [],
        pinterestBoardId: null,
        threespeakAccountIds: [],
        rumbleAccountIds: [],
        fanvueAccountIds: [],
        telegramAccountIds: [],
        timezone: 'UTC',
        publishMode: 'scheduled',
      },
      persona: null,
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockSlot),
    });

    const result = await client.getSlot('slot-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule/slots/slot-1`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual(mockSlot);
  });

  it('updates a slot title with a PATCH body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, title: 'New title' }),
    });

    await client.updateSlotTitle('slot-1', '  New title  ');
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'New title' });
  });

  it('PATCHes a trimmed first comment, and null when it is blank', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, firstComment: 'Link in bio' }),
    });
    await client.updateSlotTitle('slot-1', undefined, '  Link in bio ');
    await client.updateSlotTitle('slot-1', 'T', '   ');
    const bodies = vi.mocked(global.fetch).mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown);
    expect(bodies).toEqual([{ firstComment: 'Link in bio' }, { title: 'T', firstComment: null }]);
  });

  it('refuses to update a slot with neither a title nor a first comment', async () => {
    global.fetch = vi.fn();
    await expect(client.updateSlotTitle('slot-1', undefined)).rejects.toThrow('Provide title, firstComment or both');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast on an empty slot title without fetching', async () => {
    global.fetch = vi.fn();
    await expect(client.updateSlotTitle('slot-1', '   ')).rejects.toThrow(
      /title must be a non-empty string/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('deletes one slot by id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await client.deleteSlot('slot-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/schedule/slots/slot-1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('gets a persona delete preview by persona id', async () => {
    const mockPreview = {
      success: true,
      persona: { id: 'persona-1', name: 'Ava' },
      counts: {
        schedules: 1,
        upcomingSlots: 2,
        publishedSlots: 3,
        failedSlots: 0,
      },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockPreview),
    });

    const result = await client.getPersonaDeletePreview('persona-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona/delete-preview?personaId=persona-1`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual(mockPreview);
  });

  it('rejects a malformed delete-preview 200 with empty counts', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, persona: { id: 'persona-1', name: 'Ava' }, counts: {} }),
    });
    await expect(client.getPersonaDeletePreview('persona-1')).rejects.toThrow(
      'Malformed response from GET /api/persona/delete-preview',
    );
  });

  it('deletes a persona by id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await client.deletePersona('persona-1');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/persona?personaId=persona-1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('rejects a malformed delete 200 with a false success flag', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false }),
    });
    await expect(client.deletePersona('persona-1')).rejects.toThrow(
      'Malformed response from DELETE /api/persona',
    );
  });

  it('disconnects a social account by provider and account id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await client.disconnectAccount('bluesky', 'did:plc:abc');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/account?provider=bluesky&providerAccountId=did%3Aplc%3Aabc`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('fails fast on an unknown provider or empty account id without fetching', async () => {
    global.fetch = vi.fn();
    await expect(client.disconnectAccount('myspace', 'acc-1')).rejects.toThrow(
      /provider must be one of: youtube, instagram, bluesky, linkedin/
    );
    await expect(client.disconnectAccount('youtube', '   ')).rejects.toThrow(
      /providerAccountId must be a non-empty string/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('PostEngineerClient accounts', () => {
  const baseUrl = 'https://post-engineer.com';
  const apiKey = 'test-token-123';
  let client: PostEngineerClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey });
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
      ok: false, headers: new Headers(),
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
      ok: false, headers: new Headers(),
      status: 400,
      text: async () => 'Invalid handle or app password.',
    });

    await expect(
      client.connectBlueskyAccount('user.bsky.social', 'wrong')
    ).rejects.toThrow(/Failed to connect Bluesky account: 400/);
  });

  it('connects a 3Speak account with username + posting key', async () => {
    const mockResponse = { success: true, accountId: 'acc-1', username: 'alice' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.connectThreespeakAccount('alice', '5Kposting-key-123');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/threespeak-connect`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ username: 'alice', postingKey: '5Kposting-key-123' }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws a clear error when the 3Speak connect request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 422,
      text: async () => 'Invalid Hive posting key.',
    });

    await expect(
      client.connectThreespeakAccount('alice', 'wrong')
    ).rejects.toThrow(/Failed to connect 3Speak account: 422/);
  });

  it('connects a Rumble account with channelId + accessToken', async () => {
    const mockResponse = { success: true, accountId: 'acc-1', channelId: 'chan-1' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.connectRumbleAccount('chan-1', 'a'.repeat(40));
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/rumble-connect`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ channelId: 'chan-1', accessToken: 'a'.repeat(40) }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws a clear error when the Rumble connect request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 400,
      text: async () => 'Rumble access token must be the 40-character token issued by Rumble.',
    });

    await expect(
      client.connectRumbleAccount('chan-1', 'wrong')
    ).rejects.toThrow(/Failed to connect Rumble account: 400/);
  });

  it('connects a Telegram account with botToken + chatId + chatType', async () => {
    const mockResponse = {
      success: true,
      accountId: 'acc-tg',
      chatId: '-1001234567890',
      chatType: 'group',
      title: 'Maria Group',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });

    const botToken = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const result = await connectTelegramAccount(client, botToken, '-1001234567890', 'group');
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/telegram-connect`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ botToken, chatId: '-1001234567890', chatType: 'group' }),
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('redacts the bot token from a Telegram connect failure', async () => {
    const botToken = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 422,
      text: async () => `Telegram rejected the bot token ${botToken}.`,
    });

    const error = await connectTelegramAccount(client, botToken, '-1001234567890', 'channel').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Failed to connect Telegram account: 422');
    expect((error as Error).message).not.toContain(botToken);
  });
});

describe('PostEngineerClient configuration', () => {
  it('uses the default production URL when no override is given', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
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
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
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
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
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
      ok: false, headers: new Headers(),
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
      ok: false, headers: new Headers(),
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
      ok: false, headers: new Headers(),
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

  it('never echoes the 3Speak posting key when the API error body reflects the payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 422,
      text: async () => `{"error":"invalid postingKey value '5Ksecret-key'"}`,
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    const error = await c.connectThreespeakAccount('alice', '5Ksecret-key').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('5Ksecret-key');
    expect((error as Error).message).toContain('[redacted]');
  });

  it('never echoes the Rumble access token when the API error body reflects the payload', async () => {
    const token = 'a'.repeat(40);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, headers: new Headers(),
      status: 400,
      text: async () => `{"error":"invalid accessToken value '${token}'"}`,
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    const error = await c.connectRumbleAccount('chan-1', token).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).toContain('[redacted]');
  });

  it('rejects a malformed accounts 200 instead of listing a partial account', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ authenticated: true, accounts: [{ provider: 'youtube', channelId: 'chan-1' }], message: 'ok' }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).listSocialAccounts()).rejects.toThrow('Malformed response from GET /api/account');
  });

  it('rejects a malformed connect-url 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).getOAuthConnectUrl('instagram')).rejects.toThrow('Malformed response from POST /api/account/connect-url');
  });

  it('rejects a malformed Bluesky connect 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, accountId: 'acc-1' }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).connectBlueskyAccount('user.bsky.social', 'app-password-123')).rejects.toThrow(
      'Malformed response from POST /api/bluesky-connect',
    );
  });

  it('rejects a malformed disconnect 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).disconnectAccount('youtube', 'chan-1')).rejects.toThrow('Malformed response from DELETE /api/account');
  });

  it('rejects a malformed schedules 200 instead of listing a partial row', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, schedules: [{ id: 'sched-1' }] }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).listSchedules()).rejects.toThrow('Malformed response from GET /api/schedule');
  });

  it('rejects a malformed posts 200 with a raw DB status instead of a presented one', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          upcoming: [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending' }],
          recent: [],
        }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).listPosts()).rejects.toThrow('Malformed response from GET /api/schedule/status');
  });

  it('rejects a malformed cancel 200 without the cancel facts', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).cancelSchedule('sched-1')).rejects.toThrow('Malformed response from DELETE /api/schedule');
  });

  it('rejects a malformed slot 200 instead of presenting a partial detail', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, slot: { id: 'slot-1', title: 'Hello' } }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).getSlot('slot-1')).rejects.toThrow('Malformed response from GET /api/schedule/slots/:slotId');
  });

  it('rejects a malformed title update 200 with a wrong-typed title', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, title: 42 }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).updateSlotTitle('slot-1', 'New')).rejects.toThrow('Malformed response from PATCH /api/schedule/slots/:slotId');
  });

  it('rejects a malformed slot delete 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: false }),
    });

    await expect(new PostEngineerClient({ apiKey: 'k' }).deleteSlot('slot-1')).rejects.toThrow('Malformed response from DELETE /api/schedule/slots/:slotId');
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

  it('cancelSchedule reports an empty 204 as a malformed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.cancelSchedule('sched-123')).rejects.toThrow(
      'Malformed response from DELETE /api/schedule',
    );
  });

  it('listPersonas reports an empty 200 body as a malformed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const c = new PostEngineerClient({ apiKey: 'k' });
    await expect(c.listPersonas()).rejects.toThrow(
      'Malformed response from GET /api/persona/list',
    );
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
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
    });

    const c = new PostEngineerClient({ apiKey: 'k', baseUrl: 'https://user:pass@api.example.com/' });
    await c.listPersonas();
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/api/persona/list', expect.anything());
  });

  it('strips a trailing slash from the base URL override', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
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
      text: async () => JSON.stringify({ authenticated: true, personas: [] }),
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
      ok: false, headers: new Headers(),
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

function mockFetchJson(body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe('PostEngineerClient request timeouts', () => {
  let client: PostEngineerClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey: 'test-token-123' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  it('listPersonas uses the default timeout', async () => {
    mockFetchJson({ authenticated: true, personas: [] });
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

});

describe('publishVideoDirect', () => {
  let client: PostEngineerClient;
  const baseUrl = 'https://post-engineer.com';
  const apiKey = 'test-token-123';
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new PostEngineerClient({ apiKey });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          provider: 'youtube',
          results: [
            { accountId: 'chan-1', success: true, videoId: 'vid-1', videoUrl: 'https://youtu.be/vid-1' },
          ],
          successCount: 1,
          logId: 'log-1',
        }),
    });
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeTempVideo(name: string, size = 8): Promise<string> {
    const { mkdtempSync } = await import('node:fs');
    const { writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pe-mcp-video-test-'));
    tempDirs.push(dir);
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(size, 0x00));
    return path;
  }

  const youtubeInput = (videoPath: string) => ({
    provider: 'youtube' as const,
    videoPath,
    accountIds: ['chan-1'],
    title: 'My video',
    description: 'A description',
    tags: ['tech', 'ai'],
    privacyStatus: 'unlisted' as const,
  });

  it('posts the video as multipart with youtube field names', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect(youtubeInput(videoPath));

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/api/upload-content`,
      expect.objectContaining({ method: 'POST' })
    );
    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('youtube');
    expect(formData.get('title')).toBe('My video');
    expect(formData.get('description')).toBe('A description');
    expect(formData.get('tags')).toBe('tech,ai');
    expect(formData.get('privacyStatus')).toBe('unlisted');
    expect(formData.getAll('accountIds')).toEqual(['chan-1']);
    const video = formData.get('video');
    expect(video).toBeInstanceOf(Blob);
    expect((video as Blob).size).toBe(8);
  });

  it('does not send a JSON content type with the multipart body', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect(youtubeInput(videoPath));

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect(new Headers(request?.headers).get('content-type')).toBeNull();
  });

  it('maps account ids to the instagram field names', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'instagram',
      videoPath,
      accountIds: ['ig-1', 'ig-2'],
      caption: 'hello world',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('instagram');
    expect(formData.get('caption')).toBe('hello world');
    expect(formData.getAll('igAccountIds')).toEqual(['ig-1', 'ig-2']);
    expect(formData.get('file')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the bluesky did field name', async () => {
    const videoPath = await writeTempVideo('clip.mov');
    await client.publishVideoDirect({
      provider: 'bluesky',
      videoPath,
      accountIds: ['did:plc:abc'],
      caption: 'hello bluesky',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.getAll('did')).toEqual(['did:plc:abc']);
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the linkedin field name', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'linkedin',
      videoPath,
      accountIds: ['urn:li:org:1'],
      caption: 'hello linkedin',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.getAll('linkedinAccountIds')).toEqual(['urn:li:org:1']);
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the threads field name', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'threads',
      videoPath,
      accountIds: ['t-1'],
      caption: 'hello linkedin',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.getAll('threadsAccountIds')).toEqual(['t-1']);
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the facebook field name and sends the caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'facebook',
      videoPath,
      accountIds: ['page-1', 'page-2'],
      caption: 'hello facebook',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('facebook');
    expect(formData.getAll('facebookAccountIds')).toEqual(['page-1', 'page-2']);
    expect(formData.get('caption')).toBe('hello facebook');
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the pinterest field name and sends title, description and boardId', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'pinterest',
      videoPath,
      accountIds: ['user-9'],
      caption: 'the pin description',
      title: 'My pin',
      boardId: 'b1',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('pinterest');
    expect(formData.getAll('pinterestAccountIds')).toEqual(['user-9']);
    expect(formData.get('caption')).toBe('the pin description');
    expect(formData.get('title')).toBe('My pin');
    expect(formData.get('description')).toBe('the pin description');
    expect(formData.get('boardId')).toBe('b1');
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('uses the description when given for pinterest instead of the caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'pinterest',
      videoPath,
      accountIds: ['user-9'],
      caption: 'caption text',
      description: 'explicit description',
      boardId: 'b1',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('description')).toBe('explicit description');
  });

  it('publishes to pinterest with a description and no caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'pinterest',
      videoPath,
      accountIds: ['user-9'],
      description: 'description only',
      boardId: 'b1',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('description')).toBe('description only');
    expect(formData.get('caption')).toBe('');
    expect(formData.get('boardId')).toBe('b1');
  });

  it('falls back to the caption for pinterest when the description is blank', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'pinterest',
      videoPath,
      accountIds: ['user-9'],
      description: '   ',
      caption: 'caption fallback',
      boardId: 'b1',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('description')).toBe('caption fallback');
  });

  it('fails fast for pinterest with neither description nor caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({
        provider: 'pinterest',
        videoPath,
        accountIds: ['user-9'],
        boardId: 'b1',
      }),
    ).rejects.toThrow('description or caption is required for pinterest.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast for pinterest without a boardId', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({
        provider: 'pinterest',
        videoPath,
        accountIds: ['user-9'],
        caption: 'hello pinterest',
      }),
    ).rejects.toThrow('boardId is required for pinterest.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('narrows the pin permalink from a direct-publish response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          provider: 'pinterest',
          results: [
            { accountId: 'user-9', success: true, postId: '123456789', permalink: 'https://www.pinterest.com/pin/123456789/' },
          ],
          successCount: 1,
          logId: 'log-1',
        }),
    });
    const videoPath = await writeTempVideo('clip.mp4');
    const result = await client.publishVideoDirect({
      provider: 'pinterest',
      videoPath,
      accountIds: ['user-9'],
      caption: 'hello pinterest',
      boardId: 'b1',
    });
    expect(result.results[0]).toEqual({
      accountId: 'user-9',
      success: true,
      postId: '123456789',
      permalink: 'https://www.pinterest.com/pin/123456789/',
    });
  });

  it('keeps errorCode on a direct-publish account result so publish_unknown is observable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: false,
          provider: 'fanvue',
          results: [
            {
              accountId: 'fan-1',
              success: false,
              error:
                'Publish result could not be recorded — this account may already have published. Check the provider before posting again.',
              errorCode: 'publish_unknown',
            },
          ],
          successCount: 0,
          logId: 'log-1',
        }),
    });
    const videoPath = await writeTempVideo('clip.mp4');
    const result = await client.publishVideoDirect({
      provider: 'fanvue',
      videoPath,
      accountIds: ['fan-1'],
      title: 'Fan post',
      description: 'hello fanvue',
    });
    expect(result.results[0]).toEqual({
      accountId: 'fan-1',
      success: false,
      error:
        'Publish result could not be recorded — this account may already have published. Check the provider before posting again.',
      errorCode: 'publish_unknown',
    });
  });

  it('maps account ids to the threespeak field name and sends the caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: '3speak',
      videoPath,
      accountIds: ['alice'],
      caption: 'hello 3speak',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('3speak');
    expect(formData.getAll('threespeakAccountIds')).toEqual(['alice']);
    expect(formData.get('caption')).toBe('hello 3speak');
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('maps account ids to the fanvue field name and sends title + description', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'fanvue',
      videoPath,
      accountIds: ['fan-1'],
      title: 'Fan post',
      description: 'hello fanvue',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('fanvue');
    expect(formData.getAll('fanvueAccountIds')).toEqual(['fan-1']);
    expect(formData.get('title')).toBe('Fan post');
    expect(formData.get('description')).toBe('hello fanvue');
    expect(formData.get('caption')).toBeNull();
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('fails fast for fanvue without a title, without fetching', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({ provider: 'fanvue', videoPath, accountIds: ['fan-1'] }),
    ).rejects.toThrow(/title is required for fanvue/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('gives direct publish the 600s budget, because Fanvue waits for transcoding', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout;
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return realTimeout(ms);
    });
    try {
      await client.publishVideoDirect({
        provider: 'fanvue',
        videoPath,
        accountIds: ['fan-1'],
        title: 'Fan post',
        description: 'A description',
      });
    } finally {
      spy.mockRestore();
    }
    expect(timeouts).toEqual([600_000]);
  });

  it('maps account ids to the rumble field name and sends title + description instead of a caption', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await client.publishVideoDirect({
      provider: 'rumble',
      videoPath,
      accountIds: ['chan-1', 'chan-2'],
      title: 'My video',
      description: 'A description',
    });

    const formData = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('provider')).toBe('rumble');
    expect(formData.getAll('rumbleAccountIds')).toEqual(['chan-1', 'chan-2']);
    expect(formData.get('title')).toBe('My video');
    expect(formData.get('description')).toBe('A description');
    expect(formData.get('caption')).toBeNull();
    expect(formData.get('video')).toBeInstanceOf(Blob);
  });

  it('fails fast when the rumble title or description is missing, without fetching', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({ provider: 'rumble', videoPath, accountIds: ['chan-1'], description: 'A description' }),
    ).rejects.toThrow(/title is required for rumble/);
    await expect(
      client.publishVideoDirect({ provider: 'rumble', videoPath, accountIds: ['chan-1'], title: 'My video' }),
    ).rejects.toThrow(/description is required for rumble/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast on an unknown provider without fetching', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({
        provider: 'tiktok' as 'youtube',
        videoPath,
        accountIds: ['acc-1'],
      })
    ).rejects.toThrow(/provider/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast when the video file does not exist', async () => {
    await expect(client.publishVideoDirect(youtubeInput('/tmp/does-not-exist-pe-mcp.mp4'))).rejects.toThrow(
      /Failed to read video/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast without fetching when the video exceeds the 2GB server limit', async () => {
    const { truncate } = await import('node:fs/promises');
    const { VideoTooLargeError } = await import('../errors.js');
    const videoPath = await writeTempVideo('huge.mp4');
    await truncate(videoPath, 2 * 1024 * 1024 * 1024 + 1);
    const failure = client.publishVideoDirect(youtubeInput(videoPath));
    await expect(failure).rejects.toBeInstanceOf(VideoTooLargeError);
    await expect(failure).rejects.toThrow(/2GB/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('names the 2GB server limit in the video size error', async () => {
    const { VideoTooLargeError } = await import('../errors.js');
    expect(new VideoTooLargeError('/tmp/clip.mp4', 2 * 1024 * 1024 * 1024 + 1).message).toMatch(/2GB/);
  });

  it('fails fast when the extension is not a supported video type', async () => {
    const videoPath = await writeTempVideo('clip.avi');
    await expect(client.publishVideoDirect(youtubeInput(videoPath))).rejects.toThrow(/Unsupported video extension/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast for youtube when title, description, tags, or privacyStatus are missing', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    const base = youtubeInput(videoPath);
    for (const field of ['title', 'description', 'tags', 'privacyStatus'] as const) {
      const input = { ...base, [field]: undefined };
      await expect(client.publishVideoDirect(input)).rejects.toThrow(new RegExp(`${field} is required for youtube`));
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast for instagram, bluesky, and linkedin when caption is missing', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    for (const provider of ['instagram', 'bluesky', 'linkedin'] as const) {
      await expect(
        client.publishVideoDirect({ provider, videoPath, accountIds: ['acc-1'] })
      ).rejects.toThrow(/caption is required/);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails fast when no account ids are given', async () => {
    const videoPath = await writeTempVideo('clip.mp4');
    await expect(
      client.publishVideoDirect({ ...youtubeInput(videoPath), accountIds: [] })
    ).rejects.toThrow(/At least one account ID/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
