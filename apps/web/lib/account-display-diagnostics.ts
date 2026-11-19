import type { SocialProvider } from '@/lib/contracts/providers';

export const ACCOUNT_CARD_DISPLAY_EVENT = 'account_card_displayed';
export const ACCOUNT_DISCONNECT_FAILED_EVENT = 'account_disconnect_failed';
export const ACCOUNT_LIST_FAILED_EVENT = 'account_list_failed';

// Fallback labels written by lib/providers/registry.ts when accountName is
// empty; null for a network that shows the account id instead. The card
// receives the already-substituted string. A source test pins these
// literals to that file.
export const ACCOUNT_NAME_FALLBACKS = {
  youtube: 'YouTube Account',
  instagram: 'instagram_user',
  bluesky: 'bluesky.user',
  linkedin: null,
  threads: null,
  facebook: null,
  pinterest: null,
  '3speak': null,
  rumble: null,
  fanvue: null,
} as const satisfies Record<SocialProvider, string | null>;

export const THUMBNAIL_HOST_ALLOWLIST = [
  'avatars.githubusercontent.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
  'cdn.bsky.app',
  'media.licdn.com',
  'i.pinimg.com',
  'media.fanvue.com',
] as const;

export const THUMBNAIL_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'] as const;

const LABEL_CAP = 200;

export type AccountProvider = SocialProvider;

export type AccountLabelOrigin = 'stored' | 'provider_id';

export interface ElementBox {
  clientWidth: number;
  scrollWidth: number;
}

export interface AccountCardDisplayInput {
  provider: AccountProvider;
  shownLabel: string;
  secondaryLabel?: string | null;
  storedDisplayName?: string | null;
  thumbnailUrl?: string | null;
  thumbnailFailed: boolean;
  labelOrigin?: AccountLabelOrigin;
  compact: boolean;
  labelEl?: ElementBox | null;
  secondaryEl?: ElementBox | null;
  cardEl?: { clientWidth: number } | null;
  viewport?: { width: number; height: number } | null;
}

export interface AccountCardDisplayReport {
  provider: AccountProvider;
  shown_label: string;
  shown_label_length: number;
  secondary_label: string | null;
  secondary_missing: boolean;
  label_truncated: boolean;
  secondary_truncated: boolean;
  label_client_width: number | null;
  label_scroll_width: number | null;
  secondary_client_width: number | null;
  secondary_scroll_width: number | null;
  card_width: number | null;
  viewport_width: number | null;
  viewport_height: number | null;
  name_is_fallback: boolean;
  label_is_provider_id: boolean;
  stored_display_name: string | null;
  display_name_not_rendered: boolean;
  thumbnail_present: boolean;
  thumbnail_failed: boolean;
  thumbnail_host: string | null;
  thumbnail_host_allowed: boolean | null;
  thumbnail_url_expired: boolean;
  compact: boolean;
  reasons: string[];
}

function presentText(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.length === 0) return null;
  return value;
}

function cap(value: string): string {
  return value.slice(0, LABEL_CAP);
}

export function thumbnailHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function thumbnailHostAllowed(host: string): boolean {
  if ((THUMBNAIL_HOST_ALLOWLIST as readonly string[]).includes(host)) return true;
  return THUMBNAIL_HOST_SUFFIXES.some(
    (suffix) => host.endsWith(suffix) || host === suffix.slice(1),
  );
}

export function pictureUrlExpired(url: string, now = Date.now()): boolean {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (oe === null || oe.length === 0) return false;
    const expiresAtMs = Number.parseInt(oe, 16) * 1000;
    return Number.isFinite(expiresAtMs) && expiresAtMs < now;
  } catch {
    return false;
  }
}

function isTruncated(el: ElementBox | null | undefined): boolean {
  if (el === null || el === undefined) return false;
  return el.scrollWidth > el.clientWidth;
}

function nameIsFallback(provider: AccountProvider, shown: string): boolean {
  const fallback = ACCOUNT_NAME_FALLBACKS[provider];
  if (fallback === null) return false;
  // Instagram's card shows the username as a handle (@instagram_user).
  return shown === fallback || (provider === 'instagram' && shown === `@${fallback}`);
}

export function buildAccountCardDisplayReport(input: AccountCardDisplayInput): AccountCardDisplayReport {
  const shown = input.shownLabel;
  const secondary = presentText(input.secondaryLabel);
  const stored = presentText(input.storedDisplayName);
  const thumbnailUrl = presentText(input.thumbnailUrl);
  const host = thumbnailUrl === null ? null : thumbnailHost(thumbnailUrl);
  const hostAllowed = host === null ? null : thumbnailHostAllowed(host);
  const expired = thumbnailUrl !== null && pictureUrlExpired(thumbnailUrl);
  const fallback = nameIsFallback(input.provider, shown);
  const labelIsProviderId = input.labelOrigin === 'provider_id';
  const displayNameNotRendered = stored !== null && !shown.includes(stored);
  const labelTruncated = isTruncated(input.labelEl);
  const secondaryTruncated = isTruncated(input.secondaryEl);

  const reasons: string[] = [];
  if (labelTruncated) reasons.push('label_truncated');
  if (secondaryTruncated) reasons.push('secondary_truncated');
  if (secondary === null && !input.compact) reasons.push('secondary_missing');
  if (fallback) reasons.push('name_fallback');
  if (thumbnailUrl === null) reasons.push('thumbnail_missing');
  if (input.thumbnailFailed) reasons.push('thumbnail_failed');
  if (hostAllowed === false) reasons.push('thumbnail_host_blocked');
  if (expired) reasons.push('thumbnail_url_expired');
  if (displayNameNotRendered) reasons.push('display_name_not_rendered');
  if (labelIsProviderId) reasons.push('label_is_provider_id');

  return {
    provider: input.provider,
    shown_label: cap(shown),
    shown_label_length: shown.length,
    secondary_label: secondary === null ? null : cap(secondary),
    secondary_missing: secondary === null,
    label_truncated: labelTruncated,
    secondary_truncated: secondaryTruncated,
    label_client_width: input.labelEl?.clientWidth ?? null,
    label_scroll_width: input.labelEl?.scrollWidth ?? null,
    secondary_client_width: input.secondaryEl?.clientWidth ?? null,
    secondary_scroll_width: input.secondaryEl?.scrollWidth ?? null,
    card_width: input.cardEl?.clientWidth ?? null,
    viewport_width: input.viewport?.width ?? null,
    viewport_height: input.viewport?.height ?? null,
    name_is_fallback: fallback,
    label_is_provider_id: labelIsProviderId,
    stored_display_name: stored === null ? null : cap(stored),
    display_name_not_rendered: displayNameNotRendered,
    thumbnail_present: thumbnailUrl !== null && !input.thumbnailFailed,
    thumbnail_failed: input.thumbnailFailed,
    thumbnail_host: host,
    thumbnail_host_allowed: hostAllowed,
    thumbnail_url_expired: expired,
    compact: input.compact,
    reasons,
  };
}
