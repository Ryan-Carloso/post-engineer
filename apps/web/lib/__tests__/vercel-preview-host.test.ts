import { describe, expect, it } from 'vitest';
import { isOwnVercelPreviewHost } from '@/lib/vercel-preview-host';

const TEAM = 'ryan-carlosos-projects';

describe('isOwnVercelPreviewHost', () => {
  it.each([
    `post-enginner-k3j2h1g0f-${TEAM}.vercel.app`,
    `post-enginner-0a1b2c3d4-${TEAM}.vercel.app`,
    `post-enginner-git-main-${TEAM}.vercel.app`,
    `post-enginner-git-fix-xyz-${TEAM}.vercel.app`,
    `post-enginner-git-fix-454-anchor-vercel-${TEAM}.vercel.app`,
  ])('accepts the real preview host %s', (host) => {
    expect(isOwnVercelPreviewHost(host)).toBe(true);
  });

  it.each([
    [`post-enginner-${TEAM}.vercel.app-not-ours-post-enginner-${TEAM}.vercel.app`, 'issue #454 attacker project alias'],
    [`post-enginner-x.evil-${TEAM}.vercel.app`, 'dot inside the middle label'],
    [`post-enginner-git-x.attacker-${TEAM}.vercel.app`, 'dot inside the branch slug'],
    [`sub.post-enginner-git-main-${TEAM}.vercel.app`, 'extra leading label'],
    [`post-enginner-git-main-${TEAM}.vercel.app.evil.com`, 'vercel.app.evil.com lookalike'],
    [`post-enginner-git-main-${TEAM}.vercel.app.`, 'trailing dot'],
    [`post-enginner-${TEAM}.vercel.app`, 'production alias without a middle label'],
    [`post-enginner--${TEAM}.vercel.app`, 'empty middle label'],
    [`post-enginner-abc-${TEAM}.vercel.app`, 'hash shorter than nine characters'],
    [`post-enginner-abcdefghij-${TEAM}.vercel.app`, 'hash longer than nine characters'],
    [`post-enginner-git--${TEAM}.vercel.app`, 'empty branch slug'],
    [`post-enginner-git-fix--${TEAM}.vercel.app`, 'branch slug ending in a hyphen'],
    [`post-enginner-git-fix_x-${TEAM}.vercel.app`, 'underscore in the branch slug'],
    [`post-enginner-git-${'a'.repeat(40)}-${TEAM}.vercel.app`, 'first label longer than 63 characters'],
    [`POST-ENGINNER-GIT-MAIN-${TEAM.toUpperCase()}.VERCEL.APP`, 'uppercase host'],
    [` post-enginner-git-main-${TEAM}.vercel.app`, 'leading whitespace'],
    [`post-enginner-git-main-${TEAM}.vercel.app `, 'trailing whitespace'],
    [`evil-post-enginner-git-main-${TEAM}.vercel.app`, 'prefix not anchored at the start'],
    [`post-enginner-git-main-other-team.vercel.app`, 'another team'],
    [`post-enginner-git-main-evil${TEAM}.vercel.app`, 'team slug fused to another label'],
    ['attacker-app.vercel.app', 'third-party vercel.app project'],
    ['', 'empty string'],
  ])('rejects %s (%s)', (host) => {
    expect(isOwnVercelPreviewHost(host)).toBe(false);
  });
});
