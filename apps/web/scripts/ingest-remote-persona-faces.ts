import { createClient } from '@supabase/supabase-js';

import { logger } from '../lib/logger';
import { ingestRemotePersonaFaces } from '../lib/persona-remote-face';

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await ingestRemotePersonaFaces(supabase);
  logger.info('ingest-remote-persona-faces', {
    migrated: result.migrated,
    skipped: result.skipped,
    failed: result.failed,
  });
}

if (process.argv[1]?.includes('ingest-remote-persona-faces')) {
  main().catch((error: unknown) => {
    logger.error('ingest-remote-persona-faces failed', error);
    process.exit(1);
  });
}
