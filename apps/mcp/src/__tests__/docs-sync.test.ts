import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every user-facing surface that lists MCP tools as documentation must stay
// in sync with the registered tools, so agents reading any of them see the
// full surface (batch generation, task progress, image library, account
// connect) instead of a stale subset.
const here = dirname(fileURLToPath(import.meta.url));
const indexTs = readFileSync(join(here, '..', 'index.ts'), 'utf8');

const toolNames = [...indexTs.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(
  (m) => m[1],
);

// Doc surfaces that enumerate the tool list, relative to apps/mcp/.
const docFiles: Array<{ path: string; label: string }> = [
  { path: 'README.md', label: 'apps/mcp/README.md' },
  {
    path: join('..', 'web', 'components', 'ui', 'mcp-docs-section.tsx'),
    label: 'apps/web/components/ui/mcp-docs-section.tsx',
  },
];

const docs = docFiles.map(({ path, label }) => ({
  label,
  content: readFileSync(join(here, '..', '..', path), 'utf8'),
}));

describe('MCP tool docs sync', () => {
  it('registers at least one tool', () => {
    expect(toolNames.length).toBeGreaterThan(0);
  });

  it('has at least one doc surface', () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  for (const { label, content } of docs) {
    it.each(toolNames)(`documents tool \`%s\` in ${label}`, (name) => {
      expect(content).toContain(name);
    });
  }
});

describe('MCP schedule window copy sync', () => {
  // Every surface that tells agents the schedule window must advertise the
  // same 3h minimum: a one-sided edit (or a bad conflict resolution) would
  // silently teach agents the old rule while the server enforces the real
  // one. Change all three surfaces together, or update this test.
  const windowSurfaces = [
    { label: 'apps/mcp/src/index.ts', rel: '../index.ts' },
    { label: 'apps/mcp/src/tools.ts', rel: '../tools.ts' },
    { label: 'apps/mcp/README.md', rel: '../../README.md' },
  ].map(({ label, rel }) => ({
    label,
    content: readFileSync(join(here, rel), 'utf8'),
  }));

  for (const { label, content } of windowSurfaces) {
    it(`advertises the 3h minimum schedule window in ${label}`, () => {
      expect(content).toMatch(/3h[-–]30d/);
    });

    it(`does not advertise the old 24h schedule window in ${label}`, () => {
      // Scoped to the window phrase: a bare '24h' is legitimate clock-format
      // copy ("times (HH:MM, 24h)").
      expect(content).not.toMatch(/24h\s*[-–]\s*30d/);
    });
  }
});
