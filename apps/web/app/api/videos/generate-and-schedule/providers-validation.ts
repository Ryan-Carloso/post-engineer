//---------------
// Provider validation for POST /api/videos/generate-and-schedule. Runs
// BEFORE any token is charged. Every unknown provider is reported, not just
// the first one.
//---------------

import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { invalid, type Checked } from './validation-issues';

export type Provider = (typeof VALID_SCHEDULE_PROVIDERS)[number];

export function validateProviders(rawProviders: string[]): Checked<Provider[]> {
  const providers = [...new Set(rawProviders.map((p) => p.trim()).filter((p) => p.length > 0))];
  if (providers.length === 0) {
    return { ok: false, issues: [invalid('Select at least one provider.', 'publishing.providers')] };
  }
  const known = VALID_SCHEDULE_PROVIDERS as ReadonlyArray<string>;
  const issues = providers
    .filter((provider) => !known.includes(provider))
    .map((provider) =>
      invalid(
        `Invalid provider: "${provider}". Use one of ${VALID_SCHEDULE_PROVIDERS.join(', ')}.`,
        'publishing.providers',
      ),
    );
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: providers as Provider[] };
}
