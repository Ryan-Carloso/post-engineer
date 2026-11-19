import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';

export type PublishProvider = SocialProvider;

export interface PublishLink {
  provider: PublishProvider;
  url: string;
}

const PROVIDERS: ReadonlySet<string> = new Set<PublishProvider>(SOCIAL_PROVIDERS);

export function isPublishProvider(value: unknown): value is PublishProvider {
  return typeof value === 'string' && PROVIDERS.has(value);
}

function isHttpsUrl(value: string): boolean {
  return value.startsWith('https://');
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function blueskyPostUrl(postId: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(postId);
  if (!match) return null;
  const [, did, rkey] = match;
  if (!did || !rkey) return null;
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

function linkedinPostUrl(postId: string): string | null {
  if (!postId.startsWith('urn:li:')) return null;
  return `https://www.linkedin.com/feed/update/${postId}`;
}

function pinterestPostUrl(postId: string): string | null {
  if (!/^[0-9]+$/.exec(postId)) return null;
  return `https://www.pinterest.com/pin/${postId}/`;
}

const POST_URL_FROM_ID: Record<SocialProvider, ((postId: string) => string | null) | null> = {
  youtube: null,
  instagram: null,
  bluesky: blueskyPostUrl,
  linkedin: linkedinPostUrl,
  threads: null,
  facebook: null,
  pinterest: pinterestPostUrl,
  '3speak': null,
  rumble: null,
  fanvue: null,
};

export function resolvePublishLinks(
  publishResults: unknown,
): PublishLink[] {
  if (!Array.isArray(publishResults)) return [];

  const links: PublishLink[] = [];
  for (const entry of publishResults) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    if (record.status === 'failed') continue;

    const provider = readString(record, 'provider');
    if (provider === null || !PROVIDERS.has(provider)) continue;

    const typed = provider as PublishProvider;
    const direct = readString(record, 'videoUrl') ?? readString(record, 'permalink');
    if (direct !== null) {
      if (isHttpsUrl(direct)) links.push({ provider: typed, url: direct });
      continue;
    }

    const postId = readString(record, 'postId');
    if (postId === null) continue;
    const derive = POST_URL_FROM_ID[typed];
    const derived = derive === null ? null : derive(postId);
    if (derived !== null && isHttpsUrl(derived)) links.push({ provider: typed, url: derived });
  }
  return links;
}