import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { getPromptComparison } from '../client-experiments.js';
import { getPrompt, listPrompts } from '../client-prompts.js';
import { getPost, getPostMetrics, getYouTubeRetentionCurve } from '../client-posts.js';
import { createVideoUpload, completeVideoUpload, publishUploadedVideo, publishVideoDirect } from '../client-publish-uploaded.js';
import { getPersonaPublishingAccounts } from '../client-publishing-accounts.js';

type ComparisonResult = Awaited<ReturnType<typeof getPromptComparison>>;
type ListPromptsResult = Awaited<ReturnType<typeof listPrompts>>;
type GetPromptResult = Awaited<ReturnType<typeof getPrompt>>;
type GetPostResult = Awaited<ReturnType<typeof getPost>>;
type PostMetricsResult = Awaited<ReturnType<typeof getPostMetrics>>;
type RetentionCurveResult = Awaited<ReturnType<typeof getYouTubeRetentionCurve>>;
type DirectPublishResult = Awaited<ReturnType<typeof publishVideoDirect>>;
type ListAccountsResult = Awaited<ReturnType<PostEngineerClient['listSocialAccounts']>>;
type ConnectUrlResult = Awaited<ReturnType<PostEngineerClient['getOAuthConnectUrl']>>;
type PublishingAccountsResult = Awaited<ReturnType<typeof getPersonaPublishingAccounts>>;
type ListSchedulesResult = Awaited<ReturnType<PostEngineerClient['listSchedules']>>;
type ListPostsResult = Awaited<ReturnType<PostEngineerClient['listPosts']>>;
type CancelScheduleResult = Awaited<ReturnType<PostEngineerClient['cancelSchedule']>>;
type GetSlotResult = Awaited<ReturnType<PostEngineerClient['getSlot']>>;
type UpdateSlotResult = Awaited<ReturnType<PostEngineerClient['updateSlotTitle']>>;
type ListPersonasResult = Awaited<ReturnType<PostEngineerClient['listPersonas']>>;
type CreatePersonaResult = Awaited<ReturnType<PostEngineerClient['createPersona']>>;
type UpdatePersonaResult = Awaited<ReturnType<PostEngineerClient['updatePersona']>>;
type DeletePersonaResult = Awaited<ReturnType<PostEngineerClient['deletePersona']>>;
type GetPersonaDeletePreviewResult = Awaited<ReturnType<PostEngineerClient['getPersonaDeletePreview']>>;
type MintVideoUploadResult = Awaited<ReturnType<typeof createVideoUpload>>;
type CompleteVideoUploadResult = Awaited<ReturnType<typeof completeVideoUpload>>;
type PublishUploadedResult = Awaited<ReturnType<typeof publishUploadedVideo>>;

describe('contracts typecheck', () => {
  it('rejects an unknown query value and an unknown response field at compile time', () => {
    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    const run = (): void => {
      expectTypeOf<'30d'>().not.toExtend<Parameters<typeof getPromptComparison>[1]>();
    };
    const read = (result: ComparisonResult): unknown => {
      return expectTypeOf(result).not.toHaveProperty('experiments');
    };
    expect(typeof run).toBe('function');
    expect(typeof read).toBe('function');
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });

  it('rejects unknown prompt fields at compile time', () => {
    const list = (result: ListPromptsResult): unknown => {
      return expectTypeOf(result[0]).exclude<undefined>().not.toHaveProperty('name');
    };
    const detail = (result: GetPromptResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('text');
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown metrics fields at compile time', () => {
    const row = (result: PostMetricsResult): unknown => {
      return expectTypeOf(result.rows[0]).exclude<undefined>().not.toHaveProperty('post_id');
    };
    const curve = (result: RetentionCurveResult): unknown => {
      return expectTypeOf(result.points[0]).exclude<undefined>().not.toHaveProperty('watchRatio');
    };
    expect(typeof row).toBe('function');
    expect(typeof curve).toBe('function');
  });

  it('rejects unknown accounts fields at compile time', () => {
    const list = (result: ListAccountsResult): unknown => {
      return expectTypeOf(result.accounts[0]).exclude<undefined>().not.toHaveProperty('channel_id');
    };
    const connectUrl = (result: ConnectUrlResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('authUrl');
    };
    const publishing = (result: PublishingAccountsResult): unknown => {
      return expectTypeOf(result.defaults).exclude<undefined>().not.toHaveProperty('youtube_id');
    };
    expect(typeof list).toBe('function');
    expect(typeof connectUrl).toBe('function');
    expect(typeof publishing).toBe('function');
  });

  it('rejects unknown schedule fields at compile time', () => {
    const schedules = (result: ListSchedulesResult): unknown => {
      return expectTypeOf(result.schedules[0]).exclude<undefined>().not.toHaveProperty('personaId');
    };
    const posts = (result: ListPostsResult): unknown => {
      return expectTypeOf(result.upcoming[0]).exclude<undefined>().not.toHaveProperty('slotAt');
    };
    const cancel = (result: CancelScheduleResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('cancelled_slot_ids');
    };
    const slot = (result: GetSlotResult): unknown => {
      return expectTypeOf(result.slot).exclude<undefined>().not.toHaveProperty('schedule_id');
    };
    const update = (result: UpdateSlotResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('slot_at');
    };
    expect(typeof schedules).toBe('function');
    expect(typeof posts).toBe('function');
    expect(typeof cancel).toBe('function');
    expect(typeof slot).toBe('function');
    expect(typeof update).toBe('function');
  });

  it('rejects unknown post detail and direct publish fields at compile time', () => {
    const detail = (result: GetPostResult): unknown => {
      return expectTypeOf(result.slot).exclude<undefined>().not.toHaveProperty('taskId');
    };
    const generation = (result: GetPostResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('generation');
    };
    const direct = (result: DirectPublishResult): unknown => {
      return expectTypeOf(result.results[0]).exclude<undefined>().not.toHaveProperty('account_id');
    };
    expect(typeof detail).toBe('function');
    expect(typeof generation).toBe('function');
    expect(typeof direct).toBe('function');
  });

  it('rejects unknown personas fields at compile time', () => {
    const list = (result: ListPersonasResult): unknown => {
      return expectTypeOf(result.personas[0]).exclude<undefined>().not.toHaveProperty('created_at');
    };
    const voice = (result: ListPersonasResult): unknown => {
      return expectTypeOf(result.personas[0]).exclude<undefined>().not.toHaveProperty('voiceId');
    };
    const created = (result: CreatePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('imageIds');
    };
    const updated = (result: UpdatePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('personaId');
    };
    const deleted = (result: DeletePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('personaId');
    };
    const preview = (result: GetPersonaDeletePreviewResult): unknown => {
      return expectTypeOf(result.counts).exclude<undefined>().not.toHaveProperty('generatedVideos');
    };
    expect(typeof list).toBe('function');
    expect(typeof voice).toBe('function');
    expect(typeof created).toBe('function');
    expect(typeof updated).toBe('function');
    expect(typeof deleted).toBe('function');
    expect(typeof preview).toBe('function');
  });

  it('rejects unknown upload fields at compile time', () => {
    const minted = (result: MintVideoUploadResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('storagePath');
    };
    const completed = (result: CompleteVideoUploadResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('state');
    };
    const published = (result: PublishUploadedResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('count');
    };
    expect(typeof minted).toBe('function');
    expect(typeof completed).toBe('function');
    expect(typeof published).toBe('function');
  });
});
