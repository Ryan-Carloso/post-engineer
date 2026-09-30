//---------------
// version — identifies the deployed build. Shared by the public
// /api/version endpoint, the startup log line, and the Sentry release tag.
// Vercel sets VERCEL_GIT_COMMIT_SHA automatically on every deployment,
// so the reported version always matches the live code with no manual step.
// APP_VERSION is the escape hatch for non-Vercel deployments.
//---------------
export function getDeployedVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_VERSION || 'dev';
}
