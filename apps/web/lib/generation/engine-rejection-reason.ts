import { sanitizeEngineReason } from '@/lib/scrub';

const VALUE_ERROR_PREFIX = 'Value error, ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function locPrefix(loc: unknown): string | null {
  if (!Array.isArray(loc)) {
    return null;
  }
  const parts = loc.filter(
    (part): part is string | number => typeof part === 'string' || typeof part === 'number',
  );
  const shown = parts[0] === 'body' ? parts.slice(1) : parts;
  if (shown.length === 0) {
    return null;
  }
  return shown.join('.');
}

function stripValueErrorPrefix(msg: string): string {
  return msg.startsWith(VALUE_ERROR_PREFIX) ? msg.slice(VALUE_ERROR_PREFIX.length) : msg;
}

export function extractEngineRejectionReason(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  if (Array.isArray(body.body)) {
    const reasons: string[] = [];
    for (const item of body.body) {
      if (!isRecord(item) || typeof item.msg !== 'string') {
        continue;
      }
      const msg = stripValueErrorPrefix(item.msg);
      const prefix = locPrefix(item.loc);
      reasons.push(prefix !== null ? `${prefix}: ${msg}` : msg);
    }
    if (reasons.length === 0) {
      return null;
    }
    return sanitizeEngineReason(reasons.join('; '));
  }
  if (typeof body.message === 'string') {
    return sanitizeEngineReason(body.message);
  }
  return null;
}
