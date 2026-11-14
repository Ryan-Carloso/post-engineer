import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GET, protectedResourceMetadata } from '../route';
import { getMcpResource, getIssuer } from '@/lib/oauth/config';

const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://post-engineer.test';
});

afterAll(() => {
  if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
});

describe('GET /.well-known/oauth-protected-resource', () => {
  it('publishes the RFC 9728 protected-resource document for the MCP endpoint', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: getMcpResource(),
      authorization_servers: [getIssuer()],
      scopes_supported: ['mcp:tools', 'offline_access'],
    });
  });

  it('derives the metadata from the configured resource and issuer', () => {
    const doc = protectedResourceMetadata();
    expect(doc.resource).toBe(getMcpResource());
    expect(doc.authorization_servers).toEqual([getIssuer()]);
    expect(doc.scopes_supported).toContain('mcp:tools');
  });

  it('returns a generic 500 when OAuth is not configured (no internal details leaked)', async () => {
    const saved = process.env.MCP_RESOURCE;
    vi.stubEnv('MCP_RESOURCE', undefined);
    try {
      const response = await GET();
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('OAuth is not configured.');
      expect(body.error).not.toContain('MCP_RESOURCE');
    } finally {
      vi.unstubAllEnvs();
      if (saved !== undefined) process.env.MCP_RESOURCE = saved;
    }
  });
});
