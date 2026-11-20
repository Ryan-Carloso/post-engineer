import { describe, expect, it } from 'vitest';
import { isCodeRelayTarget } from '@/lib/auth-code-relay';

const PREVIEW_HOST = 'post-enginner-git-fix-xyz-ryan-carlosos-projects.vercel.app';

describe('isCodeRelayTarget', () => {
  it.each([
    `https://${PREVIEW_HOST}/auth/callback`,
    'https://post-enginner-k3j2h1g0f-ryan-carlosos-projects.vercel.app/auth/callback',
    'http://localhost:3434/auth/callback',
    'http://127.0.0.1:3434/auth/callback',
    'http://[::1]:3434/auth/callback',
    `https://${PREVIEW_HOST}/auth/callback?param=1`,
  ])('relays to %s', (target) => {
    expect(isCodeRelayTarget(target)).toBe(true);
  });

  it.each([
    ['https://post-enginner-ryan-carlosos-projects.vercel.app-not-ours-post-enginner-ryan-carlosos-projects.vercel.app/auth/callback', 'issue #454 attacker host'],
    ['https://post-enginner-x.evil-ryan-carlosos-projects.vercel.app/auth/callback', 'dotted lookalike host'],
    ['https://attacker-app.vercel.app/auth/callback', 'third-party vercel.app host'],
    ['https://vercel.app.evil.com/auth/callback', 'vercel.app.evil.com lookalike'],
    [`http://${PREVIEW_HOST}/auth/callback`, 'preview over plain http'],
    [`https://user:pass@${PREVIEW_HOST}/auth/callback`, 'preview with userinfo'],
    [`https://user@${PREVIEW_HOST}/auth/callback`, 'preview with a username only'],
    ['http://user@localhost:3434/auth/callback', 'local with userinfo'],
    [`https://${PREVIEW_HOST}:8443/auth/callback`, 'preview with an explicit port'],
    [`https://${PREVIEW_HOST}/auth/callback/`, 'trailing slash on the path'],
    [`https://${PREVIEW_HOST}/auth/callbackx`, 'path with a suffix'],
    [`https://${PREVIEW_HOST}/dashboard`, 'another path'],
    [`https://${PREVIEW_HOST}/auth/callback#frag`, 'fragment on the target'],
    ['https://localhost/auth/callback', 'local host over https'],
    ['http://localhost.evil.com/auth/callback', 'local lookalike'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['/auth/callback', 'relative path'],
    ['not a url', 'unparseable value'],
  ])('does not relay to %s (%s)', (target) => {
    expect(isCodeRelayTarget(target)).toBe(false);
  });
});
