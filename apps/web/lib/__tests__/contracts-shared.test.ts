/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { METRICS_WINDOWS, YOUTUBE_VIDEO_ID } from '@/lib/contracts/metrics';
import { CHECK_MEDIA_CODES, MEDIA_ID_PATTERN, VIDEO_ASPECTS } from '@/lib/contracts/media';
import { PublicAccountItemSchema } from '@/lib/contracts/accounts';
import { CancelRefundSchema, RANGE_STATUSES, ScheduleRowSchema } from '@/lib/contracts/schedule';
import { VideoGenerationRowSchema } from '@/lib/contracts/video-tasks';
import { VOICE_ACCENTS, VOICE_GENDERS, VOICE_KINDS } from '@/lib/contracts/voices';
import { FACE_QUALITIES, MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH, PERSONA_CTA_INSTRUCTION_MAX_LENGTH, PERSONA_CTA_TYPES, PERSONA_CTA_URL_MAX_LENGTH, PERSONA_IMAGE_WARNING_CODES, PersonaCtaSchema, VIDEO_LAYOUTS } from '@/lib/contracts/personas';
import { BATCH_KEY_MAX_LENGTH, BATCH_KEY_PATTERN, DRAFT_KINDS, DRAFT_MAX_INPUT_CHARS, GenerateSlotResultSchema, HOOK_MAX_SECONDS, HOOK_MIN_SECONDS, MAX_BATCH_VIDEOS, MAX_IMAGES_MODE_MEDIAS, MAX_REPORTED_ISSUES, MAX_REQUESTED_PHOTO_SECONDS, MAX_SEGMENTS, MAX_VIDEO_UPLOAD_BYTES, MIN_REQUESTED_PHOTO_SECONDS, VIDEO_TYPES, VIDEO_TYPE_ERROR_SUFFIX, VIDEO_UPLOAD_CONTENT_TYPES } from '@/lib/contracts/videos';
import { ExperimentCreatedResponseSchema } from '@/lib/contracts/experiments';

const HEADER = '// GENERATED from shared/contracts — do not edit.\n// Run `node scripts/sync-contracts.mjs` from the repo root to regenerate.\n';

describe('contracts shared source', () => {
  it('generates every shared contract with the header and no relative imports', () => {
    const root = findRepoRoot(import.meta.url);
    const sharedDir = join(root, 'shared', 'contracts');
    const files = readdirSync(sharedDir).filter((name: string) => name.endsWith('.ts'));
    expect(files).toContain('endpoint.ts');
    expect(files).toContain('experiments.ts');
    const endpointBody = readFileSync(join(sharedDir, 'endpoint.ts'), 'utf8').replace(/import \{ z \} from 'zod';\n/, '');
    for (const file of files) {
      const shared = readFileSync(join(sharedDir, file), 'utf8');
      const generated = readFileSync(join(root, 'apps', 'web', 'lib', 'contracts', file), 'utf8');
      const withoutEndpoint = file === 'endpoint.ts'
        ? shared
        : shared.replace(/import \{[^}]*\} from '\.\/endpoint\.js';\n/, endpointBody);
      const expected = file === 'endpoint.ts'
        ? HEADER + shared
        : HEADER + withoutEndpoint.replace(/from '\.\/([a-z0-9-]+)\.js'/g, "from './$1'");
      expect(generated.startsWith(HEADER)).toBe(true);
      expect(generated.includes("from './endpoint.js'")).toBe(false);
      expect(generated).not.toMatch(/from '\.\/[a-z0-9-]+\.js'/);
      expect(generated).toBe(expected);
    }
  });

  it('pins the shared METRICS_WINDOWS to metrics-query.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    const list = METRICS_WINDOWS.map((window) => `'${window}'`).join(', ');
    expect(metricsQuery).toContain(`export const METRICS_WINDOWS = [${list}] as const;`);
  });

  it('pins the shared YOUTUBE_VIDEO_ID to youtube-analytics.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const youtubeAnalytics = readFileSync(join(root, 'apps', 'web', 'lib', 'youtube-analytics.ts'), 'utf8');
    expect(youtubeAnalytics).toContain(`export const VIDEO_ID = /${YOUTUBE_VIDEO_ID.source}/;`);
  });

  it('pins metrics-query.ts to re-export the contract parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    expect(metricsQuery).toContain("from '@/lib/contracts/metrics'");
    expect(metricsQuery).toContain('parseMetricsQuery,');
    expect(metricsQuery).toContain('parseRetentionCurveQuery,');
  });

  it('pins the shared media check codes and aspects to the check route', () => {
    const root = findRepoRoot(import.meta.url);
    const checkRoute = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'media', 'check', 'route.ts'), 'utf8');
    for (const code of CHECK_MEDIA_CODES) {
      expect(checkRoute).toContain(`'${code}'`);
    }
    for (const aspect of VIDEO_ASPECTS) {
      expect(checkRoute).toContain(`'${aspect}'`);
    }
  });

  it('pins the shared MEDIA_ID_PATTERN to the upload route', () => {
    const root = findRepoRoot(import.meta.url);
    const uploadRoute = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'media', 'upload', 'route.ts'), 'utf8');
    expect(uploadRoute).toContain(`const MEDIA_ID_PATTERN = /${MEDIA_ID_PATTERN.source}/;`);
  });

  it('pins the shared PublicAccountItem variants to the provider registry', () => {
    const root = findRepoRoot(import.meta.url);
    const registry = readFileSync(join(root, 'apps', 'web', 'lib', 'providers', 'registry.ts'), 'utf8');
    for (const variant of PublicAccountItemSchema.options) {
      const provider = (variant.shape as { provider: { value: string } }).provider.value;
      expect(registry).toContain(`provider: '${provider}'`);
    }
    expect(PublicAccountItemSchema.options).toHaveLength(11);
    for (const name of ['AccountData', 'InstagramAccountData', 'BlueskyAccountData', 'LinkedinAccountData', 'ThreadsAccountData', 'FacebookAccountData', 'PinterestAccountData', 'ThreespeakAccountData', 'RumbleAccountData', 'FanvueAccountData']) {
      expect(registry).toContain(name);
    }
  });

  it('pins the shared ScheduleRow keys to the schedule GET select', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'schedule', 'route.ts'), 'utf8');
    const selects = [...route.matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1]);
    const select = selects.find((columns) => columns.includes('publish_mode'));
    expect(select).not.toBeUndefined();
    const columns = (select as string).split(',').map((column) => column.trim());
    for (const key of Object.keys(ScheduleRowSchema.shape)) {
      expect(columns).toContain(key);
    }
    expect(Object.keys(ScheduleRowSchema.shape)).toHaveLength(columns.length);
  });

  it('pins the shared cancel reasons to the schedule route', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'schedule', 'route.ts'), 'utf8');
    for (const reason of CancelRefundSchema.shape.reason.options) {
      expect(route).toContain(`'${reason}'`);
    }
  });

  it('keeps the slot reason through the shared slot schemas', () => {
    const slot = {
      slotId: 'slot-1',
      slotAt: '2026-12-01T12:00:00.000Z',
      title: 'Hook one',
      taskId: null,
      status: 'failed',
      errorCode: 'engine_rejected',
      tokensRefunded: true,
      reason: "video_type: unknown video_type 'voiceover'",
    };
    expect(GenerateSlotResultSchema.parse(slot).reason).toBe(slot.reason);
    const created = ExperimentCreatedResponseSchema.parse({
      success: true,
      stage: 'confirmed',
      scheduleId: 'schedule-1',
      replayed: false,
      chargedTokens: 0,
      slots: [{ ...slot, versionId: 'v-1' }],
      warnings: [],
    });
    expect(created.slots[0].reason).toBe(slot.reason);
  });

  it('pins the shared RANGE_STATUSES to the slot presentation', () => {
    const root = findRepoRoot(import.meta.url);
    const presentation = readFileSync(join(root, 'apps', 'web', 'lib', 'schedule-slot-presentation.ts'), 'utf8');
    for (const status of RANGE_STATUSES) {
      expect(presentation).toContain(`case '${status}':`);
    }
  });

  it('pins the shared hasExplicitOffset regex to timezone.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const timezone = readFileSync(join(root, 'apps', 'web', 'lib', 'timezone.ts'), 'utf8');
    const match = timezone.match(/const OFFSET_RE = (\/.*\/);/);
    expect(match).not.toBeNull();
    const scheduleContract = readFileSync(join(root, 'shared', 'contracts', 'schedule.ts'), 'utf8');
    expect(scheduleContract).toContain((match as RegExpMatchArray)[1]);
  });

  it('pins the status route and range.ts to the contract parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const statusRoute = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'schedule', 'status', 'route.ts'), 'utf8');
    expect(statusRoute).toContain("from '@/lib/contracts/schedule'");
    expect(statusRoute).toContain('parseStatusLimit,');
    expect(statusRoute).toContain('parseStatusRange,');
    const range = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'schedule', 'status', 'range.ts'), 'utf8');
    expect(range).toContain("from '@/lib/contracts/schedule'");
    expect(range).toContain('parseStatusRange as parseRange,');
    expect(range).toContain('RANGE_MAX_SPAN_DAYS,');
    expect(range).toContain('RANGE_MAX_SLOTS,');
    expect(range).toContain('RANGE_STATUSES,');
  });

  it('pins the shared VideoGenerationRow keys to the generations GET select', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'video-generations', 'route.ts'), 'utf8');
    const match = route.match(/\.select\(\s*'([^']+)'/);
    expect(match).not.toBeNull();
    const columns = (match as RegExpMatchArray)[1].split(',').map((column) => column.trim());
    const toCamel = (column: string): string =>
      column.replace(/_([a-z])/g, (_whole, letter: string) => letter.toUpperCase());
    for (const key of Object.keys(VideoGenerationRowSchema.shape)) {
      expect(columns.map(toCamel)).toContain(key);
    }
    expect(Object.keys(VideoGenerationRowSchema.shape)).toHaveLength(columns.length);
  });

  it('pins the generations route to the contract limit parser', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'video-generations', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/video-tasks'");
    expect(route).toContain('parseGenerationsLimit,');
    expect(route).toContain("export { parseGenerationsLimit } from '@/lib/contracts/video-tasks';");
    const api = readFileSync(join(root, 'apps', 'web', 'lib', 'api.ts'), 'utf8');
    expect(api).toContain("import type { VideoGenerationRow as VideoGeneration } from '@/lib/contracts/video-tasks';");
  });

  it('pins the voice catalog enums and cloned row type to the contract', () => {
    const root = findRepoRoot(import.meta.url);
    const catalog = readFileSync(join(root, 'apps', 'web', 'lib', 'voice-catalog.ts'), 'utf8');
    expect(catalog).toContain("from '@/lib/contracts/voices'");
    expect(catalog).toContain('VOICE_GENDERS,');
    expect(catalog).toContain('VOICE_ACCENTS,');
    expect(catalog).toContain('VOICE_KINDS,');
    expect(VOICE_GENDERS).toEqual(['female', 'male']);
    expect(VOICE_ACCENTS).toEqual(['us', 'gb']);
    expect(VOICE_KINDS).toEqual(['standard', 'character', 'cloned']);
    const types = readFileSync(join(root, 'apps', 'web', 'lib', 'cloned-voices-types.ts'), 'utf8');
    expect(types).toContain("import type { ClonedVoiceRow as ClonedVoicePublicRow } from '@/lib/contracts/voices';");
  });

  it('pins the persona constants to the contract', () => {
    const root = findRepoRoot(import.meta.url);
    const schema = readFileSync(join(root, 'apps', 'web', 'lib', 'persona-schema.ts'), 'utf8');
    expect(schema).toContain("from './contracts/personas'");
    expect(schema).toContain('FACE_QUALITIES,');
    expect(schema).toContain('PERSONA_CTA_TYPES,');
    expect(schema).toContain('PERSONA_CTA_URL_MAX_LENGTH,');
    expect(schema).toContain('PERSONA_CTA_INSTRUCTION_MAX_LENGTH,');
    expect(schema).toContain('VALID_VIDEO_ASPECTS,');
    expect(schema).toContain('VIDEO_LAYOUTS,');
    expect(schema).toContain('export { FACE_QUALITIES, PERSONA_CTA_TYPES, PERSONA_CTA_URL_MAX_LENGTH, PERSONA_CTA_INSTRUCTION_MAX_LENGTH, VALID_VIDEO_ASPECTS, VIDEO_LAYOUTS };');
    expect(FACE_QUALITIES).toEqual(['ok', 'very_good']);
    expect(PERSONA_CTA_TYPES).toEqual(['follow', 'comment', 'share', 'save', 'link', 'buy', 'other']);
    expect(PERSONA_CTA_URL_MAX_LENGTH).toBe(2048);
    expect(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).toBe(500);
    expect(VIDEO_LAYOUTS).toEqual(['standard', 'react']);
    const images = readFileSync(join(root, 'apps', 'web', 'lib', 'persona-images.ts'), 'utf8');
    expect(images).toContain("from '@/lib/contracts/personas'");
    expect(images).toContain('MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH');
    expect(MAX_TAG_LENGTH).toBe(100);
    expect(MAX_DESCRIPTION_LENGTH).toBe(500);
  });

  it('pins the persona CTA intent shape to the contract', () => {
    expect(PersonaCtaSchema.safeParse({ type: 'follow' }).success).toBe(true);
    expect(PersonaCtaSchema.safeParse({ type: 'comment' }).success).toBe(true);
    expect(PersonaCtaSchema.safeParse({ type: 'link', url: 'https://example.com/group' }).success).toBe(true);
    expect(PersonaCtaSchema.safeParse({ type: 'buy', url: 'https://example.com/checkout' }).success).toBe(true);
    expect(PersonaCtaSchema.safeParse({ type: 'other', instruction: 'invite to the WhatsApp group' }).success).toBe(true);
    expect(PersonaCtaSchema.safeParse({ type: 'link' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'buy' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'other' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'follow', url: 'https://example.com' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'follow', instruction: 'do something' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'link', url: 'not-a-url' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'subscribe' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'other', instruction: 'x'.repeat(501) }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'other', instruction: '' }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'link', url: `https://example.com/${'a'.repeat(2029)}` }).success).toBe(false);
    expect(PersonaCtaSchema.safeParse({ type: 'link', url: `https://example.com/${'a'.repeat(2028)}` }).success).toBe(true);
  });

  it('pins the persona image warning codes to persona-image-select.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const select = readFileSync(join(root, 'apps', 'web', 'lib', 'persona-image-select.ts'), 'utf8');
    expect(select).toContain("'primary_swap_failed'");
    expect(select).toContain("'metadata_save_failed'");
    expect(select).toContain("'row_refetch_failed'");
    expect(PERSONA_IMAGE_WARNING_CODES).toEqual({
      PRIMARY_SWAP_FAILED: 'primary_swap_failed',
      METADATA_SAVE_FAILED: 'metadata_save_failed',
      ROW_REFETCH_FAILED: 'row_refetch_failed',
    });
  });

  it('pins the persona routes to the contract query parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/personas'");
    expect(route).toContain('parsePersonaIdQuery');
    const images = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'images', 'route.ts'), 'utf8');
    expect(images).toContain("from '@/lib/contracts/personas'");
    expect(images).toContain('parseListPersonaImagesQuery');
    expect(images).toContain('parseDeletePersonaImageQuery');
    const preview = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'delete-preview', 'route.ts'), 'utf8');
    expect(preview).toContain("from '@/lib/contracts/personas'");
    expect(preview).toContain('parsePersonaIdQuery');
  });

  it('pins the videos type literals to lib/tokens.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const tokens = readFileSync(join(root, 'apps', 'web', 'lib', 'tokens.ts'), 'utf8');
    expect(VIDEO_TYPES).toEqual(['full_lipsync', 'hook_lipsync', 'voiceover']);
    expect(tokens).toContain("export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'voiceover'] as const;");
    expect(VIDEO_TYPE_ERROR_SUFFIX).toBe('use full_lipsync (8/15), hook_lipsync (2/3) or voiceover (1)');
    expect(tokens).toContain("export const VIDEO_TYPE_ERROR_SUFFIX =\n  'use full_lipsync (8/15), hook_lipsync (2/3) or voiceover (1)';");
  });

  it('pins the videos segment caps to the shared script-segments source', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, 'shared', 'script-segments', 'script-segments.ts'), 'utf8');
    expect(MAX_SEGMENTS).toBe(12);
    expect(MAX_IMAGES_MODE_MEDIAS).toBe(30);
    expect(HOOK_MIN_SECONDS).toBe(8);
    expect(HOOK_MAX_SECONDS).toBe(12);
    expect(MIN_REQUESTED_PHOTO_SECONDS).toBe(0.5);
    expect(MAX_REQUESTED_PHOTO_SECONDS).toBe(6);
    for (const line of [
      'export const MAX_SEGMENTS = 12;',
      'export const MAX_IMAGES_MODE_MEDIAS = 30;',
      'export const HOOK_MIN_SECONDS = 8;',
      'export const HOOK_MAX_SECONDS = 12;',
      'export const MIN_REQUESTED_PHOTO_SECONDS = 0.5;',
      'export const MAX_REQUESTED_PHOTO_SECONDS = 6;',
    ]) {
      expect(shared).toContain(line);
    }
  });

  it('pins the videos constants to the contract re-exports', () => {
    const root = findRepoRoot(import.meta.url);
    const batch = readFileSync(join(root, 'apps', 'web', 'lib', 'billing', 'batch-discount.ts'), 'utf8');
    expect(batch).toContain("export { MAX_BATCH_VIDEOS } from '@/lib/contracts/videos';");
    expect(MAX_BATCH_VIDEOS).toBe(12);
    expect(BATCH_KEY_MAX_LENGTH).toBe(100);
    expect(BATCH_KEY_PATTERN).toEqual(/^[A-Za-z0-9_-]+$/);
    const draft = readFileSync(join(root, 'apps', 'web', 'lib', 'draft-scoring.ts'), 'utf8');
    expect(draft).toContain("export { DRAFT_KINDS, DRAFT_MAX_INPUT_CHARS, PUBLISH_NETWORKS } from '@/lib/contracts/videos';");
    expect(DRAFT_KINDS).toEqual(['post', 'script']);
    expect(DRAFT_MAX_INPUT_CHARS).toBe(10000);
    const upload = readFileSync(join(root, 'apps', 'web', 'lib', 'videos', 'signed-upload.ts'), 'utf8');
    expect(upload).toContain("from '@/lib/contracts/videos'");
    expect(upload).toContain('MAX_VIDEO_UPLOAD_BYTES,');
    expect(upload).toContain('VIDEO_UPLOAD_CONTENT_TYPES,');
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(VIDEO_UPLOAD_CONTENT_TYPES).toEqual(['video/mp4', 'video/quicktime']);
    const issues = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'videos', 'generate-and-schedule', 'validation-issues.ts'), 'utf8');
    expect(issues).toContain("export { MAX_REPORTED_ISSUES } from '@/lib/contracts/videos';");
    expect(MAX_REPORTED_ISSUES).toBe(20);
    const segments = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'videos', 'generate-and-schedule', 'segments-schema.ts'), 'utf8');
    expect(segments).toContain("export { segmentOverlaySchema, segmentsRequestSchema } from '@/lib/contracts/videos';");
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'videos', 'generate-and-schedule', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/videos'");
    expect(route).toContain('GenerateAndScheduleBodySchema,');
  });
});
