//---------------
// version — build metadata for the deployed platform build.
//
// VERSION/PR_NUMBER/BUILD/COMMIT are injected at build time. In production
// the VPS deploy generates them from the commit being deployed: VERSION is
// MAJOR.MINOR.PR (e.g. 1.28.152), PR_NUMBER and BUILD carry that PR's
// number and COMMIT the SHA; next.config.ts inlines them into the bundle via
// env. Local builds without injected metadata fall back to the VERSION file
// for the version (pr/build/commit stay null there).
//---------------

export interface BuildInfo {
  version: string;
  /** Merged PR number that produced the deployed commit (null when unknown). */
  pr: number | null;
  /** Build identifier; mirrors `pr` on the VPS deploy, CI's run number in CI. */
  build: number | null;
  commit: string | null;
}

//---------------
// Strict narrowing: only an all-digit string is a number here. A
// non-numeric value degrades to null instead of rendering as NaN.
//---------------
function toBuildNumber(raw: string | undefined): number | null {
  const value = raw?.trim() ?? '';
  return /^\d+$/.test(value) ? parseInt(value, 10) : null;
}

export function getBuildInfo(): BuildInfo {
  const version = process.env.VERSION?.trim() || 'dev';
  const pr = toBuildNumber(process.env.PR_NUMBER);
  return {
    version,
    pr,
    build: toBuildNumber(process.env.BUILD) ?? pr,
    commit: process.env.COMMIT?.trim() || null,
  };
}

//---------------
// formatBuildInfo — "1.28.152 (#152)". The PR number is the deployment
// build identifier; `build` is shown only as the fallback for payloads that
// carry no PR (CI builds, older engines).
//---------------
export function formatBuildInfo(
  info: Pick<BuildInfo, 'version' | 'build' | 'pr'>,
): string {
  if (info.pr !== null) return `${info.version} (#${info.pr})`;
  return info.build === null ? info.version : `${info.version} (${info.build})`;
}

//---------------
// parseBuildInfo — defensive parse of a /version payload (unknown wire
// shape). Returns null when the payload is not a plausible build-info
// object, so callers degrade instead of rendering garbage.
//---------------
export function parseBuildInfo(body: unknown): BuildInfo | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const version = record.version;
  if (typeof version !== 'string' || version.trim() === '') return null;
  const toNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  const pr = toNumber(record.pr);
  const build = toNumber(record.build) ?? pr;
  const commitRaw = record.commit;
  const commit =
    typeof commitRaw === 'string' && commitRaw.trim() !== '' ? commitRaw.trim() : null;
  return { version: version.trim(), pr, build, commit };
}
