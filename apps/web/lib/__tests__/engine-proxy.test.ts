// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { engineBaseUrl, parseEngineJson } from '@/lib/engine-proxy';

describe('engineBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws the exact error when MONEYPRINT_API_URL is not defined', () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    expect(() => engineBaseUrl()).toThrow('MONEYPRINT_API_URL is not defined');
  });

  it('throws when MONEYPRINT_API_URL is an empty string', () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    expect(() => engineBaseUrl()).toThrow('MONEYPRINT_API_URL is not defined');
  });

  it('returns the url unchanged when it has no trailing slash', () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080');
    expect(engineBaseUrl()).toBe('http://127.0.0.1:8080');
  });

  it('strips a single trailing slash', () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://127.0.0.1:8080/');
    expect(engineBaseUrl()).toBe('http://127.0.0.1:8080');
  });

  it('strips multiple trailing slashes but keeps inner path segments', () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.example.com/base///');
    expect(engineBaseUrl()).toBe('https://engine.example.com/base');
  });
});

describe('parseEngineJson', () => {
  it('returns the parsed json body', async () => {
    const response = {
      json: async () => ({ status: 200, message: 'ok', body: { id: 'c1' } }),
    } as unknown as Response;
    await expect(parseEngineJson(response)).resolves.toEqual({
      status: 200,
      message: 'ok',
      body: { id: 'c1' },
    });
  });

  it('returns null when the body is not valid json', async () => {
    const response = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response;
    await expect(parseEngineJson(response)).resolves.toBeNull();
  });
});
