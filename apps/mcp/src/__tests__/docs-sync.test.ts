import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The README tool list must document every registered MCP tool, so agents
// reading the docs see the full surface (batch generation, task progress,
// image library, account connect) instead of a stale subset.
const here = dirname(fileURLToPath(import.meta.url));
const indexTs = readFileSync(join(here, '..', 'index.ts'), 'utf8');
const readme = readFileSync(join(here, '..', '..', 'README.md'), 'utf8');

const toolNames = [...indexTs.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(
  (m) => m[1],
);

describe('README tool docs sync', () => {
  it('registers at least one tool', () => {
    expect(toolNames.length).toBeGreaterThan(0);
  });

  it.each(toolNames)('documents tool `%s` in README.md', (name) => {
    expect(readme).toContain(`\`${name}\``);
  });
});
