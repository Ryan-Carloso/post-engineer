import { describe, expect, expectTypeOf, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createUserPrompt, getPrompt, listPrompts } from '@/lib/contracts/prompts';
import { getPost } from '@/lib/contracts/posts';
import { getRetentionCurve, listMetrics } from '@/lib/contracts/metrics';
import { uploadContent } from '@/lib/contracts/media';
import { connectBlueskyAccount, getOAuthConnectUrl, getPersonaPublishingAccounts, listSocialAccounts } from '@/lib/contracts/accounts';
import { cancelSchedule, deleteSlot, getSlot, listPosts, listSchedules, updateSlotTitle } from '@/lib/contracts/schedule';
import { createPersona, deletePersona, getPersonaDeletePreview, listPersonas, updatePersona } from '@/lib/contracts/personas';
import { completeVideoUpload, mintVideoUpload, publishUploadedVideo } from '@/lib/contracts/videos';
import type { BodyOf, ResponseOf } from '@/lib/contracts/endpoint';

type CreateBody = BodyOf<typeof createUserPrompt>;
type CreateResponse = ResponseOf<typeof createUserPrompt>;
type ListPromptsResponse = ResponseOf<typeof listPrompts>;
type GetPromptResponse = ResponseOf<typeof getPrompt>;
type GetPostResponse = ResponseOf<typeof getPost>;
type MetricsResponse = ResponseOf<typeof listMetrics>;
type RetentionCurveResponse = ResponseOf<typeof getRetentionCurve>;
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
type ListPersonasResponse = ResponseOf<typeof listPersonas>;
type CreatePersonaBody = BodyOf<typeof createPersona>;
type CreatePersonaResponse = ResponseOf<typeof createPersona>;
type UpdatePersonaBody = BodyOf<typeof updatePersona>;
type UpdatePersonaResponse = ResponseOf<typeof updatePersona>;
type DeletePersonaResponse = ResponseOf<typeof deletePersona>;
type GetPersonaDeletePreviewResponse = ResponseOf<typeof getPersonaDeletePreview>;
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

  it('pins the post detail response field names', () => {
    const detail: GetPostResponse = {
      success: true,
      slot: {
        id: 'slot-1', scheduleId: 'sched-1', slotAt: '2026-11-07T00:00:00Z', status: 'published', title: 'Gym',
        error: null, publishedAt: '2026-11-07T00:01:00Z', publishLinks: [], userNotices: [], providerFailures: [], firstComment: null, commentWarnings: [], postUrl: null,
      },
      schedule: {
        id: 'sched-1', personaId: null, providers: ['youtube'], youtubeAccountIds: ['UC-1'], instagramAccountIds: [],
        linkedinAccountIds: [], blueskyAccountIds: [], threadsAccountIds: [], facebookAccountIds: [], pinterestAccountIds: [],
        pinterestBoardId: null, threespeakAccountIds: [], rumbleAccountIds: [], fanvueAccountIds: [], telegramAccountIds: [],
        timezone: 'UTC', publishMode: 'scheduled',
      },
      persona: null,
    };
    expect(detail.slot.title).toBe('Gym');
    expectTypeOf(detail.slot).exclude<undefined>().not.toHaveProperty('taskId');
    expectTypeOf(detail).exclude<undefined>().not.toHaveProperty('generation');
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
      success: true, cancelledSlotIds: [],
    };
    expect(cancel.cancelledSlotIds).toEqual([]);
    expectTypeOf(cancel).exclude<undefined>().not.toHaveProperty('cancelled_slot_ids');
    const posts: ListPostsResponse = { success: true, upcoming: [], recent: [], hasAnyPost: false };
    expect(posts.hasAnyPost).toBe(false);
    expectTypeOf(posts).exclude<undefined>().not.toHaveProperty('has_any_post');
    const slot: GetSlotResponse = {
      success: true,
      slot: {
        id: 'slot-1', scheduleId: 'sched-1', slotAt: '2026-10-10T20:00:00Z', status: 'ready',
        title: 'T', error: null, publishedAt: null,
        postUrl: null, publishLinks: [], userNotices: [], providerFailures: [], firstComment: null, commentWarnings: [],
      },
      schedule: {
        id: 'sched-1', personaId: null, providers: [], youtubeAccountIds: [],
        instagramAccountIds: [], linkedinAccountIds: [], blueskyAccountIds: [],
        threadsAccountIds: [], facebookAccountIds: [], pinterestAccountIds: [],
        pinterestBoardId: null, threespeakAccountIds: [], rumbleAccountIds: [],
        fanvueAccountIds: [], telegramAccountIds: [], timezone: 'UTC', publishMode: 'scheduled',
      },
      persona: null,
    };
    expect(slot.slot.title).toBe('T');
    expectTypeOf(slot).exclude<undefined>().not.toHaveProperty('generation');
    expectTypeOf(slot.slot).exclude<undefined>().not.toHaveProperty('schedule_id');
    const body: UpdateSlotBody = { title: 'New title' };
    expect(body.title).toBe('New title');
    expectTypeOf(body).exclude<undefined>().not.toHaveProperty('slot_at');
    const updated: UpdateSlotResponse = { success: true, title: 'New title' };
    expect(updated.title).toBe('New title');
    const deleted: DeleteSlotResponse = { success: true };
    expect(deleted.success).toBe(true);
  });

  it('pins the personas field names', () => {
    const list: ListPersonasResponse = {
      authenticated: true,
      personas: [
        {
          id: 'p1',
          aiLabel: false,
          name: 'Ava',
          createdAt: '2026-01-01T00:00:00Z',
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
    expectTypeOf(list.personas[0]).exclude<undefined>().not.toHaveProperty('voiceId');
    const created: CreatePersonaResponse = { success: true, personaId: 'p1' };
    expect(created.personaId).toBe('p1');
    expectTypeOf(created).exclude<undefined>().not.toHaveProperty('imageIds');
    const body: CreatePersonaBody = { name: 'Ava', publishingAccounts: '{"youtube":["acct-1"]}' };
    expect(body.name).toBe('Ava');
    expectTypeOf<CreatePersonaBody>().not.toHaveProperty('paragraphNumber');
    const updateBody: UpdatePersonaBody = { name: 'Ava 2' };
    expect(updateBody.name).toBe('Ava 2');
    expectTypeOf<UpdatePersonaBody>().not.toHaveProperty('ctaType');
    const updated: UpdatePersonaResponse = { success: true };
    expect(updated.success).toBe(true);
    expectTypeOf(updated).exclude<undefined>().not.toHaveProperty('personaId');
    const deleted: DeletePersonaResponse = { success: true };
    expect(deleted.success).toBe(true);
    const preview: GetPersonaDeletePreviewResponse = {
      success: true,
      persona: { id: 'p1', name: 'Ava' },
      counts: { schedules: 1, upcomingSlots: 2, publishedSlots: 3, failedSlots: 0 },
    };
    expect(preview.counts.schedules).toBe(1);
    expectTypeOf(preview.counts).exclude<undefined>().not.toHaveProperty('generatedVideos');
    expectTypeOf(preview).exclude<undefined>().not.toHaveProperty('videos');
  });

  it('pins the signed upload field names', () => {
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
