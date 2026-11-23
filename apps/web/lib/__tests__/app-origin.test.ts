import { afterEach, describe, expect, it, vi } from 'vitest';
import { appOrigin } from '@/lib/app-origin';

describe('appOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the origin of the configured public app URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', ' https://post-engineer.com/some/path/ ');
    expect(appOrigin()).toBe('https://post-engineer.com');
  });

  it('keeps an explicit port for local development', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3434');
    expect(appOrigin()).toBe('http://localhost:3434');
  });

  it.each([undefined, '', '   '])('throws when the app URL is %j', (value: string | undefined): void => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);
    expect(() => appOrigin()).toThrow('NEXT_PUBLIC_APP_URL is not defined');
  });

  it('throws on a value that is not a URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'post-engineer.com');
    expect(() => appOrigin()).toThrow('NEXT_PUBLIC_APP_URL is not a valid URL');
  });

  it('throws on a non-http scheme', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'ftp://post-engineer.com');
    expect(() => appOrigin()).toThrow('NEXT_PUBLIC_APP_URL must be an http(s) URL');
  });
});
