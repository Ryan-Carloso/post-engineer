import { describe, it, expect } from 'vitest';
import { redirectUriAllowed, clientRedirectUrl } from '../redirect-uri';

const UNSAFE = [
  'javascript:alert(1)',
  "javascript:document.title='x';/*",
  'data:text/html,x',
  'http://evil.example/cb',
  'https://ok.example/cb#frag',
  'ftp://ok.example/cb',
  'not a url',
  '',
];

describe('redirectUriAllowed', () => {
  it.each(UNSAFE)('rejects %j', (value) => {
    expect(redirectUriAllowed(value)).toBe(false);
  });

  it.each([
    'https://ok.example/cb',
    'http://localhost:3000/cb',
    'http://127.0.0.1/cb',
    'http://[::1]:8080/cb',
  ])('accepts %s', (value) => {
    expect(redirectUriAllowed(value)).toBe(true);
  });
});

describe('clientRedirectUrl', () => {
  it('appends the given params to an allowed redirect_uri', () => {
    const url = clientRedirectUrl('https://ok.example/cb?keep=1', {
      code: 'c',
      state: 's',
      error_description: undefined,
    });
    expect(url?.toString()).toBe('https://ok.example/cb?keep=1&code=c&state=s');
  });

  it('skips empty param values', () => {
    const url = clientRedirectUrl('https://ok.example/cb', { error: 'e', state: '' });
    expect(url?.toString()).toBe('https://ok.example/cb?error=e');
  });

  it.each(UNSAFE)('returns null for %j', (value) => {
    expect(clientRedirectUrl(value, { code: 'c', state: 's' })).toBeNull();
  });
});
