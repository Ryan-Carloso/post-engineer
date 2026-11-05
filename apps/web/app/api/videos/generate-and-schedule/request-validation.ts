//---------------
// Request validation for POST /api/videos/generate-and-schedule. Runs before
// auth and before any token is charged, and reports every problem it finds
// in one 400: the top-level code/message/field describe the first problem
// (so existing clients keep working), and `errors` lists all of them.
//
// Order is fixed (topics/script-prompt keys, shape, title, segments,
// providers, options, persona-less rules) so the first problem reported is
// the same one a single-error response would have named. When the shape
// fails, the semantic checks are skipped: they need the parsed fields.
//---------------

import type { NextResponse } from 'next/server';
import type { z } from 'zod';

import { trackApiEvent } from '@/lib/analytics';
import { coded } from './prepare-persona';
import { resolveTitle } from './request-title';
import { validateSegmentsRequest } from './segments-validation';
import { validateProviders, type Provider } from './providers-validation';
import { validateOptions, type OptionsInput, type ValidatedOptions } from './options-validation';
import type { Checked, ValidationIssue } from './validation-issues';

export function shapeIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: 'VALIDATION_FAILED' as const,
    message: `Invalid request: ${issue.message}`,
    field: issue.path.length > 0 ? issue.path.join('.') : undefined,
  }));
}

export interface SemanticInput {
  title: string;
  segments: unknown;
  providers: string[];
  options: OptionsInput;
  /** Null for a post without a persona (see route.ts). */
  personaId: string | null;
}

export interface CheckedRequest {
  title: string;
  script: string;
  providers: Provider[];
  options: ValidatedOptions;
}

/** A post without a persona has no face and no voice: both are required. */
function personaLessIssues(options: ValidatedOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!options.faceless) {
    issues.push({
      code: 'VALIDATION_FAILED',
      message: 'A post without a persona must be faceless: set options.faceless to true.',
      field: 'options.faceless',
    });
  }
  if (options.voiceId === undefined && options.audioUrl === undefined) {
    issues.push({
      code: 'VALIDATION_FAILED',
      message: 'A post without a persona needs a voice: set options.voiceId (or options.audioUrl).',
      field: 'options.voiceId',
    });
  }
  return issues;
}

export function checkSemantics(input: SemanticInput): Checked<CheckedRequest> {
  const issues: ValidationIssue[] = [];
  const title = resolveTitle(input.title);
  if (!title.ok) issues.push(...title.issues);
  const segments = validateSegmentsRequest(input.segments);
  if (!segments.ok) issues.push(...segments.issues);
  const providers = validateProviders(input.providers);
  if (!providers.ok) issues.push(...providers.issues);
  const options = validateOptions(input.options);
  if (!options.ok) issues.push(...options.issues);
  if (options.ok && input.personaId === null) issues.push(...personaLessIssues(options.value));
  if (issues.length > 0 || !title.ok || !segments.ok || !providers.ok || !options.ok) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { title: title.value, script: segments.value, providers: providers.value, options: options.value },
  };
}

/** Track once per rejected request and return the 400 with every problem. */
export function rejectInvalidRequest(issues: ValidationIssue[]): NextResponse {
  const [first] = issues;
  trackApiEvent('video_creation_validation_failed', {
    errorCode: first.code,
    field: first.field ?? null,
    errorCount: issues.length,
    fields: issues.map((issue) => issue.field ?? null),
  });
  return coded(400, first.code, first.message, first.field, {
    errors: issues.map((issue) => ({ code: issue.code, message: issue.message, field: issue.field })),
  });
}
