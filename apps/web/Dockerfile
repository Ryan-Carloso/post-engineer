# Web (Next.js) production image.
#
# Build context is the MONOREPO ROOT (see docker-compose.yml): the pnpm
# workspace lockfile and the repo-root VERSION file live there.
#
# .env is NOT baked into the runtime image beyond the build: NEXT_PUBLIC_*
# vars are inlined at build time (inject_secrets copies apps/web/.env into
# apps/web/ before `docker compose build` runs), and server-side secrets
# come from env_file at runtime (see docker-compose.yml).

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Dependency layer first: rebuilds only when the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# Application code, VERSION (inlined as APP_VERSION) and build-time env.
COPY VERSION ./
COPY apps/web ./apps/web
RUN cd apps/web && pnpm build

FROM node:22-alpine AS runner
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app

# Next.js standalone output: server.js plus only the traced node_modules.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

# Non-root runtime user.
RUN addgroup -g 10001 web && adduser -u 10001 -G web -D web \
    && chown -R web:web /app
USER web

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
