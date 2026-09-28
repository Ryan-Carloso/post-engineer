import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '@/lib/logger';

const ENV_KEY = 'NEXT_PUBLIC_APP_URL';
const previous = process.env[ENV_KEY];

afterEach(() => {
  if (previous === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previous;
});

describe('GET /.well-known/oauth-authorization-server', () => {
  it('publishes RFC 8414 metadata for the MCP authorization server', async () => {
    process.env[ENV_KEY] = 'https://post-engineer.test';
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issuer: 'https://post-engineer.test',
      authorization_endpoint: 'https://post-engineer.test/oauth/authorize',
      token_endpoint: 'https://post-engineer.test/oauth/token',
      registration_endpoint: 'https://post-engineer.test/oauth/register',
      jwks_uri: 'https://post-engineer.test/.well-known/jwks.json',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp:tools', 'offline_access'],
    });
  });

  it('logs when the metadata cannot be built (misconfigured issuer)', async () => {
    delete process.env[ENV_KEY];
    const response = await GET();
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('metadata failed'),
      expect.anything(),
    );
  });
});
