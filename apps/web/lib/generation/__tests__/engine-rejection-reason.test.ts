import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractEngineRejectionReason } from '@/lib/generation/engine-rejection-reason';
import { findRepoRoot } from '@/test/repo-root';

function loadFixture(): unknown {
  const fixturePath = path.join(
    findRepoRoot(import.meta.url),
    'apps/web/lib/generation/__tests__/fixtures/engine-400-unknown-video-type.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
}

describe('extractEngineRejectionReason', () => {
  it('reads the real stale-engine envelope: loc-prefixed msg, Value error stripped, message ignored', () => {
    const out = extractEngineRejectionReason(loadFixture());
    expect(out).toBe(
      "video_type: unknown video_type 'voiceover'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
    expect(out).not.toContain('field required');
    expect(out).not.toContain('Value error, ');
  });

  it('never surfaces input, ctx or url from a body item', () => {
    const out = extractEngineRejectionReason({
      status: 400,
      message: 'field required',
      body: [
        {
          type: 'value_error',
          loc: ['body', 'photo_url'],
          msg: 'Value error, invalid photo_url',
          input: 'https://host.example/x.jpg?token=SECRET',
          ctx: { error: 'SENTINEL-CTX' },
          url: 'https://sentinel.example/err',
        },
      ],
    });
    expect(out).toBe('photo_url: invalid photo_url');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('SENTINEL');
  });

  it('joins several body items with "; "', () => {
    const out = extractEngineRejectionReason({
      status: 400,
      message: 'field required',
      body: [
        { type: 'value_error', loc: ['body', 'a'], msg: 'first' },
        { type: 'value_error', loc: ['body', 'b'], msg: 'second' },
      ],
    });
    expect(out).toBe('a: first; b: second');
  });

  it('skips body items with a non-string msg', () => {
    const out = extractEngineRejectionReason({
      status: 400,
      message: 'field required',
      body: [
        { type: 'value_error', loc: ['body', 'a'], msg: 42 },
        { type: 'value_error', loc: ['body', 'x'], msg: 'ok' },
      ],
    });
    expect(out).toBe('x: ok');
  });

  it('renders loc without the leading "body" segment', () => {
    const out = extractEngineRejectionReason({
      status: 400,
      message: 'field required',
      body: [{ type: 'value_error', loc: ['body', 'segments', 1, 'media'], msg: 'bad media' }],
    });
    expect(out).toBe('segments.1.media: bad media');
  });

  it('returns just the msg when loc is missing or not an array', () => {
    expect(
      extractEngineRejectionReason({
        status: 400,
        message: 'field required',
        body: [{ type: 'value_error', msg: 'bare msg' }],
      }),
    ).toBe('bare msg');
    expect(
      extractEngineRejectionReason({
        status: 400,
        message: 'field required',
        body: [{ type: 'value_error', loc: 'not-an-array', msg: 'bare msg' }],
      }),
    ).toBe('bare msg');
  });

  it('returns null when the body array has no usable msg, without falling back to message', () => {
    expect(
      extractEngineRejectionReason({
        status: 400,
        message: 'field required',
        body: [{ type: 'value_error', loc: ['body', 'a'] }],
      }),
    ).toBeNull();
    expect(
      extractEngineRejectionReason({ status: 400, message: 'field required', body: [] }),
    ).toBeNull();
  });

  it('returns message when there is no body array (HttpException)', () => {
    expect(extractEngineRejectionReason({ status: 500, message: 'engine exploded' })).toBe(
      'engine exploded',
    );
  });

  it('returns null for Starlette detail, null, string and number bodies', () => {
    expect(extractEngineRejectionReason({ detail: 'Not found' })).toBeNull();
    expect(extractEngineRejectionReason(null)).toBeNull();
    expect(extractEngineRejectionReason('not json')).toBeNull();
    expect(extractEngineRejectionReason(42)).toBeNull();
    expect(extractEngineRejectionReason({})).toBeNull();
  });

  it('sanitises the extracted reason: paths to basenames, Bearer redacted', () => {
    const out = extractEngineRejectionReason({
      status: 400,
      message: 'field required',
      body: [
        {
          type: 'value_error',
          loc: ['body', 'voice_audio_url'],
          msg: 'Value error, cannot read /home/app/storage/tasks/abc/x.mp4 with Bearer abc123',
        },
      ],
    });
    expect(out).toBe('voice_audio_url: cannot read x.mp4 with Bearer [redacted]');
    expect(out).not.toContain('/home/app/storage');
    expect(out).not.toContain('abc123');
  });
});
