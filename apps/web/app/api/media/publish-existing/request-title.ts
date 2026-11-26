import { invalid, type Checked } from './validation-issues';

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
