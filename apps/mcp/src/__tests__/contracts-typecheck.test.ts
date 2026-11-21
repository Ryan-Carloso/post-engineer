import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { createExperiment } from '../client-experiments.js';
import { getPrompt, listPrompts } from '../client-prompts.js';
import { getTokenBalance, listTokenTransactions } from '../client-billing.js';
import { getPost, getPostMetrics, getYouTubeRetentionCurve } from '../client-posts.js';
import { createVideoUpload, completeVideoUpload, publishUploadedVideo, publishVideoDirect } from '../client-publish-uploaded.js';
import { scoreDraft } from '../client-posts.js';
import { applyBatchDiscount } from '../client-batch.js';
import { checkSegmentMedia, uploadSegmentMedia } from '../client-user-media.js';
import { getPersonaPublishingAccounts } from '../client-publishing-accounts.js';
import { cancelVideoTask } from '../client-video-task.js';
import { createClonedVoiceFromUrl, deleteClonedVoice, getClonedVoice, listClonedVoices } from '../cloned-voice-client.js';

type CreateResult = Awaited<ReturnType<typeof createExperiment>>;
type ListPromptsResult = Awaited<ReturnType<typeof listPrompts>>;
type GetPromptResult = Awaited<ReturnType<typeof getPrompt>>;
type TokenBalanceResult = Awaited<ReturnType<typeof getTokenBalance>>;
type TokenTransactionsResult = Awaited<ReturnType<typeof listTokenTransactions>>;
type GetPostResult = Awaited<ReturnType<typeof getPost>>;
type PostMetricsResult = Awaited<ReturnType<typeof getPostMetrics>>;
type RetentionCurveResult = Awaited<ReturnType<typeof getYouTubeRetentionCurve>>;
type CheckMediaResult = Awaited<ReturnType<typeof checkSegmentMedia>>;
type UploadMediaResult = Awaited<ReturnType<typeof uploadSegmentMedia>>;
type DirectPublishResult = Awaited<ReturnType<typeof publishVideoDirect>>;
type ListAccountsResult = Awaited<ReturnType<PostEngineerClient['listSocialAccounts']>>;
type ConnectUrlResult = Awaited<ReturnType<PostEngineerClient['getOAuthConnectUrl']>>;
type PublishingAccountsResult = Awaited<ReturnType<typeof getPersonaPublishingAccounts>>;
type ListSchedulesResult = Awaited<ReturnType<PostEngineerClient['listSchedules']>>;
type ListPostsResult = Awaited<ReturnType<PostEngineerClient['listPosts']>>;
type CancelScheduleResult = Awaited<ReturnType<PostEngineerClient['cancelSchedule']>>;
type GetSlotResult = Awaited<ReturnType<PostEngineerClient['getSlot']>>;
type UpdateSlotResult = Awaited<ReturnType<PostEngineerClient['updateSlotTitle']>>;
type ListVideoGenerationsResult = Awaited<ReturnType<PostEngineerClient['listVideoGenerations']>>;
type GetVideoGenerationResult = Awaited<ReturnType<PostEngineerClient['getVideoGeneration']>>;
type GetVideoStatusResult = Awaited<ReturnType<PostEngineerClient['getVideoStatus']>>;
type ListVoicesResult = Awaited<ReturnType<PostEngineerClient['listVoices']>>;
type ListClonedVoicesResult = Awaited<ReturnType<typeof listClonedVoices>>;
type GetClonedVoiceResult = Awaited<ReturnType<typeof getClonedVoice>>;
type CreateClonedVoiceResult = Awaited<ReturnType<typeof createClonedVoiceFromUrl>>;
type DeleteClonedVoiceResult = Awaited<ReturnType<typeof deleteClonedVoice>>;
type CancelVideoTaskResult = Awaited<ReturnType<typeof cancelVideoTask>>;
type ListPersonasResult = Awaited<ReturnType<PostEngineerClient['listPersonas']>>;
type ListFacesResult = Awaited<ReturnType<PostEngineerClient['listFaces']>>;
type ListPersonaImagesResult = Awaited<ReturnType<PostEngineerClient['listPersonaImages']>>;
type CreatePersonaResult = Awaited<ReturnType<PostEngineerClient['createPersona']>>;
type UpdatePersonaResult = Awaited<ReturnType<PostEngineerClient['updatePersona']>>;
type DeletePersonaResult = Awaited<ReturnType<PostEngineerClient['deletePersona']>>;
type GetPersonaDeletePreviewResult = Awaited<ReturnType<PostEngineerClient['getPersonaDeletePreview']>>;
type AddPersonaImageResult = Awaited<ReturnType<PostEngineerClient['addPersonaImage']>>;
type UpdatePersonaImageResult = Awaited<ReturnType<PostEngineerClient['updatePersonaImage']>>;
type DeletePersonaImageResult = Awaited<ReturnType<PostEngineerClient['deletePersonaImage']>>;
type GenerateAndScheduleResult = Awaited<ReturnType<PostEngineerClient['generatePersonaVideo']>>;
type ValidateScriptResult = Awaited<ReturnType<PostEngineerClient['validateScript']>>;
type ScoreDraftResult = Awaited<ReturnType<typeof scoreDraft>>;
type BatchDiscountResult = Awaited<ReturnType<typeof applyBatchDiscount>>;
type MintVideoUploadResult = Awaited<ReturnType<typeof createVideoUpload>>;
type CompleteVideoUploadResult = Awaited<ReturnType<typeof completeVideoUpload>>;
type PublishUploadedResult = Awaited<ReturnType<typeof publishUploadedVideo>>;

describe('contracts typecheck', () => {
  it('rejects an unknown body field and an unknown response field at compile time', () => {
    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    const run = (): void => {
      expectTypeOf<Parameters<typeof createExperiment>[1]>().not.toHaveProperty('nome');
    };
    const read = (result: CreateResult): unknown => {
      return expectTypeOf(result.experiment).exclude<undefined>().not.toHaveProperty('nome');
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

  it('rejects unknown billing fields at compile time', () => {
    const balance = (result: TokenBalanceResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('total');
    };
    const ledger = (result: TokenTransactionsResult): unknown => {
      return expectTypeOf(result.transactions[0]).exclude<undefined>().not.toHaveProperty('generation_id');
    };
    expect(typeof balance).toBe('function');
    expect(typeof ledger).toBe('function');
  });

  it('rejects unknown post detail fields at compile time', () => {
    const detail = (result: GetPostResult): unknown => {
      if (result.kind !== 'generation') return undefined;
      return expectTypeOf(result.generation).exclude<undefined>().not.toHaveProperty('subject');
    };
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

  it('rejects unknown media fields at compile time', () => {
    const upload = (result: UploadMediaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('media_id');
    };
    const check = (result: CheckMediaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('status');
    };
    const checkFace = (result: CheckMediaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('hasFace');
    };
    const direct = (result: DirectPublishResult): unknown => {
      return expectTypeOf(result.results[0]).exclude<undefined>().not.toHaveProperty('account_id');
    };
    expect(typeof upload).toBe('function');
    expect(typeof check).toBe('function');
    expect(typeof checkFace).toBe('function');
    expect(typeof direct).toBe('function');
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

  it('rejects unknown video-tasks fields at compile time', () => {
    const list = (result: ListVideoGenerationsResult): unknown => {
      return expectTypeOf(result.generations[0]).exclude<undefined>().not.toHaveProperty('generation_id');
    };
    const detail = (result: GetVideoGenerationResult): unknown => {
      return expectTypeOf(result.generation).exclude<undefined>().not.toHaveProperty('engine_task_id');
    };
    const status = (result: GetVideoStatusResult): unknown => {
      return expectTypeOf(result.body).exclude<undefined>().not.toHaveProperty('taskId');
    };
    const statusEnvelope = (result: GetVideoStatusResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('success');
    };
    const cancel = (result: CancelVideoTaskResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('deleted');
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
    expect(typeof status).toBe('function');
    expect(typeof statusEnvelope).toBe('function');
    expect(typeof cancel).toBe('function');
  });

  it('rejects unknown voices fields at compile time', () => {
    const list = (result: ListVoicesResult): unknown => {
      return expectTypeOf(result.voices[0]).exclude<undefined>().not.toHaveProperty('type');
    };
    const listId = (result: ListVoicesResult): unknown => {
      return expectTypeOf(result.voices[0]).exclude<undefined>().not.toHaveProperty('voiceId');
    };
    const clones = (result: ListClonedVoicesResult): unknown => {
      return expectTypeOf(result.voices[0]).exclude<undefined>().not.toHaveProperty('voiceId');
    };
    const detail = (result: GetClonedVoiceResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('body');
    };
    const created = (result: CreateClonedVoiceResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('body');
    };
    const deleted = (result: DeleteClonedVoiceResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('voice');
    };
    expect(typeof list).toBe('function');
    expect(typeof listId).toBe('function');
    expect(typeof clones).toBe('function');
    expect(typeof detail).toBe('function');
    expect(typeof created).toBe('function');
    expect(typeof deleted).toBe('function');
  });

  it('rejects unknown personas fields at compile time', () => {
    const list = (result: ListPersonasResult): unknown => {
      return expectTypeOf(result.personas[0]).exclude<undefined>().not.toHaveProperty('created_at');
    };
    const listAccounts = (result: ListPersonasResult): unknown => {
      return expectTypeOf(result.personas[0]).exclude<undefined>().not.toHaveProperty('accounts');
    };
    const faces = (result: ListFacesResult): unknown => {
      return expectTypeOf(result.faces[0]).exclude<undefined>().not.toHaveProperty('path');
    };
    const images = (result: ListPersonaImagesResult): unknown => {
      return expectTypeOf(result.images[0]).exclude<undefined>().not.toHaveProperty('isPrimary');
    };
    const imagesCreated = (result: ListPersonaImagesResult): unknown => {
      return expectTypeOf(result.images[0]).exclude<undefined>().not.toHaveProperty('createdAt');
    };
    const created = (result: CreatePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('image_ids');
    };
    const updated = (result: UpdatePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('personaId');
    };
    const deleted = (result: DeletePersonaResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('personaId');
    };
    const preview = (result: GetPersonaDeletePreviewResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('truncated');
    };
    const added = (result: AddPersonaImageResult): unknown => {
      return expectTypeOf(result.image).exclude<undefined>().not.toHaveProperty('image_path');
    };
    const updatedImage = (result: UpdatePersonaImageResult): unknown => {
      return expectTypeOf(result.image).exclude<undefined>().not.toHaveProperty('image_url');
    };
    const deletedImage = (result: DeletePersonaImageResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('image');
    };
    expect(typeof list).toBe('function');
    expect(typeof listAccounts).toBe('function');
    expect(typeof faces).toBe('function');
    expect(typeof images).toBe('function');
    expect(typeof imagesCreated).toBe('function');
    expect(typeof created).toBe('function');
    expect(typeof updated).toBe('function');
    expect(typeof deleted).toBe('function');
    expect(typeof preview).toBe('function');
    expect(typeof added).toBe('function');
    expect(typeof updatedImage).toBe('function');
    expect(typeof deletedImage).toBe('function');
  });

  it('rejects unknown videos fields at compile time', () => {
    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    const run = (): void => {
      expectTypeOf<Parameters<PostEngineerClient['generatePersonaVideo']>[0]>().not.toHaveProperty('publishing');
    };
    const schedule = (result: GenerateAndScheduleResult): unknown => {
      return expectTypeOf(result.schedule).exclude<undefined>().not.toHaveProperty('scheduleId');
    };
    const slot = (result: GenerateAndScheduleResult): unknown => {
      return expectTypeOf(result.slots[0]).exclude<undefined>().not.toHaveProperty('task_id');
    };
    const replayed = (result: GenerateAndScheduleResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('isReplay');
    };
    const validate = (result: ValidateScriptResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('hookWindow');
    };
    const measured = (result: ValidateScriptResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('status');
    };
    const score = (result: ScoreDraftResult): unknown => {
      return expectTypeOf(result.counts).exclude<undefined>().not.toHaveProperty('theme');
    };
    const check = (result: ScoreDraftResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('check');
    };
    const free = (result: BatchDiscountResult): unknown => {
      return expectTypeOf(result.freeVideos[0]).exclude<undefined>().not.toHaveProperty('id');
    };
    const minted = (result: MintVideoUploadResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('storagePath');
    };
    const completed = (result: CompleteVideoUploadResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('state');
    };
    const published = (result: PublishUploadedResult): unknown => {
      return expectTypeOf(result).exclude<undefined>().not.toHaveProperty('count');
    };
    const warnings = (result: GenerateAndScheduleResult): unknown => {
      return expectTypeOf(result.warnings?.[0]).exclude<undefined>().not.toHaveProperty('toUpperCase');
    };
    expect(typeof run).toBe('function');
    expect(typeof schedule).toBe('function');
    expect(typeof slot).toBe('function');
    expect(typeof replayed).toBe('function');
    expect(typeof validate).toBe('function');
    expect(typeof measured).toBe('function');
    expect(typeof score).toBe('function');
    expect(typeof check).toBe('function');
    expect(typeof free).toBe('function');
    expect(typeof minted).toBe('function');
    expect(typeof completed).toBe('function');
    expect(typeof published).toBe('function');
    expect(typeof warnings).toBe('function');
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });
});
