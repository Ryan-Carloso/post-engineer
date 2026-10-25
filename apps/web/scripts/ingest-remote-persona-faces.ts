//---------------
// One-shot: ingest remote http(s) persona avatar_url values into the
// personas bucket. Service-role client only — does not call GET /api/persona/list.
//
// 200 image -> upload and clear avatar_url in one update.
// 404 / non-image -> leave the row.
// A second run is a no-op (rows with photo_path, samples, data:image skipped).
//
// Do not run this against production from the PR; four muse.ai avatar_url
// rows are 404 and cannot be repaired (see the ingest run log for ids).
//
//   pnpm exec tsx apps/web/scripts/ingest-remote-persona-faces.ts
//---------------

import { createClient } from '@supabase/supabase-js';

import { ingestRemotePersonaFaces } from '@/lib/persona-remote-face';

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
  console.log(
    `ingest-remote-persona-faces: migrated=${result.migrated} skipped=${result.skipped} failed=${result.failed}`,
  );
}

if (process.argv[1]?.includes('ingest-remote-persona-faces')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
