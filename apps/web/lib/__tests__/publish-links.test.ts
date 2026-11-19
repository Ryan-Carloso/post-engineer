import { describe, it, expect } from 'vitest';
import { resolvePublishLinks } from '../publish-links';

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

  it('uses the 3Speak permalink as-is', () => {
    expect(
      resolvePublishLinks([
        { provider: '3speak', permalink: 'https://3speak.tv/watch?v=alice/my-video' },
      ]),
    ).toEqual([
      { provider: '3speak', url: 'https://3speak.tv/watch?v=alice/my-video' },
    ]);
  });

  it('omits a 3Speak entry with only a video id (no URL can be derived from it)', () => {
    expect(resolvePublishLinks([{ provider: '3speak', postId: 'video-1' }])).toEqual([]);
  });

  it('derives the public Bluesky URL from the at:// record URI', () => {
    expect(
      resolvePublishLinks([
        { provider: 'bluesky', postId: 'at://did:plc:abc123/app.bsky.feed.post/xyz789' },
      ]),
    ).toEqual([
      { provider: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc123/post/xyz789' },
    ]);
  });

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

  it('yields no link for a failed provider entry', () => {
    expect(
      resolvePublishLinks([
        {
          provider: 'youtube',
          status: 'failed',
          videoUrl: 'https://www.youtube.com/watch?v=abc123',
        },
        {
          provider: 'bluesky',
          status: 'published',
          postId: 'at://did:plc:abc123/app.bsky.feed.post/xyz789',
        },
      ]),
    ).toEqual([
      { provider: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc123/post/xyz789' },
    ]);
  });

  it('ignores an unknown provider', () => {
    expect(resolvePublishLinks([{ provider: 'tiktok', postId: 'x' }])).toEqual([]);
  });

  it('returns no links for a non-array payload', () => {
    expect(resolvePublishLinks(null)).toEqual([]);
    expect(resolvePublishLinks('nope')).toEqual([]);
    expect(resolvePublishLinks(undefined)).toEqual([]);
  });

  it('ignores entries whose fields are not strings', () => {
    expect(resolvePublishLinks([{ provider: 'youtube', videoUrl: 42 }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 7, videoUrl: 'https://x.test' }])).toEqual([]);
  });

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