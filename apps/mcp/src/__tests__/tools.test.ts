import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  handleCreatePersona,
  handleListPersonaImages,
  handleAddPersonaImage,
  handleUpdatePersonaImage,
  handleRemovePersonaImage,
  handleGeneratePersonaVideos,
  handleListVoices,
  handleListFaces,
  handleUpdatePersona,
  handleListSocialAccounts,
  handleListSchedules,
  handleListPosts,
  handleCancelSchedule,
  handleGetTokenBalance,
  handleConnectAccount,
  ListPostsSchema,
  CreatePersonaSchema,
  UpdatePersonaSchema,
  GeneratePersonaVideosSchema,
  ListPersonaImagesSchema,
  AddPersonaImageSchema,
  UpdatePersonaImageSchema,
  UpdatePersonaImageShape,
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
    generatePersonaVideos: vi.fn(),
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


describe('schema bounds', () => {
  it('CreatePersonaSchema accepts paragraphNumber up to 10 (matches the API)', () => {
    const result = CreatePersonaSchema.safeParse({
      name: 'x',
      avatarUrl: 'https://example.com/a.png',
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

describe('persona image library tools', () => {
  const mockClient = {
    createPersona: vi.fn(),
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

  it('CreatePersonaSchema rejects a missing avatarUrl at parse time', () => {
    // avatarUrl is always required: every persona has a face, and "no face"
    // is a per-video choice (generate_persona_videos options.faceless),
    // never a persona one. There is no images-specific rule anymore — the
    // missing required field fails the parse on its own.
    expect(() =>
      CreatePersonaSchema.parse({ name: 'X', images: [{ path: '/tmp/a.jpg' }] })
    ).toThrow(/Required/);
    expect(() => CreatePersonaSchema.parse({ name: 'X' })).toThrow(/Required/);
  });

  it('CreatePersonaSchema accepts images with avatarUrl', () => {
    expect(() =>
      CreatePersonaSchema.parse({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [{ path: '/tmp/a.jpg' }],
      })
    ).not.toThrow();
    expect(() =>
      CreatePersonaSchema.parse({
        name: 'X',
        avatarUrl: 'https://example.com/a.png',
        images: [],
      })
    ).not.toThrow();
  });

  it('create_persona handler fails on a missing avatarUrl before the client call', async () => {
    // Simulates args that bypassed the SDK's raw-shape validation: the
    // handler re-parses with the full schema, so the required avatarUrl
    // becomes a loud isError — no file is read, no fetch happens.
    vi.clearAllMocks();
    vi.mocked(mockClient.createPersona).mockResolvedValue({ success: true });
    const sdkArgs = {
      name: 'X',
      images: [{ path: '/tmp/a.jpg' }],
    } as unknown as z.infer<typeof CreatePersonaSchema>;
    const response = await handleCreatePersona(mockClient, sdkArgs);
    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/avatarUrl/);
    expect(mockClient.createPersona).not.toHaveBeenCalled();
  });

  it('update_persona_image documents that whitespace-only metadata clears the stored value', () => {
    // Server convention: undefined = keep, '' = clear. A whitespace-only
    // value trims to '' client-side, so the field docs must say so —
    // otherwise a caller passing "   " wipes the value unknowingly.
    for (const field of [UpdatePersonaImageShape.tag, UpdatePersonaImageShape.description]) {
      expect(field.description).toMatch(/whitespace/i);
      expect(field.description).toMatch(/clear/i);
    }
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

  it('add_persona_image rejects isPrimary:false at parse time', async () => {
    // Symmetric with update_persona_image (swap-only): isPrimary:false on a
    // brand-new image is meaningless — the image is never primary unless
    // explicitly marked. Reject loudly instead of silently dropping it.
    expect(() =>
      AddPersonaImageSchema.parse({ personaId: 'p-1', path: '/tmp/a.jpg', isPrimary: false }),
    ).toThrow();
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

  it('update_persona_image rejects a no-op update with only an id', async () => {
    // The refine encodes the domain rule "at least one of tag/description/
    // isPrimary" in the schema: an id-only call must fail at parse time,
    // before any client call.
    vi.clearAllMocks();
    expect(() => UpdatePersonaImageSchema.parse({ id: 'img-1' })).toThrow(
      /At least one of tag, description, or isPrimary/
    );
    expect(mockClient.updatePersonaImage).not.toHaveBeenCalled();
  });

  it.each([
    ['tag', { id: 'img-1', tag: 'portrait' }],
    ['description', { id: 'img-1', description: 'Studio headshot' }],
    ['isPrimary', { id: 'img-1', isPrimary: true }],
  ])('update_persona_image accepts when only %s is set', (_field, args) => {
    // Each || branch of the refine must independently accept: a mutant
    // dropping any branch must be caught.
    expect(() => UpdatePersonaImageSchema.parse(args)).not.toThrow();
  });

  it('update_persona_image re-parses raw handler args with the refined schema', async () => {
    // The MCP SDK parses tool args against the raw UpdatePersonaImageShape,
    // so the .refine would never fire on the tool path. The handler
    // re-parses (like handleCreatePersona) so the id-only call fails at
    // parse time with the schema message, before any client call.
    vi.clearAllMocks();
    const result = await handleUpdatePersonaImage(mockClient, { id: 'img-1' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(
      /At least one of tag, description, or isPrimary/
    );
    expect(mockClient.updatePersonaImage).not.toHaveBeenCalled();
  });

  it('update_persona_image rejects isPrimary:false at parse time', async () => {
    // The server PATCH is swap-only and 400s isPrimary:false. The schema
    // is z.literal(true) so an agent learns the constraint from the tool
    // contract instead of a server error.
    expect(() =>
      UpdatePersonaImageSchema.parse({ id: 'img-1', isPrimary: false })
    ).toThrow();
    expect(mockClient.updatePersonaImage).not.toHaveBeenCalled();
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

describe('video task progress tools', () => {
  const mockClient = {
    getVideoStatus: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleGetVideoTaskProgress narrows the status body to task_id/state/progress/stage', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: 4, progress: 42, stage: 'audio' },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 'task-1' });

    expect(mockClient.getVideoStatus).toHaveBeenCalledWith('task-1');
    const text = textOf(response);
    expect(text).toContain('"task_id": "task-1"');
    expect(text).toContain('"state": 4');
    expect(text).toContain('"progress": 42');
    expect(text).toContain('"stage": "audio"');
  });

  it('handleGetVideoTaskProgress surfaces the engine error when the task failed', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      status: 200,
      message: 'success',
      body: {
        task_id: 'task-1',
        state: -1,
        progress: 75,
        stage: 'render',
        error: 'persona hook must end between 3 and 6 seconds, got 6.55',
      },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 'task-1' });
    const text = textOf(response);
    expect(text).toContain('"state": -1');
    expect(text).toContain('"error": "persona hook must end between 3 and 6 seconds, got 6.55"');
  });

  it('handleGetVideoTaskProgress redacts credential-like material from the engine error', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      status: 200,
      message: 'success',
      body: {
        task_id: 'task-1',
        state: -1,
        progress: 75,
        stage: 'render',
        error:
          'upload failed: 401 for Bearer abc123XYZ; ' +
          'dsn https://user:s3cret@ingest.example.com/9 failed; ' +
          'GET https://api.example.com/v1?api_key=SECRET123 denied',
      },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 'task-1' });
    const text = textOf(response);
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('https://[redacted]@ingest.example.com/9');
    expect(text).toContain('api_key=[redacted]');
    expect(text).not.toContain('abc123XYZ');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('SECRET123');
    // The human-readable failure reason survives redaction.
    expect(text).toContain('upload failed');
  });

  it('handleGetVideoTaskProgress leaves an ordinary engine error untouched', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      status: 200,
      message: 'success',
      body: {
        task_id: 'task-1',
        state: -1,
        progress: 10,
        stage: 'hook',
        error: 'persona hook must end between 3 and 6 seconds, got 6.55',
      },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 'task-1' });
    expect(textOf(response)).toContain(
      '"error": "persona hook must end between 3 and 6 seconds, got 6.55"'
    );
  });

  it('handleGetVideoTaskProgress reports explicit nulls when the task payload is missing', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({ ok: true });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 'task-9' });
    const text = textOf(response);
    expect(text).toContain('"task_id": null');
    expect(text).toContain('"state": null');
    expect(text).toContain('"progress": null');
    expect(text).toContain('"stage": null');
    expect(text).toContain('"error": null');
  });
});

describe('generate_persona_videos tool', () => {
  const mockClient = {
    generatePersonaVideos: vi.fn(),
  } as unknown as PostEngineerClient;

  const baseArgs = {
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
    vi.clearAllMocks();
  });

  it('GeneratePersonaVideosSchema accepts a full valid call', () => {
    const result = GeneratePersonaVideosSchema.safeParse(baseArgs);
    expect(result.success).toBe(true);
  });

  it('GeneratePersonaVideosSchema accepts an omitted personaId (a faceless post)', () => {
    // Since migration 012 a persona is optional: a faceless post is defined by
    // options.faceless plus a voice. The empty string is still rejected — it
    // is a caller bug (half-specified persona), not a way to omit one.
    const { personaId: _personaId, ...rest } = baseArgs;
    const withoutPersona = GeneratePersonaVideosSchema.safeParse({
      ...rest,
      options: { faceless: true, voiceId: 'calm' },
    });
    expect(withoutPersona.success).toBe(true);
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, personaId: '' }).success
    ).toBe(false);
  });

  it('GeneratePersonaVideosSchema accepts the persona-less identity options', () => {
    // The rest of what a persona used to supply. Pinned because they are the
    // only way to define a post without one.
    const { personaId: _personaId, ...rest } = baseArgs;
    const result = GeneratePersonaVideosSchema.safeParse({
      ...rest,
      options: {
        faceless: true,
        voiceId: 'calm',
        scriptPrompt: 'Be direct.',
        videoAspect: '16:9',
        paragraphNumber: 3,
        language: 'pt-BR',
        niche: 'tech',
      },
    });
    expect(result.success).toBe(true);
  });

  it('GeneratePersonaVideosSchema rejects an out-of-range identity option', () => {
    // The caps mirror the engine's PersonaParams; catching them at parse
    // time is what turns an engine-side validation error into a tool error.
    const { personaId: _personaId, ...rest } = baseArgs;
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...rest,
        options: { faceless: true, voiceId: 'calm', paragraphNumber: 11 },
      }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...rest,
        options: { faceless: true, voiceId: 'calm', videoAspect: '4:3' },
      }).success
    ).toBe(false);
  });

  it('GeneratePersonaVideosSchema requires topics and providers', () => {
    const { topics: _topics, ...noTopics } = baseArgs;
    expect(GeneratePersonaVideosSchema.safeParse(noTopics).success).toBe(false);
    const { providers: _providers, ...noProviders } = baseArgs;
    expect(GeneratePersonaVideosSchema.safeParse(noProviders).success).toBe(false);
  });

  it("GeneratePersonaVideosSchema defaults mode to 'scheduled'", () => {
    const result = GeneratePersonaVideosSchema.safeParse(baseArgs);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe('scheduled');
  });

  it("GeneratePersonaVideosSchema accepts mode 'asap' without startAt/times", () => {
    // ASAP mode publishes each video the moment generation finishes: no
    // schedule plan is sent, so startAt and times are simply absent.
    const { startAt: _startAt, times: _times, ...rest } = baseArgs;
    const result = GeneratePersonaVideosSchema.safeParse({ ...rest, mode: 'asap' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('asap');
      expect(result.data.startAt).toBeUndefined();
      expect(result.data.times).toBeUndefined();
    }
  });

  it('GeneratePersonaVideosSchema bounds topics to 1-10', () => {
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, topics: [] }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...baseArgs,
        topics: Array.from({ length: 11 }, (_, i) => `topic ${i}`),
      }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...baseArgs,
        topics: Array.from({ length: 10 }, (_, i) => `topic ${i}`),
      }).success
    ).toBe(true);
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, topics: [''] }).success
    ).toBe(false);
  });

  it('GeneratePersonaVideosSchema rejects an invalid startAt and non-HH:MM times', () => {
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, startAt: 'not-a-date' }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, times: ['9:30'] }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, times: ['24:00'] }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({ ...baseArgs, times: ['09:30', '20:00'] }).success
    ).toBe(true);
  });

  it('GeneratePersonaVideosSchema defaults timezone to UTC', () => {
    const { timezone: _timezone, ...rest } = baseArgs;
    const result = GeneratePersonaVideosSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.timezone).toBe('UTC');
  });

  it('GeneratePersonaVideosSchema requires https (loopback http allowed) for audioUrl/webhookUrl', () => {
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...baseArgs,
        options: { audioUrl: 'https://cdn.example.com/narracao.mp3' },
      }).success
    ).toBe(true);
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...baseArgs,
        options: { audioUrl: 'http://cdn.example.com/narracao.mp3' },
      }).success
    ).toBe(false);
    expect(
      GeneratePersonaVideosSchema.safeParse({
        ...baseArgs,
        options: { webhookUrl: 'http://localhost:3000/hook' },
      }).success
    ).toBe(true);
  });

  it('handleGeneratePersonaVideos returns a human summary plus the machine JSON', async () => {
    vi.mocked(mockClient.generatePersonaVideos).mockResolvedValue({
      success: true,
      schedule: { id: 'sched-1' },
      slots: [
        {
          slotId: 'slot-1',
          slotAt: '2026-10-05T20:00:00Z',
          topic: 'Launch a SaaS in days',
          taskId: 'task-1',
          status: 'generating',
        },
        {
          slotId: 'slot-2',
          slotAt: '2026-10-06T20:00:00Z',
          topic: 'Pricing lessons',
          taskId: 'task-2',
          status: 'awaiting',
        },
      ],
      replayed: false,
    });

    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(baseArgs)
    );

    expect(mockClient.generatePersonaVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'persona-123',
        topics: ['Launch a SaaS in days', 'Pricing lessons'],
        providers: ['youtube', 'bluesky'],
        startAt: '2026-10-05T20:00:00',
        times: ['20:00'],
        timezone: 'Europe/Lisbon',
      })
    );
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('sched-1');
    expect(text).toContain('Launch a SaaS in days');
    expect(text).toContain('task-1');
    expect(text).toContain('task-2');
    expect(text).toContain('"replayed": false');
    expect(text).toContain('"slotId": "slot-1"');
  });

  it("handleGeneratePersonaVideos fails fast when startAt/times ride along with mode 'asap'", async () => {
    // A stray schedule plan 400s server-side; the tool names the rule
    // before the client ever fires.
    const { startAt: _startAt, times: _times, ...rest } = baseArgs;
    const withStartAt = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse({ ...baseArgs, mode: 'asap' })
    );
    expect(withStartAt.isError).toBe(true);
    expect(textOf(withStartAt)).toMatch(/must not be set/i);

    const withTimes = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse({ ...rest, mode: 'asap', times: ['20:00'] })
    );
    expect(withTimes.isError).toBe(true);
    expect(textOf(withTimes)).toMatch(/must not be set/i);

    expect(mockClient.generatePersonaVideos).not.toHaveBeenCalled();
  });

  it("handleGeneratePersonaVideos fails fast when startAt/times are missing in scheduled mode", async () => {
    const { startAt: _startAt, times: _times, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(rest)
    );
    expect(response.isError).toBe(true);
    expect(textOf(response)).toMatch(/startAt and times are required/i);
    expect(mockClient.generatePersonaVideos).not.toHaveBeenCalled();
  });

  it("handleGeneratePersonaVideos passes mode through and summarizes ASAP publishing", async () => {
    vi.mocked(mockClient.generatePersonaVideos).mockResolvedValue({
      success: true,
      schedule: { id: 'sched-7', mode: 'asap' },
      slots: [
        {
          slotId: 'slot-7',
          slotAt: '2026-10-09T22:00:00Z',
          topic: 'Launch a SaaS in days',
          taskId: 'task-7',
          status: 'generating',
        },
      ],
      replayed: false,
    });

    const { startAt: _startAt, times: _times, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse({ ...rest, mode: 'asap' })
    );

    expect(mockClient.generatePersonaVideos).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'asap' })
    );
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toMatch(/as soon as/i);
    expect(text).toContain('"mode": "asap"');
  });

  it('handleGeneratePersonaVideos notes a replayed idempotent schedule', async () => {
    vi.mocked(mockClient.generatePersonaVideos).mockResolvedValue({
      success: true,
      schedule: { id: 'sched-9' },
      slots: [],
      replayed: true,
    });

    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(baseArgs)
    );

    const text = textOf(response);
    expect(text).toMatch(/replayed/i);
    expect(text).toContain('"replayed": true');
  });

  it('handleGeneratePersonaVideos surfaces the structured API error as JSON (never a bare failure)', async () => {
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.generatePersonaVideos).mockRejectedValue(
      new ApiError(
        'Failed to generate and schedule videos: 422 Provide at least one video topic.',
        'TOPICS_REQUIRED',
        'topics'
      )
    );

    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(baseArgs)
    );

    expect(response.isError).toBe(true);
    const text = textOf(response);
    expect(text).toContain('"code":"TOPICS_REQUIRED"');
    expect(text).toContain('"field":"topics"');
    expect(text).toContain('Provide at least one video topic.');
    expect(text).not.toMatch(/Tool execution failed/i);
  });

  it('handleGeneratePersonaVideos redacts credential-shaped fragments from the API error', async () => {
    const { ApiError } = await import('../errors.js');
    vi.mocked(mockClient.generatePersonaVideos).mockRejectedValue(
      new ApiError(
        'Failed to generate and schedule videos: 500 engine blew up for Bearer abc123XYZ',
        'INTERNAL_ERROR',
        null
      )
    );

    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(baseArgs)
    );

    const text = textOf(response);
    expect(text).toContain('"code":"INTERNAL_ERROR"');
    expect(text).toContain('Bearer [redacted]');
    expect(text).not.toContain('abc123XYZ');
  });

  it('handleGeneratePersonaVideos surfaces non-API failures as isError', async () => {
    vi.mocked(mockClient.generatePersonaVideos).mockRejectedValue(new Error('fetch failed'));

    const response = await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse(baseArgs)
    );

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('fetch failed');
  });

  it('handleGeneratePersonaVideos forwards a caller-supplied idempotencyKey', async () => {
    vi.mocked(mockClient.generatePersonaVideos).mockResolvedValue({
      success: true,
      schedule: { id: 'sched-1' },
      slots: [],
      replayed: false,
    });

    await handleGeneratePersonaVideos(
      mockClient,
      GeneratePersonaVideosSchema.parse({ ...baseArgs, idempotencyKey: 'key-123' })
    );

    expect(mockClient.generatePersonaVideos).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'key-123' })
    );
  });
});

describe('handleLibraryCall message contracts', () => {
  // The error-verb and success-prefix strings are user-facing (surfaced to
  // the AI agent calling the tool). Pin them so a reword or a dropped
  // prefix breaks CI instead of silently changing the agent-visible
  // contract — Stryker's StringLiteral mutants survived here.
  const mockClient = {
    createPersona: vi.fn(),
    cancelSchedule: vi.fn(),
    getTokenBalance: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.mocked(mockClient.createPersona).mockReset();
    vi.mocked(mockClient.cancelSchedule).mockReset();
    vi.mocked(mockClient.getTokenBalance).mockReset();
  });

  it('handleCreatePersona prefixes failures with "Error creating persona:"', async () => {
    vi.mocked(mockClient.createPersona).mockRejectedValue(new Error('boom'));
    const response = await handleCreatePersona(
      mockClient,
      CreatePersonaSchema.parse({
        name: 'Alex AI',
        avatarUrl: 'https://example.com/alex.png',
      })
    );
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error creating persona: boom');
  });

  it('handleCreatePersona prefixes success with "Persona created successfully:"', async () => {
    vi.mocked(mockClient.createPersona).mockResolvedValue({ personaId: 'p-1' });
    const response = await handleCreatePersona(
      mockClient,
      CreatePersonaSchema.parse({
        name: 'Alex AI',
        avatarUrl: 'https://example.com/alex.png',
      })
    );
    expect(response.isError).toBeUndefined();
    expect(textOf(response).startsWith('Persona created successfully:')).toBe(true);
  });

  it('handleCancelSchedule prefixes failures with "Error cancelling schedule:"', async () => {
    vi.mocked(mockClient.cancelSchedule).mockRejectedValue(new Error('gone'));
    const response = await handleCancelSchedule(mockClient, { scheduleId: 's-1' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error cancelling schedule: gone');
  });

  it('handleGetTokenBalance prefixes failures with "Error getting token balance:"', async () => {
    vi.mocked(mockClient.getTokenBalance).mockRejectedValue(new Error('down'));
    const response = await handleGetTokenBalance(mockClient);
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('Error getting token balance: down');
  });
});

describe('narrowTaskProgress type narrowing', () => {
  // narrowTaskProgress coerces every field to its declared type or null.
  // Wrong-typed values must become null (not pass through), and a
  // non-object payload must yield all nulls.
  const mockClient = {
    getVideoStatus: vi.fn(),
  } as unknown as PostEngineerClient;

  beforeEach(() => {
    vi.mocked(mockClient.getVideoStatus).mockReset();
  });

  it('coerces wrong-typed fields to null instead of passing them through', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      body: {
        task_id: 42,
        state: 'generating',
        progress: '60',
        stage: 7,
        error: { reason: 'x' },
      },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 't-1' });
    const text = textOf(response);
    expect(text).toContain('"task_id": null');
    expect(text).toContain('"state": null');
    expect(text).toContain('"progress": null');
    expect(text).toContain('"stage": null');
    expect(text).toContain('"error": null');
  });

  it('reports all nulls when the payload is not an object', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue('not-an-object');

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 't-1' });
    const text = textOf(response);
    expect(text).toContain('"task_id": null');
    expect(text).toContain('"state": null');
    expect(text).toContain('"progress": null');
    expect(text).toContain('"stage": null');
    expect(text).toContain('"error": null');
  });

  it('keeps well-typed fields and nulls only the missing ones', async () => {
    const { handleGetVideoTaskProgress } = await import('../tools.js');
    vi.mocked(mockClient.getVideoStatus).mockResolvedValue({
      body: { task_id: 't-2', state: 1, progress: 60 },
    });

    const response = await handleGetVideoTaskProgress(mockClient, { taskId: 't-2' });
    const text = textOf(response);
    expect(text).toContain('"task_id": "t-2"');
    expect(text).toContain('"state": 1');
    expect(text).toContain('"progress": 60');
    expect(text).toContain('"stage": null');
    expect(text).toContain('"error": null');
  });
});

describe('slot tools', () => {
  const mockClient = {
    getSlot: vi.fn(),
    updateSlotTopic: vi.fn(),
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

  it('UpdateSlotTopicSchema requires slotId and a non-empty topic', async () => {
    const { UpdateSlotTopicSchema } = await import('../tools.js');
    expect(
      UpdateSlotTopicSchema.safeParse({ slotId: 'slot-1', topic: 'New' }).success
    ).toBe(true);
    expect(
      UpdateSlotTopicSchema.safeParse({ slotId: 'slot-1', topic: '' }).success
    ).toBe(false);
    expect(UpdateSlotTopicSchema.safeParse({ slotId: 'slot-1' }).success).toBe(false);
  });

  it('handleGetSlot narrows the detail envelope and summarizes', async () => {
    const { handleGetSlot } = await import('../tools.js');
    vi.mocked(mockClient.getSlot).mockResolvedValue({
      success: true,
      slot: {
        id: 'slot-1',
        scheduleId: 'sched-1',
        slotAt: '2026-10-10T20:00:00Z',
        status: 'awaiting',
        topic: 'Launch day',
        taskId: 'task-1',
        progress: 0,
        stage: null,
        error: null,
        publishedAt: null,
      },
      schedule: { id: 'sched-1', providers: ['youtube'], publishMode: 'scheduled', timezone: 'Europe/Lisbon' },
      persona: { id: 'persona-1', name: 'Ava' },
      extraUnpinnedField: 'rides through unparsed',
    });

    const response = await handleGetSlot(mockClient, { slotId: 'slot-1' });
    expect(mockClient.getSlot).toHaveBeenCalledWith('slot-1');
    expect(response.isError).toBeUndefined();
    const text = textOf(response);
    expect(text).toContain('slot-1');
    expect(text).toContain('Launch day');
    expect(text).toContain('awaiting');
    expect(text).toContain('"topic": "Launch day"');
    expect(text).not.toContain('extraUnpinnedField');
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

  it('handleUpdateSlotTopic passes the trimmed topic and summarizes', async () => {
    const { handleUpdateSlotTopic } = await import('../tools.js');
    vi.mocked(mockClient.updateSlotTopic).mockResolvedValue({
      success: true,
      topic: 'New topic',
    });

    const response = await handleUpdateSlotTopic(mockClient, {
      slotId: 'slot-1',
      topic: 'New topic',
    });
    expect(mockClient.updateSlotTopic).toHaveBeenCalledWith('slot-1', 'New topic');
    expect(response.isError).toBeUndefined();
    expect(textOf(response)).toContain('New topic');
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
