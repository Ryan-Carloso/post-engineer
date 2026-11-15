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
});
