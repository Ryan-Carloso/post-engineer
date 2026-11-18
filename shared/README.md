# Shared TypeScript sources

Single sources of truth used by more than one app, kept here at the repo
root. A pnpm workspace package is not an option for MCP code: the
published MCP package ships only `dist`, and an unpublished workspace
dependency would be missing from a standalone `npm install` of
`post-engineer-mcp`. Consumers reach a shared file through a symlink
when a direct import is blocked by their `rootDir` or by tooling that
copies only the app root (see prompt-base below).

## script-segments

`script-segments/script-segments.ts` is the mechanical segments-script
validation (limits, `normalize`, `validateSegments`, `joinSegments`),
mirroring `apps/engine/app/services/script_segments.py` with the one
documented exception (Python `casefold` vs JS `toLowerCase`, e.g. `ß`).
The engine Python copy stays duplicated on purpose: Python and
TypeScript cannot share code.

The consumers use generated copies, committed to git:

- `apps/web/lib/generation/script-segments.ts`
- `apps/mcp/src/script-segments.ts`

The MCP copy is byte-identical to the shared source. The web copy has
the `.js` suffix stripped from its relative sibling imports
(`./segment-media.js` -> `./segment-media`) so webpack can resolve
them; the sibling helper modules have no imports and are byte-identical
in both apps.

To change the validation, edit only the shared file, then regenerate:

```sh
node scripts/sync-script-segments.mjs
```

Both apps also run the sync from their `prebuild` and `pretest` scripts,
and each app has a `script-segments-shared.test.ts` suite that fails
loudly if a generated copy ever drifts from the shared source. Never
edit a generated copy by hand.

## music-mood-field

`music-mood-field/music-mood-field.ts` is the Zod field schema for
`options.musicMood` on generate-and-schedule (`musicMoodField`: a 1-64
char string, optional) — the first shared JSON body (issue #561). Both
apps already sent this exact shape; sharing it keeps the MCP from
stripping or loosening a mood the web route would reject.

The consumers use byte-identical generated copies, committed to git:

- `apps/web/lib/generation/music-mood-field.ts`
- `apps/mcp/src/music-mood-field.ts`

Unlike script-segments, this file imports `zod`, so it uses only syntax
both apps accept (both run Zod 4.6.7):
`z.string().min().max().optional().describe()`. Each app resolves `zod`
from its own dependencies. The catalog check (a catalogued mood or `"none"`)
stays a separate web-side layer in `lib/generation/music-moods`.

To change the field, edit only the shared file, then regenerate:

```sh
node scripts/sync-music-mood-field.mjs
```

`scripts/sync-script-segments.mjs` runs this sync afterwards and forwards
`--check`. Both apps' `prebuild` and `pretest` scripts run that script.
The music sync is not named in `apps/*/package.json`: those files are
guarded by the parity-exclusion gate. Each app has a
`music-mood-field-shared.test.ts` drift suite, and each runs the same
payload contract table in `music-mood-field.test.ts` against its own
copy. Never edit a generated copy by hand.

## prompt-base

`prompt-base/prompt-base.ts` holds the text of every prompt in the prompts
hub: `SHARED_PROMPT_BASE` (rules for all prompts) plus each composed prompt
(`[...SHARED_PROMPT_BASE, '', ...specificLines].join('\n')`). A new prompt
gets every shared rule by spreading the base. Web, MCP, and docs never repeat
this text: docs link to the hub.

There is exactly one prompt-base file in git: this one. The web reads it
through a symlink, not a copy:

- `apps/web/lib/generation/prompt-base.ts` ->
  `../../../../shared/prompt-base/prompt-base.ts`

A direct import is not an option: the web `rootDir` makes `tsc` reject
it with TS6059, and Stryker's sandbox copies only the app root, so a
direct import breaks mutation testing (verified: Stryker fails with
"No tests were executed" on a directly imported shared file). The
symlink is dereferenced by `tsc`, webpack, vitest, and Stryker.

The MCP has no copy: `prompts (action: list)`, `prompts (action: get)` and the slash commands
fetch the recipes from the web API (`GET /api/prompts`,
`GET /api/prompts/[slug]`), so a recipe edit reaches every MCP install
without a package release.

To change the base, edit only this file. The web
`prompt-base-shared.test.ts` suite fails loudly if a copy ever
reappears.

## contracts

`contracts/providers.ts` is THE list of social networks (`SOCIAL_PROVIDERS`)
plus its named subsets (`DIRECT_CONNECT_PROVIDERS`, `OAUTH_CONNECT_PROVIDERS`).
The web, the MCP and the OpenAPI generator all import it; the generator
imports the shared file directly (it has no imports, and Node strips the
types; `contracts/package.json` marks the folder as ES modules). Never type
the list again anywhere: `apps/web/lib/__tests__/provider-list-single-source.test.ts`
fails on any array or union that lists every network outside this file.

`contracts/*.ts` are the shared endpoint contracts: one `defineEndpoint`
per web API exchange (`method`, `path`, optional `body`/`query`, `response`
schemas) plus the `BodyOf`/`QueryOf`/`ResponseOf`/`ParamsOf` types derived
from it. The pilot is the experiments API (`POST /api/experiments`,
`GET /api/experiments`, `GET /api/experiments/:id`); the prompts catalog
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
`POST /api/rumble-connect`, `GET /api/pinterest/boards`,
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
