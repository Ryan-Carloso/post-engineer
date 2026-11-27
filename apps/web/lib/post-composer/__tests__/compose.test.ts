import { describe, expect, it, vi } from 'vitest';

import { emptyPersonaDefaultAccounts, type PersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import {
  TITLE_MAX_LENGTH,
  buildSubmission,
  browserTimezone,
  createDraft,
  defaultPublishAt,
  mediaKindOf,
  mediaMaxBytes,
  parseTags,
  providersForMedia,
  publishAtBounds,
  resolveMediaContentType,
  type ComposerDraft,
} from '../compose';

const NOW = new Date('2026-12-01T00:00:00Z');

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    ...createDraft('Europe/Lisbon'),
    mediaKind: 'video',
    accounts: { youtube: ['ch-1'] },
    title: 'A day in Lisbon',
    description: 'A short vlog about the city.',
    tags: 'vlog, lisbon',
    mode: 'scheduled',
    publishAt: '2026-12-02T20:00',
    ...overrides,
  };
}

function build(
  overrides: Partial<ComposerDraft> = {},
  bound: PersonaDefaultAccounts | null = null,
) {
  return buildSubmission(draft(overrides), { now: NOW, boundAccounts: bound });
}

describe('post-composer compose', () => {
  it('builds an asap video plan with the youtube fields', () => {
    const result = build({ mode: 'asap' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.mode).toBe('asap');
    expect(result.plan.providers).toEqual(['youtube']);
    expect(result.plan.accounts).toEqual({ youtube: ['ch-1'] });
    expect(result.plan.tags).toEqual(['vlog', 'lisbon']);
    expect(result.plan.privacyStatus).toBe('public');
    expect(result.plan.schedule).toBeNull();
  });

  it('requires tags for youtube only when publishing now', () => {
    const asap = build({ mode: 'asap', tags: '   ' });
    expect(asap.ok).toBe(false);
    if (!asap.ok) expect(asap.issues).toContainEqual({ field: 'tags', key: 'composer.validationTags' });

    const scheduled = build({ mode: 'scheduled', tags: '' });
    expect(scheduled.ok).toBe(true);
  });

  it('builds a scheduled plan with the wall clock and timezone', () => {
    const result = build({ mode: 'scheduled', publishAt: '2026-12-02T20:00' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.schedule).toEqual({
      publishAt: '2026-12-02T20:00',
      timezone: 'Europe/Lisbon',
    });
  });

  it('rejects a publish time outside the 3h-30d window', () => {
    const tooSoon = build({ mode: 'scheduled', publishAt: '2026-12-01T01:00' });
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) {
      expect(tooSoon.issues[0]).toMatchObject({ field: 'schedule', key: 'composer.validationSchedule' });
    }
    const tooFar = build({ mode: 'scheduled', publishAt: '2027-02-01T20:00' });
    expect(tooFar.ok).toBe(false);
  });

  it('requires media, accounts, a title and a description', () => {
    const result = build({ mediaKind: null, accounts: {}, title: ' ', description: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.field).sort()).toEqual(
      ['description', 'media', 'title'].sort(),
    );
  });

  it('rejects a title over the limit', () => {
    const result = build({ title: 'x'.repeat(TITLE_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({ field: 'title', key: 'composer.validationTitleLong' });
      expect(result.issues[0].vars).toEqual({ count: TITLE_MAX_LENGTH });
    }
  });

  it('rejects an image on a video-only provider', () => {
    const result = build({ mediaKind: 'image', accounts: { youtube: ['ch-1'] } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ field: 'accounts', key: 'composer.validationImageProviders' }),
      );
    }
  });

  it('keeps only the persona bound accounts and fails when the persona has none', () => {
    const bound = emptyPersonaDefaultAccounts();
    const result = buildSubmission(
      draft({ personaId: 'p-1', accounts: { youtube: ['ch-1', 'ch-2'] }, mode: 'asap' }),
      { now: NOW, boundAccounts: bound },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ field: 'persona', key: 'composer.validationPersonaAccounts' });
    }

    bound.youtube = ['ch-2'];
    const filtered = buildSubmission(
      draft({ personaId: 'p-1', accounts: { youtube: ['ch-1', 'ch-2'] }, mode: 'asap' }),
      { now: NOW, boundAccounts: bound },
    );
    expect(filtered.ok).toBe(true);
    if (filtered.ok) expect(filtered.plan.accounts).toEqual({ youtube: ['ch-2'] });
  });

  it('requires exactly one pinterest account and a board', () => {
    const twoAccounts = build({ accounts: { pinterest: ['p-1', 'p-2'] } });
    expect(twoAccounts.ok).toBe(false);
    if (!twoAccounts.ok) {
      expect(twoAccounts.issues).toContainEqual({ field: 'board', key: 'composer.validationPinterestSingle' });
    }

    const noBoard = build({ accounts: { pinterest: ['p-1'] } });
    expect(noBoard.ok).toBe(false);
    if (!noBoard.ok) {
      expect(noBoard.issues).toContainEqual({ field: 'board', key: 'composer.validationBoard' });
    }

    const withBoard = build({ accounts: { pinterest: ['p-1'] }, pinterestBoardId: 'board-1' });
    expect(withBoard.ok).toBe(true);
    if (withBoard.ok) expect(withBoard.plan.pinterestBoardId).toBe('board-1');
  });

  it('resolves the media type from the MIME type or the extension', () => {
    expect(resolveMediaContentType({ type: 'video/mp4', name: 'clip' })).toBe('video/mp4');
    expect(resolveMediaContentType({ type: '', name: 'clip.MOV' })).toBe('video/quicktime');
    expect(resolveMediaContentType({ type: '', name: 'photo.jpeg' })).toBe('image/jpeg');
    expect(resolveMediaContentType({ type: '', name: 'notes.txt' })).toBeNull();
    expect(mediaKindOf('image/png')).toBe('image');
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaMaxBytes('image/png')).toBe(8 * 1024 * 1024);
    expect(mediaMaxBytes('video/mp4')).toBe(2 * 1024 * 1024 * 1024);
  });

  it('limits image posts to the image providers', () => {
    expect(providersForMedia('image')).toEqual([
      'instagram',
      'bluesky',
      'linkedin',
      'threads',
      'facebook',
      'pinterest',
      'telegram',
    ]);
    expect(providersForMedia('video')).toContain('youtube');
  });

  it('parses tags with commas and new lines, without duplicates', () => {
    expect(parseTags(' a, b\nc ,, a ')).toEqual(['a', 'b', 'c']);
  });

  it('keeps the publish time inside the visible bounds', () => {
    const bounds = publishAtBounds(NOW, 'UTC');
    expect(bounds.min).toBe('2026-12-01T03:00');
    expect(bounds.max).toBe('2026-12-31T00:00');
    expect(defaultPublishAt(NOW, 'UTC')).toBe('2026-12-02T00:00');
  });

  it('rejects a description over the limit', () => {
    const result = build({ description: 'x'.repeat(5001) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ field: 'description', key: 'composer.validationDescriptionLong' }),
      );
      expect(result.issues[0].vars).toEqual({ count: 5000 });
    }
  });

  it('rejects an invalid timezone', () => {
    const result = build({ timezone: 'Not/AZone' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ field: 'schedule', key: 'composer.validationTimezone' });
    }
  });

  it('rejects a publish time it cannot parse', () => {
    const result = build({ publishAt: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ field: 'schedule', key: 'composer.validationSchedule' }),
      );
    }
  });

  it('returns empty bounds for a timezone it cannot convert', () => {
    expect(defaultPublishAt(NOW, 'Bogus/Zone')).toBe('');
    expect(publishAtBounds(NOW, 'Bogus/Zone')).toEqual({ min: '', max: '' });
  });

  it('falls back to UTC when the browser timezone is missing or unreadable', () => {
    const original = Intl.DateTimeFormat;
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        DateTimeFormat: class {
          static supportedValuesOf(): string[] {
            return [];
          }
          resolvedOptions(): { timeZone?: string } {
            return { timeZone: '' };
          }
        },
      }),
    );
    try {
      expect(browserTimezone()).toBe('UTC');
    } finally {
      vi.stubGlobal('Intl', original);
    }
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        DateTimeFormat: class {
          static supportedValuesOf(): string[] {
            return [];
          }
          resolvedOptions(): { timeZone?: string } {
            return {};
          }
        },
      }),
    );
    try {
      expect(browserTimezone()).toBe('UTC');
    } finally {
      vi.stubGlobal('Intl', original);
    }
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        DateTimeFormat: class {
          resolvedOptions(): { timeZone?: string } {
            throw new Error('no intl');
          }
        },
      }),
    );
    try {
      expect(browserTimezone()).toBe('UTC');
    } finally {
      vi.stubGlobal('Intl', original);
    }
  });

  it('builds the full plan for an image post without youtube', () => {
    const result = build({
      mediaKind: 'image',
      accounts: { instagram: ['ig-1'] },
      mode: 'asap',
      caption: '  A caption  ',
      firstComment: '  First!  ',
      tags: 'vlog',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.caption).toBe('A caption');
    expect(result.plan.firstComment).toBe('First!');
    expect(result.plan.privacyStatus).toBeUndefined();
    expect(result.plan.pinterestBoardId).toBeNull();
    expect(result.plan.personaId).toBeNull();
    expect(result.plan.schedule).toBeNull();
  });

  it('keeps caption and first comment null when blank', () => {
    const result = build({ mode: 'asap', caption: '   ', firstComment: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.caption).toBeNull();
    expect(result.plan.firstComment).toBeNull();
  });

  it('resolves no content type for a file without an extension', () => {
    expect(resolveMediaContentType({ type: '', name: 'clip' })).toBeNull();
    expect(resolveMediaContentType({ type: 'application/octet-stream', name: 'clip.mp4' })).toBe('video/mp4');
  });
});

describe('post-composer compose timezones', () => {
  it('prepends UTC when the platform list omits it', async () => {
    vi.resetModules();
    const original = Intl;
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        supportedValuesOf: () => ['Europe/Lisbon'],
      }),
    );
    try {
      const mod = await import('../compose');
      expect(mod.TIMEZONES[0]).toBe('UTC');
      expect(mod.TIMEZONES).toContain('Europe/Lisbon');
    } finally {
      vi.stubGlobal('Intl', original);
      vi.resetModules();
    }
  });

  it('falls back to UTC only when the platform list is unavailable', async () => {
    vi.resetModules();
    const original = Intl;
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        supportedValuesOf: () => {
          throw new Error('no zones');
        },
      }),
    );
    try {
      const mod = await import('../compose');
      expect(mod.TIMEZONES).toEqual(['UTC']);
    } finally {
      vi.stubGlobal('Intl', original);
      vi.resetModules();
    }
  });
});
