//---------------
// mcp-version-gate — the web API serves exactly one MCP version.
//
// Every request the MCP sends carries its package version in the
// X-MCP-Version header (apps/mcp/src/analytics.ts). The VPS deploy
// computes the version the web requires (REQUIRED_MCP_VERSION:
// apps/mcp/package.json MAJOR.MINOR + the PR number of the last merge
// that touched apps/mcp/, the same rule .github/scripts/mcp-release-version.sh
// publishes to npm with) and only deploys the web once npm serves that
// version, so the version this gate asks for always exists on npm.
//
// - No header: not the MCP (the dashboard, a direct API call, the engine),
//   so the request passes untouched and the env is not read.
// - Header equal to the required version: passes.
// - Anything else: 426 with MCP_VERSION_MISMATCH and the exact npx
//   command that installs the required version. An older MCP is stale; a
//   newer one means npm already has a release the web has not deployed
//   yet, which the deploy closes within minutes.
// - REQUIRED_MCP_VERSION missing or malformed: throws (no fallback). The
//   web compose file refuses to start without it, so this only fires on a
//   misconfigured local setup.
//---------------

import type { NextResponse } from 'next/server';

import { apiErrorResponse } from './api-error';
import { ERROR_CODES } from './error-codes';

/** Lowercase form of the MCP's X-MCP-Version header (pinned by a sync test). */
export const MCP_VERSION_HEADER = 'x-mcp-version';

const ROUTE = 'mcp-version-gate';
const VERSION_SHAPE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;

type VersionParts = [number, number, number];

function parseVersion(value: string): VersionParts | null {
  const match = VERSION_SHAPE.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: VersionParts, b: VersionParts): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function requiredMcpVersion(): { text: string; parts: VersionParts } {
  const text = process.env.REQUIRED_MCP_VERSION;
  if (text === undefined || text === '') {
    throw new Error('REQUIRED_MCP_VERSION is not defined');
  }
  const parts = parseVersion(text);
  if (parts === null) {
    throw new Error('REQUIRED_MCP_VERSION must be MAJOR.MINOR.PATCH');
  }
  return { text, parts };
}

function mismatchMessage(clientVersion: string, required: string): string {
  const install = `npx -y post-engineer-mcp@${required}`;
  const clientParts = parseVersion(clientVersion);
  const requiredParts = parseVersion(required);
  if (clientParts === null || requiredParts === null) {
    // Never echo a header value that is not version-shaped.
    return `This post-engineer-mcp version is not supported: this server requires ${required}. Restart the MCP with ${install}.`;
  }
  if (compareVersions(clientParts, requiredParts) > 0) {
    return (
      `post-engineer-mcp ${clientVersion} is newer than this server, which requires ${required}: a deploy is in progress. ` +
      `Retry in a few minutes, or restart the MCP with ${install}.`
    );
  }
  return `post-engineer-mcp ${clientVersion} is out of date: this server requires ${required}. Restart the MCP with ${install}.`;
}

/**
 * Returns a 426 response when the request comes from an MCP whose version
 * differs from REQUIRED_MCP_VERSION, null when the request may proceed.
 */
export function checkMcpVersion(request: Request): NextResponse | null {
  const clientVersion = request.headers.get(MCP_VERSION_HEADER);
  if (clientVersion === null) return null;
  const required = requiredMcpVersion();
  if (clientVersion === required.text) return null;
  const versionShaped = parseVersion(clientVersion) !== null;
  return apiErrorResponse(426, mismatchMessage(clientVersion, required.text), {
    route: ROUTE,
    code: ERROR_CODES.MCP_VERSION_MISMATCH,
    logMessage: 'MCP version mismatch',
    metadata: { clientVersion: versionShaped ? clientVersion : 'malformed' },
    extra: { requiredVersion: required.text },
  });
}
