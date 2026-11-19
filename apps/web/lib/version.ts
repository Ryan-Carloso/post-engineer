export interface BuildInfo {
  version: string;
  pr: number | null;
  build: number | null;
  commit: string | null;
  builtAt: string | null;
}

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
    builtAt: process.env.BUILT_AT?.trim() || null,
  };
}

export function formatBuildInfo(
  info: Pick<BuildInfo, 'version' | 'build' | 'pr'>,
): string {
  if (info.pr !== null) return `${info.version} (#${info.pr})`;
  return info.build === null ? info.version : `${info.version} (${info.build})`;
}

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
  const builtAtRaw = record.builtAt;
  const builtAt =
    typeof builtAtRaw === 'string' && builtAtRaw.trim() !== '' ? builtAtRaw.trim() : null;
  return { version: version.trim(), pr, build, commit, builtAt };
}
