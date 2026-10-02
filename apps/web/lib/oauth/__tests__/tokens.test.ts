import { describe, it, expect } from 'vitest';
import { generateKeyPair, exportJWK, calculateJwkThumbprint } from 'jose';
import {
  mintAccessToken,
  verifyAccessToken,
  mintAuthorizationCode,
  verifyAuthorizationCode,
  mintRefreshToken,
  verifyRefreshToken,
  mintConsentRequest,
  verifyConsentRequest,
  type OAuthKeyMaterial,
} from '../tokens';

const ISSUER = 'https://post-engineer.com';
const RESOURCE = 'https://mcp.post-engineer.com';

async function testKeys(): Promise<OAuthKeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return { privateKey, publicKey, publicJwk, kid, issuer: ISSUER };
}

describe('oauth tokens', () => {
  it('round-trips an access token with audience binding', async () => {
    const keys = await testKeys();
    const token = await mintAccessToken(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      scope: 'mcp:tools',
      resource: RESOURCE,
    });
    const claims = await verifyAccessToken(keys, token, { resource: RESOURCE });
    expect(claims.sub).toBe('user-1');
    expect(claims.clientId).toBe('client-1');
    expect(claims.scope).toBe('mcp:tools');
  });

  it('rejects access tokens for a different resource', async () => {
    const keys = await testKeys();
    const token = await mintAccessToken(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      scope: 'mcp:tools',
      resource: RESOURCE,
    });
    await expect(
      verifyAccessToken(keys, token, { resource: 'https://evil.example' }),
    ).rejects.toThrow();
  });

  it('rejects tampered and foreign-key tokens', async () => {
    const keys = await testKeys();
    const other = await testKeys();
    const token = await mintAccessToken(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      scope: 'mcp:tools',
      resource: RESOURCE,
    });
    // Flip a fully-significant base64url char of the signature. The last
    // signature char carries only 2 data bits (the rest is padding), so
    // replacing the tail (e.g. slice(0, -2) + "aa") is a byte-level no-op
    // ~1/256 of the time and the "tampered" token still verifies (flaky).
    const [header, payload, signature] = token.split('.');
    const flipped = signature[0] === 'a' ? 'b' : 'a';
    const tampered = `${header}.${payload}.${flipped}${signature.slice(1)}`;
    await expect(verifyAccessToken(keys, tampered, { resource: RESOURCE })).rejects.toThrow();
    await expect(verifyAccessToken(other, token, { resource: RESOURCE })).rejects.toThrow();
  });

  it('round-trips an authorization code and refuses it as an access token', async () => {
    const keys = await testKeys();
    const code = await mintAuthorizationCode(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      redirectUri: 'https://chatgpt.com/connector/callback',
      scope: 'mcp:tools offline_access',
      resource: RESOURCE,
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const claims = await verifyAuthorizationCode(keys, code);
    expect(claims.sub).toBe('user-1');
    expect(claims.redirectUri).toBe('https://chatgpt.com/connector/callback');
    await expect(verifyAccessToken(keys, code, { resource: RESOURCE })).rejects.toThrow();
  });

  it('round-trips refresh and consent-request tokens', async () => {
    const keys = await testKeys();
    const refresh = await mintRefreshToken(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      scope: 'mcp:tools offline_access',
      resource: RESOURCE,
    });
    const refreshClaims = await verifyRefreshToken(keys, refresh);
    expect(refreshClaims.sub).toBe('user-1');
    expect(refreshClaims.resource).toBe(RESOURCE);

    const consent = await mintConsentRequest(keys, {
      sub: 'user-1',
      clientId: 'client-1',
      redirectUri: 'https://chatgpt.com/connector/callback',
      scope: 'mcp:tools',
      resource: RESOURCE,
      state: 'xyz',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const consentClaims = await verifyConsentRequest(keys, consent);
    expect(consentClaims.sub).toBe('user-1');
    expect(consentClaims.state).toBe('xyz');
  });
});
