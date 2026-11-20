import type { NextResponse } from 'next/server';

import { apiErrorResponse } from './api-error';
import { ERROR_CODES } from './error-codes';
import { createWarnOnce } from './warn-once';

export const MCP_VERSION_HEADER = 'x-mcp-version';

const ROUTE = 'mcp-version-gate';
export const MISMATCH_WARNING_WINDOW_MS = 60 * 60 * 1000;
export const MISMATCH_WARNING_MAX_PAIRS = 100;
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

export interface McpVersionGateOptions {
  now: () => number;
}

export function createMcpVersionGate(
  options: McpVersionGateOptions,
): (request: Request) => NextResponse | null {
  const shouldWarn = createWarnOnce({
    windowMs: MISMATCH_WARNING_WINDOW_MS,
    maxKeys: MISMATCH_WARNING_MAX_PAIRS,
    now: options.now,
  });
  return (request: Request): NextResponse | null => {
    const clientVersion = request.headers.get(MCP_VERSION_HEADER);
    if (clientVersion === null) return null;
    const required = requiredMcpVersion();
    if (clientVersion === required.text) return null;
    const loggedVersion = parseVersion(clientVersion) !== null ? clientVersion : 'malformed';
    return apiErrorResponse(426, mismatchMessage(clientVersion, required.text), {
      route: ROUTE,
      code: ERROR_CODES.MCP_VERSION_MISMATCH,
      logMessage: 'MCP version mismatch',
      metadata: { clientVersion: loggedVersion },
      extra: { requiredVersion: required.text },
      suppressLog: !shouldWarn(`${loggedVersion} ${required.text}`),
    });
  };
}

export const checkMcpVersion = createMcpVersionGate({ now: Date.now });
