//---------------
// vercel-preview-host — recognizes THIS project's Vercel previews.
// The OAuth relay (/auth/callback → preview) must only apply to our own
// deploys: a generic *.vercel.app belongs to any Vercel user. Preview hosts
// have the form <project>-<hash>-<team-slug>.vercel.app, and the team slug
// is unique per account — requiring 'post-enginner-*' plus the project's
// own '-<team-slug>.vercel.app' suffix (leading dot included) prevents
// relaying the code to a third-party app (attacker-app.vercel.app and
// vercel.app.evil.com do not end with the suffix).
//---------------

export const VERCEL_PREVIEW_HOST_SUFFIX = '-ryan-carlosos-projects.vercel.app';
const VERCEL_PREVIEW_HOST_PREFIX = 'post-enginner-';

export function isOwnVercelPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host.startsWith(VERCEL_PREVIEW_HOST_PREFIX) &&
    host.endsWith(VERCEL_PREVIEW_HOST_SUFFIX)
  );
}
