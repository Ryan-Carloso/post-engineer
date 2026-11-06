//---------------
// Account card display diagnostics — the facts PostHog gets so a clipped
// name can be told apart from a missing one.
//---------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import {
  ACCOUNT_CARD_DISPLAY_EVENT,
  ACCOUNT_DISCONNECT_FAILED_EVENT,
  ACCOUNT_LIST_FAILED_EVENT,
  ACCOUNT_NAME_FALLBACKS,
  THUMBNAIL_HOST_ALLOWLIST,
  THUMBNAIL_HOST_SUFFIXES,
  buildAccountCardDisplayReport,
  pictureUrlExpired,
  thumbnailHostAllowed,
  type AccountCardDisplayInput,
} from '@/lib/account-display-diagnostics';

vi.mock('@/lib/client-analytics', () => ({
  trackClientEvent: vi.fn(),
}));

import { trackClientEvent } from '@/lib/client-analytics';
import {
  reportAccountCardDisplay,
  reportAccountDisconnectFailed,
  reportAccountListFailed,
} from '@/lib/account-card-telemetry';

const repoRoot = findRepoRoot(import.meta.url);

function input(overrides: Partial<AccountCardDisplayInput> = {}): AccountCardDisplayInput {
  return {
    provider: 'youtube',
    shownLabel: 'Europe on the Road',
    secondaryLabel: '@by-ryan',
    thumbnailUrl: 'https://yt3.ggpht.com/avatar.jpg',
    thumbnailFailed: false,
    compact: false,
    labelEl: { clientWidth: 80, scrollWidth: 220 },
    secondaryEl: { clientWidth: 120, scrollWidth: 70 },
    cardEl: { clientWidth: 280 },
    viewport: { width: 1100, height: 800 },
    ...overrides,
  };
}

describe('buildAccountCardDisplayReport', () => {
  it('records a CSS clip: the stored title is longer than the slot', () => {
    const report = buildAccountCardDisplayReport(input());
    expect(report.shown_label).toBe('Europe on the Road');
    expect(report.shown_label_length).toBe('Europe on the Road'.length);
    expect(report.secondary_label).toBe('@by-ryan');
    expect(report.label_truncated).toBe(true);
    expect(report.secondary_truncated).toBe(false);
    expect(report.label_client_width).toBe(80);
    expect(report.label_scroll_width).toBe(220);
    expect(report.card_width).toBe(280);
    expect(report.viewport_width).toBe(1100);
    expect(report.reasons).toContain('label_truncated');
    expect(report.name_is_fallback).toBe(false);
    expect(report.thumbnail_host).toBe('yt3.ggpht.com');
    expect(report.thumbnail_host_allowed).toBe(true);
    expect(report.thumbnail_present).toBe(true);
  });

  it('flags the YouTube, Instagram and Bluesky empty-name fallbacks', () => {
    expect(buildAccountCardDisplayReport(input({
      shownLabel: ACCOUNT_NAME_FALLBACKS.youtube,
      secondaryLabel: null,
      thumbnailUrl: null,
      labelEl: { clientWidth: 80, scrollWidth: 140 },
    })).reasons).toEqual(expect.arrayContaining(['name_fallback', 'secondary_missing', 'thumbnail_missing', 'label_truncated']));

    const instagram = buildAccountCardDisplayReport(input({
      provider: 'instagram',
      shownLabel: `@${ACCOUNT_NAME_FALLBACKS.instagram}`,
      secondaryLabel: null,
      thumbnailUrl: null,
      labelEl: null,
    }));
    expect(instagram.name_is_fallback).toBe(true);
    expect(instagram.reasons).toContain('name_fallback');

    expect(buildAccountCardDisplayReport(input({
      provider: 'bluesky',
      shownLabel: ACCOUNT_NAME_FALLBACKS.bluesky,
      secondaryLabel: null,
      thumbnailUrl: null,
      labelEl: null,
    })).name_is_fallback).toBe(true);
  });

  it('flags an Instagram display name that the card does not paint', () => {
    const report = buildAccountCardDisplayReport(input({
      provider: 'instagram',
      shownLabel: '@viajar_europa',
      secondaryLabel: null,
      storedDisplayName: 'Europa na Estrada',
      thumbnailUrl: null,
      labelEl: { clientWidth: 70, scrollWidth: 160 },
    }));
    expect(report.stored_display_name).toBe('Europa na Estrada');
    expect(report.display_name_not_rendered).toBe(true);
    expect(report.reasons).toContain('display_name_not_rendered');
  });

  it('does not flag a display name that is already inside the shown label', () => {
    const report = buildAccountCardDisplayReport(input({
      provider: 'instagram',
      shownLabel: '@viajar_europa',
      storedDisplayName: 'viajar_europa',
      secondaryLabel: null,
      thumbnailUrl: null,
      labelEl: null,
    }));
    expect(report.display_name_not_rendered).toBe(false);
  });

  it('flags a blocked image host, a failed load, and an expired Instagram URL without sending the URL', () => {
    // The facebook CDN hosts are allowed (next.config.ts matches `**.fbcdn.net`),
    // so an unknown host is what the blocked flag covers.
    const url = 'https://scontent.xx.fbcdn.net/v/pic.jpg?oe=1&access_token=secret-token';
    const report = buildAccountCardDisplayReport(input({
      provider: 'instagram',
      shownLabel: '@insta.travel',
      secondaryLabel: null,
      thumbnailUrl: url,
      thumbnailFailed: true,
      labelEl: null,
    }));
    expect(report.thumbnail_host).toBe('scontent.xx.fbcdn.net');
    expect(report.thumbnail_host_allowed).toBe(true);
    expect(report.thumbnail_failed).toBe(true);
    expect(report.thumbnail_present).toBe(false);
    expect(report.thumbnail_url_expired).toBe(true);
    expect(report.reasons).toEqual(expect.arrayContaining([
      'thumbnail_failed',
      'thumbnail_url_expired',
      'secondary_missing',
    ]));
    expect(JSON.stringify(report)).not.toContain('secret-token');
  });

  it('flags an unknown image host as blocked without sending the URL', () => {
    const report = buildAccountCardDisplayReport(input({
      provider: 'instagram',
      shownLabel: '@insta.travel',
      secondaryLabel: null,
      thumbnailUrl: 'https://images.example.com/pic.jpg',
      thumbnailFailed: false,
      labelEl: null,
    }));
    expect(report.thumbnail_host_allowed).toBe(false);
    expect(report.reasons).toContain('thumbnail_host_blocked');
    expect(JSON.stringify(report)).not.toContain('pic.jpg');
  });

  it('treats a future oe timestamp as not expired and ignores a missing oe', () => {
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const url = `https://scontent.cdninstagram.com/pic.jpg?oe=${future.toString(16)}`;
    expect(pictureUrlExpired(url)).toBe(false);
    expect(thumbnailHostAllowed('scontent.cdninstagram.com')).toBe(true);
    expect(pictureUrlExpired('https://yt3.ggpht.com/a.jpg')).toBe(false);
    expect(pictureUrlExpired('not a url')).toBe(false);
  });

  it('flags a provider id used as the only label', () => {
    const report = buildAccountCardDisplayReport(input({
      provider: 'threads',
      shownLabel: '1234567890',
      secondaryLabel: null,
      thumbnailUrl: null,
      labelOrigin: 'provider_id',
      labelEl: null,
    }));
    expect(report.label_is_provider_id).toBe(true);
    expect(report.reasons).toContain('label_is_provider_id');
  });

  it('does not call a short label truncated', () => {
    const report = buildAccountCardDisplayReport(input({
      shownLabel: 'Ch1',
      labelEl: { clientWidth: 200, scrollWidth: 40 },
      secondaryEl: null,
    }));
    expect(report.label_truncated).toBe(false);
    expect(report.reasons).not.toContain('label_truncated');
  });
});

describe('reportAccountCardDisplay', () => {
  beforeEach(() => {
    vi.mocked(trackClientEvent).mockClear();
  });

  it('sends account_card_displayed once per diagnosis', () => {
    const card = input({ shownLabel: 'dedupe-channel' });
    reportAccountCardDisplay(card);
    reportAccountCardDisplay(card);
    expect(trackClientEvent).toHaveBeenCalledTimes(1);
    expect(trackClientEvent).toHaveBeenCalledWith(
      ACCOUNT_CARD_DISPLAY_EVENT,
      expect.objectContaining({ shown_label: 'dedupe-channel', label_truncated: true }),
    );
  });

  it('sends again when the clip state changes', () => {
    reportAccountCardDisplay(input({
      shownLabel: 'resize-channel',
      labelEl: { clientWidth: 200, scrollWidth: 40 },
    }));
    reportAccountCardDisplay(input({
      shownLabel: 'resize-channel',
      labelEl: { clientWidth: 40, scrollWidth: 200 },
    }));
    expect(trackClientEvent).toHaveBeenCalledTimes(2);
  });

  it('skips compact cards', () => {
    reportAccountCardDisplay(input({ shownLabel: 'compact-channel', compact: true }));
    expect(trackClientEvent).not.toHaveBeenCalled();
  });
});

describe('account failure events', () => {
  beforeEach(() => {
    vi.mocked(trackClientEvent).mockClear();
  });

  it('sends a disconnect failure once per provider and outcome', () => {
    reportAccountDisconnectFailed('youtube', 'threw');
    reportAccountDisconnectFailed('youtube', 'threw');
    reportAccountDisconnectFailed('youtube', 'rejected');
    expect(trackClientEvent).toHaveBeenNthCalledWith(1, ACCOUNT_DISCONNECT_FAILED_EVENT, {
      provider: 'youtube',
      outcome: 'threw',
    });
    expect(trackClientEvent).toHaveBeenNthCalledWith(2, ACCOUNT_DISCONNECT_FAILED_EVENT, {
      provider: 'youtube',
      outcome: 'rejected',
    });
  });

  it('sends a list failure once per provider and message', () => {
    reportAccountListFailed('instagram', 'list failed');
    reportAccountListFailed('instagram', 'list failed');
    expect(trackClientEvent).toHaveBeenCalledTimes(1);
    expect(trackClientEvent).toHaveBeenCalledWith(ACCOUNT_LIST_FAILED_EVENT, {
      provider: 'instagram',
      message: 'list failed',
    });
  });
});

describe('diagnostic literals stay aligned with the app', () => {
  it('pins empty-name fallbacks to the provider registry', () => {
    const registry = readFileSync(path.join(repoRoot, 'apps/web/lib/providers/registry.ts'), 'utf8');
    expect(registry).toContain(`export const YOUTUBE_CHANNEL_NAME_FALLBACK = '${ACCOUNT_NAME_FALLBACKS.youtube}'`);
    expect(registry).toContain(`export const INSTAGRAM_USERNAME_FALLBACK = '${ACCOUNT_NAME_FALLBACKS.instagram}'`);
    expect(registry).toContain(`channelName: record.accountName || YOUTUBE_CHANNEL_NAME_FALLBACK`);
    expect(registry).toContain(`username: record.accountName || INSTAGRAM_USERNAME_FALLBACK`);
    expect(registry).toContain(`handle: record.accountName ?? '${ACCOUNT_NAME_FALLBACKS.bluesky}'`);
  });

  it('pins thumbnail hosts to next.config.ts and the account route resyncs via the shared sync module', () => {
    const config = readFileSync(path.join(repoRoot, 'apps/web/next.config.ts'), 'utf8');
    const hosts = [...config.matchAll(/hostname:\s*'([^']+)'/g)].map((match) => match[1]);
    const wildcardHosts = THUMBNAIL_HOST_SUFFIXES.map((suffix) => `**${suffix}`);
    expect([...hosts].sort()).toEqual([...THUMBNAIL_HOST_ALLOWLIST, ...wildcardHosts].sort());
    const route = readFileSync(path.join(repoRoot, 'apps/web/app/api/account/route.ts'), 'utf8');
    expect(route).toContain("from '@/lib/account-profile-sync'");
    expect(route).not.toContain('parseInt(oe');
  });
});
