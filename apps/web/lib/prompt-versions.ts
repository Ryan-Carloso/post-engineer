import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { logger } from '@/lib/logger';
import type { PostPromptFacts } from '@/lib/slot-detail';
import { UserPromptStoreError } from '@/lib/user-prompts';

type Db = SupabaseClient<Database>;

export interface PromptVersionRef {
  versionId: string;
  version: number;
}

export async function currentUserPromptVersion(db: Db, promptId: string): Promise<PromptVersionRef> {
  const { data, error } = await db
    .from('prompt_versions')
    .select('id, version')
    .eq('prompt_id', promptId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new UserPromptStoreError('current version', error);
  if (data === null) throw new UserPromptStoreError('current version', new Error(`prompt ${promptId} has no version`));
  return { versionId: data.id, version: data.version };
}

export async function readPostPromptFacts(db: SupabaseClient, versionId: string | null): Promise<PostPromptFacts | null> {
  if (versionId === null) return null;
  const { data, error } = await db
    .from('prompt_versions')
    .select('slug, title, version, source')
    .eq('id', versionId)
    .maybeSingle();
  if (error !== null) {
    logger.error('[prompt-versions] post prompt lookup failed', error, { versionId, code: error.code });
    return null;
  }
  if (data === null) {
    logger.error('[prompt-versions] post prompt version missing', undefined, { versionId });
    return null;
  }
  const row = data as { slug: string; title: string; version: number; source: string };
  if (row.source !== 'official' && row.source !== 'user') return null;
  return { slug: row.slug, title: row.title, version: row.version, source: row.source };
}
