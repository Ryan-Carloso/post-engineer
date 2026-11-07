import { describe, it, expect, expectTypeOf } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import type { Database } from '@/lib/supabase/database.gen';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';

//---------------
// database.gen.ts is generated from supabase/schema.snapshot.json. This
// suite pins it two ways:
//   - drift: the committed file equals the generator's output (regenerate
//     with `node scripts/db/generate-types.mjs --write`);
//   - the type-level contract the typed clients rely on. The expectTypeOf
//     lines are checked by tsc (CI typecheck), not at runtime: they are
//     what makes a provider/mode the database refuses, or a missing
//     NOT NULL column, a compile error instead of a production 500.
//---------------

type SocialAccountInsert = Database['public']['Tables']['social_accounts']['Insert'];

describe('database.gen.ts', () => {
  it('is up to date with the generator', () => {
    const root = findRepoRoot(import.meta.url);
    const output = execFileSync('node', [join(root, 'scripts', 'db', 'generate-types.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(output).toContain('up to date');
  });

  it('narrows enum CHECK columns to the values the database accepts', () => {
    expectTypeOf<(typeof SOCIAL_PROVIDERS)[number]>().toEqualTypeOf<SocialAccountInsert['provider']>();
    expectTypeOf<'tiktok'>().not.toExtend<SocialAccountInsert['provider']>();
    // Runtime anchor so the test cannot pass vacuously if the import is dropped.
    expect(SOCIAL_PROVIDERS).toContain('threads');
  });

  it('requires NOT NULL columns without a default on insert', () => {
    expectTypeOf<{ provider: 'youtube' }>().not.toExtend<SocialAccountInsert>();
    expectTypeOf<{
      user_id: string;
      provider: 'youtube';
      provider_account_id: string;
      account_metadata: unknown;
      encrypted_tokens: string;
    }>().toExtend<SocialAccountInsert>();
  });
});
