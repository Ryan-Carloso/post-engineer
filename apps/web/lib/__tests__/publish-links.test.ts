import { describe, it, expect } from 'vitest';
import { resolvePublishLinks } from '../publish-links';

//---------------
// publish-links — turn the engine's publish_results into clickable links.
//
// The engine records one entry per (provider, video) it published. Only
// YouTube and Instagram hand back a ready-made URL; Bluesky returns an
// at:// record URI and LinkedIn a bare URN, so both are derived here.
//
// A provider entry with neither a URL nor an id is omitted rather than
// rendered as a dead link — a missing link is honest, a broken one is not.
//---------------

describe('resolvePublishLinks', () => {
  it('uses the YouTube videoUrl as-is', () => {
    expect(
      resolvePublishLinks([
        { provider: 'youtube', videoUrl: 'https://www.youtube.com/watch?v=abc123' },
      ]),
    ).toEqual([
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' },
    ]);
  });

  it('uses the Instagram permalink as-is', () => {
    expect(
      resolvePublishLinks([
        { provider: 'instagram', permalink: 'https://www.instagram.com/p/XYZ/' },
      ]),
    ).toEqual([
      { provider: 'instagram', url: 'https://www.instagram.com/p/XYZ/' },
    ]);
  });

  // Bluesky returns at://<did>/app.bsky.feed.post/<rkey>; the public web
  // URL is bsky.app/profile/<did>/post/<rkey>.
  it('derives the public Bluesky URL from the at:// record URI', () => {
    expect(
      resolvePublishLinks([
        { provider: 'bluesky', postId: 'at://did:plc:abc123/app.bsky.feed.post/xyz789' },
      ]),
    ).toEqual([
      { provider: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc123/post/xyz789' },
    ]);
  });

  // LinkedIn publishes no public URL. We derive one from the share URN;
  // it can 404 for a private organization post, which is accepted (the id
  // is still the useful part) — documented so it is not read as a bug.
  it('derives a LinkedIn feed URL from the share URN', () => {
    expect(
      resolvePublishLinks([{ provider: 'linkedin', postId: 'urn:li:share:12345' }]),
    ).toEqual([
      { provider: 'linkedin', url: 'https://www.linkedin.com/feed/update/urn:li:share:12345' },
    ]);
  });

  it('omits a provider with neither a URL nor an id', () => {
    expect(resolvePublishLinks([{ provider: 'linkedin' }])).toEqual([]);
  });

  it('ignores an unknown provider', () => {
    expect(resolvePublishLinks([{ provider: 'tiktok', postId: 'x' }])).toEqual([]);
  });

  // The payload crosses a network boundary; anything malformed must degrade
  // to "no links" instead of throwing and taking the detail page down.
  it('returns no links for a non-array payload', () => {
    expect(resolvePublishLinks(null)).toEqual([]);
    expect(resolvePublishLinks('nope')).toEqual([]);
    expect(resolvePublishLinks(undefined)).toEqual([]);
  });

  it('ignores entries whose fields are not strings', () => {
    expect(resolvePublishLinks([{ provider: 'youtube', videoUrl: 42 }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 7, videoUrl: 'https://x.test' }])).toEqual([]);
  });

  // A link rendered into an href is an injection surface: only https URLs
  // from the providers we know may pass through.
  it('drops a non-https URL', () => {
    expect(
      resolvePublishLinks([{ provider: 'youtube', videoUrl: 'javascript:alert(1)' }]),
    ).toEqual([]);
    expect(
      resolvePublishLinks([{ provider: 'instagram', permalink: 'http://evil.test/p' }]),
    ).toEqual([]);
  });

  it('derives a Bluesky URL only from a well-formed at:// record URI', () => {
    expect(resolvePublishLinks([{ provider: 'bluesky', postId: 'not-a-uri' }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 'bluesky', postId: 'at://did/app.bsky.feed.post/' }])).toEqual([]);
  });

  it('lists every published provider, one entry each', () => {
    expect(
      resolvePublishLinks([
        { provider: 'youtube', videoUrl: 'https://www.youtube.com/watch?v=a' },
        { provider: 'instagram', permalink: 'https://www.instagram.com/p/b/' },
        { provider: 'bluesky', postId: 'at://did:plc:x/app.bsky.feed.post/c' },
        { provider: 'linkedin', postId: 'urn:li:share:9' },
      ]),
    ).toHaveLength(4);
  });
});