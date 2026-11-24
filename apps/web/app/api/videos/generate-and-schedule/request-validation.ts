import type { NextResponse } from 'next/server';
import type { z } from 'zod';

import { trackApiEvent } from '@/lib/analytics';
import { coded } from './prepare-persona';
import { resolveTitle } from './request-title';
import { validateSegmentsRequest } from './segments-validation';
import { validateProviders, validatePinterestBoard, type Provider } from './providers-validation';
import { validateOptions, type OptionsInput, type ValidatedOptions } from './options-validation';
import { invalid, MAX_REPORTED_ISSUES, type Checked, type ValidationIssue } from './validation-issues';

export { MAX_REPORTED_ISSUES };

export function shapeIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: 'VALIDATION_FAILED' as const,
    message: `Invalid request: ${issue.message}`,
    field: issue.path.length > 0 ? issue.path.join('.') : undefined,
  }));
}

export interface SemanticInput {
  title: string;
  description: string;
  segments: unknown;
  providers: string[];
  options: OptionsInput;
  personaId: string | null;
  pinterestBoardId?: string;
}

export interface CheckedRequest {
  title: string;
  description: string;
  script: string;
  providers: Provider[];
  options: ValidatedOptions;
  pinterestBoardId: string | null;
}

function personaLessIssues(options: ValidatedOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (options.videoType !== 'voiceover') {
    issues.push({
      code: 'VALIDATION_FAILED',
      message: 'A post without a persona must be voiceover: set options.videoType to \'voiceover\'.',
      field: 'options.videoType',
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

function resolveDescription(description: string): Checked<string> {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      issues: [invalid('description must be a non-empty string: the publish copy for this video.', 'description')],
    };
  }
  return { ok: true, value: trimmed };
}

export function checkSemantics(input: SemanticInput): Checked<CheckedRequest> {
  const issues: ValidationIssue[] = [];
  const title = resolveTitle(input.title);
  if (!title.ok) issues.push(...title.issues);
  const description = resolveDescription(input.description);
  if (!description.ok) issues.push(...description.issues);
  const segments = validateSegmentsRequest(input.segments, input.options.videoType);
  if (!segments.ok) issues.push(...segments.issues);
  const providers = validateProviders(input.providers);
  if (!providers.ok) issues.push(...providers.issues);
  const pinterestBoardId = validatePinterestBoard(providers.ok ? providers.value : input.providers, input.pinterestBoardId);
  if (!pinterestBoardId.ok) issues.push(...pinterestBoardId.issues);
  const options = validateOptions(input.options);
  if (!options.ok) issues.push(...options.issues);
  if (options.ok && input.personaId === null) issues.push(...personaLessIssues(options.value));
  if (issues.length > 0 || !title.ok || !description.ok || !segments.ok || !providers.ok || !pinterestBoardId.ok || !options.ok) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { title: title.value, description: description.value, script: segments.value, providers: providers.value, options: options.value, pinterestBoardId: pinterestBoardId.value },
  };
}

const MAX_FIELD_PATH_CHARS = 200;

const MAX_ECHOED_MESSAGE_CHARS = 500;

function capField(field: string | undefined): string | undefined {
  return field === undefined ? undefined : field.slice(0, MAX_FIELD_PATH_CHARS);
}

function capMessage(message: string): string {
  return message.slice(0, MAX_ECHOED_MESSAGE_CHARS);
}

export function rejectInvalidRequest(issues: ValidationIssue[]): NextResponse {
  const reported = issues.slice(0, MAX_REPORTED_ISSUES);
  const [first] = reported;
  const field = capField(first.field);
  const message = capMessage(first.message);
  trackApiEvent('video_creation_validation_failed', {
    errorCode: first.code,
    field: field ?? null,
    errorCount: issues.length,
    fields: reported.map((issue) => capField(issue.field) ?? null),
  });
  return coded(400, first.code, message, field, {
    errors: reported.map((issue) => ({
      code: issue.code,
      message: capMessage(issue.message),
      field: capField(issue.field),
    })),
  });
}
