//---------------
// api-telemetry-names coverage — every API route label must have a
// semantic PostHog event name.
//
// withApiErrorReporting('METHOD /api/...') labels are the keys of
// API_TELEMETRY_NAMES. This test walks every route.ts under
// apps/web/app/api, extracts the labels (the same extraction the
// web->MCP parity test uses, including const-identifier indirection),
// and fails when a label has no table entry — so a new route without a
// semantic name breaks CI instead of silently falling back to the
// generic server_success / server_warning.
//---------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_TELEMETRY_NAMES } from '@/lib/api-telemetry-names';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..', '..', 'app', 'api');

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out.sort();
}

// Mirror of the web->MCP parity test's label discovery: inline literals
// plus `const NAME = 'label'` indirection.
function discoverLabels(): string[] {
  const labels: string[] = [];
  for (const file of collectRouteFiles(apiDir)) {
    const content = readFileSync(file, 'utf8');
    const constStrings = new Map<string, string>();
    for (const m of content.matchAll(/const ([A-Za-z_$][\w$]*) = '([^']+)'/g)) {
      constStrings.set(m[1], m[2]);
    }
    for (const m of content.matchAll(
      /withApiErrorReporting\((?:'([^']+)'|([A-Za-z_$][\w$]*))/g,
    )) {
      const literal = m[1];
      const identifier = m[2];
      const label =
        literal !== undefined ? literal : constStrings.get(identifier ?? '');
      if (label === undefined) {
        throw new Error(
          `${file}: withApiErrorReporting label is not a resolvable string literal`,
        );
      }
      labels.push(label);
    }
  }
  return [...new Set(labels)].sort();
}

const discovered = discoverLabels();
const mapped = new Set(Object.keys(API_TELEMETRY_NAMES));

describe('api-telemetry-names coverage', () => {
  it('discovers at least one route label', () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it.each(discovered)('route label %s has a semantic event name', (label) => {
    expect(
      mapped.has(label),
      `add '${label}' to API_TELEMETRY_NAMES in apps/web/lib/api-telemetry-names.ts`,
    ).toBe(true);
  });
});
