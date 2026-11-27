import { z } from 'zod';

import { SOCIAL_PROVIDERS } from './providers.js';

export const ACCOUNT_NEEDS_RECONNECT_WARNING_CODE = 'account_needs_reconnect';

export const AccountNeedsReconnectWarningSchema = z.object({
  code: z.literal(ACCOUNT_NEEDS_RECONNECT_WARNING_CODE),
  accounts: z.array(z.object({
    provider: z.enum(SOCIAL_PROVIDERS),
    accountId: z.string().min(1),
  })).min(1),
});

