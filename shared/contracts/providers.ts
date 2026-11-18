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
