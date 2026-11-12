# MCP HTTP server (remote transport) production image.
#
# Build context is the MONOREPO ROOT (see docker-compose.yml): the pnpm
# workspace lockfile lives there, and the build runs the sync scripts
# under scripts/ plus the shared sources they copy from.
#
# The image runs only the HTTP transport; the stdio package published to
# npm is built separately and is unaffected.

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Dependency layer first: rebuilds only when the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --filter post-engineer-mcp

# Application code. apps/mcp's prebuild syncs generated copies from
# shared/ via scripts/, so both must be present before `pnpm build`.
COPY apps/mcp ./apps/mcp
COPY shared ./shared
COPY scripts ./scripts
COPY VERSION ./
# pnpm's isolated linker keeps the real packages in /repo/node_modules/.pnpm.
# apps/mcp/node_modules is only relative symlinks, so copying that directory
# into the runner leaves every import pointing at a store the image does not
# contain. `pnpm deploy --legacy` writes a tree whose links stay inside
# node_modules/.pnpm. pnpm 10 refuses deploy without --legacy unless the
# workspace sets inject-workspace-packages.
RUN cd apps/mcp && pnpm build \
    && cd /repo \
    && pnpm --filter post-engineer-mcp --legacy deploy --prod /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production TZ=UTC
WORKDIR /app

COPY --from=builder /out ./

# Non-root runtime user.
RUN addgroup -g 10001 mcp && adduser -u 10001 -G mcp -D mcp \
    && chown -R mcp:mcp /app
USER mcp

EXPOSE 8081
# OAuth env (MCP_OAUTH_ISSUER / MCP_RESOURCE) is required by compose;
# without it serveHttpTransport refuses a non-loopback bind.
CMD ["node", "dist/index.js", "--http-transport", "--host", "0.0.0.0", "--http-port", "8081", "--allow-remote"]
