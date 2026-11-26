import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { contactWhatsappUrl } from '@/lib/contact-whatsapp';
import { ERROR_CODES, errorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/lib/supabase/database.gen';
import { computeTrialStatus } from '@/lib/trial-status';

export interface TrialGateOptions {
  route: string;
  supabase?: SupabaseClient<Database>;
  now?: () => Date;
}

async function readTrialEndsAt(supabase: SupabaseClient<Database>, userId: string): Promise<string> {
  const { error: ensureError } = await supabase
    .from('user_profiles')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (ensureError) throw new Error(`trial profile upsert failed: ${ensureError.message}`);
  const { data, error } = await supabase
    .from('user_profiles')
    .select('trial_ends_at')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`trial lookup failed: ${error.message}`);
  return data.trial_ends_at;
}

export async function assertTrialActive(
  userId: string,
  options: TrialGateOptions,
): Promise<NextResponse | null> {
  const supabase = options.supabase ?? createSupabaseServiceClient();
  const now = options.now ?? (() => new Date());
  let endsAt: string;
  try {
    endsAt = await readTrialEndsAt(supabase, userId);
  } catch (error) {
    logger.error('[trial] could not read the trial window; blocking the action', error, { userId });
    return apiErrorResponse(500, errorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: options.route,
      code: ERROR_CODES.INTERNAL_ERROR,
      cause: error,
    });
  }
  if (computeTrialStatus(endsAt, now()).active) return null;
  return apiErrorResponse(402, errorMessage(ERROR_CODES.TRIAL_EXPIRED), {
    route: options.route,
    code: ERROR_CODES.TRIAL_EXPIRED,
    extra: { contactUrl: contactWhatsappUrl(), trialEndedAt: endsAt },
  });
}
