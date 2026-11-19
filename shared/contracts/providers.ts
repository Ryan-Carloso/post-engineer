export const SOCIAL_PROVIDERS = [
  'youtube',
  'instagram',
  'bluesky',
  'linkedin',
  'threads',
  'facebook',
  'pinterest',
  '3speak',
  'rumble',
  'fanvue',
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

export const DIRECT_CONNECT_PROVIDERS = ['bluesky', '3speak', 'rumble'] as const satisfies readonly SocialProvider[];
export type DirectConnectProvider = (typeof DIRECT_CONNECT_PROVIDERS)[number];

export type OAuthConnectProvider = Exclude<SocialProvider, DirectConnectProvider>;
export const OAUTH_CONNECT_PROVIDERS: readonly OAuthConnectProvider[] = SOCIAL_PROVIDERS.filter(
  (provider): provider is OAuthConnectProvider => !(DIRECT_CONNECT_PROVIDERS as readonly string[]).includes(provider),
);

export function isOAuthConnectProvider(value: unknown): value is OAuthConnectProvider {
  return typeof value === 'string' && (OAUTH_CONNECT_PROVIDERS as readonly string[]).includes(value);
}

export const IMAGE_PROVIDERS = ['instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest'] as const satisfies readonly SocialProvider[];
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export function isImageProvider(value: unknown): value is ImageProvider {
  return typeof value === 'string' && (IMAGE_PROVIDERS as readonly string[]).includes(value);
}

/** Networks whose publish takes a title and a description instead of a
 * caption. Every other network takes a caption (Pinterest also takes an
 * optional pin title next to it). */
export const TITLE_PROVIDERS = ['youtube', 'rumble', 'fanvue'] as const satisfies readonly SocialProvider[];
export type TitleProvider = (typeof TITLE_PROVIDERS)[number];

export function isTitleProvider(value: unknown): value is TitleProvider {
  return typeof value === 'string' && (TITLE_PROVIDERS as readonly string[]).includes(value);
}

/** The multipart field each network's account ids arrive under in
 * POST /api/upload-content. The web handlers read it, and the web
 * publish paths and the MCP direct publish write it. */
export const PUBLISH_ACCOUNT_FIELDS: Record<SocialProvider, string> = {
  youtube: 'accountIds',
  instagram: 'igAccountIds',
  bluesky: 'did',
  linkedin: 'linkedinAccountIds',
  threads: 'threadsAccountIds',
  facebook: 'facebookAccountIds',
  pinterest: 'pinterestAccountIds',
  '3speak': 'threespeakAccountIds',
  rumble: 'rumbleAccountIds',
  fanvue: 'fanvueAccountIds',
};

/** The account-id column of each network in public.schedules. */
export const SCHEDULE_ACCOUNT_COLUMNS = {
  youtube: 'youtube_account_ids',
  instagram: 'instagram_account_ids',
  bluesky: 'bluesky_account_ids',
  linkedin: 'linkedin_account_ids',
  threads: 'threads_account_ids',
  facebook: 'facebook_account_ids',
  pinterest: 'pinterest_account_ids',
  '3speak': 'threespeak_account_ids',
  rumble: 'rumble_account_ids',
  fanvue: 'fanvue_account_ids',
} as const satisfies Record<SocialProvider, string>;
