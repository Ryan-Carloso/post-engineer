const MAX_SOURCE_CHARS = 120;

export function describeImageSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('/')) {
    return cap(trimmed.split('#')[0] ?? trimmed);
  }

  try {
    const url = new URL(trimmed);
    const origin = `${url.protocol}//${url.host}`;
    return cap(`${origin}${url.pathname}`);
  } catch {
    return `<unparseable:${trimmed.length}chars>`;
  }
}

const PUBLIC_ASSET_DIRS: readonly string[] = ['caracter-samples', 'voice-samples'];

const ASSET_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isPublicAssetPath(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  const segments = value.trim().split('/');
  const [root, dir, ...rest] = segments;
  if (root !== '' || dir === undefined || !PUBLIC_ASSET_DIRS.includes(dir)) return false;
  if (rest.length === 0) return false;
  return rest.every((segment) => ASSET_SEGMENT.test(segment));
}

export function toSameOriginAssetPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('/')) {
    try {
      const url = new URL(trimmed);
      if (!isPublicAssetPath(url.pathname)) return trimmed;
      return url.pathname;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function cap(value: string): string {
  return value.length > MAX_SOURCE_CHARS ? `${value.slice(0, MAX_SOURCE_CHARS)}…` : value;
}
