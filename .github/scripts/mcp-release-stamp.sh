#!/usr/bin/env bash
# Writes a release version into apps/mcp/package.json and both version
# fields of apps/mcp/server.json (server + npm package), in the publish
# workspace only — release-mcp.yml never commits the result. The MCP
# Registry rejects a server.json whose versions drift from the npm package,
# and the MCP reports package.json's version in X-MCP-Version, so all three
# must carry the exact version that is published.
#
# Usage: bash .github/scripts/mcp-release-stamp.sh <version> [repo-root]
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Release version \"$version\" is not MAJOR.MINOR.PATCH." >&2
  exit 1
fi
cd "${2:-.}"

node -e "
  const fs = require('fs');
  const version = process.argv[1];
  const pkgPath = 'apps/mcp/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const serverPath = 'apps/mcp/server.json';
  const server = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
  server.version = version;
  server.packages[0].version = version;
  fs.writeFileSync(serverPath, JSON.stringify(server, null, 2) + '\n');
" "$version"
echo "Stamped post-engineer-mcp ${version} into package.json and server.json."
