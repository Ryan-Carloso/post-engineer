import { describe, it, expect } from 'vitest';
import { verifyPkceChallenge, sha256Base64Url } from '../pkce';

describe('pkce', () => {
  it('accepts a valid S256 verifier (RFC 7636 appendix B vector)', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkceChallenge(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects a wrong verifier', async () => {
    const challenge = sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    expect(verifyPkceChallenge('wrong-verifier-value-which-is-long-enough-1234', challenge, 'S256')).toBe(
      false,
    );
  });

  it('rejects the plain method and unknown methods', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(verifyPkceChallenge(verifier, verifier, 'plain')).toBe(false);
    expect(verifyPkceChallenge(verifier, verifier, 'S512')).toBe(false);
  });

  it('rejects malformed verifiers', async () => {
    const challenge = sha256Base64Url('a-valid-verifier-string-with-enough-length-123456');
    expect(verifyPkceChallenge('short', challenge, 'S256')).toBe(false);
    expect(verifyPkceChallenge('has spaces in it which is not allowed at all 123', challenge, 'S256')).toBe(
      false,
    );
    expect(verifyPkceChallenge('', challenge, 'S256')).toBe(false);
  });
});
