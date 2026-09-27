import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getErrorMessage,
  handleCreatePersona,
  handleListPersonaImages,
  handleAddPersonaImage,
  handleUpdatePersonaImage,
  handleRemovePersonaImage,
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
  ScheduleVideoSchema,
  CreatePersonaSchema,
  UpdatePersonaSchema,
  GenerateVideoSchema,
  ListPersonaImagesSchema,
  AddPersonaImageSchema,
  UpdatePersonaImageSchema,
  RemovePersonaImageSchema,
} from '../tools.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools.js';

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

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

    const response = await handleCreatePersona(
      mockClient,
      CreatePersonaSchema.parse({
        name: 'Alex AI',
        avatarUrl: 'https://example.com/alex.png',
        voiceId: 'alloy',
        language: 'en-US',
        videoAspect: '9:16',
        scriptPrompt: 'Explain AI concepts',
      })
    );

    expect(mockClient.createPersona).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alex AI' })
    );
    expect(textOf(response)).toContain('persona-123');
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
    expect(textOf(response)).toContain('task-789');
  });

  it('handleGenerateVideo renders the ok sentinel instead of "undefined" for empty-body success', async () => {
    vi.mocked(mockClient.generateVideoJob).mockResolvedValue({ ok: true });

    const response = await handleGenerateVideo(mockClient, {
      personaId: 'persona-123',
      scriptPrompt: 'Top 3 AI coding assistants in 2026',
    });

    const text = textOf(response);
    expect(text).toContain('"ok": true');
    expect(text).not.toContain('undefined');
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
    expect(textOf(response)).toContain('task-audio-2');
  });

  it('handleListVoices returns the voice catalog', async () => {
    vi.mocked(mockClient.listVoices).mockResolvedValue({
      voices: [{ id: 'calm' }, { id: 'energetic' }],
    });

    const response = await handleListVoices(mockClient);

    expect(mockClient.listVoices).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('calm');
  });


  it('handleListFaces returns the face catalog', async () => {
    vi.mocked(mockClient.listFaces).mockResolvedValue({
      faces: [{ id: 'file-1', url: 'https://post-engineer.com/caracter-samples/file-1.png', name: 'Character 1', gender: 'female', age: 23, ethnicity: 'White', hair: 'shoulder-length wavy blonde', description: 'Young blonde woman with light eyes.' }],
    });

    const response = await handleListFaces(mockClient);

    expect(mockClient.listFaces).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('file-1');
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
    expect(textOf(response)).toContain('updated successfully');
  });

  it('handleUpdatePersona returns error when the API fails', async () => {
    vi.mocked(mockClient.updatePersona).mockRejectedValue(new Error('Failed to update persona: 404 Persona not found.'));

    const response = await handleUpdatePersona(mockClient, { personaId: 'missing' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Persona not found');
  });

  it('handleListSocialAccounts returns connected accounts', async () => {
    vi.mocked(mockClient.listSocialAccounts).mockResolvedValue({
      authenticated: true,
      accounts: [{ provider: 'youtube', channelId: 'chan-1' }],
    });

    const response = await handleListSocialAccounts(mockClient);

    expect(mockClient.listSocialAccounts).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('chan-1');
  });

  it('handleListSchedules returns schedules', async () => {
    vi.mocked(mockClient.listSchedules).mockResolvedValue({
      success: true,
      schedules: [{ id: 'sched-1', persona_id: 'persona-123' }],
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

  it('handleListPosts returns upcoming and past posts', async () => {
    vi.mocked(mockClient.listPosts).mockResolvedValue({
      success: true,
      upcoming: [{ id: 'up-1', status: 'pending' }],
      recent: [{ id: 're-1', status: 'published' }],
    });

    const response = await handleListPosts(mockClient, { limit: 20 });

    expect(mockClient.listPosts).toHaveBeenCalledWith(20);
    expect(textOf(response)).toContain('up-1');
    expect(textOf(response)).toContain('re-1');
    expect(response.isError).toBeUndefined();
  });

  it('handleListPosts returns an error result when the client fails', async () => {
    vi.mocked(mockClient.listPosts).mockRejectedValue(new Error('boom'));

    const response = await handleListPosts(mockClient, { limit: 20 });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error listing posts: boom');
  });

  it('handleCancelSchedule cancels by id', async () => {
    vi.mocked(mockClient.cancelSchedule).mockResolvedValue({ success: true });

    const response = await handleCancelSchedule(mockClient, { scheduleId: 'sched-1' });

    expect(mockClient.cancelSchedule).toHaveBeenCalledWith('sched-1');
    expect(textOf(response)).toContain('cancelled successfully');
  });

  it('handleGetTokenBalance returns the wallet balance', async () => {
    vi.mocked(mockClient.getTokenBalance).mockResolvedValue({ success: true, balance: 8, free: 3 });

    const response = await handleGetTokenBalance(mockClient);

    expect(mockClient.getTokenBalance).toHaveBeenCalledOnce();
    expect(textOf(response)).toContain('8');
  });

  it('handleScheduleVideo returns error when < 24h constraint violated', async () => {
    vi.mocked(mockClient.createSchedule).mockRejectedValue(
      new Error('Scheduled time must be at least 24 hours in advance.')
    );

    const response = await handleScheduleVideo(
      mockClient,
      ScheduleVideoSchema.parse({
        personaId: 'persona-123',
        providers: ['youtube'],
        youtubeAccountIds: ['yt-1'],
        scheduledAt: '2026-09-18T12:00:00.000Z',
      })
    );

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/at least 24 hours/i);
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
    expect(text).toContain('list_social_accounts');
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
});

describe('schedule account validation', () => {
  const baseArgs = {
    personaId: 'persona-123',
    providers: ['youtube'] as const,
    scheduledAt: '2026-10-18T12:00:00.000Z',
  };

  it('ScheduleVideoSchema rejects a provider with no account IDs', () => {
    const result = ScheduleVideoSchema.safeParse({
      ...baseArgs,
      providers: ['youtube'],
    });
    expect(result.success).toBe(false);
  });

  it('ScheduleVideoSchema accepts a provider with account IDs', () => {
    const result = ScheduleVideoSchema.safeParse({
      ...baseArgs,
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
    });
    expect(result.success).toBe(true);
  });

  it('handleScheduleVideo fails fast without calling the API when account IDs are missing', async () => {
    const client = { createSchedule: vi.fn() } as unknown as PostEngineerClient;
    const response = await handleScheduleVideo(client, {
      personaId: 'persona-123',
      providers: ['youtube'],
      youtubeAccountIds: [],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      scheduledAt: '2026-10-18T12:00:00.000Z',
      timezone: 'UTC',
    });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/youtube.*account|account.*youtube/i);
    expect(client.createSchedule).not.toHaveBeenCalled();
  });
});

describe('schema bounds', () => {
  it('CreatePersonaSchema accepts paragraphNumber up to 10 (matches the API)', () => {
    const result = CreatePersonaSchema.safeParse({
      name: 'x',
      paragraphNumber: 10,
    });
    expect(result.success).toBe(true);
  });

  it('UpdatePersonaSchema rejects avatarUrl: null (clearing is not supported)', () => {
    const result = UpdatePersonaSchema.safeParse({
      personaId: 'p1',
      avatarUrl: null,
    });
    expect(result.success).toBe(false);
  });

  it('handleConnectAccount errors clearly when the response has no auth_url', async () => {
    const client = { getOAuthConnectUrl: vi.fn() } as unknown as PostEngineerClient;
    vi.mocked(client.getOAuthConnectUrl).mockResolvedValue({ success: true });

    const response = await handleConnectAccount(client, { provider: 'youtube' });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/auth_url/i);
  });
});

describe('getErrorMessage', () => {
  it('returns the message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error thrown values', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('persona image library tools', () => {
  const mockClient = {
    createPersona: vi.fn(),
    generateVideoJob: vi.fn(),
    listPersonaImages: vi.fn(),
    addPersonaImage: vi.fn(),
    updatePersonaImage: vi.fn(),
    deletePersonaImage: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('create_persona accepts images and imagePrimaryIndex', async () => {
    vi.mocked(mockClient.createPersona).mockResolvedValue({ success: true, personaId: 'p-1' });
    const args = CreatePersonaSchema.parse({
      name: 'Alex AI',
      avatarUrl: 'https://example.com/alex.png',
      images: [
        { path: '/tmp/a.jpg', tag: 'casual', description: 'at the beach' },
        { path: '/tmp/b.png' },
      ],
      imagePrimaryIndex: 1,
    });
    const response = await handleCreatePersona(mockClient, args);
    expect(mockClient.createPersona).toHaveBeenCalledWith(
      expect.objectContaining({ imagePrimaryIndex: 1, images: expect.any(Array) })
    );
    expect(textOf(response)).toContain('p-1');
  });

  it('create_persona rejects more than 10 images at the schema level', () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ path: `/tmp/img-${i}.jpg` }));
    expect(() =>
      CreatePersonaSchema.parse({ name: 'X', avatarUrl: 'https://example.com/a.png', images })
    ).toThrow();
  });

  it('generate_video_from_persona passes imageId through', async () => {
    vi.mocked(mockClient.generateVideoJob).mockResolvedValue({ success: true, taskId: 't-1' });
    const response = await handleGenerateVideo(
      mockClient,
      GenerateVideoSchema.parse({ personaId: 'p-1', imageId: 'img-123' })
    );
    expect(mockClient.generateVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: 'img-123' })
    );
    expect(textOf(response)).toContain('t-1');
  });

  it('generate_video_from_persona rejects an empty imageId', () => {
    expect(() =>
      GenerateVideoSchema.parse({ personaId: 'p-1', imageId: '' })
    ).toThrow();
  });

  it('list_persona_images returns the library', async () => {
    vi.mocked(mockClient.listPersonaImages).mockResolvedValue({ images: [] });
    const response = await handleListPersonaImages(
      mockClient,
      ListPersonaImagesSchema.parse({ personaId: 'p-1' })
    );
    expect(mockClient.listPersonaImages).toHaveBeenCalledWith('p-1');
    expect(textOf(response)).toContain('images');
  });

  it('add_persona_image forwards path, tag, description, isPrimary', async () => {
    vi.mocked(mockClient.addPersonaImage).mockResolvedValue({ success: true, id: 'img-1' });
    const response = await handleAddPersonaImage(
      mockClient,
      AddPersonaImageSchema.parse({ personaId: 'p-1', path: '/tmp/a.jpg', tag: 'gym', isPrimary: true })
    );
    expect(mockClient.addPersonaImage).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ path: '/tmp/a.jpg', tag: 'gym', isPrimary: true })
    );
    expect(textOf(response)).toContain('img-1');
  });

  it('update_persona_image forwards metadata', async () => {
    vi.mocked(mockClient.updatePersonaImage).mockResolvedValue({ success: true });
    await handleUpdatePersonaImage(
      mockClient,
      UpdatePersonaImageSchema.parse({ id: 'img-1', tag: 'formal', isPrimary: true })
    );
    expect(mockClient.updatePersonaImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'img-1', tag: 'formal', isPrimary: true })
    );
  });

  it('remove_persona_image forwards the id', async () => {
    vi.mocked(mockClient.deletePersonaImage).mockResolvedValue({ success: true });
    await handleRemovePersonaImage(mockClient, RemovePersonaImageSchema.parse({ id: 'img-1' }));
    expect(mockClient.deletePersonaImage).toHaveBeenCalledWith('img-1');
  });

  it('library handlers surface client errors as isError', async () => {
    vi.mocked(mockClient.listPersonaImages).mockRejectedValue(new Error('boom'));
    const response = await handleListPersonaImages(
      mockClient,
      ListPersonaImagesSchema.parse({ personaId: 'p-1' })
    );
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('boom');
  });
});
