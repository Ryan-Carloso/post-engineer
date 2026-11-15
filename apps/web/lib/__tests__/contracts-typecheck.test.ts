import { describe, expect, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createExperiment } from '@/lib/contracts/experiments';
import { getPrompt, listPrompts } from '@/lib/contracts/prompts';
import { getTokenBalance, listTokenTransactions } from '@/lib/contracts/billing';
import { getPost } from '@/lib/contracts/posts';
import { getRetentionCurve, listMetrics } from '@/lib/contracts/metrics';
import { checkMedia, uploadContent, uploadMedia } from '@/lib/contracts/media';
import { connectBlueskyAccount, getOAuthConnectUrl, getPersonaPublishingAccounts, listSocialAccounts } from '@/lib/contracts/accounts';
import type { BodyOf, ResponseOf } from '@/lib/contracts/endpoint';

//---------------
// Type-level pins for the shared contracts (web side, mirroring
// apps/mcp/src/__tests__/contracts-typecheck.test.ts): renaming a
// contract field makes this file fail typecheck. The @ts-expect-error
// pins must stay errors.
//---------------

type CreateBody = BodyOf<typeof createExperiment>;
type CreateResponse = ResponseOf<typeof createExperiment>;
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

describe('contracts typecheck', () => {
  it('pins BodyOf and ResponseOf field names', async () => {
    const validBody: CreateBody = {
      name: 'Hook test',
      variable: 'hook',
      targetPairs: 6,
      variants: [
        { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
        { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
      ],
    };
    expect(validBody.name).toBe('Hook test');

    // @ts-expect-error -- strict body: `nome` is not a field of the create body
    const badBody: CreateBody = { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] };
    expect(badBody).toBeDefined();

    const response = { success: true, experiment: { id: '1', name: 'Hook test', variable: 'hook', personaId: '11111111-2222-4333-8444-555555555555' as string | null, targetPairs: 6, variants: [] } } as CreateResponse;
    expect(response.experiment.name).toBe('Hook test');

    // @ts-expect-error -- response experiment field is `name`, not `nome`
    const badName = response.experiment.nome;
    expect(badName).toBeUndefined();

    const request = new Request('http://localhost/api/experiments', { method: 'POST', body: JSON.stringify(validBody) });
    const result = await readBody(createExperiment, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.name).toBe('Hook test');
      // @ts-expect-error -- readBody body field is `name`, not `nome`
      expect(result.body.nome).toBeUndefined();
    }
  });

  it('pins the prompts response field names', () => {
    const list: ListPromptsResponse = { success: true, prompts: [{ slug: 'daily-news', title: 'News', description: 'News' }] };
    expect(list.prompts[0]?.title).toBe('News');
    // @ts-expect-error -- the list item field is `title`, not `name`
    expect(list.prompts[0]?.name).toBeUndefined();

    const detail: GetPromptResponse = { success: true, prompt: { slug: 'daily-news', title: 'News', description: 'News', prompt: 'Write...' } };
    expect(detail.prompt.prompt).toBe('Write...');
    // @ts-expect-error -- the detail field is `prompt`, not `text`
    expect(detail.prompt.text).toBeUndefined();
  });

  it('pins the billing response field names', () => {
    const balance: TokenBalanceResponse = { success: true, balance: 8, free: 3 };
    expect(balance.balance).toBe(8);
    // @ts-expect-error -- the balance field is `balance`, not `total`
    expect(balance.total).toBeUndefined();

    const ledger: TokenTransactionsResponse = {
      success: true,
      transactions: [{ id: 'tx-1', amount: -1, type: 'spend', description: null, reason: null, generationId: null, createdAt: '2026-10-08T10:00:00Z' }],
      total: 1,
      limit: 20,
      offset: 0,
    };
    expect(ledger.transactions[0]?.generationId).toBeNull();
    // @ts-expect-error -- the transaction field is `generationId`, not `generation_id`
    expect(ledger.transactions[0]?.generation_id).toBeUndefined();
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
    // @ts-expect-error -- the generation field is `videoSubject`, not `subject`
    expect(detail.generation.subject).toBeUndefined();
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
    // @ts-expect-error -- the row field is `postId`, not `post_id`
    expect(metrics.rows[0]?.post_id).toBeUndefined();
    const curve: RetentionCurveResponse = {
      success: true,
      points: [{ ratio: 0.01, audienceWatchRatio: 0.5, relativeRetentionPerformance: 1.2 }],
      startDate: '2026-11-01',
      endDate: '2026-11-14',
      provisional: false,
    };
    expect(curve.points[0]?.ratio).toBe(0.01);
    // @ts-expect-error -- the point field is `audienceWatchRatio`, not `watchRatio`
    expect(curve.points[0]?.watchRatio).toBeUndefined();
  });

  it('pins the media response field names', () => {
    const upload: UploadMediaResponse = {
      success: true,
      mediaId: 'aabbccddeeff00112233445566778899.png',
      expiresInSeconds: 3600,
    };
    expect(upload.mediaId).toContain('.png');
    // @ts-expect-error -- the upload field is `mediaId`, not `media_id`
    expect(upload.media_id).toBeUndefined();
    const check: MediaCheckResponse = { success: true, code: 'ok', width: 1920, height: 1080 };
    expect(check.code).toBe('ok');
    // @ts-expect-error -- the check field is `code`, not `status`
    expect(check.status).toBeUndefined();
    const content: UploadContentResponse = {
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'chan-1', success: true, videoId: 'vid-1' }],
      successCount: 1,
      logId: 'log-1',
    };
    expect(content.results[0]?.accountId).toBe('chan-1');
    // @ts-expect-error -- the account field is `accountId`, not `account_id`
    expect(content.results[0]?.account_id).toBeUndefined();
  });

  it('pins the accounts response field names', () => {
    const list: ListAccountsResponse = {
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'rec-1', channelId: 'chan-1', channelName: 'Chan', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
      message: 'Accounts retrieved from Supabase',
    };
    expect(list.accounts[0]?.provider).toBe('youtube');
    // @ts-expect-error -- the account field is `channelId`, not `channel_id`
    expect(list.accounts[0]?.channel_id).toBeUndefined();
    const connectUrl: ConnectUrlResponse = { success: true, auth_url: 'https://example.com/oauth' };
    expect(connectUrl.auth_url).toContain('oauth');
    // @ts-expect-error -- the connect field is `auth_url`, not `authUrl`
    expect(connectUrl.authUrl).toBeUndefined();
    const body: BlueskyConnectBody = { handle: 'user.bsky.social', appPassword: 'secret' };
    expect(body.handle).toBe('user.bsky.social');
    // @ts-expect-error -- the connect body field is `appPassword`, not `app_password`
    expect(body.app_password).toBeUndefined();
    const publishing: PublishingAccountsResponse = {
      success: true,
      defaults: { youtube: ['UC-1'], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [], pinterest: [], '3speak': [], rumble: [], fanvue: [] },
    };
    expect(publishing.defaults.youtube).toEqual(['UC-1']);
    // @ts-expect-error -- the defaults field is `youtube`, not `youtube_id`
    expect(publishing.defaults.youtube_id).toBeUndefined();
  });
});
