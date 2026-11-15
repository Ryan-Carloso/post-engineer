import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { createExperiment } from '../client-experiments.js';
import { getPrompt, listPrompts } from '../client-prompts.js';
import { getTokenBalance, listTokenTransactions } from '../client-billing.js';
import { getPost, getPostMetrics, getYouTubeRetentionCurve } from '../client-posts.js';
import { publishVideoDirect } from '../client-publish-uploaded.js';
import { checkSegmentMedia, uploadSegmentMedia } from '../client-user-media.js';
import { getPersonaPublishingAccounts } from '../client-publishing-accounts.js';
import { cancelVideoTask } from '../client-video-task.js';
import { createClonedVoiceFromUrl, deleteClonedVoice, getClonedVoice, listClonedVoices } from '../cloned-voice-client.js';

//---------------
// Type-level pins for the shared contracts, checked by
// `tsc -p tsconfig.spec.json` (part of the MCP typecheck): each
// ts-expect-error below must stay an error. If the contract stops
// rejecting `nome`, the directive is unused and typecheck fails.
//---------------

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

describe('contracts typecheck', () => {
  it('rejects an unknown body field and an unknown response field at compile time', () => {
    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    const run = (): void => {
      // @ts-expect-error -- the create body field is `name`, not `nome`
      void createExperiment(client, { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] });
    };
    const read = (result: CreateResult): unknown => {
      // @ts-expect-error -- the response experiment field is `name`, not `nome`
      return result.experiment.nome;
    };
    expect(typeof run).toBe('function');
    expect(typeof read).toBe('function');
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });

  it('rejects unknown prompt fields at compile time', () => {
    const list = (result: ListPromptsResult): unknown => {
      // @ts-expect-error -- the list item field is `title`, not `name`
      return result[0]?.name;
    };
    const detail = (result: GetPromptResult): unknown => {
      // @ts-expect-error -- the detail field is `prompt`, not `text`
      return result.text;
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown billing fields at compile time', () => {
    const balance = (result: TokenBalanceResult): unknown => {
      // @ts-expect-error -- the balance field is `balance`, not `total`
      return result.total;
    };
    const ledger = (result: TokenTransactionsResult): unknown => {
      // @ts-expect-error -- the transaction field is `generationId`, not `generation_id`
      return result.transactions[0]?.generation_id;
    };
    expect(typeof balance).toBe('function');
    expect(typeof ledger).toBe('function');
  });

  it('rejects unknown post detail fields at compile time', () => {
    const detail = (result: GetPostResult): unknown => {
      if (result.kind !== 'generation') return undefined;
      // @ts-expect-error -- the generation field is `videoSubject`, not `subject`
      return result.generation.subject;
    };
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown metrics fields at compile time', () => {
    const row = (result: PostMetricsResult): unknown => {
      // @ts-expect-error -- the row field is `postId`, not `post_id`
      return result.rows[0]?.post_id;
    };
    const curve = (result: RetentionCurveResult): unknown => {
      // @ts-expect-error -- the point field is `audienceWatchRatio`, not `watchRatio`
      return result.points[0]?.watchRatio;
    };
    expect(typeof row).toBe('function');
    expect(typeof curve).toBe('function');
  });

  it('rejects unknown media fields at compile time', () => {
    const upload = (result: UploadMediaResult): unknown => {
      // @ts-expect-error -- the result field is `mediaId`, not `media_id`
      return result.media_id;
    };
    const check = (result: CheckMediaResult): unknown => {
      // @ts-expect-error -- the result field is `code`, not `status`
      return result.status;
    };
    const direct = (result: DirectPublishResult): unknown => {
      // @ts-expect-error -- the account field is `accountId`, not `account_id`
      return result.results[0]?.account_id;
    };
    expect(typeof upload).toBe('function');
    expect(typeof check).toBe('function');
    expect(typeof direct).toBe('function');
  });

  it('rejects unknown accounts fields at compile time', () => {
    const list = (result: ListAccountsResult): unknown => {
      // @ts-expect-error -- the account field is `channelId`, not `channel_id`
      return result.accounts[0]?.channel_id;
    };
    const connectUrl = (result: ConnectUrlResult): unknown => {
      // @ts-expect-error -- the connect field is `auth_url`, not `authUrl`
      return result.authUrl;
    };
    const publishing = (result: PublishingAccountsResult): unknown => {
      // @ts-expect-error -- the defaults field is `youtube`, not `youtube_id`
      return result.defaults.youtube_id;
    };
    expect(typeof list).toBe('function');
    expect(typeof connectUrl).toBe('function');
    expect(typeof publishing).toBe('function');
  });

  it('rejects unknown schedule fields at compile time', () => {
    const schedules = (result: ListSchedulesResult): unknown => {
      // @ts-expect-error -- the schedule row keeps its snake_case `persona_id`
      return result.schedules[0]?.personaId;
    };
    const posts = (result: ListPostsResult): unknown => {
      // @ts-expect-error -- the status slot keeps its snake_case `slot_at`
      return result.upcoming[0]?.slotAt;
    };
    const cancel = (result: CancelScheduleResult): unknown => {
      // @ts-expect-error -- the cancel field is `cancelledSlotIds`, not `cancelled_slot_ids`
      return result.cancelled_slot_ids;
    };
    const slot = (result: GetSlotResult): unknown => {
      // @ts-expect-error -- the slot field is `scheduleId`, not `schedule_id`
      return result.slot.schedule_id;
    };
    const update = (result: UpdateSlotResult): unknown => {
      // @ts-expect-error -- the update field is `slotAt`, not `slot_at`
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
      // @ts-expect-error -- the generation row field is `generationId`, not `generation_id`
      return result.generations[0]?.generation_id;
    };
    const detail = (result: GetVideoGenerationResult): unknown => {
      // @ts-expect-error -- the generation row field is `engineTaskId`, not `engine_task_id`
      return result.generation.engine_task_id;
    };
    const status = (result: GetVideoStatusResult): unknown => {
      // @ts-expect-error -- the task body keeps its snake_case `task_id`
      return result.body.taskId;
    };
    const statusEnvelope = (result: GetVideoStatusResult): unknown => {
      // @ts-expect-error -- the engine envelope carries `status`, not `success`
      return result.success;
    };
    const cancel = (result: CancelVideoTaskResult): unknown => {
      // @ts-expect-error -- the delete response has no `deleted` flag
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
      // @ts-expect-error -- the voice row field is `kind`, not `type`
      return result.voices[0]?.type;
    };
    const listId = (result: ListVoicesResult): unknown => {
      // @ts-expect-error -- the voice row field is `id`, not `voiceId`
      return result.voices[0]?.voiceId;
    };
    const clones = (result: ListClonedVoicesResult): unknown => {
      // @ts-expect-error -- the cloned row keeps its snake_case `voice_id`
      return result.voices[0]?.voiceId;
    };
    const detail = (result: GetClonedVoiceResult): unknown => {
      // @ts-expect-error -- the create/get response carries `voice`, not `body`
      return result.body;
    };
    const created = (result: CreateClonedVoiceResult): unknown => {
      // @ts-expect-error -- the create response carries `voice`, not `body`
      return result.body;
    };
    const deleted = (result: DeleteClonedVoiceResult): unknown => {
      // @ts-expect-error -- the delete response has no `voice` field
      return result.voice;
    };
    expect(typeof list).toBe('function');
    expect(typeof listId).toBe('function');
    expect(typeof clones).toBe('function');
    expect(typeof detail).toBe('function');
    expect(typeof created).toBe('function');
    expect(typeof deleted).toBe('function');
  });
});
