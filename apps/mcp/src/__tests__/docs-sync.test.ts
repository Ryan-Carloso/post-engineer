import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  const windowSurfaces = [
    { label: 'apps/mcp/src/publish-existing-shape.ts', rel: '../publish-existing-shape.ts' },
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
      expect(content).not.toMatch(/24h\s*[-–]\s*30d/);
    });
  }
});

describe('MCP npx install command sync', () => {
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
