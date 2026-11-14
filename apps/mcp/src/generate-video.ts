import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { getPersonaPublishingAccounts } from './client-publishing-accounts.js';
import { getErrorMessage } from './errors.js';
import { BATCH_FREE_EVERY, BATCH_KEY_MAX_LENGTH, BATCH_KEY_PATTERN, BATCH_WINDOW_MINUTES, MAX_BATCH_VIDEOS } from './limits.js';
import { createRefResolvers, type RefResolvers } from './refs.js';
import { GeneratePersonaVideoSchema, GeneratePersonaVideoShape } from './single-video-shape.js';
import type { McpToolResponse } from './tools-call.js';
import { handleGeneratePersonaVideoBatch } from './tools-batch.js';
import { generatePersonaVideoOutcome } from './tools-single-video.js';

//---------------
// generate_video (issue #566): one intent, one call. Replaces
// generate_persona_video and generate_persona_video_batch.
//
// `videos` holds 1..MAX_BATCH_VIDEOS videos. One video is generated and
// scheduled as before; several are a batch (every BATCH_FREE_EVERY face
// videos, the cheapest is free). The agent gives a persona and the accounts
// by name or id and the tool resolves them (refs.ts): every reference of
// every video is resolved BEFORE the first video is created, so an unknown
// or ambiguous reference never leaves a half-created batch. What was
// resolved, and which accounts the video publishes to by default, is echoed
// back in the result.
//---------------

const PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', 'fanvue', '3speak', 'rumble'] as const;
type Provider = (typeof PROVIDERS)[number];

// Where each provider's account ids go in the web request (the per-provider arrays the route reads).
const ACCOUNT_FIELD: Record<Provider, string> = {
  youtube: 'youtubeAccountIds',
  instagram: 'instagramAccountIds',
  linkedin: 'linkedinAccountIds',
  bluesky: 'blueskyAccountIds',
  threads: 'threadsAccountIds',
  facebook: 'facebookAccountIds',
  pinterest: 'pinterestAccountIds',
  fanvue: 'fanvueAccountIds',
  '3speak': 'threespeakAccountIds',
  rumble: 'rumbleAccountIds',
};

const OMITTED_PER_VIDEO = {
  personaId: true,
  youtubeAccountIds: true,
  instagramAccountIds: true,
  linkedinAccountIds: true,
  blueskyAccountIds: true,
  threadsAccountIds: true,
  facebookAccountIds: true,
  pinterestAccountIds: true,
  fanvueAccountIds: true,
  threespeakAccountIds: true,
  rumbleAccountIds: true,
  providers: true,
  idempotencyKey: true,
  recipe: true,
} as const;

export const GenerateVideoItemSchema = z
  .object(GeneratePersonaVideoShape)
  .omit(OMITTED_PER_VIDEO)
  .extend({
    persona: z.string().min(1).optional().describe('The persona, by name or id. Omit for a faceless post with no persona: then set options.videoType to \'faceless\' and options.voiceId (or options.audioUrl).'),
    providers: z.array(z.enum(PROVIDERS)).min(1).optional().describe('Networks to publish to. Omit to use the networks of `accounts`, or of the persona\'s bound publishing accounts when `accounts` is omitted too.'),
    accounts: z.array(z.string().min(1)).optional().describe('Accounts to publish to, each an account name or id from accounts (the network is read from the account). Omit for the persona\'s bound publishing accounts.'),
  })
  .strict();

export const GenerateVideoShape = {
  videos: z
    .array(GenerateVideoItemSchema)
    .min(1, 'Provide at least one video')
    .max(MAX_BATCH_VIDEOS, `At most ${MAX_BATCH_VIDEOS} videos per call`)
    .describe(`The videos: one is generated and scheduled right away, 2-${MAX_BATCH_VIDEOS} are a batch.`),
  batchKey: z
    .string()
    .min(1)
    .max(BATCH_KEY_MAX_LENGTH)
    .regex(BATCH_KEY_PATTERN, 'batchKey may only contain letters, digits, "-" and "_".')
    .optional()
    .describe('Required with 2+ videos, rejected with one. A name unique per batch; reuse it with the same videos in the same order to retry (created videos replay, no second charge).'),
  idempotencyKey: GeneratePersonaVideoShape.idempotencyKey.describe('One video only: retrying with the same key returns the original schedule (replayed: true).'),
  recipe: GeneratePersonaVideoShape.recipe,
};

export const GenerateVideoSchema = z.object(GenerateVideoShape);
export type GenerateVideoArgs = z.infer<typeof GenerateVideoSchema>;
type GenerateVideoItem = z.infer<typeof GenerateVideoItemSchema>;
type LegacyVideo = z.infer<typeof GeneratePersonaVideoSchema>;

export const GenerateVideoDescription =
  `Generate and schedule persona videos from complete scripts: one video, or a batch of 2-${MAX_BATCH_VIDEOS} (every ${BATCH_FREE_EVERY} videos with the persona face, the cheapest is free; faceless videos pay full price and are never free; all videos are created within ${BATCH_WINDOW_MINUTES} minutes). Charges prepaid tokens. Give persona and accounts by name or id: they are resolved here, and an unknown or ambiguous name creates nothing. Omit accounts to publish to the persona's bound accounts. The result echoes what was resolved. Then wait with video_tasks status. Writing the script: call prompts list first for a topic, and check_script validate before spending tokens.`;

function failure(message: string): McpToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function withVideoPrefix(response: McpToolResponse, index: number, total: number): McpToolResponse {
  if (total === 1) return response;
  const [first, ...rest] = response.content;
  const prefix = `Video ${index + 1} of ${total}: `;
  return { ...response, content: first?.type === 'text' ? [{ ...first, text: `${prefix}${first.text}` }, ...rest] : [{ type: 'text', text: prefix.trim() }, ...response.content] };
}

export interface PreparedVideo {
  video: LegacyVideo;
  note: string;
}

/** The persona's bound accounts per provider, from GET /api/persona/publishing-accounts. */
async function boundAccounts(client: PostEngineerClient, personaId: string): Promise<Map<Provider, string[]>> {
  const payload = await getPersonaPublishingAccounts(client, personaId);
  const defaults = typeof payload === 'object' && payload !== null ? (payload as { defaults?: unknown }).defaults : undefined;
  const bound = new Map<Provider, string[]>();
  if (typeof defaults !== 'object' || defaults === null) return bound;
  for (const provider of PROVIDERS) {
    const ids = (defaults as Record<string, unknown>)[provider];
    if (Array.isArray(ids) && ids.length > 0) bound.set(provider, ids.filter((id): id is string => typeof id === 'string'));
  }
  return bound;
}

export async function prepareVideo(
  client: PostEngineerClient,
  resolvers: RefResolvers,
  item: GenerateVideoItem,
): Promise<{ kind: 'ok'; prepared: PreparedVideo } | { kind: 'response'; response: McpToolResponse }> {
  const { persona, providers: explicitProviders, accounts: accountRefs, ...rest } = item;
  const notes: string[] = [];

  let personaId: string | undefined;
  if (persona !== undefined) {
    const outcome = await resolvers.persona(persona);
    if (outcome.kind === 'response') return outcome;
    personaId = outcome.value.id;
    notes.push(`persona ${outcome.value.name === null ? personaId : `"${outcome.value.name}" → ${personaId}`}`);
  }

  const accountIds = new Map<Provider, string[]>();
  for (const ref of accountRefs ?? []) {
    const outcome = await resolvers.account(ref);
    if (outcome.kind === 'response') return outcome;
    const provider = outcome.value.provider as Provider;
    if (explicitProviders !== undefined && !explicitProviders.includes(provider)) {
      return { kind: 'response', response: failure(`Account "${ref}" is on ${provider}, which is not in providers (${explicitProviders.join(', ')}). Add ${provider} to providers or drop that account.`) };
    }
    accountIds.set(provider, [...(accountIds.get(provider) ?? []), outcome.value.id]);
    notes.push(`account "${ref}" → ${provider} ${outcome.value.id}`);
  }

  let providers: Provider[];
  if (explicitProviders !== undefined) {
    providers = [...new Set(explicitProviders)];
  } else if (accountIds.size > 0) {
    providers = [...accountIds.keys()];
  } else {
    if (personaId === undefined) {
      return { kind: 'response', response: failure('A video with no persona needs providers or accounts: say where to publish it (accounts list shows your accounts).') };
    }
    let bound: Map<Provider, string[]>;
    try {
      bound = await boundAccounts(client, personaId);
    } catch (error) {
      return { kind: 'response', response: failure(`Error reading the persona's publishing accounts: ${getErrorMessage(error)}`) };
    }
    if (bound.size === 0) {
      return { kind: 'response', response: failure('The persona has no bound publishing accounts. Pass providers or accounts, or bind accounts with accounts set_persona_publishing.') };
    }
    providers = [...bound.keys()];
    notes.push(`publishing to the persona's bound accounts: ${[...bound].map(([provider, ids]) => `${provider} (${ids.join(', ')})`).join('; ')}`);
  }

  const accountArrays: Record<string, string[]> = {};
  for (const [provider, ids] of accountIds) accountArrays[ACCOUNT_FIELD[provider]] = ids;
  const video = GeneratePersonaVideoSchema.parse({ ...rest, personaId, providers, ...accountArrays });
  return { kind: 'ok', prepared: { video, note: notes.join('; ') } };
}

function echo(prepared: PreparedVideo[]): McpToolResponse['content'][number] {
  const lines = prepared.map((entry, index) => `${prepared.length === 1 ? '' : `Video ${index + 1}: `}${entry.note === '' ? 'no references to resolve' : entry.note}`);
  return { type: 'text', text: `Resolved: ${lines.join('\n')}` };
}

export async function handleGenerateVideo(client: PostEngineerClient, args: GenerateVideoArgs): Promise<McpToolResponse> {
  const { videos, batchKey, idempotencyKey } = args;
  if (videos.length > 1) {
    if (batchKey === undefined) return failure(`batchKey is required with ${videos.length} videos: name the batch (e.g. "launch-week-1") so a retry replays instead of charging again.`);
    if (idempotencyKey !== undefined) return failure('idempotencyKey is for one video. Use batchKey for a batch.');
    if (videos.some((video) => video.experiment !== undefined)) return failure('experiment is for one video at a time. Create both videos of a pair with experiments add_pair.');
  } else if (batchKey !== undefined) {
    return failure('batchKey is for a batch of 2 or more videos. Use idempotencyKey to make one video safe to retry.');
  }

  // Resolve every reference of every video before creating anything.
  const resolvers = createRefResolvers(client);
  const prepared: PreparedVideo[] = [];
  for (const [index, item] of videos.entries()) {
    const outcome = await prepareVideo(client, resolvers, item);
    if (outcome.kind === 'response') return withVideoPrefix(outcome.response, index, videos.length);
    prepared.push(outcome.prepared);
  }

  if (videos.length === 1) {
    const { response } = await generatePersonaVideoOutcome(client, { ...prepared[0].video, idempotencyKey });
    return { ...response, content: [...response.content, echo(prepared)] };
  }
  const response = await handleGeneratePersonaVideoBatch(client, {
    batchKey: batchKey as string,
    videos: prepared.map(({ video }) => {
      const { idempotencyKey: _idempotency, experiment: _experiment, recipe: _recipe, ...batchVideo } = video;
      return batchVideo;
    }),
  });
  return { ...response, content: [...response.content, echo(prepared)] };
}
