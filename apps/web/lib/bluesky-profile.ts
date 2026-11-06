//---------------
// fetchBlueskyPublicProfile — display name and avatar of a Bluesky account.
// Profiles are public on the AppView, so no session or app password is
// needed: connect and the 24h profile resync both read it by DID. The host
// is fixed (never user input), https only, with a timeout.
//---------------

export const BLUESKY_PUBLIC_APPVIEW = 'https://public.api.bsky.app';
export const BLUESKY_PROFILE_TIMEOUT_MS = 8000;

export interface BlueskyPublicProfile {
  did: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
}

export class BlueskyProfileError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'BlueskyProfileError';
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function fetchBlueskyPublicProfile(actor: string): Promise<BlueskyPublicProfile> {
  const url = `${BLUESKY_PUBLIC_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(BLUESKY_PROFILE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new BlueskyProfileError(`BLUESKY_PROFILE_FAILED: status ${response.status}`, response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BlueskyProfileError('BLUESKY_PROFILE_FAILED: non-JSON body', response.status);
  }
  if (typeof body !== 'object' || body === null) {
    throw new BlueskyProfileError('BLUESKY_PROFILE_FAILED: empty body', response.status);
  }
  const record = body as Record<string, unknown>;
  const did = optionalString(record.did);
  const handle = optionalString(record.handle);
  if (did === null || handle === null) {
    throw new BlueskyProfileError('BLUESKY_PROFILE_FAILED: missing did or handle', response.status);
  }
  return {
    did,
    handle,
    displayName: optionalString(record.displayName),
    avatar: optionalString(record.avatar),
  };
}
