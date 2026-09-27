import 'server-only';

import { randomUUID } from 'crypto';
import {
  SignJWT,
  jwtVerify,
  type JWTPayload,
  type JWK,
  type CryptoKey,
} from 'jose';

//---------------
// Authorization server tokens (OAuth 2.1).
//
// All tokens are self-contained ES256 JWTs: no user secret is ever
// persisted in the database. Each type carries `token_use` so an authorization
// code is never accepted as an access token and vice versa.
//
// - access: 1h, aud = resource (e.g. https://api.post-engineer.com)
// - authorization code: 10min, binds client_id + redirect_uri + PKCE
// - refresh: 30d, rotated on every use (requires the offline_access scope)
// - consent: 10min, carries the authorize request to the consent screen
//---------------

export interface OAuthKeyMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JWK;
  kid: string;
  issuer: string;
}

export interface AccessTokenClaims {
  sub: string;
  clientId: string;
  scope: string;
}

export interface AuthorizationCodeClaims extends AccessTokenClaims {
  redirectUri: string;
  resource: string;
  codeChallenge: string;
}

export interface RefreshTokenClaims extends AccessTokenClaims {
  resource: string;
  jti: string;
}

export interface ConsentRequestClaims extends AccessTokenClaims {
  redirectUri: string;
  resource: string;
  state: string;
  codeChallenge: string;
}

async function verify(
  keys: OAuthKeyMaterial,
  token: string,
  expectedUse: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: keys.issuer,
    algorithms: ['ES256'],
  });
  if (payload.token_use !== expectedUse) {
    throw new Error(`Unexpected token_use (expected ${expectedUse}).`);
  }
  return payload;
}

function requiredString(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Token is missing required claim ${name}.`);
  }
  return value;
}

export async function mintAccessToken(
  keys: OAuthKeyMaterial,
  input: { sub: string; clientId: string; scope: string; resource: string },
): Promise<string> {
  return new SignJWT({
    token_use: 'access',
    scope: input.scope,
    client_id: input.clientId,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setSubject(input.sub)
    .setAudience(input.resource)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setJti(randomUUID())
    .sign(keys.privateKey);
}

export async function verifyAccessToken(
  keys: OAuthKeyMaterial,
  token: string,
  input: { resource: string },
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: keys.issuer,
    audience: input.resource,
    algorithms: ['ES256'],
  });
  if (payload.token_use !== 'access') {
    throw new Error('Unexpected token_use (expected access).');
  }
  const sub = requiredString(payload, 'sub');
  return {
    sub,
    clientId: requiredString(payload, 'client_id'),
    scope: requiredString(payload, 'scope'),
  };
}

export async function mintAuthorizationCode(
  keys: OAuthKeyMaterial,
  input: {
    sub: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    resource: string;
    codeChallenge: string;
  },
): Promise<string> {
  return new SignJWT({
    token_use: 'auth_code',
    scope: input.scope,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    code_challenge: input.codeChallenge,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .setJti(randomUUID())
    .sign(keys.privateKey);
}

export async function verifyAuthorizationCode(
  keys: OAuthKeyMaterial,
  code: string,
): Promise<AuthorizationCodeClaims> {
  const payload = await verify(keys, code, 'auth_code');
  return {
    sub: requiredString(payload, 'sub'),
    clientId: requiredString(payload, 'client_id'),
    scope: requiredString(payload, 'scope'),
    redirectUri: requiredString(payload, 'redirect_uri'),
    resource: requiredString(payload, 'resource'),
    codeChallenge: requiredString(payload, 'code_challenge'),
  };
}

export async function mintRefreshToken(
  keys: OAuthKeyMaterial,
  input: { sub: string; clientId: string; scope: string; resource: string },
): Promise<string> {
  return new SignJWT({
    token_use: 'refresh',
    scope: input.scope,
    client_id: input.clientId,
    resource: input.resource,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .setJti(randomUUID())
    .sign(keys.privateKey);
}

export async function verifyRefreshToken(
  keys: OAuthKeyMaterial,
  token: string,
): Promise<RefreshTokenClaims> {
  const payload = await verify(keys, token, 'refresh');
  const jti = requiredString(payload, 'jti');
  return {
    sub: requiredString(payload, 'sub'),
    clientId: requiredString(payload, 'client_id'),
    scope: requiredString(payload, 'scope'),
    resource: requiredString(payload, 'resource'),
    jti,
  };
}

export async function mintConsentRequest(
  keys: OAuthKeyMaterial,
  input: {
    sub: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    resource: string;
    state: string;
    codeChallenge: string;
  },
): Promise<string> {
  return new SignJWT({
    token_use: 'consent',
    scope: input.scope,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    state: input.state,
    code_challenge: input.codeChallenge,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .setJti(randomUUID())
    .sign(keys.privateKey);
}

export async function verifyConsentRequest(
  keys: OAuthKeyMaterial,
  token: string,
): Promise<ConsentRequestClaims> {
  const payload = await verify(keys, token, 'consent');
  return {
    sub: requiredString(payload, 'sub'),
    clientId: requiredString(payload, 'client_id'),
    scope: requiredString(payload, 'scope'),
    redirectUri: requiredString(payload, 'redirect_uri'),
    resource: requiredString(payload, 'resource'),
    state: requiredString(payload, 'state'),
    codeChallenge: requiredString(payload, 'code_challenge'),
  };
}
