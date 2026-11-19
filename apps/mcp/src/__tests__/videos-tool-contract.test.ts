import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  BatchDiscountBodySchema,
  GenerateAndScheduleBodySchema,
  GenerateAndScheduleResponseSchema,
  MintVideoUploadBodySchema,
  PublishByIdBodySchema,
  ScoreDraftBodySchema,
  ValidateScriptBodySchema,
} from '../contracts/videos.js';
import { GeneratePersonaVideoSchema, ValidateScriptSchema } from '../single-video-shape.js';
import { musicMoodField } from '../music-mood-field.js';
import { ScoreDraftSchema } from '../tools-single-video.js';

function firstIssue(schema: z.ZodType, value: unknown): string | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'invalid');
}

function accepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

const TOOL_GENERATE = {
  title: 'Launch a SaaS in days',
  description: 'Agent description.',
  segments: [{ kind: 'hook', text: 'Hook text here today now.' }],
  providers: ['youtube'],
  mode: 'scheduled',
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'UTC',
  options: { videoType: 'hook_lipsync' },
};

const CONTRACT_GENERATE = {
  title: 'Launch a SaaS in days',
  description: 'Agent description.',
  publishing: {
    mode: 'scheduled',
    providers: ['youtube'],
    schedule: { startAt: '2026-10-05T20:00:00', times: ['20:00'], timezone: 'UTC' },
  },
  options: {
    videoType: 'hook_lipsync',
    segments: [{ kind: 'hook', text: 'Hook text here today now.' }],
  },
};

const VALID_SEGMENT = { kind: 'hook', text: 'Hook text here today now.' };

describe('generate tool shape vs the videos contract', () => {
  it('rejects a missing or unknown videoType on both sides with the costs message', () => {
    const missingTool = firstIssue(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, options: undefined });
    expect(missingTool).toContain('options.videoType is required; use full_lipsync (8/15)');
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, options: undefined })).toBe(true);
    const unknownTool = { ...TOOL_GENERATE, options: { videoType: 'sideways' } };
    const unknownContract = { ...CONTRACT_GENERATE, options: { videoType: 'sideways' } };
    expect(firstIssue(GeneratePersonaVideoSchema, unknownTool)).toBe(
      "unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
    expect(firstIssue(GenerateAndScheduleBodySchema, unknownContract)).toBe(
      "unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
  });

  it('rejects an over-long title and a missing description on both sides', () => {
    expect(firstIssue(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, title: 'x'.repeat(101) })).toBe(
      'title must be at most 100 characters',
    );
    expect(firstIssue(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, title: 'x'.repeat(101) })).toBe(
      'title must be at most 100 characters.',
    );
    const { description: _dTool, ...noDescriptionTool } = TOOL_GENERATE;
    const { description: _dContract, ...noDescriptionContract } = CONTRACT_GENERATE;
    expect(accepts(GeneratePersonaVideoSchema, noDescriptionTool)).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, noDescriptionContract)).toBe(false);
  });

  it('requires at least one provider on the tool; the contract shape caps at 20 only', () => {
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, providers: [] })).toBe(false);
    expect(
      accepts(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        publishing: { ...CONTRACT_GENERATE.publishing, providers: [] },
      }),
    ).toBe(true);
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, providers: Array(21).fill('youtube') })).toBe(true);
    expect(
      accepts(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        publishing: { ...CONTRACT_GENERATE.publishing, providers: Array(21).fill('youtube') },
      }),
    ).toBe(false);
  });

  it('caps segments at 12 on both sides', () => {
    const segments = Array(13).fill(VALID_SEGMENT);
    expect(firstIssue(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, segments })).toContain('At most 12 segments');
    expect(
      accepts(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        options: { ...CONTRACT_GENERATE.options, segments },
      }),
    ).toBe(false);
  });

  it('keeps the tool stricter on segment text and overlay titles', () => {
    const emptyText = [{ kind: 'hook', text: '' }];
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, segments: emptyText })).toBe(false);
    expect(
      accepts(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        options: { ...CONTRACT_GENERATE.options, segments: emptyText },
      }),
    ).toBe(true);
    const emptyOverlay = [{ kind: 'hook', text: 'Hook text here.', media: [{ url: 'https://example.com/a.jpg', overlay: { title: '' } }] }];
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, segments: emptyOverlay })).toBe(false);
    expect(
      accepts(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        options: { ...CONTRACT_GENERATE.options, segments: emptyOverlay },
      }),
    ).toBe(true);
  });

  it('accepts a requested photo duration in range and rejects one outside it on both sides', () => {
    const withDuration = (duration: unknown) => ({
      ...TOOL_GENERATE,
      segments: [
        {
          kind: 'hook',
          text: 'Hook text here today now.',
          media: [{ url: 'https://example.com/a.jpg', duration }],
        },
      ],
    });
    const withContractDuration = (duration: unknown) => ({
      ...CONTRACT_GENERATE,
      options: {
        ...CONTRACT_GENERATE.options,
        segments: [
          {
            kind: 'hook',
            text: 'Hook text here today now.',
            media: [{ url: 'https://example.com/a.jpg', duration }],
          },
        ],
      },
    });
    for (const duration of [0.5, 3, 6]) {
      expect(accepts(GeneratePersonaVideoSchema, withDuration(duration))).toBe(true);
      expect(accepts(GenerateAndScheduleBodySchema, withContractDuration(duration))).toBe(true);
    }
    for (const duration of [0, 6.01, '3', true]) {
      expect(accepts(GeneratePersonaVideoSchema, withDuration(duration))).toBe(false);
      expect(accepts(GenerateAndScheduleBodySchema, withContractDuration(duration))).toBe(false);
    }
  });

  it('rejects an unknown experiment pair and variant on both sides', () => {
    const badPairTool = { ...TOOL_GENERATE, experiment: { experimentId: '11111111-2222-4333-8444-555555555555', variantId: 'hook-a', pair: 21 } };
    const badPairContract = { ...CONTRACT_GENERATE, experiment: { experimentId: '11111111-2222-4333-8444-555555555555', variantId: 'hook-a', pair: 21 } };
    expect(accepts(GeneratePersonaVideoSchema, badPairTool)).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, badPairContract)).toBe(false);
    const badVariantTool = { ...TOOL_GENERATE, experiment: { experimentId: '11111111-2222-4333-8444-555555555555', variantId: 'Hook A', pair: 1 } };
    const badVariantContract = { ...CONTRACT_GENERATE, experiment: { experimentId: '11111111-2222-4333-8444-555555555555', variantId: 'Hook A', pair: 1 } };
    expect(accepts(GeneratePersonaVideoSchema, badVariantTool)).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, badVariantContract)).toBe(false);
  });

  it('lets the mode/schedule coupling live outside the shape', () => {
    const asapWithPlan = {
      ...CONTRACT_GENERATE,
      publishing: { mode: 'asap', providers: ['youtube'], schedule: { startAt: '2026-10-05T20:00:00', times: ['20:00'], timezone: 'UTC' } },
    };
    expect(accepts(GenerateAndScheduleBodySchema, asapWithPlan)).toBe(true);
  });

  it('accepts the per-video CTA override and the marked take on both sides (issue #639)', () => {
    const markedSegments = [
      { kind: 'hook', text: 'Hook text here today now.' },
      { kind: 'content', text: 'Save this for your next trip.', cta: true },
    ];
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, cta: { type: 'save' }, segments: markedSegments })).toBe(true);
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, cta: { type: 'save' }, options: { ...CONTRACT_GENERATE.options, segments: markedSegments } })).toBe(true);
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, cta: null })).toBe(true);
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, cta: null })).toBe(true);
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, cta: { type: 'link' } })).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, cta: { type: 'link' } })).toBe(false);
    expect(accepts(GeneratePersonaVideoSchema, { ...TOOL_GENERATE, cta: { type: 'other' } })).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, cta: { type: 'other' } })).toBe(false);
  });

  it('pins the inlined musicMood field to the shared field', () => {
    expect(firstIssue(musicMoodField, 'x'.repeat(65))).not.toBeNull();
    expect(
      firstIssue(GenerateAndScheduleBodySchema, {
        ...CONTRACT_GENERATE,
        options: { ...CONTRACT_GENERATE.options, musicMood: 'x'.repeat(65) },
      }),
    ).not.toBeNull();
    expect(
      accepts(GeneratePersonaVideoSchema, {
        ...TOOL_GENERATE,
        options: { videoType: 'hook_lipsync', musicMood: 'x'.repeat(65) },
      }),
    ).toBe(false);
    expect(accepts(GenerateAndScheduleBodySchema, { ...CONTRACT_GENERATE, options: { ...CONTRACT_GENERATE.options, musicMood: 'calm' } })).toBe(true);
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, 'shared/music-mood-field/music-mood-field.ts'), 'utf8');
    const contract = readFileSync(join(root, 'shared/contracts/videos.ts'), 'utf8');
    const describe = shared.match(/\.describe\(\s*'([^']+)'/)?.[1];
    if (describe === undefined) throw new Error('musicMood describe text not found in the shared field');
    expect(contract).toContain(describe);
  });
});

describe('generate response warnings are objects, not strings', () => {
  const base = {
    success: true,
    schedule: { id: 'sch-1', mode: 'scheduled' },
    slots: [{ slotId: 'slot-1', slotAt: '2026-10-05T20:00:00Z', title: 'Launch', taskId: 'task-1', status: 'scheduled' }],
    replayed: false,
  };
  it('accepts the voice-fallback warning objects the route returns', () => {
    expect(
      accepts(GenerateAndScheduleResponseSchema, {
        ...base,
        warnings: [{ code: 'voice_fallback_applied', fromVoice: '', toVoice: 'chatterbox:kokoro_af_heart' }],
      }),
    ).toBe(true);
    expect(accepts(GenerateAndScheduleResponseSchema, base)).toBe(true);
  });

  it('rejects a bare string warning', () => {
    expect(accepts(GenerateAndScheduleResponseSchema, { ...base, warnings: ['voice_fallback_applied'] })).toBe(false);
    expect(firstIssue(GenerateAndScheduleResponseSchema, { ...base, warnings: ['voice_fallback_applied'] })).toContain('expected object');
  });

  it('accepts an account_needs_reconnect warning without voice fields', () => {
    expect(
      accepts(GenerateAndScheduleResponseSchema, {
        ...base,
        warnings: [{ code: 'account_needs_reconnect', accounts: [{ provider: 'bluesky', accountId: 'did:plc:1' }] }],
      }),
    ).toBe(true);
  });
});

describe('validate tool shape vs the videos contract', () => {
  it('rejects an unknown videoType with the same message on both sides', () => {
    expect(firstIssue(ValidateScriptSchema, { segments: [VALID_SEGMENT], videoType: 'sideways' })).toBe(
      "unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
    expect(firstIssue(ValidateScriptBodySchema, { segments: [VALID_SEGMENT], videoType: 'sideways' })).toBe(
      "unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
  });

  it('keeps the tool stricter on empty segments', () => {
    expect(accepts(ValidateScriptSchema, { segments: [] })).toBe(false);
    expect(accepts(ValidateScriptBodySchema, { segments: [] })).toBe(true);
    expect(accepts(ValidateScriptBodySchema, {})).toBe(true);
  });
});

describe('score tool shape vs the videos contract', () => {
  it('rejects a blank or over-long draft on both sides', () => {
    expect(firstIssue(ScoreDraftSchema, { draft: '' })).toBe('draft is required');
    expect(firstIssue(ScoreDraftBodySchema, { draft: '' })).toBe('draft is required and must be a non-empty string.');
    expect(firstIssue(ScoreDraftSchema, { draft: 'x'.repeat(10001) })).toBe('draft must be at most 10000 characters');
    expect(firstIssue(ScoreDraftBodySchema, { draft: 'x'.repeat(10001) })).toBe('draft must be at most 10000 characters.');
    expect(accepts(ScoreDraftSchema, { draft: '   ' })).toBe(true);
    expect(accepts(ScoreDraftBodySchema, { draft: '   ' })).toBe(false);
  });

  it('rejects an unknown network, personaId and kind on both sides', () => {
    expect(accepts(ScoreDraftSchema, { draft: 'Hi.', network: 'tiktok' })).toBe(false);
    expect(firstIssue(ScoreDraftBodySchema, { draft: 'Hi.', network: 'tiktok' })).toContain('network must be one of');
    expect(accepts(ScoreDraftSchema, { draft: 'Hi.', personaId: 'not-a-uuid' })).toBe(false);
    expect(firstIssue(ScoreDraftBodySchema, { draft: 'Hi.', personaId: 'not-a-uuid' })).toBe('personaId must be a uuid when given.');
    expect(accepts(ScoreDraftSchema, { draft: 'Hi.', kind: 'caption' })).toBe(false);
    expect(firstIssue(ScoreDraftBodySchema, { draft: 'Hi.', kind: 'caption' })).toBe('kind must be "post" or "script" when given.');
  });
});

describe('batch discount contract boundary', () => {
  const base = { batchKey: 'batch-1', scheduleIds: ['11111111-2222-4333-8444-555555555555'] };
  it('accepts a valid batch and rejects a bad key, empty ids and 13 ids', () => {
    expect(accepts(BatchDiscountBodySchema, base)).toBe(true);
    expect(accepts(BatchDiscountBodySchema, { ...base, batchKey: '' })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, batchKey: 'x'.repeat(101) })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, batchKey: 'bad key!' })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, scheduleIds: [] })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, scheduleIds: ['not-a-uuid'] })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, scheduleIds: Array(13).fill('11111111-2222-4333-8444-555555555555') })).toBe(false);
    expect(accepts(BatchDiscountBodySchema, { ...base, scheduleIds: Array(12).fill('11111111-2222-4333-8444-555555555555') })).toBe(true);
  });
});

describe('signed-upload mint contract boundary', () => {
  it('accepts both video types within 2GB and JPEG/PNG within 8 MB, and rejects the rest with the route messages', () => {
    expect(accepts(MintVideoUploadBodySchema, { contentType: 'video/mp4', sizeBytes: 2 * 1024 * 1024 * 1024 })).toBe(true);
    expect(accepts(MintVideoUploadBodySchema, { contentType: 'video/quicktime', sizeBytes: 42 })).toBe(true);
    expect(accepts(MintVideoUploadBodySchema, { contentType: 'image/png', sizeBytes: 8 * 1024 * 1024 })).toBe(true);
    expect(firstIssue(MintVideoUploadBodySchema, { contentType: 'image/jpeg', sizeBytes: 8 * 1024 * 1024 + 1 })).toBe(
      'Image is too large. Maximum is 8 MB.',
    );
    expect(firstIssue(MintVideoUploadBodySchema, { contentType: 'image/webp', sizeBytes: 42 })).toBe(
      'contentType must be video/mp4, video/quicktime, image/jpeg or image/png.',
    );
    expect(firstIssue(MintVideoUploadBodySchema, { contentType: 'video/mp4', sizeBytes: 0 })).toBe(
      'sizeBytes must be a positive integer.',
    );
    expect(firstIssue(MintVideoUploadBodySchema, { contentType: 'video/mp4', sizeBytes: -1 })).toBe(
      'sizeBytes must be a positive integer.',
    );
    expect(firstIssue(MintVideoUploadBodySchema, { contentType: 'video/mp4', sizeBytes: 2 * 1024 * 1024 * 1024 + 1 })).toBe(
      'Video is too large. Maximum is 2GB.',
    );
  });
});

describe('publish-by-id contract boundary', () => {
  const base = { uploadId: '11111111-2222-4333-8444-555555555555', provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' };
  it('accepts a minimal publish and rejects bad ids, providers and fields', () => {
    expect(accepts(PublishByIdBodySchema, base)).toBe(true);
    expect(firstIssue(PublishByIdBodySchema, { ...base, uploadId: 'up-1' })).toBe(
      'uploadId must be the id returned by the signed-upload mint step.',
    );
    expect(firstIssue(PublishByIdBodySchema, { ...base, provider: 'tiktok' })).toBe('provider is invalid.');
    expect(firstIssue(PublishByIdBodySchema, { ...base, accountIds: [] })).toBe('At least one account ID is required.');
    expect(firstIssue(PublishByIdBodySchema, { ...base, accountIds: ['  '] })).toBe('At least one account ID is required.');
    expect(firstIssue(PublishByIdBodySchema, { ...base, tags: [42] })).toBe('tags must be a list of strings.');
    expect(firstIssue(PublishByIdBodySchema, { ...base, title: 42 })).toBe('title must be a string.');
  });
});

describe('videos contract duplicated literals stay pinned', () => {
  it('matches the video-type suffix in the web tokens lib and the MCP video-type module', () => {
    const root = findRepoRoot(import.meta.url);
    const contract = readFileSync(join(root, 'shared/contracts/videos.ts'), 'utf8');
    const webTokens = readFileSync(join(root, 'apps/web/lib/tokens.ts'), 'utf8');
    const mcpVideoType = readFileSync(join(root, 'apps/mcp/src/video-type.ts'), 'utf8');
    expect(contract).toContain("export const VIDEO_TYPE_ERROR_SUFFIX =\n  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';");
    expect(webTokens).toContain("export const VIDEO_TYPE_ERROR_SUFFIX =\n  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';");
    expect(mcpVideoType).toContain('use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)');
  });

  it('matches the segments caps in the shared script-segments source', () => {
    const root = findRepoRoot(import.meta.url);
    const contract = readFileSync(join(root, 'shared/contracts/videos.ts'), 'utf8');
    const shared = readFileSync(join(root, 'shared/script-segments/script-segments.ts'), 'utf8');
    for (const line of [
      'export const MAX_SEGMENTS = 12;',
      'export const MAX_IMAGES_MODE_MEDIAS = 30;',
      'export const HOOK_MIN_SECONDS = 8;',
      'export const HOOK_MAX_SECONDS = 12;',
      'export const MIN_REQUESTED_PHOTO_SECONDS = 0.5;',
      'export const MAX_REQUESTED_PHOTO_SECONDS = 6;',
    ]) {
      expect(contract).toContain(line);
      expect(shared).toContain(line);
    }
  });
});
