import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectTelegramAccount } from '../client-telegram.js';

vi.mock('../client-telegram.js', () => ({ connectTelegramAccount: vi.fn() }));

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));
import {
  handleCreatePersona,
  handleUpdatePersona,
  handleListSocialAccounts,
  handleListSchedules,
  handleCancelSchedule,
  handleConnectAccount,
  ListPostsSchema,
  CreatePersonaSchema,
  UpdatePersonaSchema,
} from '../tools.js';
import type { ResponseOf } from '../contracts/endpoint.js';
import {
  cancelSchedule as cancelScheduleContract,
  getSlot as getSlotContract,
  listPosts as listPostsContract,
  listSchedules as listSchedulesContract,
} from '../contracts/schedule.js';

import { handleListPosts } from '../tools-posts.js';
import { listPostsInRange } from '../client-posts.js';
import {
  handleGetPersonaPublishingAccounts,
  handleSetPersonaPublishingAccounts,
} from '../tools-publishing-accounts.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools.js';

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

const FULL_SCHEDULE_ROW: ResponseOf<typeof listSchedulesContract>['schedules'][number] = {
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
};

const FULL_STATUS_SLOT: ResponseOf<typeof listPostsContract>['upcoming'][number] = {
  id: 'up-1',
  slot_at: '2026-09-24T10:00:00Z',
  status: 'ready',
  title: 'Next',
  error: null,
  published_at: null,
  schedule_id: 's1',
  postUrl: null,
};

const FULL_CANCEL_RESULT: ResponseOf<typeof cancelScheduleContract> = {
  success: true,
  cancelledSlotIds: ['slot-1'],
};

const FULL_SLOT_DETAIL: ResponseOf<typeof getSlotContract> = {
  success: true,
  slot: {
    id: 'slot-1',
    scheduleId: 'sched-1',
    slotAt: '2026-10-10T20:00:00Z',
    status: 'ready',
    title: 'Launch day',
    error: null,
    publishedAt: null,
    postUrl: 'https://post-engineer.com/posts/slot-1',
    publishLinks: [],
    userNotices: [],
    providerFailures: [],
  },
  schedule: {
    id: 'sched-1',
    personaId: 'persona-1',
    providers: ['youtube'],
    youtubeAccountIds: ['yt-1'],
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
    timezone: 'Europe/Lisbon',
    publishMode: 'scheduled',
  },
  persona: { id: 'persona-1', name: 'Ava' },
};

describe('MCP Tool Handlers', () => {
  const mockClient = {
    createPersona: vi.fn(),
    listPersonas: vi.fn(),
    listVoices: vi.fn(),
    listFaces: vi.fn(),
    updatePersona: vi.fn(),
    listSocialAccounts: vi.fn(),
    listSchedules: vi.fn(),
    listPosts: vi.fn(),

    cancelSchedule: vi.fn(),
    getTokenBalance: vi.fn(),
    getVideoStatus: vi.fn(),
    getOAuthConnectUrl: vi.fn(),
    connectBlueskyAccount: vi.fn(),
    connectThreespeakAccount: vi.fn(),
    connectRumbleAccount: vi.fn(),
    request: vi.fn(),
    getHeaders: vi.fn().mockReturnValue({}),
  } as unknown as PostEngineerClient;


  it('handleUpdatePersona returns error when the API fails', async () => {
    vi.mocked(mockClient.updatePersona).mockRejectedValue(new Error('Failed to update persona: 404 Persona not found.'));

    const response = await handleUpdatePersona(mockClient, { personaId: 'missing' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Persona not found');
  });

  it('handleListSocialAccounts returns connected accounts', async () => {
    vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'rec-1', channelId: 'chan-1', channelName: 'Chan', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
      message: 'Accounts retrieved from Supabase',
    });

    const response = await handleListSocialAccounts(mockClient);

    expect(mockClient.listSocialAccounts).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('chan-1');
  });

  it('handleGetPersonaPublishingAccounts returns the persona defaults', async () => {
    vi.mocked(mockClient.request).mockResolvedValue({
      success: true,
      defaults: { youtube: [], instagram: [], bluesky: ['did:plc:a'], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] },
    });

    const response = await handleGetPersonaPublishingAccounts(mockClient, { personaId: 'p-1' });

    expect(mockClient.request).toHaveBeenCalledWith(
      '/api/persona/publishing-accounts?personaId=p-1',
      { method: 'GET', headers: {} },
      'get persona publishing accounts',
    );
    expect(textOf(response)).toContain('did:plc:a');
  });

  it('handleSetPersonaPublishingAccounts replaces the defaults', async () => {
    vi.mocked(mockClient.request).mockResolvedValue({
      success: true,
      defaults: { youtube: ['UC-1'], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] },
    });

    const response = await handleSetPersonaPublishingAccounts(mockClient, {
      personaId: 'p-1',
      accounts: { youtube: ['UC-1'], bluesky: [] },
    });

    expect(mockClient.request).toHaveBeenCalledWith(
      '/api/persona/publishing-accounts?personaId=p-1',
      {
        method: 'PUT',
        headers: {},
        body: JSON.stringify({ accounts: { youtube: ['UC-1'], bluesky: [] } }),
      },
      'set persona publishing accounts',
    );
    expect(textOf(response)).toContain('updated successfully');
  });

  it('handleListSchedules returns schedules', async () => {
    vi.mocked(mockClient.listSchedules).mockResolvedValue({
      success: true,
      schedules: [FULL_SCHEDULE_ROW],
    });

    const response = await handleListSchedules(mockClient);

    expect(mockClient.listSchedules).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('sched-1');
  });

  it('ListPostsSchema defaults limit to 20 and caps it at 500', () => {
    expect(ListPostsSchema.parse({}).limit).toBe(20);
    expect(ListPostsSchema.parse({ limit: 500 }).limit).toBe(500);
    expect(() => ListPostsSchema.parse({ limit: 0 })).toThrow();
    expect(() => ListPostsSchema.parse({ limit: 501 })).toThrow();
    expect(() => ListPostsSchema.parse({ limit: 1.5 })).toThrow();
  });

  it('handleListPosts returns an error result when the client fails', async () => {
    vi.mocked(mockClient.listPosts).mockRejectedValue(new Error('boom'));

    const response = await handleListPosts(mockClient, { limit: 20 });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error listing posts: boom');
  });

  it('ListPostsSchema requires from and to together and validates the timestamps', () => {
    const FROM = '2026-11-01T00:00:00-03:00';
    const TO = '2026-12-01T00:00:00-03:00';
    expect(ListPostsSchema.parse({ from: FROM, to: TO })).toMatchObject({ from: FROM, to: TO });
    expect(() => ListPostsSchema.parse({ from: FROM })).toThrow();
    expect(() => ListPostsSchema.parse({ to: TO })).toThrow();
    expect(() => ListPostsSchema.parse({ from: '2026-11-01', to: '2026-12-01' })).toThrow();
  });

  it('handleListPosts in range mode calls the range endpoint and never sends limit', async () => {
    vi.mocked(mockClient.listPosts).mockClear();
    vi.mocked(mockClient.request).mockClear();
    vi.mocked(mockClient.request).mockResolvedValue({
      success: true,
      slots: [{ ...FULL_STATUS_SLOT, id: 's-1' }],
      truncated: false,
    });

    const response = await handleListPosts(mockClient, {
      limit: 20,
      from: '2026-11-01T00:00:00-03:00',
      to: '2026-12-01T00:00:00-03:00',
    });

    expect(mockClient.listPosts).not.toHaveBeenCalled();
    const [path] = vi.mocked(mockClient.request).mock.calls[0];
    expect(path).toBe('/api/schedule/status?from=2026-11-01T00%3A00%3A00-03%3A00&to=2026-12-01T00%3A00%3A00-03%3A00');
    expect(path).not.toContain('limit');
    expect(textOf(response)).toContain('s-1');
  });

  it('handleListPosts rejects a lone from without calling the API', async () => {
    vi.mocked(mockClient.listPosts).mockClear();
    vi.mocked(mockClient.request).mockClear();
    const response = await handleListPosts(mockClient, { limit: 20, from: '2026-11-01T00:00:00Z' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('from and to must be provided together');
    expect(mockClient.listPosts).not.toHaveBeenCalled();
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it('listPostsInRange labels failures as list posts', async () => {
    vi.mocked(mockClient.request).mockRejectedValue(new Error('Failed to list posts: 400 Bad Request'));
    await expect(listPostsInRange(mockClient, { from: 'a', to: 'b' })).rejects.toThrow('Failed to list posts: 400');
  });

  it('handleCancelSchedule cancels by id', async () => {
    vi.mocked(mockClient.cancelSchedule).mockResolvedValue(FULL_CANCEL_RESULT);

    const response = await handleCancelSchedule(mockClient, { scheduleId: 'sched-1' });

    expect(mockClient.cancelSchedule).toHaveBeenCalledWith('sched-1');
    expect(textOf(response)).toContain('cancelled successfully');
  });


  it('handleConnectAccount returns the OAuth authorization URL with instructions', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockResolvedValue({
      success: true,
      auth_url: 'https://www.instagram.com/oauth/authorize?state=abc',
    });

    const response = await handleConnectAccount(mockClient, { provider: 'instagram' });

    expect(mockClient.getOAuthConnectUrl).toHaveBeenCalledWith('instagram');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('https://www.instagram.com/oauth/authorize?state=abc');
    expect(text).toMatch(/open/i);
    expect(text).toMatch(/authorize/i);
    expect(text).toMatch(/signed in to Post Engineer/i);
    expect(text).toContain('accounts (action: list)');
  });

  it('handleConnectAccount returns the OAuth authorization URL for fanvue', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockResolvedValue({
      success: true,
      auth_url: 'https://www.fanvue.com/oauth/authorize?state=abc',
    });

    const response = await handleConnectAccount(mockClient, { provider: 'fanvue' });

    expect(mockClient.getOAuthConnectUrl).toHaveBeenCalledWith('fanvue');
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('https://www.fanvue.com/oauth/authorize?state=abc');
  });

  it('ConnectAccountSchema accepts fanvue as an OAuth provider', async () => {
    const { ConnectAccountSchema } = await import('../tools.js');
    expect(ConnectAccountSchema.safeParse({ provider: 'fanvue' }).success).toBe(true);
    expect(ConnectAccountSchema.safeParse({ provider: 'myspace' }).success).toBe(false);
  });

  it('ConnectAccountSchema accepts every network, pinterest included', async () => {
    const { ConnectAccountSchema } = await import('../tools.js');
    const { SOCIAL_PROVIDERS } = await import('../contracts/providers.js');
    for (const provider of SOCIAL_PROVIDERS) {
      expect(ConnectAccountSchema.safeParse({ provider }).success, provider).toBe(true);
    }
    expect(ConnectAccountSchema.safeParse({ provider: 'pinterest' }).success).toBe(true);
  });

  it('handleConnectAccount returns the OAuth authorization URL for pinterest', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockResolvedValue({
      success: true,
      auth_url: 'https://www.pinterest.com/oauth/?state=abc',
    });

    const response = await handleConnectAccount(mockClient, { provider: 'pinterest' });

    expect(mockClient.getOAuthConnectUrl).toHaveBeenCalledWith('pinterest');
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('https://www.pinterest.com/oauth/?state=abc');
  });

  it('handleConnectAccount rejects non-https auth_url schemes', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockResolvedValue({
      success: true,
      auth_url: 'javascript:alert(1)',
    });

    const response = await handleConnectAccount(mockClient, { provider: 'instagram' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).not.toContain('javascript:');
  });

  it('handleConnectAccount returns an error when the connect-url request fails', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockRejectedValue(
      new Error('Failed to get OAuth connect URL: 401 Authentication required.')
    );

    const response = await handleConnectAccount(mockClient, { provider: 'youtube' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/Failed to get OAuth connect URL/);
  });

  it('handleConnectAccount connects Bluesky directly without echoing the app password', async () => {
    vi.mocked(mockClient.connectBlueskyAccount).mockResolvedValue({
      success: true,
      accountId: 'acc-1',
      did: 'did:plc:xyz',
    });

    const response = await handleConnectAccount(mockClient, {
      provider: 'bluesky',
      handle: 'user.bsky.social',
      appPassword: 'super-secret-password',
    });

    expect(mockClient.connectBlueskyAccount).toHaveBeenCalledWith(
      'user.bsky.social',
      'super-secret-password'
    );
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toMatch(/connected/i);
    expect(text).toContain('accountId=acc-1');
    expect(text).toContain('did=did:plc:xyz');
    expect(text).not.toContain('{');
    expect(text).not.toContain('super-secret-password');
  });

  it('handleConnectAccount requires handle and appPassword for Bluesky', async () => {
    vi.clearAllMocks();
    const response = await handleConnectAccount(mockClient, { provider: 'bluesky' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/handle.*appPassword|appPassword.*handle/i);
    expect(mockClient.connectBlueskyAccount).not.toHaveBeenCalled();
  });

  it('handleConnectAccount never leaks the app password on Bluesky errors', async () => {
    vi.mocked(mockClient.connectBlueskyAccount).mockRejectedValue(
      new Error('Failed to connect Bluesky account: 400 Invalid handle or app password.')
    );

    const response = await handleConnectAccount(mockClient, {
      provider: 'bluesky',
      handle: 'user.bsky.social',
      appPassword: 'super-secret-password',
    });

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toMatch(/Invalid handle or app password/);
    expect(text).not.toContain('super-secret-password');
  });

  it('handleConnectAccount connects 3Speak directly without echoing the posting key', async () => {
    vi.mocked(mockClient.connectThreespeakAccount).mockResolvedValue({
      success: true,
      accountId: 'acc-1',
      username: 'alice',
    });

    const response = await handleConnectAccount(mockClient, {
      provider: '3speak',
      username: 'alice',
      postingKey: '5Ksuper-secret-key',
    });

    expect(mockClient.connectThreespeakAccount).toHaveBeenCalledWith(
      'alice',
      '5Ksuper-secret-key'
    );
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toMatch(/connected/i);
    expect(text).not.toContain('5Ksuper-secret-key');
    expect(text).toContain('username=alice');
    expect(text).toContain('accountId=acc-1');
    expect(text).not.toContain('{');
  });

  it('handleConnectAccount requires username and postingKey for 3Speak', async () => {
    vi.clearAllMocks();
    const response = await handleConnectAccount(mockClient, { provider: '3speak' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/username.*postingKey|postingKey.*username/i);
    expect(mockClient.connectThreespeakAccount).not.toHaveBeenCalled();
  });

  it('handleConnectAccount never leaks the posting key on 3Speak errors', async () => {
    vi.mocked(mockClient.connectThreespeakAccount).mockRejectedValue(
      new Error('Failed to connect 3Speak account: 422 Invalid Hive posting key.')
    );

    const response = await handleConnectAccount(mockClient, {
      provider: '3speak',
      username: 'alice',
      postingKey: '5Ksuper-secret-key',
    });

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toMatch(/Invalid Hive posting key/);
    expect(text).not.toContain('5Ksuper-secret-key');
  });

  it('handleConnectAccount connects Rumble directly without echoing the access token', async () => {
    vi.mocked(mockClient.connectRumbleAccount).mockResolvedValue({
      success: true,
      accountId: 'acc-1',
      channelId: 'chan-1',
    });

    const response = await handleConnectAccount(mockClient, {
      provider: 'rumble',
      channelId: 'chan-1',
      accessToken: 'a'.repeat(40),
    });

    expect(mockClient.connectRumbleAccount).toHaveBeenCalledWith('chan-1', 'a'.repeat(40));
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toMatch(/connected/i);
    expect(text).not.toContain('a'.repeat(40));
  });

  it('handleConnectAccount requires channelId and accessToken for Rumble', async () => {
    vi.clearAllMocks();
    const response = await handleConnectAccount(mockClient, { provider: 'rumble' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/channelId.*accessToken|accessToken.*channelId/i);
    expect(mockClient.connectRumbleAccount).not.toHaveBeenCalled();
  });

  it('handleConnectAccount never leaks the access token on Rumble errors', async () => {
    vi.mocked(mockClient.connectRumbleAccount).mockRejectedValue(
      new Error('Failed to connect Rumble account: 400 Invalid channelId or access token.'),
    );

    const response = await handleConnectAccount(mockClient, {
      provider: 'rumble',
      channelId: 'chan-1',
      accessToken: 'a'.repeat(40),
    });

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toMatch(/Invalid channelId or access token/);
    expect(text).not.toContain('a'.repeat(40));
  });

  it('handleConnectAccount connects Telegram directly with the bot token, chat and kind', async () => {
    vi.mocked(connectTelegramAccount).mockResolvedValue({
      success: true,
      accountId: 'acc-tg',
      chatId: '-1001234567890',
      chatType: 'channel',
      title: 'Maria TV',
    });

    const botToken = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const response = await handleConnectAccount(mockClient, {
      provider: 'telegram',
      botToken,
      chatId: '-1001234567890',
      chatType: 'channel',
    });

    expect(connectTelegramAccount).toHaveBeenCalledWith(mockClient, botToken, '-1001234567890', 'channel');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toMatch(/connected/i);
    expect(text).toContain('chatId=-1001234567890');
    expect(text).toContain('chatType=channel');
    expect(text).toContain('accountId=acc-tg');
    expect(text).not.toContain(botToken);
  });

  it('handleConnectAccount requires botToken, chatId and chatType for Telegram', async () => {
    vi.clearAllMocks();
    const response = await handleConnectAccount(mockClient, { provider: 'telegram' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/botToken.*chatId.*chatType/i);
    expect(connectTelegramAccount).not.toHaveBeenCalled();
  });

  it('handleConnectAccount never leaks the bot token on Telegram errors', async () => {
    const botToken = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    vi.mocked(connectTelegramAccount).mockRejectedValue(
      new Error(`Failed to connect Telegram account: 422 Telegram rejected the bot token ${botToken}.`),
    );

    const response = await handleConnectAccount(mockClient, {
      provider: 'telegram',
      botToken,
      chatId: '-1001234567890',
      chatType: 'group',
    });

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toMatch(/Telegram/);
    expect(text).not.toContain(botToken);
  });
});


describe('schema bounds', () => {
  it('CreatePersonaSchema accepts a persona without a photo', () => {
    expect(CreatePersonaSchema.safeParse({ accounts: { youtube: ['acct-1'] }, name: 'x' }).success).toBe(true);
  });

  it('CreatePersonaSchema rejects an empty name and an empty avatarPath', () => {
    expect(CreatePersonaSchema.safeParse({ accounts: { youtube: ['acct-1'] }, name: '' }).success).toBe(false);
    expect(CreatePersonaSchema.safeParse({ accounts: { youtube: ['acct-1'] }, name: 'x', avatarPath: '' }).success).toBe(false);
  });

  it('UpdatePersonaSchema requires a personaId and accepts a name alone', () => {
    expect(UpdatePersonaSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p1', name: 'x' }).success).toBe(true);
  });

  it('persona schemas drop the removed generation fields instead of forwarding them', () => {
    const created = CreatePersonaSchema.parse({
      accounts: { youtube: ['acct-1'] },
      name: 'x',
      voiceId: 'chatterbox:kokoro_am_michael',
      language: 'pt-BR',
      faceQuality: 'ok',
    });
    expect(Object.keys(created).sort()).toEqual(['accounts', 'name']);
    const updated = UpdatePersonaSchema.parse({ personaId: 'p1', faceQuality: 'ultra' });
    expect(Object.keys(updated)).toEqual(['personaId']);
  });

  it('handleConnectAccount errors clearly when the response has no auth_url', async () => {
    const client = { getOAuthConnectUrl: vi.fn() } as unknown as PostEngineerClient;
    vi.mocked(client.getOAuthConnectUrl).mockResolvedValue({ success: true } as never);

    const response = await handleConnectAccount(client, { provider: 'youtube' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/auth_url/i);
  });
});

describe('persona account binding', () => {
  it('CreatePersonaSchema rejects a persona with no bound account (issue #572)', () => {
    const base = { name: 'X' };
    const missing = CreatePersonaSchema.safeParse(base);
    expect(missing.success).toBe(false);
    expect(JSON.stringify(missing.error?.issues)).toContain('"accounts"');
    for (const accounts of [{}, { youtube: [] }]) {
      const parsed = CreatePersonaSchema.safeParse({ ...base, accounts });
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(
        'Select at least one publishing account for this persona',
      );
    }
    expect(
      CreatePersonaSchema.safeParse({ ...base, accounts: { youtube: ['acct-1'] } }).success,
    ).toBe(true);
  });
});

describe('handleLibraryCall message contracts', () => {
  const mockClient = {
    createPersona: vi.fn(),
    cancelSchedule: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.mocked(mockClient.createPersona).mockReset();
    vi.mocked(mockClient.cancelSchedule).mockReset();
  });

  it('handleCreatePersona prefixes failures with "Error creating persona:"', async () => {
    vi.mocked(mockClient.createPersona).mockRejectedValue(new Error('boom'));
    const response = await handleCreatePersona(
      mockClient,
      CreatePersonaSchema.parse({
        accounts: { youtube: ['acct-1'] },
        name: 'Alex AI',
      })
    );
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error creating persona: boom');
  });

  it('handleCancelSchedule prefixes failures with "Error cancelling schedule:"', async () => {
    vi.mocked(mockClient.cancelSchedule).mockRejectedValue(new Error('gone'));
    const response = await handleCancelSchedule(mockClient, { scheduleId: 's-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error cancelling schedule: gone');
  });

});

describe('slot tools', () => {
  const mockClient = {
    getSlot: vi.fn(),
    updateSlotTitle: vi.fn(),
    deleteSlot: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GetSlotSchema requires a non-empty slotId', async () => {
    const { GetSlotSchema } = await import('../tools.js');
    expect(GetSlotSchema.safeParse({ slotId: 'slot-1' }).success).toBe(true);
    expect(GetSlotSchema.safeParse({ slotId: '' }).success).toBe(false);
    expect(GetSlotSchema.safeParse({}).success).toBe(false);
  });

  it('UpdateSlotTitleSchema requires slotId and a non-empty title', async () => {
    const { UpdateSlotTitleSchema } = await import('../tools.js');
    expect(
      UpdateSlotTitleSchema.safeParse({ slotId: 'slot-1', title: 'New' }).success
    ).toBe(true);
    expect(
      UpdateSlotTitleSchema.safeParse({ slotId: 'slot-1', title: '' }).success
    ).toBe(false);
    expect(UpdateSlotTitleSchema.safeParse({ slotId: 'slot-1' }).success).toBe(false);
  });

  it('handleGetSlot narrows the detail envelope and summarizes', async () => {
    const { handleGetSlot } = await import('../tools.js');
    vi.mocked(mockClient.getSlot).mockResolvedValue({
      ...FULL_SLOT_DETAIL,
      extraUnpinnedField: 'rides through unparsed',
    } as never);

    const response = await handleGetSlot(mockClient, { slotId: 'slot-1' });
    expect(mockClient.getSlot).toHaveBeenCalledWith('slot-1');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('slot-1');
    expect(text).toContain('Launch day');
    expect(text).toContain('ready');
    expect(text).toContain('"title": "Launch day"');
    expect(text).toContain('"postUrl": "https://post-engineer.com/posts/slot-1"');
    expect(text).not.toContain('extraUnpinnedField');
    expect(text).toContain('"userNotices": []');
  });

  it('handleGetSlot relays a user notice and tells the agent not to retry', async () => {
    const { handleGetSlot } = await import('../tools.js');
    const notice = 'Bluesky did not publish because the email on this account is not verified. This is a problem with your account. Only you can fix it: verify the email.';
    vi.mocked(mockClient.getSlot).mockResolvedValue({
      ...FULL_SLOT_DETAIL,
      slot: {
        ...FULL_SLOT_DETAIL.slot,
        status: 'publishing',
        userNotices: [{ provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: true, notice }],
        providerFailures: [{ provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: false, notice }],
      },
    });

    const text = textOf(await handleGetSlot(mockClient, { slotId: 'slot-1' }));
    expect(text).toContain(notice);
    expect(text).toContain('Do not retry');
    expect(text).toContain('Only the user can fix this account');
  });

  it('handleGetSlot surfaces API errors with the structured contract', async () => {
    const { handleGetSlot } = await import('../tools.js');
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.getSlot).mockRejectedValue(
      new ApiError('Failed to get slot: 404 Slot not found.', 'SLOT_NOT_FOUND', 'slotId')
    );

    const response = await handleGetSlot(mockClient, { slotId: 'nope' });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('"code":"SLOT_NOT_FOUND"');
    expect(text).toContain('"field":"slotId"');
  });

  it('handleUpdateSlotTitle passes the trimmed title and summarizes', async () => {
    const { handleUpdateSlotTitle } = await import('../tools.js');
    vi.mocked(mockClient.updateSlotTitle).mockResolvedValue({
      success: true,
      title: 'New title',
    });

    const response = await handleUpdateSlotTitle(mockClient, {
      slotId: 'slot-1',
      title: 'New title',
    });
    expect(mockClient.updateSlotTitle).toHaveBeenCalledWith('slot-1', 'New title');
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('New title');
  });

  it('handleDeleteSlot confirms the deletion', async () => {
    const { handleDeleteSlot } = await import('../tools.js');
    vi.mocked(mockClient.deleteSlot).mockResolvedValue({ success: true });

    const response = await handleDeleteSlot(mockClient, { slotId: 'slot-1' });
    expect(mockClient.deleteSlot).toHaveBeenCalledWith('slot-1');
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('slot-1');
  });

  it('DeleteSlotSchema requires a non-empty slotId', async () => {
    const { DeleteSlotSchema } = await import('../tools.js');
    expect(DeleteSlotSchema.safeParse({ slotId: 'slot-1' }).success).toBe(true);
    expect(DeleteSlotSchema.safeParse({ slotId: '' }).success).toBe(false);
  });
});

describe('delete persona tools', () => {
  const mockClient = {
    getPersonaDeletePreview: vi.fn(),
    deletePersona: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleDeletePersona confirms the destructive deletion', async () => {
    const { handleDeletePersona } = await import('../tools.js');
    vi.mocked(mockClient.deletePersona).mockResolvedValue({ success: true });

    const response = await handleDeletePersona(mockClient, { personaId: 'persona-1' });
    expect(mockClient.deletePersona).toHaveBeenCalledWith('persona-1');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('persona-1');
    expect(text).toMatch(/deleted/i);
  });

  it('handleDeletePersona surfaces API errors with the structured contract', async () => {
    const { handleDeletePersona } = await import('../tools.js');
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.deletePersona).mockRejectedValue(
      new ApiError('Failed to delete persona: 404 Persona not found.', 'PERSONA_NOT_FOUND', 'personaId')
    );

    const response = await handleDeletePersona(mockClient, { personaId: 'nope' });
    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('"code":"PERSONA_NOT_FOUND"');
    expect(text).toContain('"field":"personaId"');
  });
});

describe('disconnect account tool', () => {
  const mockClient = {
    disconnectAccount: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DisconnectAccountSchema validates provider and account id', async () => {
    const { DisconnectAccountSchema } = await import('../tools.js');
    expect(
      DisconnectAccountSchema.safeParse({ provider: 'bluesky', providerAccountId: 'did:plc:abc' }).success
    ).toBe(true);
    expect(
      DisconnectAccountSchema.safeParse({ provider: 'fanvue', providerAccountId: 'fan-1' }).success
    ).toBe(true);
    expect(
      DisconnectAccountSchema.safeParse({ provider: 'myspace', providerAccountId: 'acc-1' }).success
    ).toBe(false);
    expect(
      DisconnectAccountSchema.safeParse({ provider: 'youtube', providerAccountId: '' }).success
    ).toBe(false);
  });

  it('handleDisconnectAccount confirms the disconnection', async () => {
    const { handleDisconnectAccount } = await import('../tools.js');
    vi.mocked(mockClient.disconnectAccount).mockResolvedValue({ success: true });

    const response = await handleDisconnectAccount(mockClient, {
      provider: 'bluesky',
      providerAccountId: 'did:plc:abc',
    });
    expect(mockClient.disconnectAccount).toHaveBeenCalledWith('bluesky', 'did:plc:abc');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('bluesky');
    expect(text).toContain('did:plc:abc');
    expect(text).toMatch(/disconnected/i);
  });

  it('handleDisconnectAccount surfaces API errors with the structured contract', async () => {
    const { handleDisconnectAccount } = await import('../tools.js');
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.disconnectAccount).mockRejectedValue(
      new ApiError('Failed to disconnect account: 500 Failed to disconnect account.', 'DELETE_ERROR', 'provider')
    );

    const response = await handleDisconnectAccount(mockClient, {
      provider: 'youtube',
      providerAccountId: 'chan-1',
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('"code":"DELETE_ERROR"');
  });
});

describe('new tool error paths and narrowing fallbacks', () => {
  const mockClient = {
    getSlot: vi.fn(),
    updateSlotTitle: vi.fn(),
    listVideoGenerations: vi.fn(),
    getVideoGeneration: vi.fn(),
    listTokenTransactions: vi.fn(),
    getPersonaDeletePreview: vi.fn(),
    deletePersona: vi.fn(),
    disconnectAccount: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleGetSlot surfaces a plain failure without the structured contract', async () => {
    const { handleGetSlot } = await import('../tools.js');
    vi.mocked(mockClient.getSlot).mockRejectedValue(new Error('network down'));

    const response = await handleGetSlot(mockClient, { slotId: 'slot-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe('Error getting slot: network down');
  });

  it('handleGetSlot surfaces a malformed detail as an error instead of falling back to arg values', async () => {
    const { handleGetSlot } = await import('../tools.js');
    const { MalformedContractResponseError } = await import('../contract-response.js');
    vi.mocked(mockClient.getSlot).mockRejectedValue(
      new MalformedContractResponseError('Malformed response from GET /api/schedule/slots/:slotId.'),
    );

    const response = await handleGetSlot(mockClient, { slotId: 'slot-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe('Error getting slot: Malformed response from GET /api/schedule/slots/:slotId.');
  });

  it('handleGetSlot surfaces wrong-typed detail fields as a malformed error instead of coercing them', async () => {
    const { handleGetSlot } = await import('../tools.js');
    const { MalformedContractResponseError } = await import('../contract-response.js');
    vi.mocked(mockClient.getSlot).mockRejectedValue(
      new MalformedContractResponseError(
        'Malformed response from GET /api/schedule/slots/:slotId at slot.progress.',
      ),
    );

    const response = await handleGetSlot(mockClient, { slotId: 'slot-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe(
      'Error getting slot: Malformed response from GET /api/schedule/slots/:slotId at slot.progress.',
    );
  });

  it('handleUpdateSlotTitle surfaces API errors with the structured contract', async () => {
    const { handleUpdateSlotTitle } = await import('../tools.js');
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.updateSlotTitle).mockRejectedValue(
      new ApiError('Failed to update slot title: 409 Slot already generating.', 'SLOT_LOCKED', 'slotId')
    );

    const response = await handleUpdateSlotTitle(mockClient, { slotId: 'slot-1', title: 'New' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('"code":"SLOT_LOCKED"');
  });

  it('handleUpdateSlotTitle surfaces a plain failure without the structured contract', async () => {
    const { handleUpdateSlotTitle } = await import('../tools.js');
    vi.mocked(mockClient.updateSlotTitle).mockRejectedValue(new Error('network down'));

    const response = await handleUpdateSlotTitle(mockClient, { slotId: 'slot-1', title: 'New' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe('Error updating slot title: network down');
  });

  it('handleUpdateSlotTitle falls back to the requested title when the response has none', async () => {
    const { handleUpdateSlotTitle } = await import('../tools.js');
    vi.mocked(mockClient.updateSlotTitle).mockResolvedValue({ success: true });

    const response = await handleUpdateSlotTitle(mockClient, { slotId: 'slot-1', title: 'New' });
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('Slot slot-1 title updated to "New".');
  });

  it('handleDeletePersona surfaces a plain failure without the structured contract', async () => {
    const { handleDeletePersona } = await import('../tools.js');
    vi.mocked(mockClient.deletePersona).mockRejectedValue(new Error('network down'));

    const response = await handleDeletePersona(mockClient, { personaId: 'persona-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe('Error deleting persona: network down');
  });

  it('handleDisconnectAccount surfaces a plain failure without the structured contract', async () => {
    const { handleDisconnectAccount } = await import('../tools.js');
    vi.mocked(mockClient.disconnectAccount).mockRejectedValue(new Error('network down'));

    const response = await handleDisconnectAccount(mockClient, {
      provider: 'youtube',
      providerAccountId: 'chan-1',
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toBe('Error disconnecting account: network down');
  });
});

describe('publish video direct tool', () => {
  const mockClient = {
    publishVideoDirect: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PublishVideoDirectSchema requires accountIds and validates provider', async () => {
    const { PublishVideoDirectSchema } = await import('../tools.js');
    const base = {
      provider: 'youtube',
      videoPath: '/tmp/clip.mp4',
      accountIds: ['chan-1'],
      title: 't',
      description: 'd',
      tags: ['x'],
      privacyStatus: 'unlisted',
    };
    expect(PublishVideoDirectSchema.safeParse(base).success).toBe(true);
    expect(
      PublishVideoDirectSchema.safeParse({ ...base, accountIds: [] }).success
    ).toBe(false);
    expect(
      PublishVideoDirectSchema.safeParse({ ...base, provider: 'tiktok' }).success
    ).toBe(false);
    expect(
      PublishVideoDirectSchema.safeParse({ ...base, privacyStatus: 'friends' }).success
    ).toBe(false);
  });

  it('handlePublishVideoDirect summarizes per-account results as human text + machine JSON', async () => {
    const { handlePublishVideoDirect } = await import('../tools.js');
    vi.mocked(mockClient.publishVideoDirect).mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [
        { accountId: 'chan-1', success: true, videoId: 'vid-1', videoUrl: 'https://youtu.be/vid-1' },
        { accountId: 'chan-2', success: false, error: 'quota exceeded' },
      ],
      successCount: 1,
      logId: 'log-1',
    });

    const response = await handlePublishVideoDirect(mockClient, {
      provider: 'youtube',
      videoPath: '/tmp/clip.mp4',
      accountIds: ['chan-1', 'chan-2'],
      title: 't',
      description: 'd',
      tags: ['x'],
      privacyStatus: 'unlisted',
    });
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('1/2');
    expect(text).toContain('chan-1');
    expect(text).toContain('quota exceeded');
    expect(text).toContain('"successCount":1');
  });

  it('handlePublishVideoDirect surfaces API errors with the structured contract', async () => {
    const { handlePublishVideoDirect } = await import('../tools.js');
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.publishVideoDirect).mockRejectedValue(
      new ApiError('Failed to publish video: 401 Invalid API key.', 'UPLOAD_ERROR', 'accountIds')
    );

    const response = await handlePublishVideoDirect(mockClient, {
      provider: 'instagram',
      videoPath: '/tmp/clip.mp4',
      accountIds: ['ig-1'],
      caption: 'hello',
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('"code":"UPLOAD_ERROR"');
  });

  it('handlePublishVideoDirect forwards the idempotency key so a retry replays instead of reposting', async () => {
    const { handlePublishVideoDirect } = await import('../tools.js');
    vi.mocked(mockClient.publishVideoDirect).mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [
        { accountId: 'chan-1', success: true, videoId: 'vid-1', videoUrl: 'https://youtu.be/vid-1' },
      ],
      successCount: 1,
      logId: 'log-1',
    });

    const response = await handlePublishVideoDirect(mockClient, {
      provider: 'youtube',
      videoPath: '/tmp/clip.mp4',
      accountIds: ['chan-1'],
      title: 't',
      description: 'd',
      tags: ['x'],
      privacyStatus: 'unlisted',
      idempotencyKey: 'retry-1',
    });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(mockClient.publishVideoDirect).mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'retry-1',
    });
  });

  it('handlePublishVideoDirect forwards the pinterest boardId and shows the pin link', async () => {
    const { handlePublishVideoDirect } = await import('../tools.js');
    vi.mocked(mockClient.publishVideoDirect).mockResolvedValue({
      success: true,
      provider: 'pinterest',
      results: [
        { accountId: 'user-9', success: true, postId: '123456789', permalink: 'https://www.pinterest.com/pin/123456789/' },
      ],
      successCount: 1,
      logId: 'log-1',
    });

    const response = await handlePublishVideoDirect(mockClient, {
      provider: 'pinterest',
      videoPath: '/tmp/clip.mp4',
      accountIds: ['user-9'],
      caption: 'the pin description',
      title: 'My pin',
      boardId: 'b1',
    });
    expect(response.isError).toBeUndefined();
    expect(vi.mocked(mockClient.publishVideoDirect).mock.calls[0][0]).toMatchObject({
      provider: 'pinterest',
      boardId: 'b1',
      title: 'My pin',
    });
    expect(textOf(response)).toContain('https://www.pinterest.com/pin/123456789/');
  });
});
