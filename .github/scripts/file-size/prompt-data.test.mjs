import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPromptDataFile } from './prompt-data.mjs';

describe('prompt-data files', () => {
  it('matches the prompt store itself', () => {
    assert.equal(isPromptDataFile('shared/prompt-base/prompt-base.ts'), true);
  });

  it('matches files nested under shared/prompt-base/', () => {
    assert.equal(isPromptDataFile('shared/prompt-base/story-first-reels.ts'), true);
    assert.equal(isPromptDataFile('shared/prompt-base/steps/full-setup.ts'), true);
  });

  it('does not match a file merely named prompt-base elsewhere', () => {
    assert.equal(isPromptDataFile('apps/web/lib/prompt-base.ts'), false);
    assert.equal(isPromptDataFile('apps/web/lib/generation/prompt-base.ts'), false);
  });

  it('does not match the top-level shared/prompt-base.ts file', () => {
    assert.equal(isPromptDataFile('shared/prompt-base.ts'), false);
  });

  it('does not match other shared files', () => {
    assert.equal(isPromptDataFile('shared/other.ts'), false);
    assert.equal(isPromptDataFile('shared/prompt-base.md'), false);
  });
});
