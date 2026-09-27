import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

//---------------
// Ensures that server-only modules (secrets, service_role, cryptography)
// declaram `import 'server-only'`, fazendo o build falhar se qualquer
// client code tries to import them.
//---------------

const SERVER_ONLY_MODULES: readonly string[] = [
  'lib/token-crypto.ts',
  'lib/oauth-utils.ts',
  'lib/youtube.ts',
  'lib/instagram.ts',
  'lib/social-accounts.ts',
  'lib/supabase/server.ts',
  'lib/supabase/service.ts',
  'lib/supabase/middleware.ts',
  'lib/rate-limit.ts',
  'lib/upload/handlers.ts',
];

describe('server-only guard', () => {
  it.each(SERVER_ONLY_MODULES)('%s declara import "server-only"', (relativePath) => {
    const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
  });

  it('shared/client modules do NOT declare "server-only"', () => {
    const sharedModules: readonly string[] = [
      'lib/types.ts',
      'lib/errors.ts',
      'lib/timeout.ts',
      'lib/api.ts',
      'lib/supabase/client.ts',
      'lib/media/upload-schema.ts',
    ];
    for (const relativePath of sharedModules) {
      const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
      expect(source, `${relativePath} should not import server-only`).not.toMatch(
        /import 'server-only';/,
      );
    }
  });
});
