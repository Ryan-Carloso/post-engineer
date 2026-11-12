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
both majors accept (the web runs Zod 4, the MCP Zod 3):
`z.string().min().max().optional().describe()` — no `.url()`, `errorMap`,
or other version-specific APIs. Each app resolves `zod` from its own
dependencies. The catalog check (a catalogued mood or `"none"`) stays a
separate web-side layer in `lib/generation/music-moods`.

To change the field, edit only the shared file, then regenerate:

```sh
node scripts/sync-music-mood-field.mjs
```

Both apps also run the sync from their `prebuild` and `pretest` scripts,
each app has a `music-mood-field-shared.test.ts` drift suite, and each
runs the same payload contract table in `music-mood-field.test.ts`
against its own copy. Never edit a generated copy by hand.

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

The MCP has no copy: `list_prompts`, `get_prompt` and the slash commands
fetch the recipes from the web API (`GET /api/prompts`,
`GET /api/prompts/[slug]`), so a recipe edit reaches every MCP install
without a package release.

To change the base, edit only this file. The web
`prompt-base-shared.test.ts` suite fails loudly if a copy ever
reappears.
