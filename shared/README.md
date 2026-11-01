# Shared TypeScript sources

Single sources of truth used by more than one app, kept here at the repo
root. A pnpm workspace package is not an option for MCP code: the
published MCP package ships only `dist`, and an unpublished workspace
dependency would be missing from a standalone `npm install` of
`post-engineer-mcp`. Direct imports work where the consumer's `rootDir`
allows them; where it does not, a symlink stands in for the import
(see prompt-base below).

## script-segments

`script-segments/script-segments.ts` is the mechanical segments-script
validation (limits, `normalize`, `validateSegments`, `joinSegments`),
mirroring `apps/engine/app/services/script_segments.py` with the one
documented exception (Python `casefold` vs JS `toLowerCase`, e.g. `ß`).
The engine Python copy stays duplicated on purpose: Python and
TypeScript cannot share code.

The consumers use byte-identical generated copies, committed to git:

- `apps/web/lib/generation/script-segments.ts`
- `apps/mcp/src/script-segments.ts`

The shared file has no imports, so the same bytes compile under the
web's bundler resolution and the MCP's NodeNext resolution, and both
apps keep their existing import paths unchanged.

To change the validation, edit only the shared file, then regenerate:

```sh
node scripts/sync-script-segments.mjs
```

Both apps also run the sync from their `prebuild` and `pretest` scripts,
and each app has a `script-segments-shared.test.ts` suite that fails
loudly if a generated copy ever drifts from the shared source. Never
edit a generated copy by hand.

## prompt-base

`prompt-base/prompt-base.ts` holds the text of every prompt in the prompts
hub: `SHARED_PROMPT_BASE` (rules for all prompts) plus each composed prompt
(`[...SHARED_PROMPT_BASE, '', ...specificLines].join('\n')`). A new prompt
gets every shared rule by spreading the base. Web, MCP, and docs never repeat
this text: docs link to the hub.

There is exactly one prompt-base file in git: this one. The consumers
reach it two ways, because their `rootDir` settings differ:

- Web imports it directly (`apps/web/app/recipes/prompts.ts` imports
  `../../../../shared/prompt-base/prompt-base`): the web tsconfig sets
  `rootDir` to the repo root, so the import passes typecheck, and
  Next's webpack compiles the shared file into the bundle.
- MCP imports it through a symlink (`apps/mcp/src/prompt-base.ts` ->
  `../../../shared/prompt-base/prompt-base.ts`): the MCP tsconfig sets
  `rootDir` to `./src`, so a direct import fails with TS6059, and
  widening `rootDir` would move `dist/index.js` out of the published
  package layout. `tsc` follows the symlink and emits a real
  `dist/prompt-base.js`, so the published tarball stays self-contained.

The shared file has no imports, so it compiles under both the web's
bundler resolution and the MCP's NodeNext resolution. To change the
base, edit only this file — no sync step, no generated copy to drift.
Each app has a `prompt-base-shared.test.ts` suite that fails loudly
if a copy ever reappears, and `prompts-sync.test.ts` fails if any web
or MCP prompt bypasses the base.
