import { describe, it, expect, vi } from 'vitest';
import {
  handleCreatePersona,
  handleGenerateVideo,
  handleListVoices,
  handleListFaces,
  handleUpdatePersona,
  handleListSocialAccounts,
  handleListSchedules,
  handleListPosts,
  handleCancelSchedule,
  handleGetTokenBalance,
  handleScheduleVideo,
  handleConnectAccount,
  ListPostsSchema,
} from '../tools.js';
import type { PostEngineerClient } from '../client.js';

describe('MCP Tool Handlers', () => {
  const mockClient = {
    createPersona: vi.fn(),
    listPersonas: vi.fn(),
    generateVideoJob: vi.fn(),
    listVoices: vi.fn(),
    listFaces: vi.fn(),
    updatePersona: vi.fn(),
    listSocialAccounts: vi.fn(),
    listSchedules: vi.fn(),
    listPosts: vi.fn(),
    cancelSchedule: vi.fn(),
    getTokenBalance: vi.fn(),
    getVideoStatus: vi.fn(),
    createSchedule: vi.fn(),
    getOAuthConnectUrl: vi.fn(),
    connectBlueskyAccount: vi.fn(),
  } as unknown as PostEngineerClient;

  it('handleCreatePersona calls client and returns text response', async () => {
    vi.mocked(mockClient.createPersona).mockResolvedValue({
      success: true,
      personaId: 'persona-123',
    });

    const response = await handleCreatePersona(mockClient, {
      name: 'Alex AI',
      avatarUrl: 'https://example.com/alex.png',
      voiceId: 'alloy',
      language: 'en-US',
      videoAspect: '9:16',
      scriptPrompt: 'Explain AI concepts',
    });

    expect(mockClient.createPersona).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alex AI' })
    );
    expect(response.content[0].text).toContain('persona-123');
  });

  it('handleGenerateVideo triggers job and returns taskId', async () => {
    vi.mocked(mockClient.generateVideoJob).mockResolvedValue({
      success: true,
      taskId: 'task-789',
    });

    const response = await handleGenerateVideo(mockClient, {
      personaId: 'persona-123',
      scriptPrompt: 'Top 3 AI coding assistants in 2026',
    });

    expect(mockClient.generateVideoJob).toHaveBeenCalledWith({
      personaId: 'persona-123',
      scriptPrompt: 'Top 3 AI coding assistants in 2026',
    });
    expect(response.content[0].text).toContain('task-789');
  });

  it('handleGenerateVideo passes audioUrl through to the client', async () => {
    vi.mocked(mockClient.generateVideoJob).mockResolvedValue({
      success: true,
      taskId: 'task-audio-2',
    });

    const response = await handleGenerateVideo(mockClient, {
      personaId: 'persona-123',
      audioUrl: 'https://cdn.example.com/narracao.mp3',
    });

    expect(mockClient.generateVideoJob).toHaveBeenCalledWith({
      personaId: 'persona-123',
      audioUrl: 'https://cdn.example.com/narracao.mp3',
    });
    expect(response.content[0].text).toContain('task-audio-2');
  });

  it('handleListVoices returns the voice catalog', async () => {
    vi.mocked(mockClient.listVoices).mockResolvedValue({
      voices: [{ id: 'calm' }, { id: 'energetic' }],
    });

    const response = await handleListVoices(mockClient);

    expect(mockClient.listVoices).toHaveBeenCalledOnce();
    expect(response.content[0].text).toContain('calm');
  });


  it('handleListFaces returns the face catalog', async () => {
    vi.mocked(mockClient.listFaces).mockResolvedValue({
      faces: [{ id: 'file-1', url: 'https://post-engineer.com/caracter-samples/file-1.png', name: 'Character 1', gender: 'female', age: 23, ethnicity: 'White', hair: 'shoulder-length wavy blonde', description: 'Young blonde woman with light eyes.' }],
    });

    const response = await handleListFaces(mockClient);

    expect(mockClient.listFaces).toHaveBeenCalledOnce();
    expect(response.content[0].text).toContain('file-1');
  });

  it('handleUpdatePersona updates only provided fields', async () => {
    vi.mocked(mockClient.updatePersona).mockResolvedValue({ success: true });

    const response = await handleUpdatePersona(mockClient, {
      personaId: 'persona-123',
      voiceId: 'energetic',
      niche: 'Finanças',
    });

    expect(mockClient.updatePersona).toHaveBeenCalledWith({
      personaId: 'persona-123',
      voiceId: 'energetic',
      niche: 'Finanças',
    });
    expect(response.content[0].text).toContain('updated successfully');
  });

  it('handleUpdatePersona returns error when the API fails', async () => {
    vi.mocked(mockClient.updatePersona).mockRejectedValue(new Error('Failed to update persona: 404 Persona not found.'));

    const response = await handleUpdatePersona(mockClient, { personaId: 'missing' });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Persona not found');
  });

  it('handleListSocialAccounts returns connected accounts', async () => {
    vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({
      authenticated: true,
      accounts: [{ provider: 'youtube', channelId: 'chan-1' }],
    });

    const response = await handleListSocialAccounts(mockClient);

    expect(mockClient.listSocialAccounts).toHaveBeenCalledOnce();
    expect(response.content[0].text).toContain('chan-1');
  });

  it('handleListSchedules returns schedules', async () => {
    vi.mocked(mockClient.listSchedules).mockResolvedValue({
      success: true,
      schedules: [{ id: 'sched-1', persona_id: 'persona-123' }],
    });

    const response = await handleListSchedules(mockClient);

    expect(mockClient.listSchedules).toHaveBeenCalledOnce();
    expect(response.content[0].text).toContain('sched-1');
  });

  it('ListPostsSchema defaults limit to 20 and caps it at 500', () => {
    expect(ListPostsSchema.parse({}).limit).toBe(20);
    expect(ListPostsSchema.parse({ limit: 500 }).limit).toBe(500);
    expect(() => ListPostsSchema.parse({ limit: 0 })).toThrow();
    expect(() => ListPostsSchema.parse({ limit: 501 })).toThrow();
    expect(() => ListPostsSchema.parse({ limit: 1.5 })).toThrow();
  });

  it('handleListPosts returns upcoming and past posts', async () => {
    vi.mocked(mockClient.listPosts).mockResolvedValue({
      success: true,
      upcoming: [{ id: 'up-1', status: 'pending' }],
      recent: [{ id: 're-1', status: 'published' }],
    });

    const response = await handleListPosts(mockClient, { limit: 20 });

    expect(mockClient.listPosts).toHaveBeenCalledWith(20);
    expect(response.content[0].text).toContain('up-1');
    expect(response.content[0].text).toContain('re-1');
    expect(response.isError).toBeUndefined();
  });

  it('handleListPosts returns an error result when the client fails', async () => {
    vi.mocked(mockClient.listPosts).mockRejectedValue(new Error('boom'));

    const response = await handleListPosts(mockClient, { limit: 20 });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Error listing posts: boom');
  });

  it('handleCancelSchedule cancels by id', async () => {
    vi.mocked(mockClient.cancelSchedule).mockResolvedValue({ success: true });

    const response = await handleCancelSchedule(mockClient, { scheduleId: 'sched-1' });

    expect(mockClient.cancelSchedule).toHaveBeenCalledWith('sched-1');
    expect(response.content[0].text).toContain('cancelled successfully');
  });

  it('handleGetTokenBalance returns the wallet balance', async () => {
    vi.mocked(mockClient.getTokenBalance).mockResolvedValue({ success: true, balance: 8, free: 3 });

    const response = await handleGetTokenBalance(mockClient);

    expect(mockClient.getTokenBalance).toHaveBeenCalledOnce();
    expect(response.content[0].text).toContain('8');
  });

  it('handleScheduleVideo returns error when < 24h constraint violated', async () => {
    vi.mocked(mockClient.createSchedule).mockRejectedValue(
      new Error('Scheduled time must be at least 24 hours in advance.')
    );

    const response = await handleScheduleVideo(mockClient, {
      personaId: 'persona-123',
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
      scheduledAt: '2026-09-18T12:00:00.000Z',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/at least 24 hours/i);
  });

  it('handleConnectAccount returns the OAuth authorization URL with instructions', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockResolvedValue({
      success: true,
      auth_url: 'https://www.instagram.com/oauth/authorize?state=abc',
    });

    const response = await handleConnectAccount(mockClient, { provider: 'instagram' });

    expect(mockClient.getOAuthConnectUrl).toHaveBeenCalledWith('instagram');
    expect(response.isError).toBeUndefined();
    const text = (response.content[0] as { text: string }).text;
    expect(text).toContain('https://www.instagram.com/oauth/authorize?state=abc');
    expect(text).toMatch(/open/i);
    expect(text).toMatch(/authorize/i);
    expect(text).toContain('list_social_accounts');
  });

  it('handleConnectAccount returns an error when the connect-url request fails', async () => {
    vi.mocked(mockClient.getOAuthConnectUrl).mockRejectedValue(
      new Error('Failed to get OAuth connect URL: 401 Authentication required.')
    );

    const response = await handleConnectAccount(mockClient, { provider: 'youtube' });

    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toMatch(/Failed to get OAuth connect URL/);
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
    const text = (response.content[0] as { text: string }).text;
    expect(text).toMatch(/connected/i);
    expect(text).not.toContain('super-secret-password');
  });

  it('handleConnectAccount requires handle and appPassword for Bluesky', async () => {
    vi.clearAllMocks();
    const response = await handleConnectAccount(mockClient, { provider: 'bluesky' });

    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toMatch(/handle.*appPassword|appPassword.*handle/i);
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
    const text = (response.content[0] as { text: string }).text;
    expect(text).toMatch(/Invalid handle or app password/);
    expect(text).not.toContain('super-secret-password');
  });
});
