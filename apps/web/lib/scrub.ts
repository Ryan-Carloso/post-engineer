const SECRET_KEY_PATTERN =
  /password|passwd|secret|token|authorization|auth\b|api[-_]?key|bearer|credential|private[-_]?key|session/i;

const REDACTED = '[redacted]';

const MAX_SCRUB_DEPTH = 5;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function scrubSecrets(metadata: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      scrubbed[key] = REDACTED;
    } else if (depth < MAX_SCRUB_DEPTH && isPlainRecord(value)) {
      scrubbed[key] = scrubSecrets(value, depth + 1);
    } else if (depth < MAX_SCRUB_DEPTH && Array.isArray(value)) {
      scrubbed[key] = value.map((item) => {
        if (isPlainRecord(item)) return scrubSecrets(item, depth + 1);
        if (typeof item === 'string') return redactCredentialFragments(item);
        return item;
      });
    } else if (typeof value === 'string') {
      scrubbed[key] = redactCredentialFragments(value);
    } else if (value instanceof Error) {
      scrubbed[key] = { message: value.message, name: value.name };
    } else if (value instanceof Date) {
      scrubbed[key] = value.toISOString();
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

export function redactCredentialFragments(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

export const ENGINE_REASON_MAX_CHARS = 200;

function basenameOfPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function redactLocalPaths(text: string): string {
  return text
    .replace(/(^|[\s"'\(=,])([A-Za-z]:\\[^\s"'\)\],;]+)/g, (_match, prefix: string, path: string) => `${prefix}${basenameOfPath(path)}`)
    .replace(/(^|[\s"'\(=,])(\/[^\s"'\)\],;:]+(?:\/[^\s"'\)\],;:]+)*)/g, (_match, prefix: string, path: string) => `${prefix}${basenameOfPath(path)}`);
}

export function sanitizeEngineReason(text: string): string | null {
  const collapsed = redactLocalPaths(redactCredentialFragments(text)).replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.slice(0, ENGINE_REASON_MAX_CHARS);
}
