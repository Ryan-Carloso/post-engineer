import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type PromptVersionCheck = 'ok' | 'not_found' | 'error';

export interface PromptVersionQuery {
  versionId: string;
  userId: string;
  allowOwn: boolean;
}

export async function checkPromptVersion(supabase: SupabaseClient, query: PromptVersionQuery): Promise<PromptVersionCheck> {
  const { data: version, error } = await supabase
    .from('prompt_versions')
    .select('id, source, owner_id, prompt_id')
    .eq('id', query.versionId)
    .maybeSingle();
  if (error !== null) {
    logger.error('[generate-and-schedule] prompt version lookup failed', error, { versionId: query.versionId });
    return 'error';
  }
  if (version === null) return 'not_found';
  if (version.source === 'official') return 'ok';
  if (query.allowOwn && version.owner_id === query.userId) return 'ok';
  if (version.prompt_id === null) return 'not_found';
  const { data: prompt, error: promptError } = await supabase
    .from('user_prompts')
    .select('visibility')
    .eq('id', version.prompt_id)
    .maybeSingle();
  if (promptError !== null) {
    logger.error('[generate-and-schedule] prompt visibility lookup failed', promptError, { versionId: query.versionId });
    return 'error';
  }
  return prompt !== null && prompt.visibility === 'public' ? 'ok' : 'not_found';
}
