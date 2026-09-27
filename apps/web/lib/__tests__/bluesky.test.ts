// @vitest-environment node
// The API lib runs on the Node runtime (native fetch/undici).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAgentInstance = {
  login: vi.fn(),
  session: { did: 'did:plc:test123', handle: 'test.bsky.social' },
  app: {
    bsky: {
      video: {
        getJobStatus: vi.fn(),
      },
    },
  },
  com: {
    atproto: {
      server: {
        getServiceAuth: vi.fn(),
      },
    },
  },
  post: vi.fn(),
};

vi.mock('@atproto/api', () => {
  const AtpAgent = vi.fn(function () {
    return mockAgentInstance;
  });
  return { AtpAgent };
});

import {
  countBlueskyGraphemes,
  truncateBlueskyCaption,
  BLUESKY_CAPTION_MAX_GRAPHEMES,
  BLUESKY_VIDEO_MAX_BYTES,
  BLUESKY_VIDEO_MAX_SECONDS,
  validateVideoForBluesky,
  loginToBluesky,
} from '@/lib/bluesky';

describe('bluesky — limites', () => {
  it('exposes documented limit constants', () => {
    expect(BLUESKY_CAPTION_MAX_GRAPHEMES).toBe(300);
    expect(BLUESKY_VIDEO_MAX_BYTES).toBe(100_000_000);
    expect(BLUESKY_VIDEO_MAX_SECONDS).toBe(180);
  });
});

describe('countBlueskyGraphemes / truncateBlueskyCaption', () => {
  it('counts plain text as graphemes', () => {
    expect(countBlueskyGraphemes('abc')).toBe(3);
  });

  it('a composed emoji counts as 1 grapheme', () => {
    // ZWJ family: assembled from codepoints because the ZWJ is invisible
    // and disappears in editor copy/paste.
    const zwj = String.fromCodePoint(0x200d);
    const family = [0x1f468, 0x1f469, 0x1f467, 0x1f466]
      .map((cp) => String.fromCodePoint(cp))
      .join(zwj);
    expect(countBlueskyGraphemes(family)).toBe(1);
    expect(countBlueskyGraphemes('🇧🇷')).toBe(1);
    expect(countBlueskyGraphemes('ok👍')).toBe(3);
  });

  it('does not truncate a caption within the limit', () => {
    const caption = 'a'.repeat(300);
    expect(truncateBlueskyCaption(caption)).toBe(caption);
    expect(truncateBlueskyCaption('curta')).toBe('curta');
  });

  it('truncates captions above 300 graphemes with an ellipsis', () => {
    const caption = 'a'.repeat(320);
    const result = truncateBlueskyCaption(caption);
    expect(countBlueskyGraphemes(result)).toBe(300);
    expect(result.endsWith('…')).toBe(true);
  });

  it('truncation is safe with an emoji at the cut point', () => {
    const caption = 'a'.repeat(298) + '👍👍👍';
    const result = truncateBlueskyCaption(caption);
    expect(countBlueskyGraphemes(result)).toBe(300);
  });
});

describe('validateVideoForBluesky', () => {
  it('aceita mp4 dentro dos limites', () => {
    expect(
      validateVideoForBluesky({ sizeBytes: 50_000_000, durationSeconds: 120, mimeType: 'video/mp4' }),
    ).toEqual({ ok: true });
  });

  it('rejects non-mp4 formats', () => {
    const result = validateVideoForBluesky({ sizeBytes: 1000, durationSeconds: 10, mimeType: 'video/webm' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('MP4');
  });

  it('rejects videos above 100MB', () => {
    const result = validateVideoForBluesky({ sizeBytes: 100_000_001, durationSeconds: 10, mimeType: 'video/mp4' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('100');
  });

  it('rejects videos above 180s', () => {
    const result = validateVideoForBluesky({ sizeBytes: 1000, durationSeconds: 181, mimeType: 'video/mp4' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('3 min');
  });
});

describe('loginToBluesky', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns did and handle on success', async () => {
    mockAgentInstance.login.mockResolvedValueOnce({
      success: true,
      data: { did: 'did:plc:abc', handle: 'eu.bsky.social', accessJwt: 'jwt-1' },
    });
    const result = await loginToBluesky('eu.bsky.social', 'app-pass-1');
    expect(result).toEqual({ did: 'did:plc:abc', handle: 'eu.bsky.social' });
    expect(mockAgentInstance.login).toHaveBeenCalledWith({
      identifier: 'eu.bsky.social',
      password: 'app-pass-1',
    });
  });

  it('a credential error becomes BlueskyError without leaking the password', async () => {
    mockAgentInstance.login.mockRejectedValueOnce(new Error('Invalid identifier or password'));
    await expect(loginToBluesky('errado.bsky.social', 'senha-secreta')).rejects.toMatchObject({
      name: 'BlueskyError',
    });
    try {
      await loginToBluesky('errado.bsky.social', 'senha-secreta');
    } catch (error) {
      expect((error as Error).message).not.toContain('senha-secreta');
    }
  });
});
