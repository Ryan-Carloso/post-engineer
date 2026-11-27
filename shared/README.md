# Shared TypeScript sources

Single sources of truth used by more than one app, kept here at the repo
root. A pnpm workspace package is not an option for MCP code: the
published MCP package ships only `dist`, and an unpublished workspace
dependency would be missing from a standalone `npm install` of
`post-engineer-mcp`. Consumers reach a shared file through a symlink
when a direct import is blocked by their `rootDir` or by tooling that
copies only the app root.

## contracts

`contracts/providers.ts` is THE list of social networks (`SOCIAL_PROVIDERS`)
plus its named subsets (`DIRECT_CONNECT_PROVIDERS`, `OAUTH_CONNECT_PROVIDERS`).
The web, the MCP and the OpenAPI generator all import it; the generator
imports the shared file directly (it has no imports, and Node strips the
types; `contracts/package.json` marks the folder as ES modules). Never type
the list again anywhere: the `provider-lists` lint
(`.github/scripts/provider-lists/check.mjs`, CI workflow `provider-lists`)
reads the web, MCP, shared and scripts sources and fails on a
hand-typed provider list (any array, union, tuple or `Literal` of three or
more networks outside this file), on a per-provider ternary/if/switch chain
(use a `Record<SocialProvider, …>`), and on a per-provider map or select
string that skips a network (give every network an entry, `null` when it has
nothing to do, or match a named subset exported here). A new subset is a
fact of its own: export it here, `satisfies readonly SocialProvider[]`.
`contracts/*.ts` are the shared endpoint contracts: one `defineEndpoint`
per web API exchange (`method`, `path`, optional `body`/`query`, `response`
schemas) plus the `BodyOf`/`QueryOf`/`ResponseOf`/`ParamsOf` types derived
from it. The prompt comparison (`GET /api/experiments`), the prompts catalog
(`GET /api/prompts`, `GET /api/prompts/[slug]`), the billing wallet
(`GET /api/billing/tokens`, `GET /api/billing/transactions`), the post
detail (`GET /api/posts/[id]`) and the metrics reads
(`GET /api/metrics`, `GET /api/metrics/retention-curve`, including their
strict query parsing) and the media calls (`POST /api/media/upload`,
`POST /api/media/check`, `POST /api/upload-content`) follow the same
shape: renaming a field there fails `pnpm typecheck` in BOTH apps in the same change, with no
runtime change (same URLs, same 400 messages). The accounts calls
(`GET /api/account`, `DELETE /api/account`, `POST /api/account/connect-url`,
`POST /api/bluesky-connect`, `POST /api/threespeak-connect`,
`POST /api/rumble-connect`, `POST /api/telegram-connect`, `GET /api/pinterest/boards`,
`GET /api/persona/publishing-accounts`, `PUT /api/persona/publishing-accounts`,
including their strict query parsing) follow the same shape. The schedule calls
(`GET /api/schedule`, `DELETE /api/schedule`, `GET /api/schedule/status`,
`GET /api/schedule/slots/[slotId]`, `PATCH /api/schedule/slots/[slotId]`,
`DELETE /api/schedule/slots/[slotId]`, including the limit/range query parsing
and the cancel facts) follow the same shape. The video-tasks calls
(`GET /api/persona/video-generations`, `GET /api/persona/video-generations/[generationId]`,
`GET /api/persona/video-status/[taskId]`, `DELETE /api/persona/video-task/[taskId]`,
including the generations limit parsing) follow the same shape. The voices calls
(`GET /api/persona/voices`, `GET /api/persona/cloned-voices`, `POST /api/persona/cloned-voices`,
`GET /api/persona/cloned-voices/[cloneId]`, `DELETE /api/persona/cloned-voices/[cloneId]`,
including the voice catalog enums and the cloned row shape) follow the same shape.
The personas calls (`POST /api/persona`, `GET /api/persona/list`, `GET /api/persona/faces`,
`PATCH /api/persona`, `GET /api/persona/delete-preview`, `DELETE /api/persona`,
`GET /api/persona/images`, `POST /api/persona/images`, `PATCH /api/persona/images`,
`DELETE /api/persona/images`, including the persona constants, the library row shapes,
and the personaId/id query parsing) follow the same shape. The videos calls
(`POST /api/videos/generate-and-schedule`, `POST /api/videos/validate-script`,
`POST /api/videos/score-draft`, `POST /api/videos/batch-discount`, `POST /api/videos/upload-url`,
`POST /api/videos/uploads/[uploadId]/complete`, `POST /api/videos/publish-by-id`, including
the video-type literals, the segments caps, the batch/draft/upload constants and the
publish-by-id body) follow the same shape.
The two preview endpoints (`POST /api/persona/voices/[voiceId]/preview`,
`POST /api/persona/cloned-voices/[cloneId]/preview`) return raw audio bytes, not JSON,
so they share only the request body (`PreviewVoiceBodySchema`, 300-char cap) — the
preview parsers in each route stay, and the cap is pinned four ways
(`clone-preview-text-sync.test.ts`). The web route reads the
body through the shared schema. The MCP functions issue a literal
`client.request` (method + path) and parse the response with the contract,
so the parity gate still sees the endpoint. Request bodies are
`z.strictObject`/`.strict()`; responses are plain `z.object` (extra fields
ignored). Shared files import only `zod` (both apps resolve zod 4.6.7).

The consumers use generated copies, gitignored (not committed):

- `apps/web/lib/contracts/*.ts`
- `apps/mcp/src/contracts/*.ts`

To change a contract, edit only the shared file, then regenerate:

```sh
node scripts/sync-contracts.mjs
```

The sync also runs from the root `postinstall` and `typecheck` scripts
and is chained from `scripts/sync-script-segments.mjs` (which both apps
already run from `prebuild`/`pretest`). `scripts/sync-contracts.mjs --check`
fails when a copy drifts. Each app has a `contracts-shared.test.ts` drift
suite and a `contracts-typecheck.test.ts` type pin. Never edit a generated
copy by hand.

Nx does not hash gitignored files, and the generated copies are
gitignored, so a cached task would stay green after a contract edit.
`nx.json` adds `shared/**` and `scripts/sync-*.mjs` to the inputs of the
`typecheck`, `lint` and `test` target defaults. The same globs in
`sharedGlobals` do not change the MCP task hash; the explicit target
inputs do. The web `build` target lists the same globs in
`apps/web/project.json`, and the root `build` script runs the sync before
Nx, so a contract edit invalidates the cached bundle and the build
compiles fresh copies. The MCP npm release runs `pnpm build` in
`apps/mcp` directly, not through Nx, and that `prebuild` syncs the copies.
