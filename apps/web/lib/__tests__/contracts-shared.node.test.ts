import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { METRICS_WINDOWS, YOUTUBE_VIDEO_ID } from '@/lib/contracts/metrics';
import { PublicAccountItemSchema } from '@/lib/contracts/accounts';
import { ScheduleRowSchema } from '@/lib/contracts/schedule';
import { MAX_REPORTED_ISSUES, MAX_VIDEO_UPLOAD_BYTES, VIDEO_UPLOAD_CONTENT_TYPES } from '@/lib/contracts/videos';

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
    expect(youtubeAnalytics).toContain(`const VIDEO_ID = /${YOUTUBE_VIDEO_ID.source}/;`);
  });

  it('pins metrics-query.ts to re-export the contract parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const metricsQuery = readFileSync(join(root, 'apps', 'web', 'lib', 'metrics', 'metrics-query.ts'), 'utf8');
    expect(metricsQuery).toContain("from '@/lib/contracts/metrics'");
    expect(metricsQuery).toContain('parseMetricsQuery,');
    expect(metricsQuery).toContain('parseRetentionCurveQuery,');
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
  });

  it('pins the persona routes to the contract query parsers', () => {
    const root = findRepoRoot(import.meta.url);
    const route = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/contracts/personas'");
    expect(route).toContain('parsePersonaIdQuery');
    const scoped = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'persona-id-query.ts'), 'utf8');
    expect(scoped).toContain("from '@/lib/contracts/personas'");
    expect(scoped).toContain('parsePersonaIdQuery(request.url)');
    const preview = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'persona', 'delete-preview', 'route.ts'), 'utf8');
    expect(preview).toContain("from '../persona-id-query'");
    expect(preview).toContain('scopedPersonaIdQuery(request');
  });

  it('pins the videos constants to the contract re-exports', () => {
    const root = findRepoRoot(import.meta.url);
    const upload = readFileSync(join(root, 'apps', 'web', 'lib', 'videos', 'signed-upload.ts'), 'utf8');
    expect(upload).toContain("from '@/lib/contracts/videos'");
    expect(upload).toContain('MAX_VIDEO_UPLOAD_BYTES,');
    expect(MAX_VIDEO_UPLOAD_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(VIDEO_UPLOAD_CONTENT_TYPES).toEqual(['video/mp4', 'video/quicktime']);
    const issues = readFileSync(join(root, 'apps', 'web', 'app', 'api', 'media', 'publish-existing', 'validation-issues.ts'), 'utf8');
    expect(issues).toContain("export { MAX_REPORTED_ISSUES } from '@/lib/contracts/videos';");
    expect(MAX_REPORTED_ISSUES).toBe(20);
  });
});
