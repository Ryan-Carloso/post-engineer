//---------------
// publish-links — turn the engine's publish_results into clickable links.
//
// The engine (task_publish.py) records one entry per (provider, video) it
// published, and each entry carries whatever that provider handed back:
//
//   youtube   → videoUrl   ready-made watch URL
//   instagram → permalink  ready-made post URL
//   bluesky   → postId     at://<did>/app.bsky.feed.post/<rkey>
//   linkedin  → postId     urn:li:share:<id>  (no public URL is returned)
//
// So two providers arrive with a URL and two need one derived. A provider
// entry with neither is omitted rather than rendered as a dead link.
//
// Dependency-free on purpose: the detail page and the card both read this,
// and it must stay safe to import from a client component.
//---------------

export type PublishProvider = 'youtube' | 'instagram' | 'bluesky' | 'linkedin';

export interface PublishLink {
  provider: PublishProvider;
  url: string;
}

const PROVIDERS: ReadonlySet<string> = new Set<PublishProvider>([
  'youtube',
  'instagram',
  'bluesky',
  'linkedin',
]);

//---------------
// isHttpsUrl — a link rendered into an href is an injection surface, so
// only absolute https URLs from a known provider may reach the DOM. This
// is what keeps a "javascript:" or "http:" value in the payload from
// becoming a clickable link.
//---------------
function isHttpsUrl(value: string): boolean {
  return value.startsWith('https://');
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

//---------------
// blueskyPostUrl — at://<did>/app.bsky.feed.post/<rkey> becomes
// https://bsky.app/profile/<did>/post/<rkey>. Anything that does not match
// exactly (a bare handle, a missing rkey) yields null rather than a URL
// that 404s.
//---------------
function blueskyPostUrl(postId: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(postId);
  if (!match) return null;
  const [, did, rkey] = match;
  if (!did || !rkey) return null;
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

//---------------
// linkedinPostUrl — LinkedIn's API returns no public post URL, so the share
// URN is turned into its feed form. Accepted trade-off: an organization
// post is private by default, so the link can resolve to a login/404 while
// the URN itself stays the useful part of the value.
//---------------
function linkedinPostUrl(postId: string): string | null {
  if (!postId.startsWith('urn:li:')) return null;
  return `https://www.linkedin.com/feed/update/${postId}`;
}

//---------------
// resolvePublishLinks — map the engine's raw entries to links, dropping
// anything malformed. Returns [] rather than throwing: this runs during
// render and must never take the post detail page down.
//---------------
export function resolvePublishLinks(
  publishResults: unknown,
): PublishLink[] {
  if (!Array.isArray(publishResults)) return [];

  const links: PublishLink[] = [];
  for (const entry of publishResults) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const provider = readString(record, 'provider');
    if (provider === null || !PROVIDERS.has(provider)) continue;

    const typed = provider as PublishProvider;
    // Prefer the provider's own URL; fall back to deriving one from the id.
    const direct = readString(record, 'videoUrl') ?? readString(record, 'permalink');
    if (direct !== null) {
      if (isHttpsUrl(direct)) links.push({ provider: typed, url: direct });
      continue;
    }

    const postId = readString(record, 'postId');
    if (postId === null) continue;
    const derived =
      typed === 'bluesky'
        ? blueskyPostUrl(postId)
        : typed === 'linkedin'
          ? linkedinPostUrl(postId)
          : null;
    if (derived !== null && isHttpsUrl(derived)) links.push({ provider: typed, url: derived });
  }
  return links;
}