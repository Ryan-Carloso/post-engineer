import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';
import { OAUTH_CONNECT_PROVIDERS, SOCIAL_PROVIDERS } from './providers.js';

const ACCOUNT_SYNC_STATUSES = ['ok', 'error'] as const;

const accountStatus = z.enum(ACCOUNT_SYNC_STATUSES).optional();
const accountTimestamps = { connectedAt: z.number(), lastUsed: z.number(), status: accountStatus };

const YoutubeAccountSchema = z.object({
  provider: z.literal('youtube'),
  recordId: z.string(),
  channelId: z.string(),
  channelName: z.string(),
  email: z.string().optional(),
  thumbnail: z.string().optional(),
  customUrl: z.string().optional(),
  ...accountTimestamps,
  statistics: z
    .object({
      subscriberCount: z.string().optional(),
      viewCount: z.string().optional(),
      videoCount: z.string().optional(),
      hiddenSubscriberCount: z.boolean().optional(),
    })
    .optional(),
});

const InstagramAccountSchema = z.object({
  provider: z.literal('instagram'),
  recordId: z.string(),
  igUserId: z.string(),
  username: z.string(),
  name: z.string().optional(),
  profilePictureUrl: z.string().optional(),
  followersCount: z.number().optional(),
  mediaCount: z.number().optional(),
  ...accountTimestamps,
});

const BlueskyAccountSchema = z.object({
  provider: z.literal('bluesky'),
  recordId: z.string(),
  did: z.string(),
  handle: z.string(),
  displayName: z.string().optional(),
  avatar: z.string().optional(),
  ...accountTimestamps,
});

const LinkedinAccountSchema = z.object({
  provider: z.literal('linkedin'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  accountMetadata: z
    .object({ kind: z.enum(['member', 'organization']).optional(), name: z.string().nullable().optional() })
    .optional(),
  profilePictureUrl: z.string().optional(),
  ...accountTimestamps,
});

const ThreadsAccountSchema = z.object({
  provider: z.literal('threads'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  profilePictureUrl: z.string().optional(),
  ...accountTimestamps,
});

const FacebookAccountSchema = z.object({
  provider: z.literal('facebook'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  profilePictureUrl: z.string().optional(),
  category: z.string().optional(),
  followersCount: z.number().optional(),
  ...accountTimestamps,
});

const PinterestAccountSchema = z.object({
  provider: z.literal('pinterest'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  profilePictureUrl: z.string().optional(),
  ...accountTimestamps,
});

const ThreespeakAccountSchema = z.object({
  provider: z.literal('3speak'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  ...accountTimestamps,
});

const RumbleAccountSchema = z.object({
  provider: z.literal('rumble'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  ...accountTimestamps,
});

const FanvueAccountSchema = z.object({
  provider: z.literal('fanvue'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  profilePictureUrl: z.string().optional(),
  ...accountTimestamps,
});

const TelegramAccountSchema = z.object({
  provider: z.literal('telegram'),
  recordId: z.string(),
  providerAccountId: z.string(),
  accountName: z.string().nullable(),
  chatType: z.enum(['channel', 'group', 'supergroup']).optional(),
  username: z.string().optional(),
  botUsername: z.string().optional(),
  ...accountTimestamps,
});

export const PublicAccountItemSchema = z.discriminatedUnion('provider', [
  YoutubeAccountSchema,
  InstagramAccountSchema,
  BlueskyAccountSchema,
  LinkedinAccountSchema,
  ThreadsAccountSchema,
  FacebookAccountSchema,
  PinterestAccountSchema,
  ThreespeakAccountSchema,
  RumbleAccountSchema,
  FanvueAccountSchema,
  TelegramAccountSchema,
]);
export type PublicAccountItem = z.infer<typeof PublicAccountItemSchema>;

function nonBlank(message: string) {
  return z
    .string()
    .min(1, message)
    .refine((value) => value.trim().length > 0, { message });
}

const ConnectUrlBodySchema = z.object({
  provider: z.enum(OAUTH_CONNECT_PROVIDERS),
});

export const BlueskyConnectBodySchema = z.object({
  handle: nonBlank('Bluesky handle is required.'),
  appPassword: nonBlank('Bluesky app password is required.'),
});

export const ThreespeakConnectBodySchema = z.object({
  username: nonBlank('Hive username is required.'),
  postingKey: nonBlank('Hive posting key is required.'),
});

export const RumbleConnectBodySchema = z.object({
  channelId: nonBlank('Rumble channel ID is required.'),
  accessToken: nonBlank('Rumble access token is required.'),
});

export const TelegramConnectBodySchema = z.object({
  botToken: nonBlank('Telegram bot token is required.'),
  chatId: nonBlank('Telegram chat ID or @username is required.'),
  chatType: z.enum(['channel', 'group'], {
    error: () => 'chatType must be channel or group.',
  }),
});

const DisconnectAccountQuerySchema = z.strictObject({
  provider: z.string(),
  providerAccountId: z.string(),
});

const ListPinterestBoardsQuerySchema = z.strictObject({
  accountId: z.string(),
});

const GetPersonaPublishingAccountsQuerySchema = z.strictObject({
  personaId: z.string(),
});

export const SetPersonaPublishingAccountsBodySchema = z.object({
  accounts: z.record(z.string(), z.array(z.string().min(1))),
});

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDisconnectAccountQuery(params: URLSearchParams): {
  ok: true;
  query: { provider: string; providerAccountId: string };
} | { ok: false; error: string; code: 'INVALID_PARAMS' | 'INVALID_PROVIDER' } {
  const provider = params.get('provider');
  const providerAccountId = params.get('providerAccountId');
  if (!provider || !providerAccountId) {
    return { ok: false, error: 'provider and providerAccountId are required.', code: 'INVALID_PARAMS' };
  }
  if (!SOCIAL_PROVIDERS.includes(provider as (typeof SOCIAL_PROVIDERS)[number])) {
    return { ok: false, error: 'Unknown provider.', code: 'INVALID_PROVIDER' };
  }
  return { ok: true, query: { provider, providerAccountId } };
}

export const ACCOUNT_PROFILE_REFRESH_PARAM = 'refresh';

export function parseListAccountsQuery(params: URLSearchParams): {
  ok: true;
  refresh: boolean;
} | { ok: false; error: string; code: 'INVALID_PARAMS' } {
  const values = params.getAll(ACCOUNT_PROFILE_REFRESH_PARAM);
  if (values.length === 0) return { ok: true, refresh: false };
  if (values.length === 1 && values[0] === '1') return { ok: true, refresh: true };
  return { ok: false, error: 'refresh must be 1 when present.', code: 'INVALID_PARAMS' };
}

export function parseListPinterestBoardsQuery(params: URLSearchParams): { ok: true; accountId: string } | { ok: false; error: string } {
  const accountId = params.get('accountId');
  if (accountId === null || accountId.trim() === '') {
    return { ok: false, error: 'accountId is required.' };
  }
  return { ok: true, accountId: accountId.trim() };
}

export function parsePersonaPublishingAccountsQuery(params: URLSearchParams): { ok: true; personaId: string } | { ok: false; error: string } {
  const personaId = params.get('personaId');
  if (!personaId) return { ok: false, error: 'personaId is required.' };
  if (!UUID_SHAPE.test(personaId)) return { ok: false, error: 'personaId must be a UUID.' };
  return { ok: true, personaId };
}

export const ListSocialAccountsResponseSchema = z.object({
  authenticated: z.literal(true),
  accounts: z.array(PublicAccountItemSchema),
  message: z.string(),
});

export const DisconnectAccountResponseSchema = z.object({
  success: z.literal(true),
});

export const ConnectUrlResponseSchema = z.object({
  success: z.literal(true),
  auth_url: z.string(),
});
export type ConnectUrlResponse = z.infer<typeof ConnectUrlResponseSchema>;

export const BlueskyConnectResponseSchema = z.object({
  success: z.literal(true),
  accountId: z.string(),
  did: z.string(),
});

export const ThreespeakConnectResponseSchema = z.object({
  success: z.literal(true),
  accountId: z.string(),
  username: z.string(),
});

export const RumbleConnectResponseSchema = z.object({
  success: z.literal(true),
  accountId: z.string(),
  channelId: z.string(),
});

export const TelegramConnectResponseSchema = z.object({
  success: z.literal(true),
  accountId: z.string(),
  chatId: z.string(),
  chatType: z.enum(['channel', 'group', 'supergroup']),
  title: z.string(),
});

const PinterestBoardSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type PinterestBoard = z.infer<typeof PinterestBoardSchema>;

export const ListPinterestBoardsResponseSchema = z.object({
  success: z.literal(true),
  boards: z.array(PinterestBoardSchema),
});

export const PersonaPublishingAccountsSchema = z.object({
  youtube: z.array(z.string()),
  instagram: z.array(z.string()),
  bluesky: z.array(z.string()),
  linkedin: z.array(z.string()),
  threads: z.array(z.string()),
  facebook: z.array(z.string()),
  pinterest: z.array(z.string()),
  '3speak': z.array(z.string()),
  rumble: z.array(z.string()),
  fanvue: z.array(z.string()),
  telegram: z.array(z.string()),
});

export const PersonaPublishingAccountsResponseSchema = z.object({
  success: z.literal(true),
  defaults: PersonaPublishingAccountsSchema,
});

export const listSocialAccounts = defineEndpoint({
  method: 'GET',
  path: '/api/account',
  response: ListSocialAccountsResponseSchema,
});

export const disconnectAccount = defineEndpoint({
  method: 'DELETE',
  path: '/api/account',
  query: DisconnectAccountQuerySchema,
  response: DisconnectAccountResponseSchema,
});

export const getOAuthConnectUrl = defineEndpoint({
  method: 'POST',
  path: '/api/account/connect-url',
  body: ConnectUrlBodySchema,
  response: ConnectUrlResponseSchema,
});

export const connectBlueskyAccount = defineEndpoint({
  method: 'POST',
  path: '/api/bluesky-connect',
  body: BlueskyConnectBodySchema,
  response: BlueskyConnectResponseSchema,
});

export const connectThreespeakAccount = defineEndpoint({
  method: 'POST',
  path: '/api/threespeak-connect',
  body: ThreespeakConnectBodySchema,
  response: ThreespeakConnectResponseSchema,
});

export const connectRumbleAccount = defineEndpoint({
  method: 'POST',
  path: '/api/rumble-connect',
  body: RumbleConnectBodySchema,
  response: RumbleConnectResponseSchema,
});

export const connectTelegramAccount = defineEndpoint({
  method: 'POST',
  path: '/api/telegram-connect',
  body: TelegramConnectBodySchema,
  response: TelegramConnectResponseSchema,
});

export const listPinterestBoards = defineEndpoint({
  method: 'GET',
  path: '/api/pinterest/boards',
  query: ListPinterestBoardsQuerySchema,
  response: ListPinterestBoardsResponseSchema,
});

export const getPersonaPublishingAccounts = defineEndpoint({
  method: 'GET',
  path: '/api/persona/publishing-accounts',
  query: GetPersonaPublishingAccountsQuerySchema,
  response: PersonaPublishingAccountsResponseSchema,
});

export const setPersonaPublishingAccounts = defineEndpoint({
  method: 'PUT',
  path: '/api/persona/publishing-accounts',
  query: GetPersonaPublishingAccountsQuerySchema,
  body: SetPersonaPublishingAccountsBodySchema,
  response: PersonaPublishingAccountsResponseSchema,
});
