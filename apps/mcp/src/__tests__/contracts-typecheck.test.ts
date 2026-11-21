import { describe, expect, it, vi } from 'vitest';
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
      // @ts-expect-error
      void createExperiment(client, { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] });
    };
    const read = (result: CreateResult): unknown => {
      // @ts-expect-error
      return result.experiment.nome;
    };
    expect(typeof run).toBe('function');
    expect(typeof read).toBe('function');
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });

  it('rejects unknown prompt fields at compile time', () => {
    const list = (result: ListPromptsResult): unknown => {
      // @ts-expect-error
      return result[0]?.name;
    };
    const detail = (result: GetPromptResult): unknown => {
      // @ts-expect-error
      return result.text;
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown billing fields at compile time', () => {
    const balance = (result: TokenBalanceResult): unknown => {
      // @ts-expect-error
      return result.total;
    };
    const ledger = (result: TokenTransactionsResult): unknown => {
      // @ts-expect-error
      return result.transactions[0]?.generation_id;
    };
    expect(typeof balance).toBe('function');
    expect(typeof ledger).toBe('function');
  });

  it('rejects unknown post detail fields at compile time', () => {
    const detail = (result: GetPostResult): unknown => {
      if (result.kind !== 'generation') return undefined;
      // @ts-expect-error
      return result.generation.subject;
    };
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown metrics fields at compile time', () => {
    const row = (result: PostMetricsResult): unknown => {
      // @ts-expect-error
      return result.rows[0]?.post_id;
    };
    const curve = (result: RetentionCurveResult): unknown => {
      // @ts-expect-error
      return result.points[0]?.watchRatio;
    };
    expect(typeof row).toBe('function');
    expect(typeof curve).toBe('function');
  });

  it('rejects unknown media fields at compile time', () => {
    const upload = (result: UploadMediaResult): unknown => {
      // @ts-expect-error
      return result.media_id;
    };
    const check = (result: CheckMediaResult): unknown => {
      // @ts-expect-error
      return result.status;
    };
    const checkFace = (result: CheckMediaResult): unknown => {
      // @ts-expect-error
      return result.hasFace;
    };
    const direct = (result: DirectPublishResult): unknown => {
      // @ts-expect-error
      return result.results[0]?.account_id;
    };
    expect(typeof upload).toBe('function');
    expect(typeof check).toBe('function');
    expect(typeof checkFace).toBe('function');
    expect(typeof direct).toBe('function');
  });

  it('rejects unknown accounts fields at compile time', () => {
    const list = (result: ListAccountsResult): unknown => {
      // @ts-expect-error
      return result.accounts[0]?.channel_id;
    };
    const connectUrl = (result: ConnectUrlResult): unknown => {
      // @ts-expect-error
      return result.authUrl;
    };
    const publishing = (result: PublishingAccountsResult): unknown => {
      // @ts-expect-error
      return result.defaults.youtube_id;
    };
    expect(typeof list).toBe('function');
    expect(typeof connectUrl).toBe('function');
    expect(typeof publishing).toBe('function');
  });

  it('rejects unknown schedule fields at compile time', () => {
    const schedules = (result: ListSchedulesResult): unknown => {
      // @ts-expect-error
      return result.schedules[0]?.personaId;
    };
    const posts = (result: ListPostsResult): unknown => {
      // @ts-expect-error
      return result.upcoming[0]?.slotAt;
    };
    const cancel = (result: CancelScheduleResult): unknown => {
      // @ts-expect-error
      return result.cancelled_slot_ids;
    };
    const slot = (result: GetSlotResult): unknown => {
      // @ts-expect-error
      return result.slot.schedule_id;
    };
    const update = (result: UpdateSlotResult): unknown => {
      // @ts-expect-error
      return result.slot_at;
    };
    expect(typeof schedules).toBe('function');
    expect(typeof posts).toBe('function');
    expect(typeof cancel).toBe('function');
    expect(typeof slot).toBe('function');
    expect(typeof update).toBe('function');
  });

  it('rejects unknown video-tasks fields at compile time', () => {
    const list = (result: ListVideoGenerationsResult): unknown => {
      // @ts-expect-error
      return result.generations[0]?.generation_id;
    };
    const detail = (result: GetVideoGenerationResult): unknown => {
      // @ts-expect-error
      return result.generation.engine_task_id;
    };
    const status = (result: GetVideoStatusResult): unknown => {
      // @ts-expect-error
      return result.body.taskId;
    };
    const statusEnvelope = (result: GetVideoStatusResult): unknown => {
      // @ts-expect-error
      return result.success;
    };
    const cancel = (result: CancelVideoTaskResult): unknown => {
      // @ts-expect-error
      return result.deleted;
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
    expect(typeof status).toBe('function');
    expect(typeof statusEnvelope).toBe('function');
    expect(typeof cancel).toBe('function');
  });

  it('rejects unknown voices fields at compile time', () => {
    const list = (result: ListVoicesResult): unknown => {
      // @ts-expect-error
      return result.voices[0]?.type;
    };
    const listId = (result: ListVoicesResult): unknown => {
      // @ts-expect-error
      return result.voices[0]?.voiceId;
    };
    const clones = (result: ListClonedVoicesResult): unknown => {
      // @ts-expect-error
      return result.voices[0]?.voiceId;
    };
    const detail = (result: GetClonedVoiceResult): unknown => {
      // @ts-expect-error
      return result.body;
    };
    const created = (result: CreateClonedVoiceResult): unknown => {
      // @ts-expect-error
      return result.body;
    };
    const deleted = (result: DeleteClonedVoiceResult): unknown => {
      // @ts-expect-error
      return result.voice;
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
      // @ts-expect-error
      return result.personas[0]?.created_at;
    };
    const listAccounts = (result: ListPersonasResult): unknown => {
      // @ts-expect-error
      return result.personas[0]?.accounts;
    };
    const faces = (result: ListFacesResult): unknown => {
      // @ts-expect-error
      return result.faces[0]?.path;
    };
    const images = (result: ListPersonaImagesResult): unknown => {
      // @ts-expect-error
      return result.images[0]?.isPrimary;
    };
    const imagesCreated = (result: ListPersonaImagesResult): unknown => {
      // @ts-expect-error
      return result.images[0]?.createdAt;
    };
    const created = (result: CreatePersonaResult): unknown => {
      // @ts-expect-error
      return result.image_ids;
    };
    const updated = (result: UpdatePersonaResult): unknown => {
      // @ts-expect-error
      return result.personaId;
    };
    const deleted = (result: DeletePersonaResult): unknown => {
      // @ts-expect-error
      return result.personaId;
    };
    const preview = (result: GetPersonaDeletePreviewResult): unknown => {
      // @ts-expect-error
      return result.truncated;
    };
    const added = (result: AddPersonaImageResult): unknown => {
      // @ts-expect-error
      return result.image.image_path;
    };
    const updatedImage = (result: UpdatePersonaImageResult): unknown => {
      // @ts-expect-error
      return result.image?.image_url;
    };
    const deletedImage = (result: DeletePersonaImageResult): unknown => {
      // @ts-expect-error
      return result.image;
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
      // @ts-expect-error
      void client.generatePersonaVideo({ publishing: { providers: ['youtube'] } });
    };
    const schedule = (result: GenerateAndScheduleResult): unknown => {
      // @ts-expect-error
      return result.schedule.scheduleId;
    };
    const slot = (result: GenerateAndScheduleResult): unknown => {
      // @ts-expect-error
      return result.slots[0]?.task_id;
    };
    const replayed = (result: GenerateAndScheduleResult): unknown => {
      // @ts-expect-error
      return result.isReplay;
    };
    const validate = (result: ValidateScriptResult): unknown => {
      // @ts-expect-error
      return result.hookWindow;
    };
    const measured = (result: ValidateScriptResult): unknown => {
      // @ts-expect-error
      return result.status;
    };
    const score = (result: ScoreDraftResult): unknown => {
      // @ts-expect-error
      return result.counts.theme;
    };
    const check = (result: ScoreDraftResult): unknown => {
      // @ts-expect-error
      return result.check;
    };
    const free = (result: BatchDiscountResult): unknown => {
      // @ts-expect-error
      return result.freeVideos[0]?.id;
    };
    const minted = (result: MintVideoUploadResult): unknown => {
      // @ts-expect-error
      return result.storagePath;
    };
    const completed = (result: CompleteVideoUploadResult): unknown => {
      // @ts-expect-error
      return result.state;
    };
    const published = (result: PublishUploadedResult): unknown => {
      // @ts-expect-error
      return result.count;
    };
    const warnings = (result: GenerateAndScheduleResult): unknown => {
      // @ts-expect-error
      return result.warnings?.[0]?.toUpperCase();
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
