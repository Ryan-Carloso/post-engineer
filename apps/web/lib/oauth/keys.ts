import 'server-only';

import {
  importPKCS8,
  importJWK,
  exportJWK,
  calculateJwkThumbprint,
  type JWK,
  type CryptoKey,
} from 'jose';
import { getIssuer, getPrivateKeyPem } from './config';
import type { OAuthKeyMaterial } from './tokens';

//---------------
// Authorization server ES256 keys. The private key lives only in deploy
// env; the public key is derived at runtime and published in the JWKS. The `kid` is
// the key thumbprint (derived, not configured).
//---------------

let cached: OAuthKeyMaterial | null = null;

export async function getOAuthKeys(): Promise<OAuthKeyMaterial> {
  if (cached) return cached;
  const privateKey = await importPKCS8(getPrivateKeyPem(), 'ES256', {
    extractable: true,
  });
  const publicKey = await derivePublicKey(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  const issuer = getIssuer();
  cached = {
    privateKey,
    publicKey,
    publicJwk: { ...publicJwk, kid, use: 'sig', alg: 'ES256' } satisfies JWK,
    kid,
    issuer,
  };
  return cached;
}

async function derivePublicKey(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = await exportJWK(privateKey);
  delete jwk.d;
  return importJWK({ ...jwk, use: 'sig', alg: 'ES256' }, 'ES256') as Promise<CryptoKey>;
}

export function clearOAuthKeysCache(): void {
  cached = null;
}
