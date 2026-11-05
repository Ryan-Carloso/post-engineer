import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every user-facing surface that lists MCP tools as documentation must stay
// in sync with the registered tools, so agents reading any of them see the
// full surface (batch generation, task progress, image library, account
// connect) instead of a stale subset. Tool registrations live in every
// apps/mcp/src file that calls server.tool(...), not only index.ts, so the
// discovery scans all of src and skips the test fixtures.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...collectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

const toolNames = collectFiles(srcDir)
  .map((file) => [...readFileSync(file, 'utf8').matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map((m) => m[1]))
  .flat();

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

  // Coverage across files, not just one: a registration added to a module
  // other than index.ts (tools-prompts.ts today) must still surface here.
  const srcFiles = collectFiles(srcDir);
  it('discoveries run over more than one source file', () => {
    expect(srcFiles.length).toBeGreaterThan(1);
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
  // The schedule-window copy lives in the file that defines the schedule
  // shape: since Phase 4 the single-video shape (with its startAt window)
  // lives in single-video-shape.ts, not tools.ts, so that is the surface
  // that must advertise the window.
  const windowSurfaces = [
    { label: 'apps/mcp/src/index.ts', rel: '../index.ts' },
    { label: 'apps/mcp/src/single-video-shape.ts', rel: '../single-video-shape.ts' },
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

describe('MCP npx install command sync', () => {
  // Every surface that tells users how to install the MCP server via npx
  // must pin @latest: npx reuses its cached copy without checking for
  // updates, so an unpinned command silently serves a stale version whose
  // tools may no longer exist server-side. Change all surfaces together,
  // or update this test.
  const npxSurfaces = [
    { label: 'apps/mcp/README.md', rel: ['..', '..', 'README.md'] },
    {
      label: 'apps/web/lib/mcp-install-prompt.ts',
      rel: ['..', '..', '..', 'web', 'lib', 'mcp-install-prompt.ts'],
    },
    { label: 'README.md', rel: ['..', '..', '..', '..', 'README.md'] },
    { label: 'README.pt-BR.md', rel: ['..', '..', '..', '..', 'README.pt-BR.md'] },
  ].map(({ label, rel }) => ({
    label,
    content: readFileSync(join(here, ...rel), 'utf8'),
  }));

  for (const { label, content } of npxSurfaces) {
    it(`pins post-engineer-mcp@latest in the npx command in ${label}`, () => {
      const commandLines = content
        .split('\n')
        .filter((line) => line.includes('"command"') && line.includes('npx'));
      expect(
        commandLines.length,
        `${label} is expected to carry an npx install command`,
      ).toBeGreaterThan(0);
      for (const line of commandLines) {
        expect(line, `${label} npx command line`).toContain(
          'post-engineer-mcp@latest',
        );
      }
    });
  }
});
