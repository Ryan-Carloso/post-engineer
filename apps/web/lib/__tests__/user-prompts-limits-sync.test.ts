import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { USER_PROMPT_LIMITS, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';

interface Snapshot {
  tables: Record<string, { constraints: Record<string, string> }>;
}

const snapshot = JSON.parse(readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'schema.snapshot.json'), 'utf8')) as Snapshot;
const checks = snapshot.tables.user_prompts.constraints;

describe('user_prompts limits match the contract', () => {
  it('caps the title at the contract length', () => {
    expect(checks.user_prompts_title_check).toContain(`char_length(title) <= ${USER_PROMPT_LIMITS.title}`);
  });

  it('caps the description at the contract length', () => {
    expect(checks.user_prompts_description_check).toContain(`char_length(description) <= ${USER_PROMPT_LIMITS.description}`);
  });

  it('caps the stored prompt text at the contract length', () => {
    expect(checks.user_prompts_body_check).toContain(`char_length(body) <= ${USER_PROMPT_LIMITS.prompt}`);
  });

  it('caps the rejection reason at the contract length', () => {
    expect(checks.user_prompts_rejection_reason_check).toContain(`char_length(rejection_reason) <= ${USER_PROMPT_LIMITS.rejectionReason}`);
  });

  it('accepts slugs with the same pattern the contract validates', () => {
    expect(checks.user_prompts_slug_check).toContain(`slug ~ '${USER_PROMPT_SLUG_PATTERN.source}'`);
    expect(USER_PROMPT_LIMITS.slug).toBe(64);
    expect(USER_PROMPT_SLUG_PATTERN.source).toContain(`{0,${USER_PROMPT_LIMITS.slug - 1}}`);
  });
});
