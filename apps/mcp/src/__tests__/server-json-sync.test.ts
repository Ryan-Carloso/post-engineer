import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// server.json is the MCP Registry metadata. The registry rejects a publish
// whose name differs from package.json mcpName, and release-mcp.yml refuses
// to publish when the versions drift, so pin both here (and the auto-bump
// workflow that rewrites them) before a release ever runs.
const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, '..', '..');
const repoRoot = join(mcpRoot, '..', '..');

type ServerJson = {
  name: string;
  version: string;
  description: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string;
    environmentVariables: Array<{ name: string; isRequired: boolean; isSecret: boolean }>;
  }>;
};

const pkg: { name: string; mcpName: string; version: string } = JSON.parse(
  readFileSync(join(mcpRoot, 'package.json'), 'utf8'),
);
const server: ServerJson = JSON.parse(readFileSync(join(mcpRoot, 'server.json'), 'utf8'));
const indexTs = readFileSync(join(here, '..', 'index.ts'), 'utf8');

describe('server.json (MCP Registry metadata)', () => {
  it('uses the package mcpName as the registry name', () => {
    expect(server.name).toBe(pkg.mcpName);
  });

  it('keeps the server and npm package versions equal to package.json', () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it('points at the published npm package', () => {
    expect(server.packages[0].registryType).toBe('npm');
    expect(server.packages[0].identifier).toBe(pkg.name);
  });

  it('keeps the description within the registry limit of 100 characters', () => {
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('declares the API key the server requires as a required secret', () => {
    expect(indexTs.includes("'POST_ENGINEER_API_KEY is required'")).toBe(true);
    const key = server.packages[0].environmentVariables.find(
      (v) => v.name === 'POST_ENGINEER_API_KEY',
    );
    expect(key).toEqual(expect.objectContaining({ isRequired: true, isSecret: true }));
  });
});

describe('release workflows keep server.json in step', () => {
  const autoBump = readFileSync(join(repoRoot, '.github/workflows/release-mcp-auto.yml'), 'utf8');
  const release = readFileSync(join(repoRoot, '.github/workflows/release-mcp.yml'), 'utf8');

  it('auto-bump rewrites both server.json versions and stages the file', () => {
    expect(autoBump.includes('server.version = version;')).toBe(true);
    expect(autoBump.includes('server.packages[0].version = version;')).toBe(true);
    expect(autoBump.includes('git add apps/mcp/package.json apps/mcp/server.json')).toBe(true);
  });

  it('auto-release treats a package.json edit without a new version as a real change', () => {
    expect(autoBump.includes('if [ "$OLD_VERSION" = "$NEW_PKG_VERSION" ]; then')).toBe(true);
  });

  it('auto-release still releases a merge that changes server.json without package.json', () => {
    expect(
      autoBump.includes(
        `elif [ "$PKG_CHANGED" = "no" ] && printf '%s\\n' "$CHANGED" | grep -qx 'apps/mcp/server.json'; then`,
      ),
    ).toBe(true);
  });

  it('release publishes to the MCP Registry after npm, with OIDC login', () => {
    const npmPublish = release.indexOf('npm publish --provenance --access public');
    const registryPublish = release.indexOf('./mcp-publisher publish');
    expect(npmPublish).toBeGreaterThan(-1);
    expect(registryPublish).toBeGreaterThan(npmPublish);
    expect(release.includes('./mcp-publisher login github-oidc')).toBe(true);
    // The drift check must stop the release before npm ships anything.
    const verify = release.indexOf('- name: Verify server.json matches the package');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(npmPublish);
    expect(release.includes('id-token: write')).toBe(true);
  });
});
