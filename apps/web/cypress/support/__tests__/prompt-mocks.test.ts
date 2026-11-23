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

  it('are the only way the user prompts spec builds a prompt detail', () => {
    const spec = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/cypress/e2e/user-prompts.cy.ts'), 'utf8');
    expect(spec).toContain('promptDetail(');
    expect(spec).not.toContain('versionId');
  });
});
