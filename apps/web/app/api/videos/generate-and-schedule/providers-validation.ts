//---------------
// Provider validation — moved verbatim from route.ts so the route file,
// already over the 500-line cap, does not grow when the full lip-sync
// preflight call is added. Runs BEFORE any token is charged, exactly as
// before.
//---------------

import type { NextResponse } from 'next/server';

import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { ERROR_CODES } from '@/lib/error-codes';
import { validationFailed } from './prepare-persona';

export type Provider = (typeof VALID_SCHEDULE_PROVIDERS)[number];

export function validateProviders(rawProviders: string[]): Provider[] | NextResponse {
  const providers = [...new Set(rawProviders.map((p) => p.trim()).filter((p) => p.length > 0))];
  if (providers.length === 0) {
    return validationFailed(ERROR_CODES.VALIDATION_FAILED, 'Select at least one provider.', 'publishing.providers');
  }
  for (const provider of providers) {
    if (!(VALID_SCHEDULE_PROVIDERS as ReadonlyArray<string>).includes(provider)) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid provider: "${provider}". Use one of ${VALID_SCHEDULE_PROVIDERS.join(', ')}.`,
        'publishing.providers',
      );
    }
  }
  return providers as Provider[];
}
