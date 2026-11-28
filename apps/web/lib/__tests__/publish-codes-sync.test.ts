import { describe, expect, it } from 'vitest';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { SOCIAL_PROVIDERS } from '@/lib/contracts/providers';
import { classifyFailure, userNotice } from '@/lib/publisher/outcomes';
import { classifyUploadAccountError } from '@/lib/upload/account-error';
import { USER_ACCOUNT_ERROR_CODES } from '@/lib/upload/account-error-codes';
import { TRANSIENT_HTTP_STATUSES } from '@/lib/upload/account-error';

describe('publish code sync (scheduler ↔ upload route)', () => {
  it('pins the two code sets that must stay disjoint', () => {
    expect(USER_ACCOUNT_ERROR_CODES.length).toBe(4);
    expect(TRANSIENT_HTTP_STATUSES.size).toBeGreaterThan(0);
  });

  it('treats every user-account code as requiring the owner to reconnect', () => {
    for (const code of USER_ACCOUNT_ERROR_CODES) {
      expect(classifyFailure(code)).toEqual({ code, requiresUser: true });
    }
  });

  it('names every provider in the reconnect notice with its shared label', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(userNotice(provider, 'token_expired')).toContain(PROVIDER_LABELS[provider]);
    }
  });

  it('maps every retryable upload status to a transient failure the scheduler retries', () => {
    for (const status of TRANSIENT_HTTP_STATUSES) {
      const classified = classifyUploadAccountError({ status });
      expect(classified.errorCode).toBe('transient');
      expect(classifyFailure(classified.errorCode)).toEqual({ code: 'transient', requiresUser: false });
    }
  });
});
