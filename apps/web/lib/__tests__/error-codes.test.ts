import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorMessage, formatErrorMessage, isErrorCode } from '../error-codes';
import { SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_MIN_ADVANCE_HOURS } from '../schedule-window';

describe('error-codes', () => {
  it('exposes every code the publish and persona routes return', () => {
    const required = [
      'PERSONA_NOT_FOUND',
      'PERSONA_ACCESS_DENIED',
      'PERSONA_SCOPE_DENIED',
      'SOCIAL_ACCOUNT_NOT_OWNED',
      'INVALID_PROVIDER_ACCOUNT',
      'NO_CONNECTED_ACCOUNTS',
      'ACCOUNT_NOT_BOUND_TO_PERSONA',
      'PERSONA_NO_BOUND_ACCOUNTS',
      'SCHEDULE_OUT_OF_RANGE',
      'VALIDATION_FAILED',
      'TRIAL_EXPIRED',
      'SLOT_NOT_AWAITING_APPROVAL',
      'INTERNAL_ERROR',
    ] as const;
    for (const code of required) {
      expect(ERROR_CODES[code], code).toBe(code);
      expect(errorMessage(code).length, code).toBeGreaterThan(0);
    }
  });

  it('has no generation or token codes left', () => {
    for (const code of ['INSUFFICIENT_TOKENS', 'ENGINE_REJECTED', 'ENGINE_UNAVAILABLE', 'UNKNOWN_VOICE', 'QUOTE_EXPIRED']) {
      expect(isErrorCode(code), code).toBe(false);
    }
  });

  it('leaves unknown placeholders untouched instead of breaking the sentence', () => {
    expect(formatErrorMessage('SOCIAL_ACCOUNT_NOT_OWNED')).toBe(
      'Selected {provider} account does not belong to this user.',
    );
  });


  it('fills the {provider} placeholder', () => {
    expect(formatErrorMessage('SOCIAL_ACCOUNT_NOT_OWNED', { provider: 'youtube' })).toBe(
      'Selected youtube account does not belong to this user.',
    );
  });

  it('keeps SCHEDULE_OUT_OF_RANGE as a {minHours}/{maxDays} template fed from the shared constants', () => {
    expect(errorMessage('SCHEDULE_OUT_OF_RANGE')).toContain('{minHours}');
    expect(errorMessage('SCHEDULE_OUT_OF_RANGE')).toContain('{maxDays}');
    expect(
      formatErrorMessage('SCHEDULE_OUT_OF_RANGE', {
        minHours: SCHEDULE_MIN_ADVANCE_HOURS,
        maxDays: SCHEDULE_MAX_AHEAD_DAYS,
      }),
    ).toBe('Publishing must be scheduled between 3 hours and 30 days from now.');
  });

  it('never leaks internals in the INTERNAL_ERROR default message', () => {
    const message = errorMessage('INTERNAL_ERROR').toLowerCase();
    for (const leaked of ['stack', 'sql', 'trace', 'path']) {
      expect(message).not.toContain(leaked);
    }
  });

  it('isErrorCode narrows valid codes only', () => {
    expect(isErrorCode('TRIAL_EXPIRED')).toBe(true);
    expect(isErrorCode('SOMETHING_WRONG')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
