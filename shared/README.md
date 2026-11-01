# Shared TypeScript sources

Single sources of truth used by more than one app, kept here at the repo
root because neither consumer can import across its own `rootDir`:

- The MCP tsconfig sets `rootDir` to `./src`, so `tsc` rejects an import
  of a file outside `apps/mcp/src` (TS6059).
- The web tsconfig sets `rootDir` to `./` (`apps/web`), so it rejects an
  import from the repo root the same way.
- A pnpm workspace package is not an option for MCP code: the published
  MCP package ships only `dist`, and an unpublished workspace dependency
  would be missing from a standalone `npm install` of `post-engineer-mcp`.

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

The consumers use byte-identical generated copies, committed to git:

- `apps/web/lib/generation/prompt-base.ts`
- `apps/mcp/src/prompt-base.ts`

The shared file has no imports, so the same bytes compile under the
web's bundler resolution and the MCP's NodeNext resolution.

To change the base, edit only the shared file, then regenerate:

```sh
node scripts/sync-prompt-base.mjs
```

The sync script is deliberately NOT wired into the apps'
`prebuild`/`pretest` scripts: both apps' `package.json` files are
guard-protected paths, and auto-regeneration is a convenience, not a
correctness requirement. Each app has a `prompt-base-shared.test.ts`
suite that fails loudly if a generated copy ever drifts from the
shared source, and `prompts-sync.test.ts` fails if any web or MCP
prompt bypasses the base. Never edit a generated copy by hand.
