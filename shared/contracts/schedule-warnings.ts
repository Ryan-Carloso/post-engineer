// Schedule warning objects (never a bare string). `voice_fallback_applied`
// names the voice the route swapped in. `account_needs_reconnect` names
// the accounts whose stored login is already dead.
import { z } from 'zod';

import { SOCIAL_PROVIDERS } from './metrics.js';

export const VOICE_FALLBACK_WARNING_CODE = 'voice_fallback_applied';
export const ACCOUNT_NEEDS_RECONNECT_WARNING_CODE = 'account_needs_reconnect';

export const VoiceFallbackWarningSchema = z.object({
  code: z.literal(VOICE_FALLBACK_WARNING_CODE),
  fromVoice: z.string(),
  toVoice: z.string(),
});

export const AccountNeedsReconnectWarningSchema = z.object({
  code: z.literal(ACCOUNT_NEEDS_RECONNECT_WARNING_CODE),
  accounts: z.array(z.object({
    provider: z.enum(SOCIAL_PROVIDERS),
    accountId: z.string().min(1),
  })).min(1),
});

export const ScheduleWarningSchema = z.discriminatedUnion('code', [
  VoiceFallbackWarningSchema,
  AccountNeedsReconnectWarningSchema,
]);
