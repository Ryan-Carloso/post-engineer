import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GetPromptResponseSchema } from '@/lib/contracts/prompts';
import { findRepoRoot } from '../../../test/repo-root';
import { promptDetail } from '../prompt-mocks';

const summary = { slug: 'mine', title: 'Mine', description: 'About', source: 'own', visibility: 'private', verified: false };

describe('Cypress prompt detail mocks', () => {
  it('build a response the web client accepts under the shared prompt contract', () => {
    expect(GetPromptResponseSchema.safeParse({ success: true, prompt: promptDetail(summary, 'Text') }).success).toBe(true);
  });

  it.each(['user-prompts.cy.ts', 'prompts-hub.cy.ts'])('are the only way %s builds a prompt detail', (specName) => {
    const spec = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/cypress/e2e', specName), 'utf8');
    expect(spec).toContain('promptDetail(');
    expect(spec).not.toContain('versionId');
  });
});
