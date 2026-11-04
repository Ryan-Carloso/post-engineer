import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { RECIPE_NUDGE_SURFACES } from '../mcp-tool-telemetry';

//---------------
// The MCP sends the recipe-adoption headers (apps/mcp/src/recipe-session.ts)
// and this app validates them (lib/mcp-tool-telemetry.ts). The two apps
// share no module, so this test parses the MCP source: every header name and
// every nudge surface the MCP can send must be one the web records, or the
// property silently disappears from PostHog.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const mcpSource = readFileSync(join(repoRoot, 'apps/mcp/src/recipe-session.ts'), 'utf8');
const webSource = readFileSync(join(repoRoot, 'apps/web/lib/mcp-tool-telemetry.ts'), 'utf8');

function mcpHeaderNames(): string[] {
  return [...mcpSource.matchAll(/export const MCP_[A-Z_]+_HEADER = '(X-MCP-[A-Za-z-]+)';/g)].map((match) => match[1] ?? '');
}

function mcpNudgeSurfaces(): string[] {
  const start = mcpSource.indexOf('export const RECIPE_NUDGE_SURFACES = [');
  const end = mcpSource.indexOf('] as const;', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...mcpSource.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('MCP recipe-adoption headers stay in sync with the web telemetry', () => {
  it('records every X-MCP-* recipe header the MCP sends', () => {
    const names = mcpHeaderNames();
    expect(names).toHaveLength(7);
    for (const name of names) {
      expect(webSource).toContain(`'${name.toLowerCase()}'`);
    }
  });

  it('accepts every nudge surface the MCP can report, plus none', () => {
    const surfaces = mcpNudgeSurfaces();
    expect(surfaces.length).toBeGreaterThan(0);
    expect([...RECIPE_NUDGE_SURFACES].sort()).toEqual(['none', ...surfaces].sort());
  });
});
