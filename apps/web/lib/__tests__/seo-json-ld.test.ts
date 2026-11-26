import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GITHUB_URL, LANDING_DESCRIPTION, SITE_URL } from '@/lib/seo';
import {
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from '@/lib/seo-json-ld';
import { findRepoRoot } from '@/test/repo-root';

describe('lib/seo-json-ld — Organization and WebSite structured data', () => {
  it('sets the WebSite url to the domain root, not /landing', () => {
    const webSite = buildWebSiteJsonLd();
    expect(webSite.url).toBe('https://post-engineer.com');
    expect(webSite.url).toBe(SITE_URL);
    expect(webSite.url).not.toContain('/landing');
  });

  it('names the site Post Engineer on both entities', () => {
    expect(buildWebSiteJsonLd().name).toBe('Post Engineer');
    expect(buildOrganizationJsonLd().name).toBe('Post Engineer');
  });

  it('has no SearchAction on either entity', () => {
    expect(JSON.stringify(buildWebSiteJsonLd())).not.toContain('SearchAction');
    expect(JSON.stringify(buildOrganizationJsonLd())).not.toContain('SearchAction');
  });

  it('points the Organization logo at the real public logo file', () => {
    const organization = buildOrganizationJsonLd();
    expect(organization.logo).toBe('https://post-engineer.com/logo.png');
    const publicDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'public');
    expect(existsSync(join(publicDir, 'logo.png'))).toBe(true);
  });

  it('lists the GitHub repo as the Organization sameAs', () => {
    expect(GITHUB_URL).toBe('https://github.com/Ryan-Carloso/post-engineer');
    expect(buildOrganizationJsonLd().sameAs).toEqual([GITHUB_URL]);
  });

  it('gives each entity a stable @id under the domain root', () => {
    expect(buildWebSiteJsonLd()['@id']).toBe('https://post-engineer.com/#website');
    expect(buildOrganizationJsonLd()['@id']).toBe('https://post-engineer.com/#organization');
  });
});

describe('lib/seo-json-ld — SoftwareApplication structured data', () => {
  it('never emits aggregateRating or review', () => {
    const serialized = JSON.stringify(buildSoftwareApplicationJsonLd());
    expect(serialized).not.toContain('aggregateRating');
    expect(serialized).not.toContain('review');
  });

  it('describes the app with the landing description and the landing canonical', () => {
    const app = buildSoftwareApplicationJsonLd();
    expect(app.description).toBe(LANDING_DESCRIPTION);
    expect(app.url).toBe('https://post-engineer.com/landing');
    expect(app.name).toBe('Post Engineer');
    expect(app.applicationCategory).toBe('MultimediaApplication');
    expect(app.operatingSystem).toBe('Web');
    expect(app.image).toBe('https://post-engineer.com/og.png');
  });

  it('links its publisher to the Organization @id', () => {
    const app = buildSoftwareApplicationJsonLd();
    expect(app.publisher).toEqual({ '@id': buildOrganizationJsonLd()['@id'] });
    expect(app.publisher['@id']).toBe('https://post-engineer.com/#organization');
  });
});
