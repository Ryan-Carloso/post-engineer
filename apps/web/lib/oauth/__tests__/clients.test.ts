import { describe, it, expect } from 'vitest';
import { validateDcrMetadata, isCimdClientId } from '../clients';

describe('oauth clients', () => {
  it('accepts valid dynamic client registration metadata', () => {
    const result = validateDcrMetadata({
      redirect_uris: ['https://chatgpt.com/connector/callback'],
      client_name: 'ChatGPT',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.redirectUris).toEqual(['https://chatgpt.com/connector/callback']);
      expect(result.clientName).toBe('ChatGPT');
    }
  });

  it('allows http localhost redirects for native clients', () => {
    const result = validateDcrMetadata({
      redirect_uris: ['http://127.0.0.1:54321/callback'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects fragments, non-https remotes and empty lists', () => {
    expect(
      validateDcrMetadata({ redirect_uris: ['https://app.example/cb#frag'] }).ok,
    ).toBe(false);
    expect(validateDcrMetadata({ redirect_uris: ['http://app.example/cb'] }).ok).toBe(false);
    expect(validateDcrMetadata({ redirect_uris: [] }).ok).toBe(false);
    expect(validateDcrMetadata({}).ok).toBe(false);
  });

  it('detects client ID metadata documents vs registered ids', () => {
    expect(isCimdClientId('https://chatgpt.com/mcp-client-metadata.json')).toBe(true);
    expect(isCimdClientId('mcp_client_abc123')).toBe(false);
    expect(isCimdClientId('')).toBe(false);
  });
});
