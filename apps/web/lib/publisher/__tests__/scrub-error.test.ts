import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { diagnosticOf, errorMessageOf, nonEmptyErrorReason, scrubErrorText, scrubSecretValues } from '@/lib/publisher/scrub-error';

describe('scrubSecretValues', () => {
  it('redacts key=value secrets and bearer tokens', () => {
    expect(scrubSecretValues('failed password=hunter2 for user')).toBe('failed password=[redacted] for user');
    expect(scrubSecretValues('token: abc123, retry')).toBe('token=[redacted], retry');
    expect(scrubSecretValues('Authorization Bearer abc.def.ghi rejected')).toBe('Authorization Bearer [redacted] rejected');
  });

  it('redacts sk- keys and URL userinfo', () => {
    expect(scrubSecretValues('key sk-abcdefghijklmnopqrstuvwxyz0123 leaked')).toBe('key [redacted] leaked');
    expect(scrubSecretValues('GET https://user:pw@host.example/a')).toBe('GET https://[redacted]@host.example/a');
  });

  it('leaves text without secrets untouched', () => {
    expect(scrubSecretValues('Media ID not found')).toBe('Media ID not found');
  });
});

describe('scrubErrorText', () => {
  it('returns an empty string for empty input', () => {
    expect(scrubErrorText('')).toBe('');
  });

  it('replaces the home directory and keeps only the file name', () => {
    const text = `ENOENT ${os.homedir()}/projects/app/video.mp4 missing`;
    expect(scrubErrorText(text)).toBe('ENOENT <home>/video.mp4 missing');
  });

  it('replaces other absolute paths with <path>/name', () => {
    expect(scrubErrorText('cannot open /srv/data/cache/clip.mp4 now')).toBe('cannot open <path>/clip.mp4 now');
  });

  it('keeps URLs readable', () => {
    expect(scrubErrorText('HTTP 502 from https://api.example.com/v1/upload')).toBe(
      'HTTP 502 from https://api.example.com/v1/upload',
    );
  });

  it('scrubs secrets before truncating, keeping the first line and the tail', () => {
    const text = `first line failed\n${'x'.repeat(300)}\nlast detail token=SECRETVALUE`;
    const scrubbed = scrubErrorText(text, 100);
    expect(scrubbed.startsWith('first line failed\n…\n')).toBe(true);
    expect(scrubbed.endsWith('token=[redacted]')).toBe(true);
    expect(scrubbed).not.toContain('SECRETVALUE');
    expect(scrubbed.length).toBeLessThanOrEqual(100);
  });

  it('keeps only the tail when the first line alone exceeds the budget', () => {
    expect(scrubErrorText('a'.repeat(50), 10)).toBe('a'.repeat(10));
  });

  it('returns short text unchanged', () => {
    expect(scrubErrorText('Instagram token expired')).toBe('Instagram token expired');
  });
});

describe('nonEmptyErrorReason', () => {
  it('uses the scrubbed text when there is one', () => {
    expect(nonEmptyErrorReason('boom token=abc', 'Error')).toBe('boom token=[redacted]');
  });

  it('falls back to the fallback, then to Error', () => {
    expect(nonEmptyErrorReason('   ', 'TypeError')).toBe('TypeError');
    expect(nonEmptyErrorReason('', '')).toBe('Error');
  });
});

describe('diagnostics', () => {
  it('names the error class and scrubs the message', () => {
    const error = new TypeError('fetch failed password=abc');
    expect(diagnosticOf(error)).toBe('TypeError: fetch failed password=[redacted]');
    expect(errorMessageOf(error)).toBe('fetch failed password=abc');
  });

  it('handles non-errors', () => {
    expect(diagnosticOf('plain')).toBe('Error: plain');
    expect(diagnosticOf(42)).toBe('Error');
    expect(errorMessageOf('plain')).toBe('plain');
    expect(errorMessageOf(42)).toBe('');
  });
});
