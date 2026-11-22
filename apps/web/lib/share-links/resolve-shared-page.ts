import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { findActiveShareLink, touchShareLink } from './lookup';
import { loadShareView } from './share-view';
import type { ShareView } from './share-view-types';
import { hashShareToken, isShareTokenShape } from './token';

export type SharedPageResult =
  | { kind: 'view'; view: ShareView }
  | { kind: 'rate-limited' }
  | { kind: 'not-found' };

const TOKEN_BUCKET_LENGTH = 16;

export async function resolveSharedPage(
  token: string,
  request: Request,
  supabase: SupabaseClient,
  now: Date,
): Promise<SharedPageResult> {
  if ((await applyRateLimit(request, RATE_LIMITS.shareViewIp)) !== null) return { kind: 'rate-limited' };
  if (!isShareTokenShape(token)) return { kind: 'not-found' };
  const tokenBucket = hashShareToken(token).slice(0, TOKEN_BUCKET_LENGTH);
  if ((await applyRateLimit(request, RATE_LIMITS.shareViewToken, tokenBucket)) !== null) return { kind: 'rate-limited' };

  const link = await findActiveShareLink(supabase, token, now);
  if (link === null) return { kind: 'not-found' };

  const view = await loadShareView(supabase, link, now);
  await touchShareLink(supabase, link.id, now);
  return { kind: 'view', view };
}
