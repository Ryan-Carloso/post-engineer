import os from 'node:os';
import { redactCredentialFragments } from '@/lib/scrub';

const SECRET_VALUE_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|session)["']?\s*[:=]\s*["']?([^\s,;"']+)|(bearer)\s+([^\s,;"']+)|\b(sk-(?:or-v1-)?[A-Za-z0-9_-]{20,})/gi;

const ABSOLUTE_PATH_PATTERN = /(?<![\w:/<>])(?:\/[\w.\-~]+)+/g;
const REDACTED = '[redacted]';
const TRUNCATION_MARKER = '\n…\n';

export function scrubSecretValues(text: string): string {
  return redactCredentialFragments(
    text.replace(
      SECRET_VALUE_PATTERN,
      (
        _match: string,
        key: string | undefined,
        _value: string | undefined,
        bearer: string | undefined,
      ): string => {
        const name = key ?? bearer;
        if (name === undefined) return REDACTED;
        return `${name}${key !== undefined ? '=' : ' '}${REDACTED}`;
      },
    ),
  );
}

function replaceLocalRoots(text: string): string {
  const roots: Array<[string, string]> = [];
  const home = os.homedir();
  if (home !== '' && home !== '/') roots.push([home, '<home>']);
  const storage = os.tmpdir();
  if (storage !== '' && storage !== '/' && storage !== home) roots.push([storage, '<storage>']);
  let result = text;
  for (const [root, placeholder] of roots.sort((a, b) => b[0].length - a[0].length)) {
    result = result.split(root).join(placeholder);
  }
  result = result.replace(/(<home>|<storage>)(?:\/[^\s"'/<>]+)+\/([^\s"'/<>]+)/g, '$1/$2');
  return result.replace(ABSOLUTE_PATH_PATTERN, (match: string) => {
    const name = match.slice(match.lastIndexOf('/') + 1);
    return `<path>/${name}`;
  });
}

export function scrubErrorText(text: string, maxChars = 500): string {
  if (text === '') return '';
  const cleaned = replaceLocalRoots(scrubSecretValues(text));
  if (cleaned.length <= maxChars) return cleaned;
  const firstLine = cleaned.split('\n', 1)[0] ?? '';
  const tailBudget = maxChars - firstLine.length - TRUNCATION_MARKER.length;
  if (tailBudget <= 0) return cleaned.slice(-maxChars);
  return firstLine + TRUNCATION_MARKER + cleaned.slice(cleaned.length - tailBudget);
}

export function nonEmptyErrorReason(text: string, fallback: string, maxChars = 200): string {
  const cleaned = scrubErrorText(text, maxChars).trim();
  if (cleaned !== '') return cleaned;
  const fallbackClean = scrubErrorText(fallback, maxChars).trim();
  return fallbackClean === '' ? 'Error' : fallbackClean;
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

export function diagnosticOf(error: unknown): string {
  const name = error instanceof Error && error.name !== '' ? error.name : 'Error';
  const message = scrubErrorText(errorMessageOf(error), 400);
  return message === '' ? name : `${name}: ${message}`;
}
