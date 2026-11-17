//---------------
// providers — THE list of social networks Post Engineer publishes to.
//
// Every provider list in the web app, the MCP server and the OpenAPI
// generator derives from SOCIAL_PROVIDERS. Never type the list again
// anywhere else: a hand copy drifts the moment a network is added (each
// of fanvue, 3speak and rumble needed edits in about 25 copies, and the
// MCP accounts (action: connect) list silently missed pinterest).
//
// The subsets below are facts of their own (how a network connects), so
// they name their members and are checked against SOCIAL_PROVIDERS at
// compile time by `satisfies`.
//
// This file has no imports, so the OpenAPI generator (plain Node .mjs)
// can import it directly too: Node strips the types.
//---------------

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

/** Networks that connect with a credential typed by the user (Bluesky
 * app password, Hive posting key, Rumble access token), not OAuth. */
export const DIRECT_CONNECT_PROVIDERS = ['bluesky', '3speak', 'rumble'] as const satisfies readonly SocialProvider[];
export type DirectConnectProvider = (typeof DIRECT_CONNECT_PROVIDERS)[number];

/** Networks served by POST /api/account/connect-url: every network that
 * does not connect directly. */
export type OAuthConnectProvider = Exclude<SocialProvider, DirectConnectProvider>;
export const OAUTH_CONNECT_PROVIDERS: readonly OAuthConnectProvider[] = SOCIAL_PROVIDERS.filter(
  (provider): provider is OAuthConnectProvider => !(DIRECT_CONNECT_PROVIDERS as readonly string[]).includes(provider),
);

export function isOAuthConnectProvider(value: unknown): value is OAuthConnectProvider {
  return typeof value === 'string' && (OAUTH_CONNECT_PROVIDERS as readonly string[]).includes(value);
}

/** Networks whose publish handler posts an image (JPEG/PNG) as well as a
 * video. YouTube, Rumble and 3Speak are video-only platforms; Fanvue's
 * vault upload is wired for video only. */
export const IMAGE_PROVIDERS = ['instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest'] as const satisfies readonly SocialProvider[];
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export function isImageProvider(value: unknown): value is ImageProvider {
  return typeof value === 'string' && (IMAGE_PROVIDERS as readonly string[]).includes(value);
}
