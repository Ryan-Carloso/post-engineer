import { describe, expect, expectTypeOf, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createUserPrompt, getPrompt, listPrompts } from '@/lib/contracts/prompts';
import { getTokenBalance, listTokenTransactions } from '@/lib/contracts/billing';
import { getPost } from '@/lib/contracts/posts';
import { getRetentionCurve, listMetrics } from '@/lib/contracts/metrics';
import { checkMedia, uploadContent, uploadMedia } from '@/lib/contracts/media';
import { connectBlueskyAccount, getOAuthConnectUrl, getPersonaPublishingAccounts, listSocialAccounts } from '@/lib/contracts/accounts';
import { cancelSchedule, deleteSlot, getSlot, listPosts, listSchedules, updateSlotTitle } from '@/lib/contracts/schedule';
import { cancelVideoTask, getVideoGeneration, getVideoStatus, listVideoGenerations } from '@/lib/contracts/video-tasks';
import { createClonedVoice, deleteClonedVoice, getClonedVoice, listClonedVoices, listVoices } from '@/lib/contracts/voices';
import { addPersonaImage, createPersona, deletePersona, deletePersonaImage, getPersonaDeletePreview, listFaces, listPersonaImages, listPersonas, updatePersona, updatePersonaImage } from '@/lib/contracts/personas';
import { applyBatchDiscount, completeVideoUpload, generateAndSchedule, mintVideoUpload, publishUploadedVideo, scoreDraft, validateScript } from '@/lib/contracts/videos';
import type { BodyOf, ResponseOf } from '@/lib/contracts/endpoint';

type CreateBody = BodyOf<typeof createUserPrompt>;
type CreateResponse = ResponseOf<typeof createUserPrompt>;
type ListPromptsResponse = ResponseOf<typeof listPrompts>;
type GetPromptResponse = ResponseOf<typeof getPrompt>;
type TokenBalanceResponse = ResponseOf<typeof getTokenBalance>;
type TokenTransactionsResponse = ResponseOf<typeof listTokenTransactions>;
type GetPostResponse = ResponseOf<typeof getPost>;
type MetricsResponse = ResponseOf<typeof listMetrics>;
type RetentionCurveResponse = ResponseOf<typeof getRetentionCurve>;
type MediaCheckResponse = ResponseOf<typeof checkMedia>;
type UploadMediaResponse = ResponseOf<typeof uploadMedia>;
type UploadContentResponse = ResponseOf<typeof uploadContent>;
type ListAccountsResponse = ResponseOf<typeof listSocialAccounts>;
type ConnectUrlResponse = ResponseOf<typeof getOAuthConnectUrl>;
type BlueskyConnectBody = BodyOf<typeof connectBlueskyAccount>;
type PublishingAccountsResponse = ResponseOf<typeof getPersonaPublishingAccounts>;
type ListSchedulesResponse = ResponseOf<typeof listSchedules>;
type CancelScheduleResponse = ResponseOf<typeof cancelSchedule>;
type ListPostsResponse = ResponseOf<typeof listPosts>;
type GetSlotResponse = ResponseOf<typeof getSlot>;
type UpdateSlotBody = BodyOf<typeof updateSlotTitle>;
type UpdateSlotResponse = ResponseOf<typeof updateSlotTitle>;
type DeleteSlotResponse = ResponseOf<typeof deleteSlot>;
type ListVideoGenerationsResponse = ResponseOf<typeof listVideoGenerations>;
type GetVideoGenerationResponse = ResponseOf<typeof getVideoGeneration>;
type GetVideoStatusResponse = ResponseOf<typeof getVideoStatus>;
type CancelVideoTaskResponse = ResponseOf<typeof cancelVideoTask>;
type ListVoicesResponse = ResponseOf<typeof listVoices>;
type ListClonedVoicesResponse = ResponseOf<typeof listClonedVoices>;
type GetClonedVoiceResponse = ResponseOf<typeof getClonedVoice>;
type CreateClonedVoiceBody = BodyOf<typeof createClonedVoice>;
type CreateClonedVoiceResponse = ResponseOf<typeof createClonedVoice>;
type DeleteClonedVoiceResponse = ResponseOf<typeof deleteClonedVoice>;
type ListPersonasResponse = ResponseOf<typeof listPersonas>;
type ListFacesResponse = ResponseOf<typeof listFaces>;
type ListPersonaImagesResponse = ResponseOf<typeof listPersonaImages>;
type CreatePersonaBody = BodyOf<typeof createPersona>;
type CreatePersonaResponse = ResponseOf<typeof createPersona>;
type UpdatePersonaBody = BodyOf<typeof updatePersona>;
type UpdatePersonaResponse = ResponseOf<typeof updatePersona>;
type DeletePersonaResponse = ResponseOf<typeof deletePersona>;
type GetPersonaDeletePreviewResponse = ResponseOf<typeof getPersonaDeletePreview>;
type AddPersonaImageBody = BodyOf<typeof addPersonaImage>;
type AddPersonaImageResponse = ResponseOf<typeof addPersonaImage>;
type UpdatePersonaImageBody = BodyOf<typeof updatePersonaImage>;
type UpdatePersonaImageResponse = ResponseOf<typeof updatePersonaImage>;
type DeletePersonaImageResponse = ResponseOf<typeof deletePersonaImage>;
type GenerateAndScheduleBody = BodyOf<typeof generateAndSchedule>;
type GenerateAndScheduleResponse = ResponseOf<typeof generateAndSchedule>;
type ValidateScriptResponse = ResponseOf<typeof validateScript>;
type ScoreDraftResponse = ResponseOf<typeof scoreDraft>;
type BatchDiscountBody = BodyOf<typeof applyBatchDiscount>;
type BatchDiscountResponse = ResponseOf<typeof applyBatchDiscount>;
type MintVideoUploadResponse = ResponseOf<typeof mintVideoUpload>;
type CompleteVideoUploadResponse = ResponseOf<typeof completeVideoUpload>;
type PublishByIdBody = BodyOf<typeof publishUploadedVideo>;

describe('contracts typecheck', () => {
  it('pins BodyOf and ResponseOf field names', async () => {
    const validBody: CreateBody = { slug: 'hook-test', title: 'Hook test', prompt: 'Write a hook.' };
    expect(validBody.title).toBe('Hook test');

    expectTypeOf<CreateBody>().not.toHaveProperty('nome');

    const response = { success: true, prompt: { slug: 'hook-test', title: 'Hook test', description: '', source: 'own', visibility: 'private', prompt: 'Write a hook.', versionId: '11111111-2222-4333-8444-555555555555', version: 1 } } as CreateResponse;
    expect(response.prompt.versionId).toBe('11111111-2222-4333-8444-555555555555');

    expectTypeOf(response.prompt).not.toHaveProperty('name');

    const request = new Request('http://localhost/api/prompts', { method: 'POST', body: JSON.stringify(validBody) });
    const result = await readBody(createUserPrompt, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.title).toBe('Hook test');
      expectTypeOf(result.body).exclude<undefined>().not.toHaveProperty('name');
    }
  });

  it('pins the prompts response field names', () => {
    const list: ListPromptsResponse = { success: true, prompts: [{ slug: 'daily-news', title: 'News', description: 'News', source: 'community', visibility: 'public', verified: true }] };
    expect(list.prompts[0]?.title).toBe('News');
    expectTypeOf(list.prompts[0]).exclude<undefined>().not.toHaveProperty('name');

    const detail: GetPromptResponse = { success: true, prompt: { slug: 'daily-news', title: 'News', description: 'News', source: 'community', visibility: 'public', verified: true, prompt: 'Write...', body: 'Write...', versionId: '11111111-2222-4333-8444-555555555555', version: 3 } };
    expect(detail.prompt.prompt).toBe('Write...');
    expectTypeOf(detail.prompt).exclude<undefined>().not.toHaveProperty('text');
  });

  it('pins the billing response field names', () => {
    const balance: TokenBalanceResponse = { success: true, balance: 8, free: 3 };
    expect(balance.balance).toBe(8);
    expectTypeOf(balance).exclude<undefined>().not.toHaveProperty('total');

    const ledger: TokenTransactionsResponse = {
      success: true,
      transactions: [{ id: 'tx-1', amount: -1, type: 'spend', description: null, reason: null, generationId: null, createdAt: '2026-10-08T10:00:00Z' }],
      total: 1,
      limit: 20,
      offset: 0,
    };
    expect(ledger.transactions[0]?.generationId).toBeNull();
    expectTypeOf(ledger.transactions[0]).exclude<undefined>().not.toHaveProperty('generation_id');
  });

  it('pins the post detail response field names', () => {
    const detail: GetPostResponse = {
      success: true,
      kind: 'generation',
      generation: {
        id: 'g-1',
        generationId: 'g-1',
        engineTaskId: null,
        personaName: null,
        videoSubject: 'Gym',
        status: 'complete',
        errorCode: null,
        tokensRefunded: false,
        createdAt: '2026-11-07T00:00:00Z',
        completedAt: '2026-11-07T01:00:00Z',
        progress: 100,
        stage: null,
        scriptAngle: null,
      },
    };
    expect(detail.generation.videoSubject).toBe('Gym');
    if (detail.kind !== 'generation') throw new Error('expected a generation detail');
    expectTypeOf(detail.generation).exclude<undefined>().not.toHaveProperty('subject');
  });

  it('pins the metrics response field names', () => {
    const metrics: MetricsResponse = {
      success: true,
      rows: [
        {
          postId: 'p-1',
          personaId: null,
          provider: 'youtube',
          accountId: 'UC-1',
          externalId: 'vid_1',
          scriptAngle: null,
          publishedAt: '2026-11-12T10:00:00.000Z',
          views: 10,
          likes: 2,
          comments: 1,
          saves: 0,
          analyticsViews: 9,
          engagedViews: 5,
          stayedToWatchPct: 55.6,
          averageViewDurationSeconds: 12.5,
          averageViewPercentage: 41.2,
          contentType: 'video',
          analyticsStatus: 'ok',
          provisional: false,
          collectedAt: '2026-11-14T10:00:00.000Z',
        },
      ],
      truncated: false,
      coverage: [],
      coverageTruncated: false,
      asOf: '2026-11-14T10:00:00.000Z',
    };
    expect(metrics.rows[0]?.postId).toBe('p-1');
    expectTypeOf(metrics.rows[0]).exclude<undefined>().not.toHaveProperty('post_id');
    const curve: RetentionCurveResponse = {
      success: true,
      points: [{ ratio: 0.01, audienceWatchRatio: 0.5, relativeRetentionPerformance: 1.2 }],
      startDate: '2026-11-01',
      endDate: '2026-11-14',
      provisional: false,
    };
    expect(curve.points[0]?.ratio).toBe(0.01);
    expectTypeOf(curve.points[0]).exclude<undefined>().not.toHaveProperty('watchRatio');
  });

  it('pins the media response field names', () => {
    const upload: UploadMediaResponse = {
      success: true,
      mediaId: 'aabbccddeeff00112233445566778899.png',
      expiresInSeconds: 3600,
    };
    expect(upload.mediaId).toContain('.png');
    expectTypeOf(upload).exclude<undefined>().not.toHaveProperty('media_id');
    const check: MediaCheckResponse = { success: true, code: 'ok', width: 1920, height: 1080, has_face: true };
    expect(check.code).toBe('ok');
    expect(check.has_face).toBe(true);
    expectTypeOf(check).exclude<undefined>().not.toHaveProperty('status');
    expectTypeOf(check).exclude<undefined>().not.toHaveProperty('hasFace');
    const content: UploadContentResponse = {
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'chan-1', success: true, videoId: 'vid-1' }],
      successCount: 1,
      logId: 'log-1',
    };
    expect(content.results[0]?.accountId).toBe('chan-1');
    expectTypeOf(content.results[0]).exclude<undefined>().not.toHaveProperty('account_id');
  });

  it('pins the accounts response field names', () => {
    const list: ListAccountsResponse = {
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'rec-1', channelId: 'chan-1', channelName: 'Chan', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
      message: 'Accounts retrieved from Supabase',
    };
    expect(list.accounts[0]?.provider).toBe('youtube');
    expectTypeOf(list.accounts[0]).exclude<undefined>().not.toHaveProperty('channel_id');
    const connectUrl: ConnectUrlResponse = { success: true, auth_url: 'https://example.com/oauth' };
    expect(connectUrl.auth_url).toContain('oauth');
    expectTypeOf(connectUrl).exclude<undefined>().not.toHaveProperty('authUrl');
    const body: BlueskyConnectBody = { handle: 'user.bsky.social', appPassword: 'secret' };
    expect(body.handle).toBe('user.bsky.social');
    expectTypeOf(body).exclude<undefined>().not.toHaveProperty('app_password');
    const publishing: PublishingAccountsResponse = {
      success: true,
      defaults: { youtube: ['UC-1'], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [] },
    };
    expect(publishing.defaults.youtube).toEqual(['UC-1']);
    expectTypeOf(publishing.defaults).exclude<undefined>().not.toHaveProperty('youtube_id');
  });

  it('pins the schedule response field names', () => {
    const list: ListSchedulesResponse = {
      success: true,
      schedules: [
        {
          id: 'sched-1', persona_id: null, providers: ['youtube'],
          youtube_account_ids: [], instagram_account_ids: [], linkedin_account_ids: [],
          bluesky_account_ids: [], threads_account_ids: [], facebook_account_ids: [],
          pinterest_account_ids: [], pinterest_board_id: null, threespeak_account_ids: [],
          rumble_account_ids: [], fanvue_account_ids: [], telegram_account_ids: [], days_of_week: [1], start_hour: 9, end_hour: 17,
          posts_per_day: 1, timezone: 'UTC', active: true, created_at: '2026-10-01T00:00:00Z',
          publish_mode: 'scheduled',
        },
      ],
    };
    expect(list.schedules[0]?.providers).toEqual(['youtube']);
    expectTypeOf(list.schedules[0]).exclude<undefined>().not.toHaveProperty('personaId');
    const cancel: CancelScheduleResponse = {
      success: true, cancelledSlotIds: [], refunds: [], batchDiscountWithheld: 0,
    };
    expect(cancel.cancelledSlotIds).toEqual([]);
    expectTypeOf(cancel).exclude<undefined>().not.toHaveProperty('cancelled_slot_ids');
    const posts: ListPostsResponse = { success: true, upcoming: [], recent: [], hasAnyPost: false };
    expect(posts.hasAnyPost).toBe(false);
    expectTypeOf(posts).exclude<undefined>().not.toHaveProperty('has_any_post');
    const slot: GetSlotResponse = {
      success: true,
      slot: {
        id: 'slot-1', scheduleId: 'sched-1', slotAt: '2026-10-10T20:00:00Z', status: 'awaiting',
        title: 'T', taskId: null, progress: 0, stage: null, error: null, publishedAt: null,
        postUrl: null, publishLinks: [], progressHistory: [], scriptAngle: null,
        retryable: null, queuePosition: null, queueTotal: null, userNotices: [], providerFailures: [],
      },
      schedule: {
        id: 'sched-1', personaId: null, providers: [], youtubeAccountIds: [],
        instagramAccountIds: [], linkedinAccountIds: [], blueskyAccountIds: [],
        threadsAccountIds: [], facebookAccountIds: [], pinterestAccountIds: [],
        pinterestBoardId: null, threespeakAccountIds: [], rumbleAccountIds: [],
        fanvueAccountIds: [], telegramAccountIds: [], timezone: 'UTC', publishMode: 'scheduled',
      },
      persona: null,
      generation: {
        voiceover: true, language: null, voiceId: null, videoAspect: '9:16',
        videoLayout: null, niche: null, paragraphNumber: null, faceQuality: null,
      },
    };
    expect(slot.slot.title).toBe('T');
    expectTypeOf(slot.slot).exclude<undefined>().not.toHaveProperty('schedule_id');
    const body: UpdateSlotBody = { title: 'New title' };
    expect(body.title).toBe('New title');
    expectTypeOf(body).exclude<undefined>().not.toHaveProperty('slot_at');
    const updated: UpdateSlotResponse = { success: true, title: 'New title' };
    expect(updated.title).toBe('New title');
    const deleted: DeleteSlotResponse = { success: true };
    expect(deleted.success).toBe(true);
  });

  it('pins the video-tasks response field names', () => {
    const list: ListVideoGenerationsResponse = {
      success: true,
      generations: [
        {
          id: 'row-1', generationId: 'gen-1', engineTaskId: 'task-1', personaName: 'Ava',
          videoSubject: 'Launch day', status: 'completed', errorCode: null,
          tokensRefunded: false, createdAt: '2026-10-08T10:00:00Z', completedAt: '2026-10-08T10:05:00Z',
        },
      ],
    };
    expect(list.generations[0]?.generationId).toBe('gen-1');
    expectTypeOf(list.generations[0]).exclude<undefined>().not.toHaveProperty('generation_id');
    const detail: GetVideoGenerationResponse = {
      success: true,
      generation: {
        id: 'row-1', generationId: 'gen-1', engineTaskId: null, personaName: null,
        videoSubject: null, status: 'failed', errorCode: 'engine_restart',
        tokensRefunded: true, createdAt: '2026-10-08T10:00:00Z', completedAt: null,
      },
    };
    expect(detail.generation.status).toBe('failed');
    expectTypeOf(detail.generation).exclude<undefined>().not.toHaveProperty('engine_task_id');
    const status: GetVideoStatusResponse = {
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: 1, progress: 100, stage: null, postUrl: null },
    };
    expect(status.body.task_id).toBe('task-1');
    expectTypeOf(status.body).exclude<undefined>().not.toHaveProperty('taskId');
    expectTypeOf(status).exclude<undefined>().not.toHaveProperty('success');
    const cancelled: CancelVideoTaskResponse = {
      status: 200,
      message: 'success',
      body: { task_id: 'task-1', state: 1, progress: 100, videos: [], combined_videos: [] },
    };
    expect(cancelled.status).toBe(200);
    expectTypeOf(cancelled).exclude<undefined>().not.toHaveProperty('deleted');
  });

  it('pins the voices field names', () => {
    const list: ListVoicesResponse = {
      voices: [
        {
          id: 'chatterbox:kokoro_af_heart',
          label: 'Heart',
          provider: 'kokoro',
          gender: 'female',
          accent: 'us',
          kind: 'standard',
          description: 'Warm.',
        },
      ],
    };
    expect(list.voices[0]?.id).toBe('chatterbox:kokoro_af_heart');
    expectTypeOf(list.voices[0]).exclude<undefined>().not.toHaveProperty('type');
    const cloneRow = {
      id: 'clone-1',
      status: 'ready',
      language: 'en',
      voice_id: 'chatterbox:u1',
      error_code: null,
      consent_at: null,
      created_at: null,
      updated_at: null,
    };
    const clones: ListClonedVoicesResponse = {
      success: true,
      voices: [cloneRow],
    };
    expect(clones.voices[0]?.voice_id).toBe('chatterbox:u1');
    expectTypeOf(clones.voices[0]).exclude<undefined>().not.toHaveProperty('voiceId');
    const detail: GetClonedVoiceResponse = {
      success: true,
      voice: cloneRow,
    };
    expect(detail.voice.id).toBe('clone-1');
    expectTypeOf(detail).exclude<undefined>().not.toHaveProperty('body');
    const body: CreateClonedVoiceBody = { consent: 'true', denoise: 'false', language: 'en' };
    expect(body.consent).toBe('true');
    const wrongBody = { consent: true, denoise: 'false', language: 'en' };
    expect(typeof wrongBody).toBe('object');
    expectTypeOf<true>().not.toExtend<CreateClonedVoiceBody['consent']>();
    const created: CreateClonedVoiceResponse = { success: true, voice: cloneRow };
    expect(created.voice.id).toBe('clone-1');
    const deleted: DeleteClonedVoiceResponse = { success: true };
    expect(deleted.success).toBe(true);
    expectTypeOf(deleted).exclude<undefined>().not.toHaveProperty('voice');
  });

  it('pins the personas field names', () => {
    const list: ListPersonasResponse = {
      authenticated: true,
      personas: [
        {
          id: 'p1',
          name: 'Ava',
          createdAt: '2026-01-01T00:00:00Z',
          hookPanel: true,
          boundAccounts: {
            youtube: ['acct-1'], instagram: [], bluesky: [], linkedin: [], threads: [],
            facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [],
          },
        },
      ],
    };
    expect(list.personas[0]?.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(list.personas[0]?.boundAccounts.youtube).toEqual(['acct-1']);
    expectTypeOf(list.personas[0]).exclude<undefined>().not.toHaveProperty('created_at');
    expectTypeOf(list).exclude<undefined>().not.toHaveProperty('success');
    const faces: ListFacesResponse = {
      faces: [{ id: 'f1', url: 'https://example.test/f1.png', name: 'Ava', gender: 'female', age: 30, ethnicity: 'asian', hair: 'black', description: 'Smiling.' }],
    };
    expect(faces.faces[0]?.url).toBe('https://example.test/f1.png');
    expectTypeOf(faces.faces[0]).exclude<undefined>().not.toHaveProperty('path');
    const images: ListPersonaImagesResponse = {
      success: true,
      images: [{ id: 'img-1', tag: 'casual', description: 'Smiling.', is_primary: false, created_at: '2026-01-01T00:00:00Z', image_url: 'https://example.test/signed' }],
    };
    expect(images.images[0]?.is_primary).toBe(false);
    expectTypeOf(images.images[0]).exclude<undefined>().not.toHaveProperty('createdAt');
    const created: CreatePersonaResponse = { success: true, personaId: 'p1', imageIds: ['img-1'] };
    expect(created.imageIds).toEqual(['img-1']);
    expectTypeOf(created).exclude<undefined>().not.toHaveProperty('image_ids');
    const body: CreatePersonaBody = { name: 'Ava', paragraphNumber: '3', imagePrimaryIndex: '0' };
    expect(body.paragraphNumber).toBe('3');
    const wrongBody = { name: 'Ava', imagePrimaryIndex: 0 };
    expect(typeof wrongBody).toBe('object');
    expectTypeOf<number>().not.toExtend<CreatePersonaBody['imagePrimaryIndex']>();
    const updated: UpdatePersonaResponse = { success: true };
    expect(updated.success).toBe(true);
    expectTypeOf(updated).exclude<undefined>().not.toHaveProperty('personaId');
    const deleted: DeletePersonaResponse = { success: true };
    expect(deleted.success).toBe(true);
    const preview: GetPersonaDeletePreviewResponse = {
      success: true,
      persona: { id: 'p1', name: 'Ava' },
      counts: { schedules: 1, upcomingSlots: 2, publishedSlots: 3, failedSlots: 0, generatedVideos: 4, personaImages: 5 },
      videos: [{ taskId: 'task-1', title: 'Gym', status: 'completed', downloadUrl: 'https://cdn.test/v1.mp4' }],
      videosTruncated: false,
      linksIncomplete: false,
    };
    expect(preview.counts.schedules).toBe(1);
    expect(preview.videos[0]?.taskId).toBe('task-1');
    expectTypeOf(preview).exclude<undefined>().not.toHaveProperty('truncated');
    const addBody: AddPersonaImageBody = { personaId: 'p1', isPrimary: 'true' };
    expect(addBody.isPrimary).toBe('true');
    const wrongAddBody = { personaId: 'p1', isPrimary: true };
    expect(typeof wrongAddBody).toBe('object');
    expectTypeOf<true>().not.toExtend<AddPersonaImageBody['isPrimary']>();
    const added: AddPersonaImageResponse = {
      success: true,
      image: { id: 'img-1', tag: 'casual', description: 'Smiling.', is_primary: false, created_at: '2026-01-01T00:00:00Z' },
    };
    expect(added.image.id).toBe('img-1');
    expectTypeOf(added.image).exclude<undefined>().not.toHaveProperty('image_path');
    const updateBody: UpdatePersonaBody = { ctaType: 'comment', ctaUrl: 'https://example.com/x' };
    expect(updateBody.ctaType).toBe('comment');
    expect(updateBody.ctaUrl).toBe('https://example.com/x');
    const updatedImage: UpdatePersonaImageResponse = { success: true, image: null };
    expect(updatedImage.image).toBeNull();
    const updateImageBody: UpdatePersonaImageBody = { id: 'img-1', isPrimary: true };
    expect(updateImageBody.isPrimary).toBe(true);
    const deletedImage: DeletePersonaImageResponse = { success: true };
    expect(deletedImage.success).toBe(true);
  });

  it('pins the videos field names', () => {
    const body: GenerateAndScheduleBody = {
      title: 'Launch a SaaS in days',
      description: 'Agent description.',
      publishing: { providers: ['youtube'] },
      options: { videoType: 'hook_lipsync' },
    };
    expect(body.publishing.providers).toEqual(['youtube']);
    expectTypeOf(body.publishing).exclude<undefined>().not.toHaveProperty('provider');
    const generated: GenerateAndScheduleResponse = {
      success: true,
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 'slot-1', slotAt: '2026-10-05T20:00:00Z', title: 'Launch', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
      warnings: [{ code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' }],
    };
    expect(generated.schedule.id).toBe('sch-1');
    expect(generated.slots[0]?.taskId).toBe('task-1');
    expect(generated.warnings?.[0]?.code).toBe('voice_fallback_applied');
    const wrongWarnings = {
      success: true,
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 'slot-1', slotAt: '2026-10-05T20:00:00Z', title: 'Launch', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
      warnings: ['voice_fallback_applied'],
    };
    expect(typeof wrongWarnings).toBe('object');
    expectTypeOf<string>().not.toExtend<NonNullable<GenerateAndScheduleResponse['warnings']>[number]>();
    expectTypeOf(generated.slots[0]).exclude<undefined>().not.toHaveProperty('task_id');
    expectTypeOf(generated).exclude<undefined>().not.toHaveProperty('isReplay');
    const validated: ValidateScriptResponse = {
      success: true, valid: true, segmentCount: 1, totalWords: 3, hookWords: 3, contentWords: 0, mediaCount: 0,
      hookWindowSeconds: { min: 8, max: 12 }, measuredDurationSeconds: null, measured: 'pending',
      measuredReason: 'No hook-only TTS endpoint exists yet, so the measured hook duration cannot be checked in this phase.',
    };
    expect(validated.hookWindowSeconds.min).toBe(8);
    expect(validated.measured).toBe('pending');
    expectTypeOf(validated).exclude<undefined>().not.toHaveProperty('hookWindow');
    const scored: ScoreDraftResponse = {
      success: true, score: 100, reasons: [],
      counts: { chars: 400, words: 54, hashtags: 2, links: 0, firstLineWords: 10, slopHits: [], topThemeMatch: 'Porto mornings' },
      baseline: { postsMeasured: 2, topAngles: [], medianEngagement: 82.5, bestEngagement: 115, truncated: false },
      publishCheck: { network: 'linkedin', ok: true, failures: [], warnings: [] },
    };
    expect(scored.counts.topThemeMatch).toBe('Porto mornings');
    expectTypeOf(scored).exclude<undefined>().not.toHaveProperty('check');
    const batchBody: BatchDiscountBody = { batchKey: 'batch-1', scheduleIds: ['11111111-2222-4333-8444-555555555555'] };
    expect(batchBody.batchKey).toBe('batch-1');
    expectTypeOf(batchBody).exclude<undefined>().not.toHaveProperty('schedule_ids');
    const batch: BatchDiscountResponse = {
      success: true, batchId: 'batch-1', videos: 6, faceVideos: 6, earnedFreeVideos: 1,
      freeVideos: [{ scheduleId: '11111111-2222-4333-8444-555555555555', slotId: 'slot-1', discountTokens: 8 }],
      discountTokens: 8, chargedTokens: 40, warnings: [],
    };
    expect(batch.freeVideos[0]?.slotId).toBe('slot-1');
    expectTypeOf(batch.freeVideos[0]).exclude<undefined>().not.toHaveProperty('id');
    const minted: MintVideoUploadResponse = {
      success: true, uploadId: 'up-1', signedUrl: 'https://storage.test/upload', token: 'tok',
      storagePath: 'user-1/direct-uploads/up-1.mp4', expiresAt: '2026-11-12T00:15:00.000Z', maxBytes: 8,
    };
    expect(minted.storagePath).toBe('user-1/direct-uploads/up-1.mp4');
    expectTypeOf(minted).exclude<undefined>().not.toHaveProperty('id');
    const completed: CompleteVideoUploadResponse = { success: true, uploadId: 'up-1', status: 'ready', contentType: 'video/mp4', sizeBytes: 8 };
    expect(completed.status).toBe('ready');
    expectTypeOf(completed).exclude<undefined>().not.toHaveProperty('state');
    const publishBody: PublishByIdBody = { uploadId: '11111111-2222-4333-8444-555555555555', provider: 'instagram', accountIds: ['ig-1'] };
    expect(publishBody.uploadId).toBe('11111111-2222-4333-8444-555555555555');
    expectTypeOf<PublishByIdBody>().not.toHaveProperty('id');
  });
});
