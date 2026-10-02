//---------------
// error-codes — stable codes, default messages, template filling.
//---------------

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorMessage, formatErrorMessage, isErrorCode } from '../error-codes';
import { SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_MIN_ADVANCE_HOURS } from '../schedule-window';

describe('error-codes', () => {
  it('exposes every code required by the generate-and-schedule contract', () => {
    const required = [
      'PERSONA_NOT_FOUND',
      'PERSONA_ACCESS_DENIED',
      'PERSONA_SCOPE_DENIED',
      'SOCIAL_ACCOUNT_NOT_OWNED',
      'INVALID_PROVIDER_ACCOUNT',
      'NO_CONNECTED_ACCOUNTS',
      'TOPICS_REQUIRED',
      'TOPICS_LIMIT_EXCEEDED',
      'INVALID_SCHEDULE_TIME',
      'SCHEDULE_OUT_OF_RANGE',
      'INSUFFICIENT_TOKENS',
      'RATE_LIMIT_EXCEEDED',
      'VALIDATION_FAILED',
      'INTERNAL_ERROR',
      'ENGINE_UNAVAILABLE',
    ] as const;
    for (const code of required) {
      expect(ERROR_CODES[code], code).toBe(code);
      expect(errorMessage(code).length, code).toBeGreaterThan(0);
    }
  });

  it('fills {placeholders} in INSUFFICIENT_TOKENS', () => {
    expect(formatErrorMessage('INSUFFICIENT_TOKENS', { need: 850, have: 600 })).toBe(
      'You need 850 tokens, but only have 600.',
    );
  });

  it('fills the {provider} placeholder', () => {
    expect(formatErrorMessage('SOCIAL_ACCOUNT_NOT_OWNED', { provider: 'youtube' })).toBe(
      'Selected youtube account does not belong to this user.',
    );
  });

  it('keeps SCHEDULE_OUT_OF_RANGE as a {minHours}/{maxDays} template fed from the shared constants', () => {
    // The default message must stay a template: hardcoding the window here
    // is exactly the drift this PR's reviewer flagged.
    expect(errorMessage('SCHEDULE_OUT_OF_RANGE')).toContain('{minHours}');
    expect(errorMessage('SCHEDULE_OUT_OF_RANGE')).toContain('{maxDays}');
    expect(
      formatErrorMessage('SCHEDULE_OUT_OF_RANGE', {
        minHours: SCHEDULE_MIN_ADVANCE_HOURS,
        maxDays: SCHEDULE_MAX_AHEAD_DAYS,
      }),
    ).toBe('Publishing must be scheduled between 3 hours and 30 days from now.');
  });

  it('leaves unknown placeholders untouched instead of breaking the sentence', () => {
    expect(formatErrorMessage('INSUFFICIENT_TOKENS')).toBe(
      'You need {need} tokens, but only have {have}.',
    );
  });

  it('never leaks internals in the INTERNAL_ERROR default message', () => {
    const message = errorMessage('INTERNAL_ERROR').toLowerCase();
    for (const leaked of ['stack', 'sql', 'trace', 'path']) {
      expect(message).not.toContain(leaked);
    }
  });

  it('isErrorCode narrows valid codes only', () => {
    expect(isErrorCode('TOPICS_REQUIRED')).toBe(true);
    expect(isErrorCode('SOMETHING_WRONG')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
