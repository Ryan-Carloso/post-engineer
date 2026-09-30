import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

//---------------
// Ensures that server-only modules (secrets, service_role, cryptography)
// declare `import 'server-only'`, so the build fails if any client code
// tries to import them.
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
  // Note: lib/posthog-server.ts is intentionally NOT in this list. It is
  // imported by lib/logger.ts, which client components also import (via
  // lib/api.ts). Instead of `import 'server-only'` (which would break the
  // client bundle), getPostHogServer() returns null in the browser via a
  // `typeof window` runtime guard — client telemetry is a safe no-op.
];

describe('server-only guard', () => {
  it.each(SERVER_ONLY_MODULES)('%s declares import "server-only"', (relativePath) => {
    const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
  });

  it('shared/client modules do NOT declare "server-only"', () => {
    const sharedModules: readonly string[] = [
      'lib/types.ts',
      'lib/errors.ts',
      'lib/timeout.ts',
      'lib/api.ts',
      'lib/client-logger.ts',
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

  it('client components use the client logger, never the server logger', () => {
    // lib/logger.ts pulls in posthog-node via lib/posthog-server.ts, which
    // declares `import 'server-only'`: a client component importing it would
    // break the browser bundle. Client components report through
    // lib/client-logger.ts (browser posthog-js) instead.
    const clientComponents: readonly string[] = [
      'app/global-error.tsx',
      'app/(main)/persona/persona-image-library.tsx',
      'app/login/page.tsx',
    ];
    for (const relativePath of clientComponents) {
      const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
      expect(
        source,
        `${relativePath} must import lib/client-logger, not lib/logger`,
      ).not.toContain("from '@/lib/logger'");
    }
  });
});
