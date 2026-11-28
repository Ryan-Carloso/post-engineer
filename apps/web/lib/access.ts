import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-error';
import { DISCORD_INVITE_URL, whatsappUrl } from '@/lib/public-links';
import { ERROR_CODES, errorMessage, type ErrorCode } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { Database } from '@/lib/supabase/database.gen';
import { accessReasonOf, computeAccessStatus, type AccessReason } from '@/lib/access-status';

export interface AccessGateOptions {
  route: string;
  supabase?: SupabaseClient<Database>;
  now?: () => Date;
}

interface AccessWindow {
  accessUntil: string;
  subscriptionStatus: string | null;
}

async function readAccessWindow(supabase: SupabaseClient<Database>, userId: string): Promise<AccessWindow> {
  const { error: ensureError } = await supabase
    .from('user_profiles')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (ensureError) throw new Error(`access profile upsert failed: ${ensureError.message}`);
  const { data, error } = await supabase
    .from('user_profiles')
    .select('access_until,subscription_status')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`access lookup failed: ${error.message}`);
  return { accessUntil: data.access_until, subscriptionStatus: data.subscription_status };
}

function blockedCode(reason: AccessReason): ErrorCode {
  return reason === 'beta' ? ERROR_CODES.BETA_ACCESS_REQUIRED : ERROR_CODES.SUBSCRIPTION_INACTIVE;
}

export async function assertAccessActive(
  userId: string,
  options: AccessGateOptions,
): Promise<NextResponse | null> {
  const supabase = options.supabase ?? createSupabaseServiceClient();
  const now = options.now ?? (() => new Date());
  let window: AccessWindow;
  try {
    window = await readAccessWindow(supabase, userId);
  } catch (error) {
    logger.error('[access] could not read the access window; blocking the action', error, { userId });
    return apiErrorResponse(500, errorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route: options.route,
      code: ERROR_CODES.INTERNAL_ERROR,
      cause: error,
    });
  }
  const status = computeAccessStatus(window, now());
  if (status.active) return null;
  const code = blockedCode(accessReasonOf(window.subscriptionStatus));
  return apiErrorResponse(402, errorMessage(code), {
    route: options.route,
    code,
    extra: { contactUrl: code === ERROR_CODES.BETA_ACCESS_REQUIRED ? DISCORD_INVITE_URL : whatsappUrl(), accessEndedAt: window.accessUntil, reason: status.reason },
  });
}
