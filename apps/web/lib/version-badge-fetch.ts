export const VERSION_BADGE_FALLBACK_LABEL = 'BETA';

//---------------
// readVersionBody — the raw /api/version payload, or null when the read
// fails (any network error, non-ok status, or unparseable body).
// Resolving instead of rejecting keeps the shared request from poisoning
// the other badge copies with an unhandled rejection: a failed read
// degrades the pill, never breaks the page it sits on.
//---------------
async function readVersionBody(): Promise<unknown> {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

let inflight: Promise<unknown> | null = null;

//---------------
// fetchVersionBadgeBody — one in-flight /api/version read shared by every
// mounted VersionBadge copy.
//
// The badge renders twice in the app shell (desktop sidebar + mobile
// header; one is hidden by CSS but both stay mounted) and a third time
// on /account, and each web-side read re-asks the video engine for a
// value that cannot change during a visit — so per-copy fetches asked
// the same question two or three times per page load. The copies now
// share a single request.
//
// Only the in-flight request is shared: once it settles the reference is
// dropped, so a badge mounted by a later navigation fetches fresh
// instead of sticking to a stale (or failed) body forever.
//---------------
export function fetchVersionBadgeBody(): Promise<unknown> {
  if (inflight !== null) return inflight;
  const request = readVersionBody().finally(() => {
    if (inflight === request) inflight = null;
  });
  inflight = request;
  return request;
}
