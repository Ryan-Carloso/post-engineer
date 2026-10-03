import { describe, it, expect } from 'vitest';
import {
  describeImageSource,
  isPublicAssetPath,
  toSameOriginAssetPath,
} from '@/lib/image-source';

//---------------
// image-source — the redaction helper behind the avatar diagnostics.
//
// It exists because the logs must never print the raw value: a Supabase
// storage URL carries its signature token in the query string, and an
// absolute URL may carry userinfo. The shape (origin + path) is enough to
// answer "which host, which file" without leaking anything.
//---------------

describe('describeImageSource', () => {
  it('returns null for a missing source', () => {
    expect(describeImageSource(null)).toBeNull();
    expect(describeImageSource(undefined)).toBeNull();
    expect(describeImageSource('   ')).toBeNull();
  });

  it('keeps a relative public path as-is', () => {
    expect(describeImageSource('/caracter-samples/file-3.png')).toBe('/caracter-samples/file-3.png');
  });

  it('drops the query string of a signed storage URL (that is the token)', () => {
    const signed =
      'https://abc.supabase.co/storage/v1/object/sign/personas/9a42.png?token=eyJhbGciOi.SECRET&expires=1';
    expect(describeImageSource(signed)).toBe(
      'https://abc.supabase.co/storage/v1/object/sign/personas/9a42.png',
    );
  });

  it('drops credentials from the URL', () => {
    expect(describeImageSource('https://user:pass@muse.ai/files/x/ryan.jpg?v=2')).toBe(
      'https://muse.ai/files/x/ryan.jpg',
    );
  });

  it('caps an absurdly long source', () => {
    const long = `https://cdn.test/${'a'.repeat(400)}.png`;
    const described = describeImageSource(long) ?? '';
    expect(described.length).toBeLessThanOrEqual(121);
    expect(described.endsWith('…')).toBe(true);
  });

  it('never echoes an unparseable value', () => {
    const described = describeImageSource('not a url at all');
    expect(described).toBe('<unparseable:16chars>');
  });
});

describe('isPublicAssetPath', () => {
  it('recognizes our own asset directories', () => {
    expect(isPublicAssetPath('/caracter-samples/file-1.png')).toBe(true);
    expect(isPublicAssetPath('/voice-samples/voice-1.mp3')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPublicAssetPath('https://muse.ai/files/x.jpg')).toBe(false);
    expect(isPublicAssetPath('/api/persona/images')).toBe(false);
    expect(isPublicAssetPath(null)).toBe(false);
  });
});

describe('toSameOriginAssetPath', () => {
  it('strips the absolute origin from our own public asset', () => {
    expect(toSameOriginAssetPath('https://post-engineer.com/caracter-samples/file-3.png')).toBe(
      '/caracter-samples/file-3.png',
    );
  });

  it('leaves a third-party avatar untouched (it is genuinely remote)', () => {
    expect(toSameOriginAssetPath('https://muse.ai/files/x/ryan.jpg')).toBe('https://muse.ai/files/x/ryan.jpg');
  });

  it('passes a relative path through', () => {
    expect(toSameOriginAssetPath('/caracter-samples/file-1.png')).toBe('/caracter-samples/file-1.png');
  });

  it('returns null for empty input so the caller can use ?? undefined', () => {
    expect(toSameOriginAssetPath(null)).toBeNull();
    expect(toSameOriginAssetPath('  ')).toBeNull();
  });
});
