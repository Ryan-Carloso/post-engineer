import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { USER_PROMPT_LIMITS, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';

interface Snapshot {
  tables: Record<string, { constraints: Record<string, string> }>;
}

const snapshot = JSON.parse(readFileSync(join(findRepoRoot(import.meta.url), 'supabase', 'schema.snapshot.json'), 'utf8')) as Snapshot;
const checks = snapshot.tables.prompt_versions.constraints;

describe('prompt_versions limits match the prompts they copy', () => {
  it('stores the same slug pattern and title cap as user_prompts', () => {
    expect(checks.prompt_versions_slug_check).toContain(`slug ~ '${USER_PROMPT_SLUG_PATTERN.source}'`);
    expect(checks.prompt_versions_title_check).toContain(`char_length(title) <= ${USER_PROMPT_LIMITS.title}`);
  });

  it('ties an owner to user versions only', () => {
    expect(checks.prompt_versions_owner_source_check).toContain("(owner_id IS NOT NULL) = (source <> 'official'::text)");
  });
});
