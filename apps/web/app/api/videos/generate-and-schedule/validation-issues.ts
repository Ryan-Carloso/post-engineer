//---------------
// Shared shape for generate-and-schedule input validation. Every validator
// returns either its value or the list of problems it found, so the route
// can report every problem in one 400 instead of one per request.
//---------------

import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';

export interface ValidationIssue {
  code: ErrorCode;
  /** Human-readable problem; the first issue's message is the top-level `message`. */
  message: string;
  /** Dotted request path of the failing field, when one is known. */
  field?: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function invalid(message: string, field?: string): ValidationIssue {
  return { code: ERROR_CODES.VALIDATION_FAILED, message, field };
}
