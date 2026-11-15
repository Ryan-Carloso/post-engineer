/**
 * @vitest-environment node
 */

// contracts shared-source guard: the web copies must be generated from
// shared/contracts/*.ts (HEADER + shared, with endpoint.ts inlined into
// the other contracts so webpack needs no relative import), never
// hand-maintained. The sync runs on pretest, so a drift means the file
// was edited by hand: run `node scripts/sync-contracts.mjs`.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { METRICS_WINDOWS } from '@/lib/contracts/experiments';
import { SOCIAL_PROVIDERS, YOUTUBE_VIDEO_ID } from '@/lib/contracts/metrics';
import { CHECK_MEDIA_CODES, MEDIA_ID_PATTERN, VIDEO_ASPECTS } from '@/lib/contracts/media';
import { PUBLISH_PROVIDERS } from '@/lib/contracts/posts';
import { OAUTH_CONNECT_PROVIDERS, PublicAccountItemSchema } from '@/lib/contracts/accounts';
import { CancelRefundSchema, RANGE_STATUSES, ScheduleRowSchema } from '@/lib/contracts/schedule';
import { VideoGenerationRowSchema } from '@/lib/contracts/video-tasks';
import { VOICE_ACCENTS, VOICE_GENDERS, VOICE_KINDS } from '@/lib/contracts/voices';
import { FACE_QUALITIES, MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH, PERSONA_CTA_MAX_LENGTH, PERSONA_IMAGE_WARNING_CODES, VIDEO_LAYOUTS } from '@/lib/contracts/personas';
import { BATCH_KEY_MAX_LENGTH, BATCH_KEY_PATTERN, DRAFT_KINDS, DRAFT_MAX_INPUT_CHARS, HOOK_MAX_SECONDS, HOOK_MIN_SECONDS, MAX_BATCH_VIDEOS, MAX_IMAGES_MODE_MEDIAS, MAX_REPORTED_ISSUES, MAX_SEGMENTS, MAX_VIDEO_UPLOAD_BYTES, PUBLISH_NETWORKS, VIDEO_TYPES, VIDEO_TYPE_ERROR_SUFFIX, VIDEO_UPLOAD_CONTENT_TYPES } from '@/lib/contracts/videos';

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
      const expected = file === 'endpoint.ts'
        ? HEADER + shared
        : HEADER + shared.replace(/import \{[^}]*\} from '\.\/endpoint\.js';\n/, endpointBody);
      expect(generated.startsWith(HEADER)).toBe(true);
      expect(generated.includes("from './endpoint.js'")).toBe(false);
      expect(generated).toBe(expected);
    }
  });

  // The contract carries its own METRICS_WINDOWS copy (the route's
  // `?window=` validation used to import it straight from
  // metrics-query.ts). A one-sided edit would make the detail route 400 a
  // window the metrics layer supports, so the copy is pinned here.
  it('pins the shared METRICS_WINDOWS to metrics-query.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    const list = METRICS_WINDOWS.map((window) => `'${window}'`).join(', ');
    expect(metricsQuery).toContain(`export const METRICS_WINDOWS = [${list}] as const;`);
  });

  // The contract carries its own PUBLISH_PROVIDERS copy (the publish-link
  // builder drops any other provider before a link is built). A one-sided
  // edit would make the contract reject a link the route serves, so the
  // copy is pinned here against the PublishProvider union the PROVIDERS
  // set is built from.
  it('pins the shared PUBLISH_PROVIDERS to publish-links.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const publishLinks = readFileSync(join(root, 'apps', 'web', 'lib', 'publish-links.ts'), 'utf8');
    const list = PUBLISH_PROVIDERS.map((provider) => `'${provider}'`).join(' | ');
    expect(publishLinks).toContain(`export type PublishProvider = ${list};`);
  });

  // The metrics contract carries its own SOCIAL_PROVIDERS copy (the
  // route's `?provider=` validation used to import isSocialProvider
  // straight from the registry). A one-sided edit would make the
  // contract reject a provider the route accepts, so the copy is pinned
  // here.
  it('pins the shared SOCIAL_PROVIDERS to the provider registry', () => {
    const root = findRepoRoot(import.meta.url);
    const registry = readFileSync(join(root, 'apps', 'web', 'lib', 'providers', 'registry.ts'), 'utf8');
    const list = SOCIAL_PROVIDERS.map((provider) => `'${provider}'`).join(', ');
    expect(registry).toContain(`export const SOCIAL_PROVIDERS = [${list}] as const;`);
  });

  // The metrics contract carries its own YOUTUBE_VIDEO_ID copy (the
  // retention-curve route's `?video=` validation used to import VIDEO_ID
  // straight from youtube-analytics.ts). A one-sided edit would make the
  // contract reject a video id the Analytics call accepts, so the copy
  // is pinned here.
  it('pins the shared YOUTUBE_VIDEO_ID to youtube-analytics.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const youtubeAnalytics = readFileSync(join(root, 'apps', 'web', 'lib', 'youtube-analytics.ts'), 'utf8');
    expect(youtubeAnalytics).toContain(`export const VIDEO_ID = /${YOUTUBE_VIDEO_ID.source}/;`);
  });

  // The query parsers moved into the contract; metrics-query.ts keeps
  // the import paths working by re-exporting them. If the re-export is
  // dropped, the routes and the dashboard lose their validator.
  it('pins metrics-query.ts to re-export the contract parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    expect(metricsQuery).toContain("from '@/lib/contracts/metrics'");
    expect(metricsQuery).toContain('parseMetricsQuery,');
    expect(metricsQuery).toContain('parseRetentionCurveQuery,');
  });

  // The media contract carries its own CHECK_MEDIA_CODES and
  // VIDEO_ASPECTS copies (the check route validates against its own
  // sets). A one-sided edit would make the contract reject a code or
  // aspect the route accepts, so the copies are pinned here.
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

  // The media contract carries its own MEDIA_ID_PATTERN copy (the
  // upload route 502s when the engine-minted id does not match it). A
  // one-sided edit would make the MCP reject an id the route serves.
  it('pins the shared MEDIA_ID_PATTERN to the upload route', () => {
    const root = findRepoRoot(import.meta.url);
    const uploadRoute = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'media', 'upload', 'route.ts'), 'utf8');
    expect(uploadRoute).toContain(`const MEDIA_ID_PATTERN = /${MEDIA_ID_PATTERN.source}/;`);
  });

  // The accounts contract carries its own OAUTH_CONNECT_PROVIDERS copy
  // (the connect-url route validates against it). A one-sided edit would
  // make the contract accept a provider the route rejects (Bluesky,
  // 3Speak and Rumble connect directly and are not OAuth providers).
  it('pins the shared OAUTH_CONNECT_PROVIDERS to oauth-connect.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const oauthConnect = readFileSync(join(root, 'apps', 'web', 'lib', 'oauth-connect.ts'), 'utf8');
    const list = OAUTH_CONNECT_PROVIDERS.map((provider) => `'${provider}'`).join(', ');
    expect(oauthConnect).toContain(`export const OAUTH_CONNECT_PROVIDERS = [${list}] as const;`);
  });

  // The accounts contract carries its own PublicAccountItem copy (the
  // GET /api/account response). A one-sided edit would make the contract
  // reject an account the route serves, so every variant in the
  // registry's union must appear in the contract union with the same
  // provider literal.
  it('pins the shared PublicAccountItem variants to the provider registry', () => {
    const root = findRepoRoot(import.meta.url);
    const registry = readFileSync(join(root, 'apps', 'web', 'lib', 'providers', 'registry.ts'), 'utf8');
    for (const variant of PublicAccountItemSchema.options) {
      const provider = (variant.shape as { provider: { value: string } }).provider.value;
      expect(registry).toContain(`provider: '${provider}'`);
    }
    expect(PublicAccountItemSchema.options).toHaveLength(10);
    for (const name of ['AccountData', 'InstagramAccountData', 'BlueskyAccountData', 'LinkedinAccountData', 'ThreadsAccountData', 'FacebookAccountData', 'PinterestAccountData', 'ThreespeakAccountData', 'RumbleAccountData', 'FanvueAccountData']) {
      expect(registry).toContain(name);
    }
  });

  // The schedule contract carries its own ScheduleRow copy (GET
  // /api/schedule returns the raw Supabase rows). A one-sided edit would
  // make the contract reject a column the route selects, so every row
  // key must appear in the route's select list.
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

  // The schedule contract carries its own cancel-reason copy (the DELETE
  // /api/schedule response). A one-sided edit would make the contract
  // reject a reason the route returns, so every reason must appear in
  // the route's CancelRefundReason union.
  it('pins the shared cancel reasons to the schedule route', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'schedule', 'route.ts'), 'utf8');
    for (const reason of CancelRefundSchema.shape.reason.options) {
      expect(route).toContain(`'${reason}'`);
    }
  });

  // The schedule contract carries its own RANGE_STATUSES copy (the range
  // query filters on it). A one-sided edit would make the contract
  // reject a status the presentation layer maps, so every member must
  // appear as a presentStatus case.
  it('pins the shared RANGE_STATUSES to the slot presentation', () => {
    const root = findRepoRoot(import.meta.url);
    const presentation = readFileSync(join(root, 'apps', 'web', 'lib', 'schedule-slot-presentation.ts'), 'utf8');
    for (const status of RANGE_STATUSES) {
      expect(presentation).toContain(`case '${status}':`);
    }
  });

  // The contract's hasExplicitOffset mirrors lib/timezone.ts (the PATCH
  // slotAt rule). A one-sided edit would make the contract accept a
  // slotAt the route rejects, so the offset regex must match.
  it('pins the shared hasExplicitOffset regex to timezone.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const timezone = readFileSync(join(root, 'apps', 'web', 'lib', 'timezone.ts'), 'utf8');
    const match = timezone.match(/const OFFSET_RE = (\/.*\/);/);
    expect(match).not.toBeNull();
    const scheduleContract = readFileSync(join(root, 'shared', 'contracts', 'schedule.ts'), 'utf8');
    expect(scheduleContract).toContain((match as RegExpMatchArray)[1]);
  });

  // The range parser and the limit parser moved into the contract; the
  // status route imports them from there and range.ts keeps the old
  // import path working by re-exporting. If either import is dropped,
  // the route loses its validator or the range tests lose theirs.
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

  // The video-tasks contract carries its own VideoGenerationRow copy (the
  // generations routes map the snake_case DB row to it). A one-sided edit
  // would make the contract reject a column the route selects, so every
  // row key must appear in the route's select list (snake_case mapped to
  // camelCase).
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

  // The generations limit parser moved into the contract; the list route
  // imports it from there and re-exports it so the existing import path
  // keeps working. If either is dropped, the route loses its validator or
  // the parser tests lose theirs.
  it('pins the generations route to the contract limit parser', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'video-generations', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/video-tasks'");
    expect(route).toContain('parseGenerationsLimit,');
    expect(route).toContain("export { parseGenerationsLimit } from '@/lib/contracts/video-tasks';");
    const api = readFileSync(join(root, 'apps', 'web', 'lib', 'api.ts'), 'utf8');
    expect(api).toContain("import type { VideoGenerationRow as VideoGeneration } from '@/lib/contracts/video-tasks';");
  });

  // The voice catalog enums moved into the contract; voice-catalog.ts
  // imports them from there and the cloned-voice row type is the
  // contract's ClonedVoiceRow. A one-sided edit would make the contract
  // reject a voice the picker serves, or the MCP reject a row the route
  // serves.
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

  // The persona constants moved into the contract; persona-schema.ts and
  // persona-images.ts import them from there and re-export them so the
  // existing import paths keep working. A one-sided edit would make the
  // contract reject a value the form serves, or the form accept one the
  // route rejects.
  it('pins the persona constants to the contract', () => {
    const root = findRepoRoot(import.meta.url);
    const schema = readFileSync(join(root, 'apps', 'web', 'lib', 'persona-schema.ts'), 'utf8');
    expect(schema).toContain("from './contracts/personas'");
    expect(schema).toContain('FACE_QUALITIES,');
    expect(schema).toContain('PERSONA_CTA_MAX_LENGTH,');
    expect(schema).toContain('VALID_VIDEO_ASPECTS,');
    expect(schema).toContain('VIDEO_LAYOUTS,');
    expect(schema).toContain('export { FACE_QUALITIES, PERSONA_CTA_MAX_LENGTH, VALID_VIDEO_ASPECTS, VIDEO_LAYOUTS };');
    expect(FACE_QUALITIES).toEqual(['ok', 'very_good']);
    expect(PERSONA_CTA_MAX_LENGTH).toBe(200);
    expect(VIDEO_LAYOUTS).toEqual(['standard', 'react']);
    const images = readFileSync(join(root, 'apps', 'web', 'lib', 'persona-images.ts'), 'utf8');
    expect(images).toContain("from '@/lib/contracts/personas'");
    expect(images).toContain('MAX_DESCRIPTION_LENGTH, MAX_TAG_LENGTH');
    expect(MAX_TAG_LENGTH).toBe(100);
    expect(MAX_DESCRIPTION_LENGTH).toBe(500);
  });

  // The warning codes are duplicated in the contract because
  // persona-image-select.ts must stay dependency-free for the client
  // bundle (it cannot import the contract or zod). A one-sided rename
  // would make the contract reject a code the route serves, so the
  // contract's literals are pinned here against the select module's.
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

  // The persona routes use the contract query parsers; the route files
  // keep their own error envelopes, so the pin is only that the parser
  // comes from the contract.
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

  // The videos contract duplicates VIDEO_TYPES + the costs suffix from
  // lib/tokens.ts (the video-type sync tests pin tokens.ts to the engine,
  // and this pin keeps the contract's copy identical to it). A one-sided
  // edit would make the contract reject a mode the route serves, or the
  // route report costs the contract does not know.
  it('pins the videos type literals to lib/tokens.ts', () => {
    const root = findRepoRoot(import.meta.url);
    const tokens = readFileSync(join(root, 'apps', 'web', 'lib', 'tokens.ts'), 'utf8');
    expect(VIDEO_TYPES).toEqual(['full_lipsync', 'hook_lipsync', 'faceless']);
    expect(tokens).toContain("export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;");
    expect(VIDEO_TYPE_ERROR_SUFFIX).toBe('use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)');
    expect(tokens).toContain("export const VIDEO_TYPE_ERROR_SUFFIX =\n  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';");
  });

  // The segments caps are duplicated in the contract because a synced
  // contract cannot import the shared script-segments source (the two
  // apps keep its generated copy at different depths). A one-sided edit
  // would make the contract accept a script the validator rejects.
  it('pins the videos segment caps to the shared script-segments source', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, 'shared', 'script-segments', 'script-segments.ts'), 'utf8');
    expect(MAX_SEGMENTS).toBe(12);
    expect(MAX_IMAGES_MODE_MEDIAS).toBe(30);
    expect(HOOK_MIN_SECONDS).toBe(8);
    expect(HOOK_MAX_SECONDS).toBe(12);
    for (const line of [
      'export const MAX_SEGMENTS = 12;',
      'export const MAX_IMAGES_MODE_MEDIAS = 30;',
      'export const HOOK_MIN_SECONDS = 8;',
      'export const HOOK_MAX_SECONDS = 12;',
    ]) {
      expect(shared).toContain(line);
    }
  });

  // The batch, draft, upload and report constants moved into the videos
  // contract; the old modules re-export them so existing import paths
  // keep working. The generate route reads its body schema from the
  // contract and the segments/experiment helpers re-export theirs.
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
    const link = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'videos', 'generate-and-schedule', 'experiment-link.ts'), 'utf8');
    expect(link).toContain("from '@/lib/contracts/videos'");
    expect(link).toContain('ExperimentLinkSchema,');
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'videos', 'generate-and-schedule', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/videos'");
    expect(route).toContain('GenerateAndScheduleBodySchema,');
  });

  // PUBLISH_NETWORKS is the same 10 providers as SOCIAL_PROVIDERS, in
  // linkedin-first order (the score route lists networks that way). A
  // one-sided edit would make the contract reject a network the metrics
  // layer serves, or vice versa.
  it('pins PUBLISH_NETWORKS to SOCIAL_PROVIDERS as a set', () => {
    expect([...PUBLISH_NETWORKS].sort()).toEqual([...SOCIAL_PROVIDERS].sort());
    expect(PUBLISH_NETWORKS[0]).toBe('linkedin');
  });
});
