//---------------
// version — identifies the deployed platform build. The repo-root VERSION
// file is the single source of truth, bumped on every PR (see AGENTS.md).
// next.config.ts reads it at build time into APP_VERSION; APP_VERSION is
// also the escape hatch for non-Vercel deployments.
//---------------
export function getDeployedVersion(): string {
  return process.env.APP_VERSION || 'dev';
}
