import { invalid, type Checked, type ValidationIssue } from './validation-issues';

//---------------
// Request title: the slot label for the one video in this request.
// The topics and script-prompt keys are rejected explicitly, before the zod
// parse: a plain zod object strips unknown keys silently, so without these
// checks an old caller would get videos it never asked for under a
// different script. Each 400 names the field and the replacement (title +
// segments). A blank title is rejected the same way.
//---------------

export function rawKeyIssues(body: unknown): ValidationIssue[] {
  if (typeof body !== 'object' || body === null) return [];
  const issues: ValidationIssue[] = [];
  if ('topics' in body) {
    issues.push(invalid('topics is no longer accepted: send one title plus the full script in options.segments.', 'topics'));
  }
  if (!('options' in body)) return issues;
  const options = (body as { options?: unknown }).options;
  if (typeof options !== 'object' || options === null) return issues;
  if ('scriptPrompt' in options) {
    issues.push(invalid('options.scriptPrompt is no longer accepted: scripts come from options.segments only.', 'options.scriptPrompt'));
  }
  if ('scriptPrompts' in options) {
    issues.push(invalid('options.scriptPrompts is no longer accepted: scripts come from options.segments only.', 'options.scriptPrompts'));
  }
  return issues;
}

export function resolveTitle(rawTitle: string): Checked<string> {
  const title = rawTitle.trim();
  if (title.length === 0) {
    return {
      ok: false,
      issues: [invalid('title must be a non-empty string: the slot label for this video.', 'title')],
    };
  }
  return { ok: true, value: title };
}
