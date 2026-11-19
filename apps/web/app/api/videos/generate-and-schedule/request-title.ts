import { invalid, type Checked, type ValidationIssue } from './validation-issues';

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
