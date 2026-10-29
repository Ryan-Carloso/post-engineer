import type { NextResponse } from 'next/server';
import { ERROR_CODES } from '@/lib/error-codes';
import { validationFailed } from './prepare-persona';

//---------------
// Request title: the slot label for the one video in this request.
// The topics key is rejected explicitly, before the zod parse: a plain
// zod object strips unknown keys silently, so without this check an old
// caller would get videos it never asked for under a different script.
// The 400 names the field and the replacement (title + segments).
// A blank title is rejected the same way: the slot label must be a
// non-empty string. Each helper returns the 400 response, or null /
// the trimmed title on success.
//---------------
export function rejectTopicsKey(body: unknown): NextResponse | null {
  if (typeof body === 'object' && body !== null && 'topics' in body) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'topics is no longer accepted: send one title plus the full script in options.segments.',
      'topics',
    );
  }
  return null;
}

// Phase 5-4: scriptPrompt/scriptPrompts are no longer generation inputs —
// scripts come from options.segments only. Rejected explicitly, before the
// zod parse: a plain zod object strips unknown keys silently, so without
// this check an old caller would get a video built from segments while
// believing its prompt applied. The 400 names the field and the replacement.
export function rejectScriptPromptKeys(body: unknown): NextResponse | null {
  if (typeof body !== 'object' || body === null || !('options' in body)) return null;
  const options = (body as { options?: unknown }).options;
  if (typeof options !== 'object' || options === null) return null;
  if ('scriptPrompt' in options) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.scriptPrompt is no longer accepted: scripts come from options.segments only.',
      'options.scriptPrompt',
    );
  }
  if ('scriptPrompts' in options) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'options.scriptPrompts is no longer accepted: scripts come from options.segments only.',
      'options.scriptPrompts',
    );
  }
  return null;
}

export function resolveTitle(rawTitle: string): string | NextResponse {
  const title = rawTitle.trim();
  if (title.length === 0) {
    return validationFailed(
      ERROR_CODES.VALIDATION_FAILED,
      'title must be a non-empty string: the slot label for this video.',
      'title',
    );
  }
  return title;
}
