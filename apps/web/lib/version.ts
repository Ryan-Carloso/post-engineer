//---------------
// version — build metadata for the deployed platform build.
//
// VERSION/BUILD/COMMIT are injected at build time: CI sets them from the
// repo-root VERSION file (manual SemVer), the CI run number, and the commit
// SHA; next.config.ts inlines them into the bundle via env. Local builds
// without injected metadata fall back to the VERSION file for the version
// (build/commit stay null there).
//---------------

export interface BuildInfo {
  version: string;
  build: number | null;
  commit: string | null;
}

export function getBuildInfo(): BuildInfo {
  const version = process.env.VERSION?.trim() || 'dev';
  const buildRaw = process.env.BUILD?.trim() ?? '';
  const build = /^\d+$/.test(buildRaw) ? parseInt(buildRaw, 10) : null;
  const commit = process.env.COMMIT?.trim() || null;
  return { version, build, commit };
}

//---------------
// formatBuildInfo — "1.8.0 (502)". The build number is omitted when unknown
// (local builds without injected metadata).
//---------------
export function formatBuildInfo(info: Pick<BuildInfo, 'version' | 'build'>): string {
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
  const buildRaw = record.build;
  const build =
    typeof buildRaw === 'number' && Number.isInteger(buildRaw) && buildRaw >= 0
      ? buildRaw
      : null;
  const commitRaw = record.commit;
  const commit =
    typeof commitRaw === 'string' && commitRaw.trim() !== '' ? commitRaw.trim() : null;
  return { version: version.trim(), build, commit };
}
