import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { findRepoRoot } from '../../test/repo-root';

const UiDiffConfigSchema = z.object({
  capture: z.object({ mask: z.array(z.string()).default([]) }),
  publish: z.object({ allowPublicRepo: z.boolean().default(false) }).default({ allowPublicRepo: false }),
});

function readConfig(): z.output<typeof UiDiffConfigSchema> {
  const path = join(findRepoRoot(import.meta.url), 'apps/web/ui-diff.config.json');
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return UiDiffConfigSchema.parse(raw);
}

function readPersonaPage(): string {
  const path = join(findRepoRoot(import.meta.url), 'apps/web/app/(main)/persona/page.tsx');
  return readFileSync(path, 'utf8');
}

describe('ui-diff config', () => {
  it('publishes to the public repo only with account and persona identities masked on every capture', () => {
    const config = readConfig();
    expect(config.publish.allowPublicRepo).toBe(true);
    expect(config.capture.mask).toEqual(
      expect.arrayContaining([
        '[data-ui-diff-mask]',
        '[data-testid="account-card"]',
        '[data-testid="profile-user-link"]',
        '[data-testid="mobile-profile-link"]',
        '[data-error-field="avatar"]',
      ]),
    );
  });

  it('masks the persona photo area with a selector the base worktree already renders', () => {
    const mask = readConfig().capture.mask;
    expect(mask).toContain('[data-error-field="avatar"]');
    expect(readPersonaPage()).toContain('data-error-field="avatar"');
  });
});
