# Repository Layout (Nx monorepo, pnpm)

- `apps/web/` — Next.js 15 dashboard + API routes (run via `pnpm dev:web`, serves on `http://localhost:3434`)
- `apps/engine/` — Python/FastAPI video-generation engine (run via `pnpm dev:engine`, serves on `http://127.0.0.1:8080`)
- `apps/mcp/` — Post Engineer MCP server (npm package `post-engineer-mcp`; local stdio tool, tests via `pnpm exec nx test mcp`)
- Commands at repo root: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` (Nx run-many across all apps)

## Workflow rules

- Never push directly to `main` — always open a PR.
- TDD by default: every code change (features, fixes, refactors) ships with
  new or updated tests, and the relevant suite is green before committing.
- Keep PRs small and focused; CI must be green and review threads resolved
  before merge.
- **Every PR bumps the repo-root `VERSION` file** (minor for features,
  patch for fixes) via `scripts/bump-version.sh [patch|minor|major]` — it
  updates `VERSION`, the repo-root `package.json`, `apps/mcp/package.json`,
  `apps/web/package.json`, `apps/engine/pyproject.toml` and
  `apps/engine/uv.lock` in one go. CI (`version-check` workflow)
  fails the PR if the locations diverge or if `VERSION` was not bumped —
  this is the enforcement, not agent memory. The MCP already advertises
  its package.json version in the protocol handshake, so it stays unified
  automatically.

# Env Files Policy (NEVER commit real secrets)

- Real env files (`apps/web/.env`, `apps/engine/.env`,
  `apps/engine/config.toml`) are gitignored and are NEVER committed.
- There are only three env files by design: `apps/web/.env` (all web vars,
  including `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` used by Cypress),
  `apps/engine/.env` (engine vars), and `apps/engine/config.toml`
  (engine behavior config with provider API keys). Do not introduce new env
  files — add vars to these. Do NOT create `.env.local` overrides.
- Never remove the `.env` ignore rules from `.gitignore`, never stage real
  secret files, and never print secret values in diffs, logs, or comments.
- New contributors create them from the `*.example` files (see README).

# Supabase Authentication Rules

## Social Account Data

- All account consumers use React Query through `useYouTubeAccountsQuery` and `useInstagramAccountsQuery` in `apps/web/lib/api.ts`. Keep one implementation per network and explicit network names.
- Use the shared `youtube-accounts` and `instagram-accounts` query keys; invalidate the corresponding cache after successful OAuth or a real server mutation.
- Keep remote account state in React Query, rather than parallel `useState`/`useEffect` fetch hooks. Actions must perform their named operation; use cache invalidation directly for refresh-only work.

## Strict Requirements

- **NEVER add fallback values** for environment variables
- Always fail explicitly when environment variables are missing
- Do not provide default values or fallback configurations
- Use strict type checking - no `any` types allowed

### Exception: PostHog telemetry keys (2026-09-30)
PostHog (`POSTHOG_API_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`)
is intentionally warn-and-continue, not fail-fast. Rationale: telemetry must
never break the app — if the key is missing or PostHog is down, the app keeps
serving requests and logs to console/Vercel only. The `??` chain across the two
key vars is not a "fallback value" in the banned sense (no hardcoded default);
it reflects that the server accepts either the server-side or the public key.
This is a deliberate, documented exception to the fail-fast rule.

## Environment Variables

All environment variables must be defined or throw explicit errors:

```ts
// ❌ WRONG - fallbacks are forbidden
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'fallback-url'

// ✅ CORRECT - fail explicitly
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
```

## Type Safety

- Use `unknown` instead of `any` for untyped data
- Provide explicit type annotations for all functions
- Use proper type guards and narrowing
- No type assertions unless absolutely necessary

## UI Components

- Components under `apps/web/components/ui/` are reusable presentational components.
- They may receive props, including data and callbacks; this is the preferred API for shared UI.
- Keep fetching, OAuth, state management, and other screen-specific logic outside these components.

## "use server" Directive

All server actions must use the "use server" directive:

```ts
'use server'

import { createClient } from '@/lib/supabase-client'

export async function signInWithGitHubAction() {
  const supabase = createClient()
  // Implementation...
}
```

## Error Handling

- Never silently fail authentication
- Always log errors for debugging
- Provide explicit error messages
- Do not catch and suppress errors

## Code Comments

- **All code comments are in English. Always.** Never write comments in Portuguese (or any other language) — in code, tests, migrations, or docs-as-comments.
- When you touch a file, convert any existing non-English comments to English as part of the change.

## Next.js version note

This repo pins a specific Next.js version whose APIs and conventions may differ
from generic Next.js knowledge. Before writing framework-level code, check the
version in `apps/web/package.json` and the docs in
`node_modules/next/dist/docs/` (resolved from `apps/web/`). Heed deprecation
notices.

## Code review

- PRs are reviewed by CI workflows in `.github/workflows/` (including an AI
  reviewer). Read reviewer feedback before requesting merge; address findings
  in focused follow-up commits.

## Web/API review learnings (standing rules, distilled 2026-09-28)

Recurring findings from OpenCode/OCR review of the persona image library
(`apps/web/`). Follow these so the same issues don't come back:

- **Never fail silently on mutations.** Upload/save/delete surface errors to
  the user and log them; non-2xx, non-JSON, and `success:false` responses
  are never treated as success. Invalidate caches only on real success.
- **New stateful UI ships with behavioral tests.** A component with editing,
  pending, or error state gets component tests, not just lib tests.
- **Reuse the single primary-swap helper.** `setPrimaryLibraryImage` is the
  only code that unsets/sets the primary flag; PATCH reuses it and a failed
  unset is a 500, never a confusing unique-index violation.
- **Log storage cleanup failures.** A failed storage remove on DELETE is
  logged, never swallowed — orphaned files stay diagnosable.
- **Library images need a face.** Faceless personas (`face_mix_percent = 0`)
  reject library image adds, matching the creation rule.
- **No `instanceof File`.** Use a structural guard (`isFileLike`): the
  undici `File` constructor differs from the test env's.
- **Unknown `image_id` is always 404.** Even for an empty library — never a
  silent fallback to the legacy photo. Empty-string and non-string `image_id`
  are 400; silent coercion hides broken integrations.
- **Explicit overrides are not rotation picks.** A pinned `image_id` never
  touches the anti-repeat history.
- **Selection is pure; history is a post-gate write.** `resolveVideoImage`
  never touches `recent_image_ids`. The caller records via
  `recordRecentImageId` only after the token gate passes — a rejected
  request must not mark an image as used.
- **History writes are atomic.** `record_persona_image_use` (SQL) prepends,
  dedupes, and caps the window in one UPDATE; app-side read-modify-write
  loses concurrent updates.
- **An unsignable selected image is a 503.** Never silently fall back to a
  different face when the resolved library image can't be signed.
- **Score with the full video context.** Image selection gets topic, niche,
  AND the persona `script_prompt`, not just topic/niche.
- **Service-role bypasses RLS.** Every service-client handler re-checks
  ownership explicitly; say so in a comment at each call site.
- **Rollback failures are loud.** Creation rollback logs persona-delete and
  photo-remove failures instead of discarding them.
- **Keep SQL literals coupled.** The `10` in `persona-images.sql` mirrors
  `MAX_PERSONA_IMAGES`; the coupling is documented in both places.
- **Sync editor state with refetches.** Local editor copies re-sync from
  props when not editing; in-progress edits are never clobbered.

## MCP review learnings (standing rules, distilled 2026-09-27)

Recurring findings from 11 rounds of review on the MCP server (`apps/mcp/`).
Follow these so the same issues don't come back:

- **Secrets never surface.** Bearer <redacted>, app passwords, and base-URL userinfo
  must never appear in error messages, logs, or agent-visible output. Redact
  raw, percent-encoded, and JSON-escaped forms; cap upstream error bodies
  (200 chars); fail fast on a missing key without logging it.
- **HTTPS or loopback only.** Remote API URLs must be https; http is allowed
  only for loopback hosts (`localhost`, `127.0.0.1`, `::1`, `[::1]`). Validate
  the URL and use the normalized form (`origin + pathname`), never the raw
  string — userinfo credentials must not ride along silently.
- **Validate OAuth URLs.** An `auth_url` handed to an agent must be https:
  `z.string().url()` accepts any scheme, including `javascript:`.
- **Empty responses are explicit.** A 204/empty-body success resolves
  `{ ok: true }`, never `undefined` — handlers must not render "undefined"
  to agents (e.g. "task started: undefined" for a paid job).
- **Non-JSON success bodies are errors.** A 200 with a malformed body must
  reject loudly, never resolve as success.
- **Single source of truth for tool schemas.** Define each shape once in
  `tools.ts`, register it in `index.ts`, and pin every registration with an
  invariant test — no inline `{}` that can drift.
- **No test-only seams on production interfaces.** Inject clocks/config via
  options (e.g. `now: () => Date`), never via `_fieldForTesting` on input
  types.
- **Network calls time out.** Every fetch gets an `AbortSignal` timeout so a
  hung request can't block the agent session forever.
- **Tests must not pass vacuously.** Assert the spawned process is actually
  alive; use ephemeral ports and `mkdtempSync`, never fixed ports/paths;
  skip symlink tricks on Windows (needs elevated privileges).
- **Engines must cover the newest syntax used.** Import attributes
  (`with: { type: 'json' }`) need Node >= 20.10, not just >= 20.
- **Commit messages describe the implementation**, not the process
  ("redact encoded app password, inject clock via options", never
  "review 11 findings").

## Web/API review learnings, round 2 (2026-09-28)
- **Fixing a banned pattern? grep the whole diff.** The `instanceof File` ban
  was applied to `images/route.ts` but the same PR added a new call site in
  `persona/route.ts`. When a reviewer flags a pattern, search every touched
  file for siblings before declaring it fixed.
- **Every mutation needs visible error state.** The "set as primary" toggle
  used fire-and-forget `mutate()` while save/remove had error handling —
  audit every mutation call site in a component, not just the ones the
  reviewer quoted.
- **Validate shared params before branch splits.** `image_id` validation
  lived only in the persona branch; faceless callers got silent ignores.
  Validate before the faceless/persona split.
- **Reject over-length input, don't truncate.** PATCH silently `.slice()`d
  over-length tag/description; direct API callers got silent data loss.
  Strict type checks + silent truncation is inconsistent — 400 instead.
- **Multi-step DB mutations go in one SQL function.** The primary swap was
  two app-side UPDATEs that concurrent calls could interleave; the
  `set_primary_persona_image` function locks the parent row and does
  demote-then-promote back-to-back. Same class as the history RPC.
- **Verify the reviewer's arithmetic.** OCR claimed the AFTER INSERT
  `count(*) > 10` trigger allows an 11th row — wrong: after inserting row
  11, count is 11 > 10, so it raises. Don't apply a fix for a broken proof.
- **MCP client hygiene:** derive display values from constants (never
  hardcode "10MB" next to `MAX_LIBRARY_IMAGE_BYTES`); one `readFile`
  instead of stat/read (TOCTOU + consistent errors); file-carrying
  requests get a longer timeout (120s vs 30s); independent reads go
  through `Promise.all`; fail fast client-side on no-op calls.

## Web/API review learnings, round 3 (2026-09-28)
- **Cascade deletes need storage cleanup BEFORE the row dies.** The persona
  DELETE collected photo/voice paths but not `persona_images.image_path` —
  after the cascade the paths were unrecoverable, so up to 10 private
  photos orphaned per deletion. Whenever an ON DELETE CASCADE table has
  storage objects, select the paths first, then delete.
- **History/timing writes belong after the external accept, not the token
  gate.** Recording the rotation right after the token gate meant a failed
  (refunded) engine call still burned an anti-repeat slot. Persist only
  after the engine accepts/creates the job; a failed engine call must leave
  zero history.
- **A committed partial result turns errors into best-effort.** POST
  /api/persona/images committed the image row + storage object, then a
  primary-flag failure returned 500 for an image that existed. When the
  mutation is already committed, log loudly and report the true state
  (201 with actual is_primary), not a 500.
- **Never discard a query error on a security branch.** The faceless check
  ignored the personas select error and treated failure as "not faceless",
  silently defeating the check. Every select on an auth path must handle
  its error explicitly.
- **Explicit MIME allowlist on file validation.** `startsWith('image/')`
  passed image/gif or image/svg+xml renamed to .png; the server must
  enforce the same allowlist as the client since API-key callers bypass
  the UI.
- **Validate shared params before index-aligned arrays.** imageTags/
  imageDescriptions are matched to files by index: a non-empty array
  shorter than the file count is a client bug — 400, not silent defaults.
- **Rejects in the picker need visible feedback.** Silently filtering
  invalid picked files is a silent failure on the input path; surface a
  skip notice naming the rule.
- **No side effects inside setState updaters.** URL.revokeObjectURL ran
  inside an updater (StrictMode invokes updaters twice) — compute outside,
  update state, then run the side effect.
- **MCP stdio memory budget.** Promise.all over 10 x 10MB images held
  ~100MB in the stdio process; sequential reads bound it to one image.
  Pure-argument checks (index range) go before any file read.
- **Verify the doc claim against the code.** The imagePrimaryIndex doc said
  "default: first" but no primary was set when omitted — docs must describe
  what the code does, not what it should do.

## Web/API review learnings, round 4 (2026-09-28)
- **Magic bytes at the server boundary, not just declared MIME.** The MIME
  allowlist still trusts the client-supplied `file.type`, which API-key
  callers can spoof (GIF bytes declared as image/png passed). validate the
  real bytes with detectMagicMimeType in addLibraryImages and the
  creation pre-check; extended the detector with WebP and GIF.
- **Row first, storage second on deletes.** DELETE /api/persona removed
  storage objects BEFORE the persona row: a DB failure then destroyed
  files still referenced by a surviving row. Delete the row first; storage
  cleanup after is best-effort with loud logging.
- **Rollback leftovers must retry before the cascade.** addLibraryImages'
  internal rollback ignored storage remove() results; the creation
  rollback then deleted the persona (cascade erasing the rows), making the
  orphaned files unrecoverable. Surface leftoverPaths from the helper and
  retry the remove BEFORE the cascade delete.
- **A failed primary swap on creation is a warning, not a 500.** The
  persona and images are already committed — return 200 with a warnings
  array so the client knows no image is primary.
- **UI gating must read persisted state, not create-flow state.** The
  persona page showed the image library based on the unhydrated zustand
  personaMode, so editing a persisted faceless persona rendered uploads
  the server would always reject. Gate on
  editingPersona.faceMixPercent !== 0.
- **Pending queues must survive refetches.** The pending upload queue
  unmounted when a refetch filled the library, hiding queued items (with
  their upload button) while previews stayed alive. Render the queue
  outside the full/partial conditional.
- **PATCH isPrimary:false is rejected — primary is swap-only.** A
  demote-only PATCH would leave zero primaries and push every consumer
  onto the deterministic fallback; set isPrimary:true on the new image
  instead. Deleting the primary image is documented as intentionally
  leaving zero primaries (selector falls back deterministically).
- **Malformed metadata arrays are 400, never silent [].** imageTags/
  imageDescriptions with invalid JSON or non-string entries used to
  default to []; the call site now throws and the route returns 400.
- **Keep zero-byte files through validation.** Filtering empty files
  before index-aligned pairing shifted tags onto the wrong images; keep
  them so validateImageFile emits the clear error for the right index.
- **Unused i18n keys are a smell.** libraryTag/libraryDescription existed
  in both locales but were never rendered — wired as aria-labels on the
  pending inputs instead of deleting them.
- **Faceless video jobs reject image_id with 400.** A valid image_id on a
  faceless request was silently ignored; now it fails loudly. Persona
  image_id values are trimmed before the exact-match lookup.

## MCP review learnings, round 4 (2026-09-28)
- **Reject zero-byte files locally with a filename-specific error.** A
  0-byte file passed the local gate but desynchronized the server's
  index-aligned tag pairing; fail fast with the basename in the message.
- **imagePrimaryIndex without images is a caller bug.** Fail fast with a
  clear message instead of a silent successful creation with no primary.
- **Encode domain rules in the zod schema.** "At least one of
  tag/description/isPrimary" lived only in the handler guard; a
  .refine() on UpdatePersonaImageSchema makes the contract
  machine-checkable at parse time.

## Web/API review learnings, round 5 (2026-09-28)
- **Derive the storage extension from the detected content, not the file
  name.** Magic-byte validation already rejected mismatched content, but a
  truthful WebP file named "photo.png" was stored with a .png path.
  validateImageBuffer now returns the detected MIME and addLibraryImages
  maps it to the extension, so path and bytes always agree.
- **A failed rollback row delete must surface, not just log.** The internal
  rollback logged the delete error and returned []: surviving rows kept
  pointing at files the caller believed were cleaned up. It now returns
  the added image paths so the caller retries before any cascade cleanup,
  and skips the storage remove while rows still reference the files.
- **Ambiguous dual-spelling params are 400, not silent precedence.** The
  video-job accepted both image_id and imageId with image_id silently
  winning; conflicting values are now rejected like every other ambiguous
  input in that route. Identical values are still accepted.
- **Gate edit-UI sections on loaded data, not just non-faceless.** The
  library gate read `editingPersona?.faceMixPercent !== 0`, which is true
  while the list is loading — flashing the section for a faceless persona
  (and discarding pending picks on unmount). Require
  `editingPersona !== undefined` too.
- **Interpolate numeric limits into i18n copy.** libraryCount/
  libraryLimitReached hardcoded '10' in en+pt while MAX_LIBRARY_IMAGES is
  the source of truth; both now take {max} and the component passes it.
- **POST isPrimary accepts only 'true'/'false'.** `=== 'true'` silently
  coerced '1'/'yes'/'True' to false, confirming a 201 with a silently
  unset primary — the standing no-silent-coercion rule applied to form
  fields too, matching PATCH's strict boolean handling.
- **Document why the REVOKE suggestion doesn't apply.** OpenCode suggested
  REVOKE EXECUTE on the RPCs from authenticated — but the app invokes
  both RPCs with the user-scoped session client (getAuth), so the revoke
  would break the feature. The SQL comments now state the real trust
  boundary: invoker-rights RLS + route-level ownership checks, EXECUTE
  stays granted.
- **Mutations return raw rows by design; document it.** PATCH returns the
  DB row without a signed image_url because every client invalidates the
  query and refetches the signed GET shape — signing in the mutation
  would pay a storage round-trip per edit for no consumer. The comment
  on the handler says so explicitly.

## MCP review learnings, PR #17 (2026-09-29)
- **Sanitize engine errors before surfacing them to the agent.** The
  `error` field added to `get_video_task_progress` passed the engine
  failure reason straight through; provider exceptions can echo bearer
  tokens, DSNs, or api_key query params into it. `sanitizeEngineError`
  (tools.ts) redacts credential-shaped fragments while keeping the
  human-readable reason intact — same convention as the app-password
  redaction in client.ts.

## MCP review learnings, round 5 (2026-09-28)
- **Export shared limits from the client module.** MAX_LIBRARY_IMAGES/
  MAX_LIBRARY_IMAGE_BYTES lived unexported in client.ts while tools.ts
  hardcoded .max(10)/.max(9)/'10MB' in schemas and descriptions — one
  import keeps the guards, Zod bounds, and doc strings in sync.
- **Zod messages must match optional semantics.** 'imageId is required'
  on an optional field misleads the agent; 'imageId must be a non-empty
  string' says what actually failed.

## Web/API review learnings, round 10 (2026-09-28)
- **One mapping for server warning codes.** The upload flow and card
  flows duplicated the code→i18n map; extract `mapPersonaImageWarnings`
  so a new code is added once.
- **Warnings are not errors.** Partial-success warnings rendered in red
  error text mislead; use a separate amber warning state.
- **Disable the whole editor during save.** Inputs and Cancel stay
  enabled while saving invite lost edits; disable on `isPending`.
- **Mutations share the GET projection invariant.** Strip `image_path`
  from POST/PATCH responses too, not just GET.
- **Warnings contract is codes everywhere.** The create-persona route
  emitted English copy while images routes emit codes; standardize on
  stable codes mapped through i18n.
- **Retry orphan cleanup once.** If rollback leaves storage files behind,
  retry the remove before logging — the rows are already gone, so this
  is the last recovery chance.
- **Bare-extension files are not images.** A file named exactly ".png"
  has no basename; reject it in the fail-fast path.

## Web/API review learnings, round 9 (2026-09-28)
- **Strict null checks only.** `== null` is banned by project rules;
  spell out `=== null || === undefined` even for genuine nullish checks.
- **Edit-mode gates derive from stored data, not flow stores.** The
  zustand create-flow store persists across navigation; when editing,
  derive mode/visibility from the loaded persona (faceMixPercent), not
  from the store.
- **Project GET responses.** Spreading a DB row leaks internal fields
  (image_path); project only what the UI renders.
- **Unicode-aware tokenization.** `\p{L}\p{N}` with the `u` flag for
  keyword matching; a Latin-only class silently degrades non-Latin
  personas to primary/first with no signal.
- **Surface warnings in every consumer.** Warnings parsed but unread are
  a broken contract; card save/set-primary now map codes through i18n.
- **Type narrow + runtime guard for swap-only fields.** `isPrimary?: true`
  at the type level, with a runtime throw for JS callers.
- **Check metadata lengths client-side.** Tag/description limits checked
  before the multipart upload, not server-side after bytes transfer.
- **Share normalization between upload paths.** Trim/drop-empty logic
  lives in one place so both MCP paths honor the invariant.

## Web/API review learnings, round 8 (2026-09-28)
- **Coerce derived state at the write boundary.** A faceless creation
  stored `face_mix_percent: NULL` (no explicit mix), passing the images
  route's `=== 0` faceless guard — a backdoor for library uploads on
  faceless personas. Coerce to 0 on insert so stored state matches the
  creation-time rule; the guard then holds for every row.
- **Server warnings are i18n codes, not English copy.** POST/PATCH
  returned English warning sentences rendered verbatim; pt-BR users got
  English in a localized page. Return stable codes
  (`primary_swap_failed`, `metadata_save_failed`) and map them through
  the dictionaries in the UI, with a raw-string fallback for unknown
  codes.
- **Log inside never-throw helpers.** `signImageUrl` swallowed signing
  failures silently; a gray placeholder with zero diagnostic trail.
  `console.warn` with the path in both failure branches — the video-job
  sibling already did this.
- **Normalize empty metadata at the client boundary.** The MCP sent
  `tag: ''` verbatim; the server stores it verbatim and an empty tag can
  never match keyword selection. Trim and drop empty strings before
  building the form.
- **Disable the whole pending row while uploading.** The remove button
  (and tag/description inputs) stayed enabled mid-upload; removing an
  in-flight item revokes its preview but the captured loop still stores
  the cancelled file. Disable, don't try to cancel the loop.
- **Use a counter for non-secure-context ids.** `Date.now()` +
  `Math.random()` can collide for same-millisecond picks; a module-level
  counter is collision-free.
- **Suppress empty-state copy on query error.** "No images yet" next to a
  load error is contradictory — the library may have images that failed
  to load.
- **Size before type in validation order.** An oversized non-image should
  report the actionable size error, not a confusing type error.
- **Share the read-and-validate helper.** `validateImageContent` and
  `addLibraryImages` duplicated the arrayBuffer→magic-bytes sequence;
  extract `readValidatedImage` so the contract lives in one place. Use
  the detected MIME (not the declared type) for the storage contentType.
- **Test SQL literals against TS constants.** The trigger limit, errcode,
  and history window are manually synced; a unit test parses
  `supabase/persona-images.sql` and asserts they equal
  `MAX_PERSONA_IMAGES`, `PERSONA_IMAGE_LIMIT_SQLSTATE`, and
  `PERSONA_IMAGE_HISTORY_LIMIT`.
- **Factory for repeated mutation shapes.** Three hooks duplicated the
  null-guard + invalidate-on-success; a `usePersonaImageMutation`
  factory keeps future changes (warnings surfacing, toasts) in one place.
- **GET-only types can require their fields.** `ImageMutationResult`
  carries no image (round 6), so `PersonaImageRecord.image_url` is now
  required — the compiler enforces the GET-only contract.

## Web/API review learnings, round 7 (2026-09-28)
- **Resolve legacy fallbacks lazily.** The video-job signed the legacy
  photo_path before the library branch: a stale photo cost a signing
  round-trip on every library-served job. Resolve the fallback only when
  the primary source yields nothing — the 503 classification for the
  no-library case stays untouched.
- **Sanitize untyped JSONB columns at read time.** `recent_image_ids` is
  cast from an untyped column; a non-array value made `new Set()` throw
  and 500 every job. Filter to string[] with an Array.isArray guard —
  best-effort history degrades to empty, never a hard failure.
- **Cheap validation before expensive reads.** The creation route awaited
  per-file magic-byte reads before the imagePrimaryIndex parse/range
  checks. Order fail-fast param checks first; a malformed index must not
  cost up to 10 file reads.
- **Rollback must not drop rowless uploads.** When the rollback row delete
  failed, only added-row paths were surfaced — uploads whose insert failed
  (no row) were silently dropped from the leftovers. Remove rowless paths
  immediately (no row references them) and surface them if that remove
  fails.
- **Mock the production invariant, not a fake.** The rollback mock
  returned a hardcoded row image_path differing from the upload path,
  making every stored path look "rowless". Echo the insert payload's
  image_path so added[].image_path matches storedPaths like production.
- **Partial-success contracts must be symmetric.** POST returned 201 with
  the true is_primary but no warnings when the primary swap failed, while
  PATCH had a warnings array. Both now report warnings; the client parser
  captures and validates them, and the UI shows an amber banner.
- **Mutation hooks fail loud on missing context.** useUpdate/useDelete
  accepted null personaId and invalidated the ['persona-images', null]
  query key. All three mutation hooks now throw 'personaId is required.'
  before any fetch — audit every hook, not just the one quoted.
- **Surface rollback leftovers at every boundary.** addLibraryImages
  surfaced leftoverPaths but the POST route discarded them. Every
  consumer of a leftoverPaths result must log (or retry) them — grep for
  the field at each call site.
- **Optional error fields need ?? at consumers.** leftoverPaths is absent
  on pre-upload error paths; the route crashed on .length. Destructure
  with a default.
- **Keep previews alive until the queue updates.** Revoking a preview URL
  inside the upload loop (before setPending filtered the queue) showed a
  broken image on any re-render in between. Revoke after the state update.
- **Disable pickers while their queue drains.** The Add button stayed
  usable mid-upload, letting picks land in a half-drained queue. Disable
  it (and the hidden input's trigger) while uploading.
- **Trigger violations match on SQLSTATE, not message.** The limit
  trigger is now `raise ... using errcode = 'PEL01'` and the app matches
  the code — the English message is human copy and may be reworded.
- **MCP add isPrimary is swap-only too.** addPersonaImage(isPrimary:false)
  silently dropped the flag; the schema now takes only literal true like
  update, so a meaningless explicit false fails at parse time.
- **Verify the reviewer's claim against the code before changing.**
  OCR said GIFs got a "MIME mismatch" error and that the page could show
  the library while the personas query errored — both false: the
  allowlist check runs before the mismatch check, and the page renders
  PersonaPageError instead of the section. A 5-line probe test beats a
  blind fix.

## Web/API review learnings, round 6 (2026-09-28)
- **Dedup helpers into a leaf module, not across an existing edge.**
  Moving MCP's getErrorMessage into tools.ts while tools.ts already
  imported client.ts constants created a client↔tools cycle. Shared
  helpers go in a new leaf module (errors.ts) imported by both sides.
- **Partial-success responses must track what actually committed.** PATCH
  returned the warning-style success after ANY metadata failure; now a
  primarySwapCommitted flag gates it, and metadata-only failures keep
  the honest 500.
- **Strict numeric parsing for form/query params.** parseInt('3x') === 3
  coerces; /^\d+$/ plus an explicit 400 rejects malformed
  imagePrimaryIndex instead of silently dropping the pinned primary.
- **user-event upload honors the input's accept attribute.** A .bmp never
  reaches the change handler in tests, so rejection+limit co-occurrence
  must be exercised with an accepted-type-but-oversized file.
- **Report co-occurring user-facing errors together.** The limit notice
  used to overwrite the type/size rejection notice — join both messages
  instead of else-if.
- **Explicit-ID selectors return null on no match.** selectPersonaImage
  fell through to automatic selection for unknown ids; a pinned choice
  must never silently substitute a different face.
- **Sequential I/O loops get a why-comment.** addLibraryImages (bounded
  memory, deterministic rollback) and the UI upload queue (stop at first
  failure, retryable remainder) are sequential on purpose — say so or
  every review round re-flags them.
- **Document faceless exemptions at the handler.** PATCH/DELETE stay
  available for images that predate a switch to faceless; only POST is
  blocked. The comment lives on both handlers.

## Web/API review learnings, round 12 (2026-09-28)
- **UI gates must match the server's NULL semantics.** Making POST treat
  NULL face_mix_percent as faceless while the page gate used `!== 0`
  showed the library to legacy NULL-mix personas whose uploads always
  failed. Gate on `(faceMixPercent ?? 0) !== 0` — every consumer of a
  nullable flag must agree on what NULL means.
- **Never expose internal paths in GET-only types.** PersonaImageRecord
  declared `image_path: string` required while the API never returns it —
  a future consumer would silently pass undefined to a storage call.
  Delete the field, don't just document it.
- **Split rollback leftovers by safety.** A flat leftoverPaths array let
  callers storage.remove() files that surviving rows still referenced.
  Return `{ orphanPaths, rowBackedPaths }`: retry the row delete inside
  the helper, remove only orphans, log row-backed loudly for manual
  cleanup.
- **Wire every new server flag to a UI consumer.** image_url_error was
  added to the GET shape with docs but the card ignored it — a silently
  broken thumbnail with no retry hint. A flag without a consumer is a
  broken contract.
- **Shared helpers own their preconditions.** addLibraryImages silently
  200'd on an empty batch; the helper now 400s so callers can't forget
  the check.
- **Normalize once, use everywhere.** tag/description were trimmed in the
  validation loop and again at insert — one normalization step up front
  prevents drift.
- **Don't let insertions orphan comments.** Adding normalizeLibraryMetadata
  between the HTTPS-policy comment and resolveBaseUrl detached the
  comment from its function. Re-read the surrounding 10 lines after any
  insertion.
- **Client constants derive from shared sources.** MAX_LIBRARY_IMAGES
  hardcoded 10 next to MAX_PERSONA_IMAGES = 10; import the shared
  constant instead of duplicating the literal.
- **Answer "already covered" with the test name.** The SQL sync test from
  round 8 (parses persona-images.sql, asserts literals vs TS constants)
  is the proof — cite it, don't re-argue.

## Web/API review learnings, round 13 (2026-09-28)
- **stat() before readFile for local uploads.** The MCP read the whole
  file before the size check — a multi-GB misnamed file OOM'd the stdio
  process. stat() first bounds memory; the TOCTOU window is benign
  because the authoritative check still runs on the buffer. Derive the
  display size (MB) from the constant, never hardcode it.
- **Trim on every metadata path, not just add.** updatePersonaImage sent
  tag/description verbatim while add trimmed — an untrimmed tag can never
  match keyword selection. Share the normalization or apply it at each
  entry point.
- **Document undefined-vs-empty-string conventions.** JSON.stringify
  drops undefined keys; the server treats empty string as "clear". A
  comment on the payload builder saves programmatic callers from
  guessing.
- **Migrate old handlers to new wrappers, or document the split.**
  handleLibraryCall covered only new handlers; 12 old ones kept inline
  try/catch. Migrated the simple ones; the two with pre-validation keep
  inline (documented on the wrapper).
- **Name the failed file in queue errors.** A generic "upload failed"
  for a 5-file queue doesn't say which card to fix. Append the filename
  to both the catch and !success paths.
- **No bare glyph buttons.** The ✎ edit button had no accessible name
  and bypassed i18n. Use a translated label with aria-label.
- **Retry storage cleanup on DELETE.** The POST rollback retried; DELETE
  only logged. One retry for symmetry, then loud logging.
- **Share warning codes as constants.** 'primary_swap_failed' /
  'metadata_save_failed' were string literals in 3 producers + 1 mapper.
  PERSONA_IMAGE_WARNING_CODES (as const) makes typos a build error.

## Web/API review learnings, self-review (2026-09-28)
- **A cascade delete erases rows, not storage objects.** The creation
  rollback removed orphanPaths before the persona delete and only logged
  rowBackedPaths — after the cascade the files were true orphans with no
  cleanup path left. Remove row-backed storage only AFTER a successful
  delete (one retry, then loud logging); if the delete fails, the rows
  survive and their storage must never be touched.
- **Never remove row-backed storage while surviving rows reference it.**
  The failing-then-fixed test pair in create-with-images.test.ts pins
  both directions: the row-backed remove runs after the cascade delete,
  and never runs when the delete fails.

## Web/API review learnings, round 14 (2026-09-28)
- **Tie-breaks must match the documented order.** The GET list's comment
  said "must match resolveVideoImage's order exactly" but
  resolveVideoImage lacked the `id` tie-break — fast sequential inserts
  share a transaction-scoped `created_at`, so the UI and the selector
  could disagree about which image is "first". Both now order
  `created_at asc, id asc`.
- **Coerce derived state at the write boundary on EVERY branch.** The
  faceless NULL→0 coercion (round 8) left the persona-mode branch
  storing NULL, which the images route and page gate treat as faceless —
  permanently write-locking the library for a persona the creation
  accepted as face-requiring. Persona-mode NULL is now coerced to
  DEFAULT_FACE_MIX_PERCENT (100, the UI store's default, shared from
  persona-schema.ts) so no new row stores NULL; NULL unambiguously
  means "legacy faceless-mode row" everywhere.
- **Shared defaults live in one module.** The UI store's `faceMixPercent:
  100` and the route's insert coercion both import
  DEFAULT_FACE_MIX_PERCENT — a literal in either place would drift.
  (Same class as the round-12 "client constants derive from shared
  sources" rule.)
- **Mocks must mirror the production query chain.** Adding the `id`
  tie-break broke 73 video-job/api-key-scope tests whose mocks
  terminated `.order()` instead of chaining it. When production adds a
  chain link, grep every test mock of that query and extend the chain —
  the mock that doesn't match the chain is the bug, not the code.

## Web/API review learnings, round 15 (2026-09-28)
- **Never render a raw internal slug to users.** Unknown server warning
  codes used to pass through `mapPersonaImageWarnings` as raw English
  slugs (broken i18n for future codes). They now map to a localized
  generic fallback (`persona.libraryWarningUnknown` in en/pt) — the
  code is still logged server-side for diagnostics, but the UI never
  shows untranslated internal identifiers.
- **Keep the editor open when the metadata was NOT saved.** A success
  carrying METADATA_SAVE_FAILED used to close the editor; the refetch
  then synced local inputs back to the unchanged stored metadata,
  discarding the user's attempted edit. The editor now stays open on
  that warning so the user can retry.
- **A committed mutation is never a total failure.** When the primary
  swap committed but the follow-up row refetch failed, the route
  returned a bare 500 — hiding the committed change from a UI that
  treats 500 as "nothing changed". It now returns 200
  `{ success: true, image: null, warnings: [..., 'row_refetch_failed'] }`
  (a distinct code, not the misleading 'primary_swap_failed'); the
  mutation hook invalidates on success, so the library refetch converges
  the UI to the true state.
- **Storage bucket literals must derive from IMAGE_BUCKET.** Review
  caught `storage.from('personas')` literals in the images route's
  signed-URL/DELETE paths and persona route's creation/update/delete
  cleanup — all now use IMAGE_BUCKET. When fixing a banned literal,
  grep the whole diff for siblings (db `.from('personas')` calls are
  fine — they are tables, not buckets).
- **Response types must describe the response.** POST /api/persona
  returned `warnings`/`imageIds` that CreatePersonaResult didn't
  declare, so the web consumer dropped them silently. The type now
  declares both, createPersona narrows them defensively, and the
  creation feedback surfaces warnings through the shared i18n mapper.
- **Client-safe constants live in the client-safe leaf.**
  MAX_IMAGE_BYTES / ALLOWED_IMAGE_MIME_TYPES moved into
  persona-image-select.ts (dependency-free) so the picker, the server
  helper, and `<input accept>` all derive from one source — and
  PERSONA_IMAGE_WARNING_CODES moved there too, after a client import
  of persona-images.ts pulled node:crypto into the browser bundle.
- **RPCs enforce ownership explicitly via p_user_id — never rely on
  out-of-repo RLS alone.** record_persona_image_use and
  set_primary_persona_image take `p_user_id uuid default null` and filter
  `user_id = coalesce(p_user_id, auth.uid())`. The app always passes the
  verified caller id (the route checked ownership first); direct
  PostgREST callers fall back to auth.uid(). Blanket REVOKE is NOT an
  option — the browser flow invokes set_primary_persona_image through
  the session client. Signature changes need `drop function if exists`
  for the old arity first: CREATE OR REPLACE does not replace a changed
  argument list. The SQL-literals sync test pins the guard's presence.

## Web/API/MCP review learnings, round 16 (2026-09-28)
- **An ownership guard that doesn't stop execution is advisory, not
  enforcing.** set_primary_persona_image's `perform ... for update` with
  the user_id check found zero rows on mismatch but execution FELL
  THROUGH to the persona_id-scoped UPDATEs — a service-role caller with
  a wrong/omitted p_user_id would corrupt another tenant's rows. Both
  RPCs now `raise exception ... using errcode = 'P0002'` when the
  ownership-checked statement matches no row (record_persona_image_use
  converted from `language sql` to plpgsql for the check). The sync test
  pins both raises.
- **Distinguish "not found" from "DB is down" at every .single().**
  assertPersonaOwned/getOwnedImage collapsed every error into 404 with
  no logging — a Supabase outage looked like "not found" and told the
  client to stop retrying. PGRST116 (zero rows) is 404; anything else is
  a logged 500. Same for the PATCH metadata update: a concurrently
  deleted row (PGRST116) is 404, and the update is re-scoped with
  `.eq('persona_id', ...)` to make the TOCTOU window explicit.
- **Never render raw English server errors in the localized UI.**
  `result.error` strings were shown verbatim (pt-BR users got English
  failure copy). mapPersonaImageError maps known failure classes (full,
  faceless, content mismatch, too-long, not found — dynamic ones by
  regex so limit changes still match) to i18n keys; unknown errors fall
  back to the generic localized message, never the raw string.
- **Non-file entries in an index-aligned multipart field are a 400,
  not a silent filter.** A stray string in `images` was dropped while
  imageTags/imageDescriptions matched by index — every subsequent
  tag/description shifted onto the wrong image. Reject the request.
- **Fail-fast guards belong on every mutation path, not just the happy
  one.** The MCP updatePersonaImage trimmed metadata but never checked
  MAX_LIBRARY_TAG_LENGTH/DESCRIPTION_LENGTH (the add/create paths did);
  the length check is now a shared checkLibraryMetadataLengths used by
  both normalizeLibraryMetadata and the update path.
- **Verify the reviewer's premise before applying the suggestion.**
  OCR claimed `.PNG` (hidden file) slipped past the `base === extension`
  check via case — but Node's extname('.PNG') is '' (a leading dot with
  no other dots is not an extension), so the check was dead code that
  could never match in ANY case. Removed it; dotfiles are rejected by
  the unsupported-extension branch, now pinned by a test.
- **One derived constant for user-facing numbers.** The MB divisor was
  written three ways across the MCP (`/ (1024 * 1024)`, `/ 1024 / 1024`);
  MAX_LIBRARY_IMAGE_MB now lives in a tiny limits.ts (avoids a
  client<->errors import cycle) and every description/error string uses
  it. ImageTooLargeError dropped its redundant maxBytes param.
- **Defer blob-URL revocation past the state commit.** dropPreview ran
  synchronously after setPending — React may not have committed the
  removal yet, flashing a broken image. queueMicrotask defers it.
- **Shared cleanup orchestration lives next to the rollback logic.**
  The orphanPaths retry-once remove was duplicated between POST
  /api/persona and POST /api/persona/images with subtly different
  ordering rules; removeOrphanedUploadPaths in lib/persona-images.ts
  owns the retry semantics now (row-backed orchestration stays at the
  call site — it genuinely differs per route).
- **Narrow untrusted arrays field-by-field, but keep the valid entries.**
  toStringArray discarded a whole mixed array; it now filters
  non-strings (a partially malformed warnings payload must not swallow
  real partial-success notes). fetchPersonaImages drops malformed image
  records (id/image_url narrowed) instead of passing them to the UI.
- **Hoist the TTL, name the nested ternary.** The 3600s signed-URL TTL
  is now IMAGE_URL_TTL_SECONDS; the face-mix insert coercion is
  resolveStoredFaceMixPercent in persona-schema.ts (no nested ternary);
  the empty-state conditional is a named showEmptyState.

## Web/API review learnings, round 17 (2026-09-28)
- **New stateful UI ships with behavioral tests on both sides.** The
  `image_url_error` retryable-thumbnail state had a producer, a
  consumer, and a documented type — but no test asserting GET emits the
  flag on signing failure, nor that the card renders the retry copy.
  A refactor of `signImageUrl` or the card branch could have silently
  broken the contract. Both are now pinned.
- **Batch file errors name the failing entry.** At creation, up to 10
  files arrive with index-aligned tags; a bare "Only image files are
  accepted." left API callers guessing which entry failed. The creation
  call site appends `(image N: name)` context (1-based). validateImageFile
  keeps its own messages stable; the UI's ERROR_CLASS_PATTERNS matches
  the content-mismatch base message with an optional context suffix so
  the specific localized copy still applies.
- **The OCR review action fails intermittently without posting findings**
  (observed on 2451284 and 5899432 — "Run OpenCodeReview" step errors).
  Zero new threads + a failed action = infrastructure, not a dirty
  review. Re-run or proceed; do not treat it as a code failure.
- **The OpenCode review action can fail twice in a row without posting**
  (observed 2026-09-28 on 84db8ca — both the initial run and the rerun
  failed in the review step, zero threads). Same rule: infrastructure,
  not a code failure. After two consecutive failures, stop re-running
  and document it; the local test suite + CI green is the evidence.

## MCP review learnings, round 19 (2026-09-28)
- **Fail fast on the effective value, not just presence.** createPersona
  rejected library images without an avatarUrl but let
  avatarUrl + faceMixPercent: 0 through — the server treats a stored 0
  as faceless and 400s after the bytes are uploaded. The client now
  computes the effective mix once (shared with the form field) and
  rejects images at mix 0 before any file read.
- **Evaluated and declined (thread triage, 181 threads):** FK from
  persona_images.user_id to auth.users (Supabase convention avoids it;
  the in-RPC ownership guard is the trust boundary); an exists()
  pre-check in resolveVideoImage (the listing query IS the existence
  check — a pre-check adds a round trip); versioned SQL migrations
  (deliberate manual-apply script; the user applies it in the
  dashboard); a local faceless/library-full pre-check in
  addPersonaImage (needs server knowledge the client doesn't have);
  distinct errcodes for the two set_primary_persona_image probes
  (practically unreachable; churn); unifying NULL face_mix_percent
  behind one helper (the two NULL treatments are both deliberate
  fail-closed in different contexts — library writes block, the
  video-job 503s on an unsignable photo — one boolean would weaken
  one of them); surfacing personaId on double-failed creation rollback
  (needs two independent failures; the error contract stays
  {success, error} and the server logs loudly).

## Web/API review learnings, round 27 (2026-09-28)
- **"Every field the UI reads" means every field the UI renders.**
  Round 26 extended fetchPersonaImages narrowing with is_primary and the
  next verdict quoted the rule back: the card also renders tag/description
  (`alt={image.tag ?? ''}`, `{image.tag || '—'}`). When a review closes a
  gap in a guard, grep the consuming components for every field read
  before calling it done — the verdict may only flag the first gap.
- **Every new upload surface gets rate limiting by default.**
  POST /api/persona/images was the only new upload endpoint without
  applyRateLimit (mediaUpload profile: 10/min, mirrors upload-content).
  Add it at the top of POST for any route that writes to storage —
  payload-behavior tests then mock the limiter no-op (see
  video-job.test.ts pattern) so a dedicated rate-limit suite owns the
  real behavior.
- **The in-memory limiter's shared bucket breaks multi-POST suites.**
  Without the no-op mock, 12 existing POST tests sharing the fallback
  'unknown' identifier would 429 on the 11th call. When adding a limiter
  to an existing route, add the mock to every existing suite that hits
  that method.

## Web/API review learnings, round 26 (2026-09-28)
- **A schema refine that never runs on the tool path is a hollow claim.**
  UpdatePersonaImageSchema's "at least one of tag/description/isPrimary"
  .refine was documented as machine-checkable at parse time, but the MCP
  SDK parses tool args against the raw shape and handleUpdatePersonaImage
  forwarded them without re-parsing — the rule held only via the client's
  fail-fast guard. Re-parse INSIDE the handleLibraryCall closure (like
  handleCreatePersona): parsing outside the closure throws the ZodError
  past the handler instead of turning it into a loud isError.
- **Narrowing guards must cover every field the UI reads.**
  fetchPersonaImages narrowed only id/image_url while the card drives
  the primary badge/toggle off is_primary — a corrupt non-boolean value
  slipped through. When a guard's comment states its intent, every field
  the downstream consumers read belongs in the predicate.

## Web/API review learnings, round 25 (2026-09-28)
- **Re-sweep the dictionaries after every "no exceptions" rule.**
  Round 23 converted libraryHint/libraryFilesRejected to {max}/
  {sizeMb} templates but missed libraryEmpty — the same hardcoded
  "10" in the empty-state copy. When a standing rule says "no
  exceptions", grep the dictionary files for the literal, not just
  the quoted call sites.

## Web/API review learnings, round 24 (2026-09-28)
- **Shared-param validation belongs on every dispatch branch, not just
  the main path.** The multipart/debug video-job branch dispatched to
  debugVideoJob BEFORE the JSON flow's image_id validation, so a debug
  request carrying image_id was silently ignored while the JSON flow
  rejects a provided id loudly. When a route fans out by content-type,
  check the dispatch order: each branch must apply the shared
  validation, or the branch split itself is the hole.
- **Delete dead wrappers and fix the doc comment's drift claim.**
  validateImageContent survived as an export with zero production
  callers after readValidatedImage became the shared contract — and its
  comment ("so the two validation paths cannot drift apart") described
  a duality that no longer existed. Remove the wrapper and reword the
  comment to the single contract.

## Web/API review learnings, round 23 (2026-09-28)
- **Verify a finding exists before touching code.** OpenCode asked to
  delete a "dead" `pushRecentImageId` helper at a line that holds
  something else — a repo-wide grep showed zero references: the helper
  was already gone in an earlier round. The reviewer was working from a
  truncated diff and cited a ghost. Check the claim against the tree
  first; a stale finding costs nothing to decline.
- **Every user-facing number derives from the shared constants —
  no exceptions.** `libraryHint` and (an unflagged sibling found by
  grep) `libraryFilesRejected` hardcoded "10"/"10MB" while the count
  badge and limit notice interpolated `{max}`. Both are now
  `{max}`/`{sizeMb}` templates fed from MAX_PERSONA_IMAGES and
  MAX_IMAGE_BYTES, pinned by dictionary tests.

## Web/API review learnings, round 22 (2026-09-28)
- **Fix the pattern at every level, not just the quoted one.** Round 21
  fixed the truthiness check in `selectPersonaImage`, but the identical
  `if (input.imageId && ...)` gate lived one level up in
  `resolveVideoImage` — an empty-string id skipped the 404 and fell
  through to the legacy photo fallback. OpenCode caught the sibling.
  When a finding names a pattern, grep callers AND callees before
  declaring it fixed.

## Web/API review learnings, round 21 (2026-09-28)
- **Falsy is not absent for explicit-id params.** selectPersonaImage
  used `if (input.imageId)`: an empty-string id fell through to
  automatic selection, silently substituting a face. Spell out
  `!== undefined && !== null` so every provided id — even '' — takes
  the exact-match path and returns null on no match (the round-6
  "never silently substitute" rule, extended to the empty string).
- **Route modules export only handlers.** IMAGE_URL_TTL_SECONDS was
  exported from `images/route.ts`; App Router route files officially
  support only HTTP-method/segment-config exports. Shared constants
  live in the lib leaf next to their siblings (IMAGE_BUCKET).

## Web/API review learnings, round 20 (2026-09-28)
- **Align sibling boundaries on the same input class.** Round 10 rejected
  bare-extension filenames (".png") in the MCP fail-fast path, but the
  web `validateImageFile` used `split('.').pop()` which maps ".png" to
  "png" and passed it. `lastIndexOf('.') > 0` treats a leading dot as
  "no extension" (matching Node's extname, which the MCP relies on), so
  both boundaries now reject dotfiles identically. When a reviewer
  flags a pattern fixed on one side, grep for the sibling.
- **Evaluated and declined:** buffering up to 10×10MB in
  validateLibraryInputs before insert (round-18 trade-off: fail-fast
  validation with no double read, pinned by a test; the reviewer
  itself called it "a note, not a defect" — per-file validate+store
  would trade the all-or-nothing creation atomicity for bounded
  memory).

## Web/API review learnings, round 18 (2026-09-28)
- **Coercion at the write boundary must be unconditional for the
  security-relevant branch.** resolveStoredFaceMixPercent only coerced
  null/undefined; a direct API caller sending personaMode=faceless with
  an explicit faceMixPercent=80 stored 80, and the images route (which
  treats the stored mix as the facelessness source) accepted library
  uploads — re-opening the backdoor. The faceless branch is now
  unconditional (`if (personaMode === 'faceless') return 0`), pinned by
  a test.
- **One canonical error shape per failure class across producers.**
  addLibraryImages said "Tag must be N characters or fewer." while PATCH
  said "tag must be at most N characters." — the UI's error-class
  pattern only matched the latter, so upload rejections fell back to the
  generic message. Aligned addLibraryImages to the PATCH wording.
- **Don't read the same file twice at creation.** validateLibraryInputs
  read every file for the fail-fast magic-byte check, then
  addLibraryImages re-read them for upload (2×10×10MB worst case).
  validateLibraryInputs now returns the validated bytes/mime via
  `validatedContent`, which addLibraryImages reuses. Pinned by a test
  spying on File.prototype.arrayBuffer.

## MCP review learnings, PR #7 bluesky/faceless (2026-09-28)
- **Evaluated and declined (two OpenCode rounds, contradictory):** round 1
  MAJOR said `args.personaId === undefined || args.personaId === null` in
  handleGenerateVideo is a type-safety bug — false positive. The MCP SDK
  validates tool args against the Zod schema before the handler runs, and
  `z.string().min(1).optional()` rejects null, so null can never reach the
  handler through the tool path. The spelled-out nullish check follows the
  project rule (strict null checks only; `== null` banned). Do not
  "simplify" it to `=== undefined` on reviewer request. Round 2 then
  argued the exact opposite (add `.nullable()` because "the client sends
  null") — also false positive: it conflates the two layers. The tool
  input contract is omission-for-faceless; only the HTTP client maps that
  to the web API's explicit null sentinel (client.ts,
  `personaId: input.personaId ?? null`). The codebase already avoids
  `.nullable()` where null has no meaning at that layer (tools.ts:92).
  Pinned by a test: the schema rejects explicit null personaId.
- **Pin undefined/[] equivalence in validators.** missingProviderAccountIds
  treats a missing array and `[]` identically (`?? []`); an OpenCode MINOR
  asked for the behavior to be documented — added a pinning test rather
  than changing code.

## Release workflow review learnings, PR #8 (2026-09-28)
- **Evaluated and declined: `--provenance-registry` is not needed.** OpenCode
  MAJOR claimed `npm publish --provenance` must pass
  `--provenance-registry https://registry.npmjs.org/` — false positive. The
  official npm docs' canonical GitHub Actions flow is exactly
  `npm publish --provenance --access public` with
  `registry-url: 'https://registry.npmjs.org'` in setup-node, which is what
  the workflow does; `--provenance-registry` appears nowhere in the
  recommended flow. Do not add the redundant flag on reviewer request.
- **Evaluated and declined: keep `git+https` repository URLs.** OpenCode MINOR
  suggested `git+ssh://git@github.com/...` for the package.json repository
  field — declined. npm's own package.json docs use the `git+https` format,
  and SSH requires consumers to have GitHub SSH keys, which breaks the
  universal `npx post-engineer-mcp` install path. HTTPS is the correct
  format for a public package.

## CodeQL review learnings, PR #6 (2026-09-28)
- **Evaluated and declined: `build-mode: none` is correct for interpreted
  languages.** OpenCode MAJOR claimed the CodeQL workflow needs build steps
  for Next.js and Python — false positive. CodeQL analyzes
  javascript-typescript, python, and actions from source; no build is needed
  or useful. CodeQL is not a type checker (tsc covers that in CI) and
  `pip install` does not improve CodeQL Python analysis (dependency vulns are
  Dependabot/pip-audit's job). Empirical proof: the `Analyze
  (javascript-typescript)` and `Analyze (python)` jobs both passed with
  `build-mode: none`. The reviewer's suggested commands were also wrong for
  this repo (pnpm workspaces install from root, engine uses uv, no
  requirements.txt at that path). Only compiled languages need
  autobuild/manual.

## CI lessons

- **Rebase can silently drop a dependency from package.json while the lockfile
  keeps it (2026-10-01, PR #34):** after rebasing onto main, conflict
  resolution on `apps/mcp/package.json` kept the old branch's
  `dependencies` block (without `posthog-node`) while `pnpm-lock.yaml`
  still referenced it — CI's `pnpm install --frozen-lockfile` failed with
  `ERR_PNPM_OUTDATED_LOCKFILE` ("specifiers in the lockfile don't match").
  Same class of bug previously bit `apps/web/package.json` (@sentry/nextjs
  resurrected). Rule: after ANY rebase that touches a package.json, run
  `pnpm install --frozen-lockfile` locally before pushing; and when taking
  `--theirs`/`--ours` on a package.json, diff the dependencies blocks
  explicitly instead of trusting the merge.

- Never pass CLI flags through `pnpm <script> -- <flags>` in workflows:
  pnpm (v10) forwards a literal `--` to the script, so
  `pnpm test -- --coverage` runs `vitest run -- --coverage`, and vitest then
  silently skips coverage generation (tests still pass, no report files are
  written). The downstream step fails later with a confusing "file not found".
  Invoke the binary directly instead: `pnpm exec vitest run --coverage ...`.
- `actions/upload-code-coverage` fails closed on a missing report file even
  with `fail-on-error: 'false'` (that input only downgrades *upload* errors,
  e.g. Code Quality not enabled). The coverage-generation step must actually
  produce the file, or CI goes red.
- **OCR review 409 artifact conflict (2026-09-29):** the `alibaba/open-code-review`
  action's "Upload review artifacts" step runs `always()` with a fixed per-run
  name (`ocr-review-result-<run_id>-<run_attempt>`). Our workflow invokes the
  action twice (primary + free-model fallback), so when the primary fails and
  the fallback runs, the fallback's upload 409s on the name the primary already
  created — the job goes red and "Post review comments" is skipped even though
  the fallback review SUCCEEDED. Fix: `upload_artifacts: 'false'` on the
  primary attempt only; the fallback keeps its upload (its artifacts are the
  useful ones). Verified against run 36537786650 (single artifact from the
  primary, fallback 409).
- **OCR review exits 1 on informational-only findings (2026-09-29):** with the
  409 fixed, a run can still go red with just two `low` severity comments that
  explicitly say "no code quality concerns" (verified: PR #17, run 36538879908,
  both notes praised the docs). The action exits 1 whenever its comments list
  is non-empty. A red ocr-review check is NOT actionable until the findings are
  read: download the `ocr-review-result-<run_id>-1` artifact and inspect
  `ocr-result.json`'s `comments[].content` before touching code.
- **OCR review concurrency vs z.ai rate limits (2026-09-29):** the action's
  default `--concurrency 8` trips z.ai's rate limiter (HTTP 429 on BOTH the
  coding endpoint/glm-5.3-flash and the standard endpoint/glm-4.7-flash —
  observed on PR #17's run 36538879908, 13 requests all 429ing after retries).
  The workflow now pins `review_concurrency: '2'` on BOTH attempts (the
  validator requires the two invocations to stay in sync on shared settings).
  If ocr-review goes red with `classification: "provider"` /
  `reason: "provider or subtask request failed"` in the artifact's
  `ocr-result.json`, it's z.ai throttling, not our code — re-run the job
  later rather than "fixing" anything.
- **OCR review: verify alleged type errors against the code (2026-09-29):**
  the reviewer flagged a `high` "return type mismatch" on a function with NO
  return-type annotation whose four paths all return a consistent 5-tuple and
  whose caller handles the None case explicitly — pure false positive.
  Declined without code change. Pattern: the reviewer invents a "contract"
  (e.g. "5-tuple contract", "should be Optional[...]") that the code never
  declares; check whether the alleged contract exists before touching anything.
- **OCR fallback chain mirrors opencode-review (2026-09-29):** ocr-review now
  retries 5.3-flash -> 4.7-flash -> 4.5-flash, same as opencode-review's
  ZAI_FREE_MODEL -> ZAI_FREE_MODEL_FALLBACK. Invariants the validator pins:
  all invocations share one action pin (max 3), every fallback carries the
  fail-closed gates (key-check + env-guard) plus the previous-attempts-failed
  conditions, non-final attempts have `continue-on-error: true` (otherwise a
  mid-chain failure ends the job before the next fallback runs) and
  `upload_artifacts: 'false'` (only the LAST attempt uploads — fixed per-run
  artifact name would 409-conflict otherwise).

## Test quirks (vitest 4.1)

- **Don't `mockReset()`/`mockClear()` a `vi.stubGlobal`'d fetch in
  `beforeEach` when a test makes it throw.** Observed 2026-09-28
  (lib/__tests__/token-balance-real.test.ts): with the reset in place, a
  throwing fetch mock surfaces as a phantom `Error` attributed to the test
  even though the code under test catches it and behaves correctly
  (verified: right return value, logger.warn called once). Without the
  reset, the same test passes. Arm the mock explicitly in each test instead
  of resetting the stubbed global.

## Logger migration rule (2026-09-28)
- When migrating a direct `console.warn/error(msg, obj)` call to
  `logger.warn/error(...)`, the logger's console emission must preserve the
  EXACT call shape (message first, metadata/error as separate args).
  Pre-existing route tests pin it with
  `toHaveBeenCalledWith(msg, expect.objectContaining(...))` — adding a
  `[WARN] [logId]` prefix arg or JSON-stringifying metadata into the message
  breaks them (10 tests went red this way; the fix was a shape-preserving
  passthrough in `writeConsole`). The logger adds Bugsink routing and returns
  the logId; it must not reshape the console call.
- Same reason: don't "improve" the metadata at a migrated call site
  (`console.warn(msg, err)` -> `logger.warn(msg, { err })` is NOT faithful
  when a test expects the raw object as 2nd arg). Migrate the shape as-is;
  split cause/metadata only where no test pins the old shape.

## Reviewer finding: logging coverage (2026-09-28, PR #11)
- OpenCode flagged a GENUINE gap: `POST /api/persona` had been migrated to
  `logger.error` but had no dedicated failure-logging test. Fixed by adding
  `app/api/persona/__tests__/route-logging.test.ts` (insert failure ->
  `logger.error` with the real DB error, sanitized 500 to the client).
- Lesson: when migrating a route's failure path to the central logger, add a
  `route-logging.test.ts` (or extend the existing test) asserting the logger
  call — the migration is only half done without the pinning test. The
  reviewer's suggested assertion message was wrong (`create failed` vs the
  actual `'[api/persona] insert failed'`): always verify findings against the
  code before applying.
- The same review's MINOR (extract a shared `extractErrorMessage` helper for
  the `error instanceof Error ? error.message : ...` pattern) was evaluated
  and DECLINED: no functional issue, and the churn would touch many files
  and their test expectations for zero behavioral benefit.

## Reviewer findings: persona batch gating (2026-09-28, PR #13)
- OpenCode's MAJOR ("`params.lipsync_enabled` never consulted by
  `_use_daily_persona_batch`") was factually WRONG: the helper delegates to
  `task.persona_lipsync_active(params)`, which checks
  `not bool(params.lipsync_enabled)` in its guard (task.py). A face persona
  with lipsync disabled already skipped the batch before the review. Verify
  findings against the code before applying — this reviewer misread its own
  cited function.
- The MAJOR's actionable core WAS genuine: the test suite hardcoded
  `lipsync_enabled=True`, so the disabled-lipsync path was unpinned. Fixed
  with `test_face_with_lipsync_disabled_skips_daily_batch`.
- The MAJOR's "consider an integration test for the route" was accepted too:
  `PersonaBatchRouteTest` patches `create_task` and pins `daily_batch` at
  the `/persona-videos` boundary, guarding against a future revert of the
  one-line wiring. Route-level pinning is cheap when the fix IS the wiring.
- MINOR rename (`_use_` -> `_should_use_`): DECLINED, pure churn, the
  predicate name reads fine as a question.
- MINOR gitignore note (`!test/controllers/test_*.py` "broad"): DECLINED,
  the reviewer itself admitted it matches the existing
  `!test/services/test_*.py` pattern and is intentional.

## Web/API review learnings, round 28 (2026-09-28)
- **Multipart route tests need `// @vitest-environment node`.** The default
  jsdom env mixes jsdom's FormData/File with undici's Request: constructing
  `new Request(url, { body: formData })` with a File entry throws
  `TypeError: Cannot read properties of undefined (reading '_buffer')`
  inside jsdom's FormData.forEach. The create-with-images suite already
  carries the node pragma for this reason — any new test posting multipart
  bodies (especially with files) must too. String-only FormData does not
  trip it, which makes the failure look file-specific.

## Billing review learnings (2026-09-28, genuine finding)
- **Whoever charges owns the refund ledger.** Engine-billed batch videos are
  charged with IDs the web never sees and never receives `engine_task_id`,
  so the web's status-proxy refund cannot reach them. The batch runner
  refunds each failed video's own upfront charge itself — one refund per
  task by construction, never via the web path. When adding a new
  charge flow, first map which ledger owns each charge row, then place
  the refund next to the charge.
- **`refund_tokens` returns bool — False is a real failure.** A soft
  failure (RPC answered, charge not refunded) is not an exception, so
  try/except alone lets lost tokens vanish silently. Log loudly on any
  non-True return, and keep the batch running.
- **An unreadable terminal state must be loud, not just fail-closed.**
  `_batch_task_failed` returns False on a read exception so the batch
  survives, but the exception is logged — otherwise a skipped refund
  leaves no trail at all.

## PR #14 review learnings (2026-09-28, OpenCode — evaluated and declined)
- OpenCode MINOR suggested replacing `hasattr(module, name)` with
  `assertNotIn(name, dir(module))` in `test_batch_machinery_is_gone` as
  "more robust". Declined: the module defines no module-level
  `__getattr__` (verified by grep), so for plain module attributes the
  two checks are functionally equivalent — the suggestion is stylistic,
  not a robustness gap. Reviewer suggestions about "more robust"
  checks still get verified against the actual module before any change.

## PR #14 review learnings, round 2 (2026-09-28, OpenCode on 772260f)
- **Declined as false positives (verified against the code):**
  - CRITICAL "daemon threads die silently": `thread.start()` failure is
    caught by the caller's try/except (refund + re-raise + ERROR log);
    a crash inside the thread target hits `task.start`'s top-level
    `except Exception` → `logger.exception` + `_fail_task` (structured
    Bugsink logging). Nothing is silent on either path.
  - CRITICAL "error messages still say 'queued'": they already say
    "could not be dispatched" — the review quoted stale line numbers.
  - MAJOR "PersonaBatchQueueFullError comment at video.py:204-205": the
    symbol and comment do not exist anywhere in the codebase.
  - MAJOR "dispatch test only covers happy path": dispatch failure is
    covered at the caller level
    (`test_generate_batch_dispatch_failure_refunds_single_video`) and
    `task.start` crash handling has its own tests; a concurrency test
    would only test `threading` itself.
  - MINORs on config.example.toml + SIGNED_URL comment: both already
    fixed ("max gap until generation"); the remaining "daily batch
    cadence" comment lives in the untracked local config.toml.
- **Genuine (fixed):** the review's CRITICAL-2 misattribution surfaced a
  real stale module docstring in fill_schedule.py describing the removed
  `PersonaBatchQueue`/06h cutoff (and "no token spend" for batches,
  which are prepaid at schedule creation). Fixed the docstring.
- Lesson: this reviewer re-reviews the whole PR diff on every push and
  its line numbers go stale fast — always re-locate each cited finding
  in the current tree before acting.

## Docs-sync review learnings, round 1 (2026-09-28, PR #16)
- **Verify the reviewer's line numbers before touching code.** OpenCode
  cited docs-sync.test.ts lines 316-318 for a "missing webhookUrl param
  assertion" — the file has 45 lines. The premise was stale/hallucinated;
  the finding was declined after verifying webhookUrl IS documented in
  both surfaces (README + mcp-docs-section.tsx EN/PT) and the test's
  contract is tool-name sync, not per-parameter pinning.
- **Decline scope-creep findings explicitly.** A docs test designed to pin
  tool-list sync across surfaces should not grow per-parameter assertions
  for one param of two tools — that is a different test with a different
  contract. Record the decline; do not expand the test to satisfy the
  reviewer.

## Simplify always: delete dead code, fail fast (2026-09-29)
- When a flow is removed, delete the ENTIRE path: API route + client
  functions + MCP tool + docs + i18n keys + tests. A half-deleted flow
  (e.g. POST /api/schedule gone but MCP schedule_video still calling it)
  is worse than the old code — it breaks loudly at runtime instead of
  failing at build time.
- Never silently ignore invalid states. Fail fast with a loud error so a
  resurrected dead path surfaces immediately instead of hiding as dead
  rows in the DB.
- If an endpoint/tool isn't used, it shouldn't exist. "Keep it por agora"
  is how garbage accumulates.

## Verify web-edited commits before merging (2026-09-29)
- A GitHub web edit ("Atualizar o tools.ts" on PR #18) duplicated JSDoc
  lines and left tools.ts unparseable — CI on the old head never caught it
  because the edit landed after the last green run. Cherry-picking the
  branch surfaced the break locally via vitest.
- Rule: after cherry-picking or merging a branch that contains web-made
  commits, run the affected test suite + typecheck locally before pushing.
  A green CI badge on an older head means nothing for a newer edit.

## PR #27 review learnings (2026-09-30, OpenCode — 1 fixed, 4 rebutted)
- **OpenCode line numbers can be hallucinated — grep the file.** Two
  findings cited lines beyond EOF (route.ts:1082-1083 in a 723-line file;
  batch test 1226-1248 in a 477-line file); a third described a
  NO_CONNECTED_ACCOUNTS gap that the implementation already covers
  (batch/route.ts:227, tests green). Always verify the location exists
  before engaging with the argument.
- **Verify the reviewer's premise about types.** "Unnecessary type
  assertion" on `(persona as Record<string, unknown>)` was false: the
  Supabase client is the bare untyped `SupabaseClient`, so `data` is
  `any` and the assertion is the project-blessed any→unknown narrowing,
  not dead code.
- **A 201-with-warnings suggestion can be incoherent — read it fully.**
  The reviewer asked to keep the schedule and return 201 on slots-insert
  failure, but its own snippet returned the never-inserted slot ids as
  created AND refunded the tokens. The approved contract is atomic
  creation (rollback + refund + 500); the 500 is honest because nothing
  remains after the rollback.
- **Fixed (MAJOR 2): test names must match their assertions.** The slots-
  failure test was named "rollback (apaga schedule)" but only asserted
  the 500 + refund. The mock now tracks `deleteCalls` per table and the
  test asserts both compensating deletes run — removing either delete
  from the route fails the test.

## PR #30 review learnings (2026-09-30, OpenCode — 0 fixed, 4 rebutted)
- **A reviewer's "observability gap" fix can be worse than the gap.** The
  reviewer wanted a `logger.warn` on every swallowed `OSError` in
  `get_deployed_version()`; but `/app/VERSION` is legitimately absent in
  local dev, so the warning would fire on every `/health` hit there (log
  spam), and the startup event already logs the resolved version — the
  diagnostic trail the finding claimed was missing. Check what boot-time
  logging already records before accepting an observability-gap premise.
- **Cross-language hallucinations are a tell.** The CRITICAL finding told a
  TypeScript vitest suite to mock `fs.readFileSync` throwing `OSError`
  (a Python exception) for a function that reads env vars, not files —
  and cited lines 136-147 in a 27-line file. When a finding mixes
  languages or cites impossible lines, rebut it; don't mine it for a
  grain of truth.

## PR #35 review learnings (2026-10-01, OpenCode — 0 fixed, 2 declined)
- **Respect the reviewer's own non-blocking verdict.** Both MINORs came with
  explicit "not requesting a change in this PR" / "cosmetic only" qualifiers:
  (1) empty-string `POSTHOG_HOST` bypassing the default is pre-existing
  behavior on lines the PR merely rewrote — fixing it would change runtime
  semantics beyond the PR's refactor scope; (2) the doubled
  `@vitest-environment` pragma text in the new test file is comment-only.
  A cosmetic commit restarts the full ~10min CI and risks orphan commits if
  the user merges mid-babysit. When the reviewer declines its own finding,
  record the decision and move on — don't churn for the reviewer's sake.

## PR #35 review learnings, round 2 (2026-10-01, OpenCode on 27b5cbf — 3 fixed)

- **Parallel literals across apps get a sync test.** When a change introduces
  the same constant in multiple apps with no shared package (here
  `DEFAULT_POSTHOG_HOST` in web/engine/mcp), a one-sided future edit
  silently desyncs them — and analytics paths swallow delivery errors by
  design, so nothing surfaces. Pin them with a file-parsing sync test that
  asserts the literals match, mirroring the SQL-literals precedent
  (`supabase/persona-images.sql` vs TS constants). The test comment must
  spell out the self-hoster trade-off (change all three, or update the test
  to assert the intended mapping) so a divergent host is always conscious.
- **Delete env vars in tests via `vi.stubEnv(key, undefined)`, never a
  manual `delete process.env.X`.** `vi.unstubAllEnvs()` only restores
  *stubbed* values; a manual delete permanently removes the var for every
  subsequently-run test file in that worker — on a self-hoster's machine,
  where the var may genuinely be set, that's a leak. `stubEnv` with
  `undefined` deletes the var and restores the original on unstub.
- **Align the semver bump with the PR title.** Repo rule is minor-for-feat,
  patch-for-fix: a `feat:`-titled PR that bumps patch is the misnomer (or
  vice versa). When a PR mixes feat and fix commits, pick one and align the
  other — here the title stayed `feat(posthog)` so the bump went
  1.8.1 → 1.9.0. CI `version-check` only enforces sync, not the level, so
  this is on the author/reviewer, not automation.
- **The user merges mid-babysit — the pre-push `gh pr view` check keeps
  paying off.** Round 2 ended the same way as #34: the user merged at
  12:13:10Z while a fix commit was in flight; the check caught it before
  the push, so the unpushed work (cross-app sync test) stayed local instead
  of becoming orphan commits. Never skip the check, no matter how "safe"
  the push looks.

## PR #37 review learnings (2026-10-01, OpenCode on 8d6e498 — 2 fixed)

- **The sed-on-conflict version mistake recurred — grep for duplicate keys,
  not just markers.** The 2026-10-01 rebase lesson (~/AGENTS.md) says sed on
  conflicted version files leaves markers and duplicates TOML keys; on PR
  #37's rebase the same shortcut left DUPLICATE `"version"` keys in both
  package.json manifests (JSON.parse keeps the last, so version-check stayed
  green while the files were malformed). After any version-file conflict
  resolution, run `grep -c '"version"'` on each package.json in addition to
  the marker grep and `bump-version.sh check`. Note: the duplication came
  from manual conflict resolution, not from `bump-version.sh` — its
  `re.subn(..., count=1)` is idempotent-safe.
- **Pin a default literal in every code path that carries it.** This PR
  changed the default provider in two places — the legacy `_generate_response`
  wrapper and `_generate_response_with_fallback` — but only the fallback had
  a test asserting `"omniroute"`. A future revert of just the wrapper's
  default would have gone unnoticed. When the same default literal exists in
  N code paths, pin all N (`test_wrapper_default_provider_is_omniroute`
  mirrors `test_default_provider_is_omniroute`).

## Engine review learnings, PR #38 (2026-10-01)
- **Free-text secret scrubbers must handle quoted/JSON shapes, not just
  bare `key=value`.** `_SECRET_VALUE_PATTERN` missed `"api_key": "sk-..."`
  (JSON) and `'api_key': 'sk-...'` (Python repr) — exactly the shapes model
  output and SDK/HTTP errors echo when they embed config blobs. The
  existing test pinned only the bare shape (false confidence). Rule: probe
  a free-text redaction pattern against every serialization shape the
  field can carry (bare, JSON, dict repr), and test each shape.
- **Scrub the full free-text field before truncating it.** Truncate-then-
  scrub on `response_preview` left a leak: a 500-char cut landing mid-key
  produces a secret fragment the key-anchored pattern can no longer see.
  Scrub-then-truncate removes the boundary case entirely.
- **Global redaction exemptions must be value-type-gated.** An exact-name
  exemption list (`_REDACT_EXEMPT_KEYS`) applied to every event is a silent
  global opt-out: any future caller reusing an exempt name for a secret
  value bypasses redaction. Only honor the exemption for non-bool ints —
  a secret is never an int.
## Build learnings (2026-10-01)
- **A dynamic `import()` does NOT keep a Node-only package out of the client
  bundle.** Webpack statically analyzes `import('posthog-node')`, resolves it
  at build time, and bundles the SDK into the client chunk. posthog-node
  ships no browser export condition (only node/edge/workerd), so the client
  build died on `node:fs` / `node:os` / `node:path` (UnhandledSchemeError)
  via the chain `billing/page.tsx → token-balance.ts → logger.ts →
  posthog-server.ts`. Mark the import `/* webpackIgnore: true */` so webpack
  emits it untouched: Node resolves it natively at runtime on the server,
  and the browser never reaches it (the `typeof window` guard returns null
  first). Pinned by `posthog-server.node.test.ts` ("marks the posthog-node
  dynamic import with webpackIgnore: true"). Same bug class as the earlier
  `node:crypto`-in-the-browser-bundle incident — a client-reachable module
  must never give webpack a statically resolvable path to a Node-only
  package.
- **CI never runs `next build` for web — only Vercel does.** Webpack
  client-bundle breakage slips through a green CI; treat the Vercel preview
  build as the web build gate, and reproduce locally with
  `npx nx build web --skip-nx-cache` (local env needs the build-time
  `NEXT_PUBLIC_*` vars; a dummy `.env` suffices for verification — never
  commit it).

## Web/API review learnings, PR #41 (2026-10-01)
- **OAuth callers take the service-client branch too.** `requireSupabaseSession`
  returns `isOAuth: true` for MCP/OAuth callers, who have no cookie session —
  `request-auth.ts` says to treat them like API keys. Every new route must
  branch `auth.isApiKey === true || auth.isOAuth === true`, not just
  `isApiKey`; otherwise RLS returns zero rows and the route 404s on data the
  caller owns. Pinned by OAuth tests on delete-preview and the DELETE cascade.
- **Every promise chain in a component gets a `.catch`.** A `.then` without
  one leaves the dialog in `loading`/`deleting` forever on network failure —
  all inputs disabled, no retry, the only escape a reload. Rejections surface
  as the component's error state, never a wedged UI.
- **Client fetch helpers never throw on HTTP errors.** Check `response.ok`
  and guard `response.json()` (Vercel 502 HTML bodies throw on parse);
  return `{ success: false, error }` so the caller's existing
  `result.success` branch handles it.
- **Bound downstream fan-out on read paths; `after()` post-commit cleanup.**
  A per-video engine lookup loop gets a cap (counts still report the full
  total). Post-commit cleanup (engine task dirs) runs in `after()` from
  `next/server` — a slow downstream must not turn a committed mutation into
  a client-side timeout that reports failure for a delete that happened.
  In tests, mock `after` to run the callback inline (the real one needs a
  request scope).
- **Expensive authenticated GETs get a rate-limit profile too.** The house
  rule was upload/POST surfaces; a GET that fans out to the engine (up to
  N lookups) gets its own `RATE_LIMITS` profile keyed by user id, applied
  right after auth. Payload tests mock the limiter no-op; one dedicated
  test owns the 429 path.

## Web/API review learnings, PR #41 round 2 (2026-10-01)
- **User-scope every child query, not just the siblings.** The delete-preview
  persona_images count was persona-scoped while schedules/generations were
  user-scoped — the "every query is re-scoped by user_id" comment overclaimed.
  When a comment asserts a guarantee, grep every query under it.
- **Aggregate budgets on bounded loops.** A per-call timeout does not bound
  a loop: 20 x 8s = 160s against a slow-but-alive downstream. Gate the loop
  on `Date.now() - start < BUDGET_MS`; items past budget degrade to null,
  counts stay complete. Pinned with a mocked-clock test.
- **Truncation is part of the contract.** A capped list needs a `truncated`
  flag in the response, the client type, and the UI — a silent cap hides
  unrecoverable data loss behind a destructive confirm.
- **Singular/plural keys for count labels.** Follow the
  `accountConnected`/`accountsConnected` convention; never render "1
  schedules". If the count already renders in `<strong>`, the label key
  carries no `{count}` of its own.

## Web/API review learnings, PR #41 round 3 (2026-10-02)
- **Budget the `after()` loop too.** `after()` has no deadline of its own —
  Vercel cuts the function off and the tail orphans silently. Give
  post-commit cleanup the same aggregate budget as the read path and log
  skipped ids loudly; best-effort is not silent.
- **Log inside never-throw helpers, with the id.** `resolveDownloadUrl`
  returned null on every failure path with zero trail. Warn with the task
  id and failure class (non-ok status, abort, unsafe id) so "download
  unavailable" is diagnosable server-side.
- **Name the degradation honestly in the UI.** A budget-cut lookup is not
  "unavailable" — the video exists. A `linksIncomplete` flag drives a
  distinct "could not be loaded in time" note with retry, not the
  unrecoverable copy.
- **Share input-class guards across sibling boundaries.** `SAFE_TASK_ID`
  lived only in delete-preview while the DELETE cleanup interpolated the
  same DB-sourced ids. One shared guard in the leaf module, used by both
  loops, pinned by unit tests.
- **Test env vars via `vi.stubEnv`, never manual delete.**
  `vi.unstubAllEnvs()` only restores stubbed values; a manual
  `delete process.env.X` permanently removes a genuinely-set var for later
  test files in the worker.

## Web/API review learnings, PR #41 round 4 (2026-10-02)
- **Bound the DB reads, not just the downstream fan-out.** `head: true,
  count: 'exact'` for pure counts; `.limit()` + deterministic
  `.order('created_at').order('id')` for the list. A capped API over an
  unbounded query still pulls every row into serverless memory.
- **One shared guard per input class.** `SAFE_TASK_ID` now lives in
  `lib/video-urls.ts` next to the other engine-URL helpers; the download
  proxy imports it instead of its local duplicate. Identical regexes drift.
- **Retry must not wipe user input.** The modal's refetch effect resets
  state per persona id (via ref), not per attempt — the links-incomplete
  retry keeps the typed confirmation name.
- **Harden the closest sibling too.** `updatePersona` had the same bare
  `response.json()` the PR fixed elsewhere; a 5-line hardening now beats
  the next review round flagging it.
- **Test the budget-skip branch, not just the happy path.** The `after()`
  cleanup budget got a mocked-clock test mirroring the preview's — the
  skip-and-log path is production logic, not an edge.

## Web/API review learnings, PR #41 round 5 (2026-10-02)
- **Reset-on-close is part of the confirmation gate.** A ref keyed on
  "is new" must clear when the dialog closes — otherwise cancel → reopen
  pre-arms the destructive button. The modal stays mounted; `persona: null`
  is the close signal. Pin both directions: retry keeps the name, reopen
  clears it.
- **Destructive mutations get their own rate-limit profile.** The DELETE
  cascade (multi-table + engine fan-out) got `personaDelete` at 10/min,
  lower than the preview's 30/min. Expensive + irreversible = stricter.
- **Clock mocks restore in afterEach, not at test end.** A failing
  assertion before a manual `mockRestore()` leaks the frozen clock into
  later tests in the worker. `vi.restoreAllMocks()` in afterEach covers
  every spy.

## Web/API review learnings, PR #41 round 6 (2026-10-02)
- **Test names must match their assertions.** "naming the step" asserted
  only the status code; the step name lived solely in the server log.
  Mock the logger and assert the exact message — or drop the claim from
  the name. (PR #27 rule, re-offended.)
- **Document intentional unboundedness.** The schedules id list stays
  unbounded because schedules are posting configs (handful per persona),
  not per-video rows. Say so at the call site; a comment claiming a
  bound that isn't there is worse than no comment.
- **Mirror every hardening branch with a test.** All three client helpers
  now have both non-ok and non-JSON tests — the catch branch is the last
  defense against proxy HTML bodies.

## Web/API review learnings, PR #41 round 7 (2026-10-02)
- **Scope the count query, not just the delete.** The preview's slot count
  used schedule ids from a user-scoped select but skipped its own
  `.eq('user_id')` — transitively safe today, a silent widening tomorrow.
  A cross-user fixture row pins it for free.
- **Justifications must survive the prepaid case.** "Work already
  happened" was false for batch-prepaid, never-generated slots. State the
  forfeiture honestly in both the code comment and the user-facing copy.

## Web/API review learnings, PR #41 round 8 (2026-10-02)
- **Transient vs gone is a product-critical distinction.** An engine 5xx/
  abort during the pre-delete window is not "download unavailable" — the
  video exists and deletion is irreversible. Return a failure class from
  the lookup (or at least split 404 from the rest) and flag the UI for
  retry. The round-3 budget rule generalizes: any lookup that can fail
  without the asset being gone must say so.
- **completedSteps must describe reality, not intent.** A push outside
  its `if` guard claims a step that never ran — the exact lie the field
  exists to prevent in partial-failure states.
- **Removing a response field orphans its locals.** Dropping `deleted`
  left `imagesDeleted` assigned-but-unused; the lint error is the
  reminder — delete the source variable too.

## Web/API review learnings, PR #41 round 9 (2026-10-02)
- **Effect deps key on identity, not the object.** A background refetch
  replaces the persona object; depending on `persona` resets the dialog
  mid-confirmation. Derive `personaId` and depend on that.
- **HTTP status classes are not binary.** 404 = gone, 401/403 = config
  error (log at error, never transient), 5xx/429 = transient. A 200 with
  an unparseable body is transient too — never dead-end copy for a
  garbled response.
- **Missing env vars deserve a warn.** A config error that degrades the
  UI silently is undiagnosable. One logger.warn per request when the var
  is absent.
- **Cleanup that must not block the response belongs in after().** The
  storage remove was the same class as the engine fan-out (post-commit,
  best-effort); keeping it inline reproduced the timeout failure mode the
  after() change exists to prevent.

## Web/API review learnings, PR #41 round 10 (2026-10-02)
- **Disable every interactive element during a pending mutation.** The
  retry button survived the "disable while deleting" pass because it
  lives in the videos section, not the confirm row. Any control that
  re-fires the effect must be disabled too — and pinned by test.
- **Pre-formed URLs need the same guard as constructed ones.**
  `firstDownloadUrl` accepted `/api/persona/video-download/...` strings
  verbatim; validate the task-id segment against SAFE_TASK_ID like every
  other interpolation path.
- **Cap reads that feed only cleanup loops.** The engine task-id select
  exists solely for best-effort cleanup — cap it with loud-skip. Document
  intentionally unbounded selects (schedules) at the call site.

## Web/API review learnings, PR #41 round 11 (2026-10-02)
- **Client helpers must surface structured server errors.** A generic
  "failed (404)" invites endless retries on a persona that no longer
  exists; parse the body on non-ok and surface code/error.
- **Narrow every field, including ids.** `persona.id` from an untyped
  row is any; the typeof guard costs one line and matches the file's
  own convention.
- **Destructive dialogs need the a11y trio.** Initial focus, Escape to
  cancel (not while deleting), focus trap. Type-to-confirm mitigates
  but does not replace.
- **Relocated branches need re-pinned tests.** Moving storage cleanup
  into after() moved its failure log; the test must follow the branch.

## Web/API review learnings, PR #41 round 12 (2026-10-02)
- **A declared ref with no reader is dead code.** Either wire the focus
  trap through it or delete it — an unused a11y affordance is worse than
  none, it claims a guarantee that isn't there.
- **Config throws are not transient.** engineAuthHeaders throwing on a
  missing secret must not ride the catch-all transient path; hoist it
  out and log at error.
- **One helper per input class.** Three copies of "parse non-ok body"
  is a contract waiting to diverge; extract it on the third copy.

## Web/API review learnings, PR #41 round 13 (2026-10-02)
- **Hoist config-throwing helpers out of transient catch blocks —
  everywhere.** The preview got it right; the sibling after() loop
  re-offended. When a helper throws on config, the catch must only see
  I/O errors.
- **The preview must count everything the cascade deletes.** "Lists
  exactly what will be deleted" is a contract; published-post history
  goes too, so count it and show it.

## Web/API review learnings, PR #41 round 14 (2026-10-02)
- **A parsed flag with no UI consumer is an overclaim.** parseErrorResponse
  extracted code but the modal ignored it; PERSONA_NOT_FOUND must close +
  refetch, not offer retry.
- **"Everything the cascade deletes" includes failed rows.** The status
  enum has more members than the happy path; enumerate them or count the
  total.
- **Behavioral branches need tests, not just logging branches.** The
  config-throw path changes what the user sees (no retry note); pin it.

## Web/API review learnings, PR #41 round 15 (2026-10-02)
- **Consumer-side tests close the loop.** The lib parsed PERSONA_NOT_FOUND
  but no modal test consumed it — the overclaim moved from server to
  client. Pin both sides.
- **Conditional UI rows need >0 fixtures.** publishedSlots/failedSlots
  render only when nonzero; every fixture used 0, so the branches never
  ran.
- **Legacy mocks must mirror the production chain.** A select without a
  thenable degenerates the cascade silently; give generic mocks the same
  shape as the real builder.

## Web/API review learnings, PR #41 round 16 (2026-10-02)
- **Verify race claims against the actual predicates.** The "multi-statement
  race" MAJOR overstated: schedules/generations deletes use persona_id
  (catching late rows); only slots use the select snapshot, and that race
  is documented. Check the WHERE clause before accepting the claim.
- **Validate every segment of a pre-formed URL.** First-segment checks
  leave later segments unencoded; test all of them.
- **Gate global listeners on open state.** A mounted-but-closed modal
  should not run key handlers on every page keypress.
- **Parallelize independent counts.** Three serial head+count queries
  become one Promise.all.

## Web/API review learnings, PR #41 round 17 (2026-10-02)
- **Validators must accept what encoders produce.** encodeURIComponent
  emits %XX; a validator rejecting % contradicts its own encoder. Test
  the decoded form.
- **Producer tests need the same fixtures as consumer tests.** The modal
  pinned failedSlots rendering, but the route never counted one — both
  sides need >0 fixtures.

## Engine review learnings (2026-10-02, PR #43)
- **A test comment claiming a behavior must pin it with an assertion.** The
  reconcile test's comment said "the refund is skipped" but asserted only
  "no raise" + status — a future refactor that refunded would pass silently.
  Mirror the sibling pattern (`assertEqual(store.refund_batch_calls, [])`):
  every claimed behavior gets its assertion, or the comment is a hollow claim.
- **A stage that throws on data issues spams every tick.** `persona_for`
  raising inside `reconcile`/`generate` killed the whole stage per tick and
  the ERROR log fed PostHog `$exception` every minute. Data-dependent
  failures (deleted persona, missing embed) must fail the slot once, never
  the stage repeatedly — move fallible lookups inside the per-item try.
- **Name the token-loss trade-off in a tracking comment.** When a fix
  deliberately burns prepaid tokens (unrecoverable cost without the persona
  embed), the skip site carries a NOTE naming the consequence and the
  follow-up (persist per-slot cost at creation), so the trade-off is
  discoverable, not silent.

## Engine review learnings (2026-10-02, PR #48)

- **Verify a vendor schema against the vendored SDK, not the reviewer's
  word alone.** The first version of the PostHog `$exception_list` emitted
  `stacktrace` as a plain string; posthog-python 7.61.1's own
  `exception_utils.py` (sitting in our venv) shows ingestion expects
  `{"type": "raw", "frames": [...]}` Sentry-style. The installed SDK is the
  ground truth for the wire format — read it before hand-rolling the shape.
- **One predicate per concept.** The "is HttpException" classification used
  `"http_status_code" in extra` while property forwarding used
  `extra.get(...) is not None`: a None-bound status would mis-group in
  Error Tracking with no filterable property explaining why. Same signal
  gets the same gate, pinned by a dedicated test.
- **Pin the default branch of a classification.** The `else "Error"` arm is
  what most records take (e.g. task-context binds with no exception tuple);
  assert it explicitly — a future regression relabeling plain errors would
  otherwise pass the whole suite.
- **Pin operation order behaviorally when no input distinguishes it.** For
  scrub-before-truncate, no realistic input leaks under the old order with
  this regex, so the test spies on `scrub_secret_values`' input length
  (>5000 chars observed) instead of asserting on output — the order itself
  is the contract.
- **Round 3: don't scrub what isn't free text.** `http_status_code` went
  through the free-text scrubber as a string, killing PostHog numeric
  filters; typed ints now forward raw. The exemption mirrors analytics.py's
  "a secret is never an int" rule — including its bool gate
  (`isinstance(True, int)`), which round 4 caught missing.
- **Round 5: a cap on an ordered list keeps the diagnostic end.** The
  100-frame cap kept the FIRST frames (framework boilerplate); Sentry
  frames end with the innermost frame, so the cap keeps the LAST N — the
  error site. The cap test pins `frames[-1]` is the raise site, not just
  the length.

## PR #46 review learnings (2026-10-02, OpenCode — 24h→3h schedule window)

- **Dead `||` fallbacks with divergent copy.** `windowCheck.error ||`
  `formatErrorMessage(...)` could never reach the right side (the failure
  branch is typed `{ ok: false; error: string }` and every path returns a
  non-empty string) — two user-facing copies for one error code, one of
  them unreachable. Drop the dead branch so one code has one copy at the
  call site; the registry's canonical template stays as the documented
  API-client default.
- **Scope negative copy guards to the phrase, not the bare token.**
  `not.toContain('24h')` on a prompt false-fails the moment legitimate
  same-token copy appears ("times (HH:MM, 24h)" clock format). Scope the
  guard to the window phrase (`/24h\s*[-–]\s*30d|between 24h and 30|de
  24h a 30/`), and carve out the legitimate usage in a comment.
- **Cross-app copy needs a sync test in the same PR.** The 3h window is
  advertised in web prompts, MCP tool descriptions, and the MCP README;
  a one-sided future edit (or bad conflict resolution) would silently
  teach agents the wrong rule while the server enforces the real one.
  Pin the literal on every surface with a file-parsing test in the
  docs-sync pattern; the same file covers both dash forms (`/3h[-–]30d/`).
- **EN/PT prompt parity test for agent-facing docs.** The in-app MCP
  install prompts exist in both locales; a loop over locales asserting
  the window line (and the step-5 line) contains the new value pins both
  at once — the PT line had silently kept the old 24h.
- **Verify a reviewer's flake claim empirically before/while applying.**
  The claimed ~30-min daily flake window for the sub-3h route test did
  not reproduce in a 3,500-instant sweep across midnight and the DST
  fall-back; the fake-timer pinning was still applied as cheap insurance,
  with the non-reproduction recorded. Stale/wrong findings cost nothing
  to double-check.
- **Grep comments for deleted route names.** Removing an endpoint leaves
  "used by POST /api/schedule" in header comments — docs must describe
  what the code does, so the comment now names the real consumers.
## Web/API review learnings, PR #44 (2026-10-02)
- **Delete the ENTIRE path, including the read side.** Removing a dead
  engine flow leaves the consumer side (UI branches, API select fields,
  client mappings, i18n keys, tests) as provably unreachable dead code.
  Remove it in the same PR — a half-deleted flow is what the cleanup set
  out to eliminate. Check: UI components, `lib/api.ts` mappings,
  route selects, i18n keys in every locale, and tests asserting the dead
  state.
- **Reword every stale comment citing removed machinery, not just the
  file you touched.** Sibling comments referencing a deleted path send
  future readers hunting for code that isn't there. Grep the concept
  name across the repo after any deletion.
- **A dead i18n key in one namespace hints at dead keys in others.**
  `home.oneOff` being dead led to `fillSchedule.oneOff*` (form fields
  from the removed flow) — verify zero usages before deleting, and keep
  keys that are still live (`home.waitingForSchedule` was reused by the
  next-slot display).

## Web/API review learnings, PR #44 round 2 (2026-10-02)
- **Runtime strings are part of the deleted path too.** Validator error
  copy naming a removed field reaches API clients verbatim in 400 bodies —
  reword it to the current concept, not just code comments. Tests that
  regex-match the copy (not the literal) survive the reword untouched.
- **A nullable field rendered unconditionally is a latent "null:00".**
  When the dead branch that guarded a nullable field is removed, the
  surviving consumer must define what NULL means (fallback UI here) and
  a test must pin it — the deleted test was the only pin on the null
  shape, so its replacement belongs in the same PR.

## Web/API review learnings, PR #44 round 3 (2026-10-02)
- **The production-norm fixture is the one that must be tested.** The
  unified endpoint stores `days_of_week: null` → `daysOfWeek: []`, so the
  empty-days render is what every real card hits — test fixtures must
  include the production shape, not just the tidy non-empty one.
- **Deleting the last branch that handled a null shape promotes the null
  to the default path.** When the dead branch goes, every nullable field
  it guarded needs the same fallback+test treatment as its siblings got —
  audit all consumers of the removed discriminator, not just the obvious
  one.

## Web/API review learnings, PR #44 round 4 (2026-10-02)
- **Test the combined production shape, not just each null in isolation.**
  The unified endpoint stores `days_of_week: null` AND no window together —
  fixtures must cover the combination, since that is what every real card
  renders.
- **`getByText` exact-match hides prefixed copies.** A `<span>▣ key</span>`
  never exact-matches `key` — scope fallback assertions by the cell's
  distinctive prefix (`/▣ key/`, `/◷ key/`) so the test pins the intended
  cell instead of accidentally passing on an unrelated element.

## PR #49 review learnings (2026-10-02)
- **Sync tests must pin the actual producer artifact, not just the code.**
  Pinning `categorize('engine_restart')` missed the real seam: the engine
  writes the CODE to the row but records the _ORPHAN_ERROR_MESSAGE
  *sentence* in `data.error`, and the web's video-status poll
  re-categorizes from the sentence on the refund backstop — downgrading
  the stored code to `unknown` (generic copy, not retryable). The sync
  test now parses the sentence constant from the engine source.
- **A backstop that re-derives state can downgrade it.** Prefer the stored
  code over re-categorizing raw text; when re-categorization is the
  design, teach the categorizer the producer's exact messages.
- **Never write a boolean flag false over an unknown current value.**
  The settle PATCH now only writes `tokens_refunded=true`; a failed refund
  leaves the flag untouched so a concurrent true (web poll path) can
  never flap back to false. Absence of a write is the safe default.
- **Name billing trade-offs at the decision site.** The twice-lost
  COMPLETE write → reconcile refunds an already-delivered video trade-off
  is documented in the reconcile docstring (rare, bounded, accepted over
  silently keeping the token) — not just in a review thread.
- **Bound every boot-time loop.** Unbounded orphan SELECT + serial
  per-row HTTP at boot stalls for minutes after a long outage: cap the
  batch (100, ordered), log progress every 25, drain leftovers on later
  boots. Idempotent ordering makes the drain safe.
- **Single-writer assumptions need an ops constraint in tracked docs.**
  The engine's boot reconcile assumes one process; rolling deploys would
  double-reconcile. config.toml is gitignored, so the constraint lives in
  config.example.toml (stop-then-start only, never rolling).

## PR #52 consolidation review learnings (2026-10-02, OpenCode on the merge)

- **Conflict resolution on user-facing copy needs semantic verification, not just marker removal.** Merging #44 (dead-code removal) into the consolidated branch silently reverted its own "Publish time" reword on two of three validator branches — the 3h parameterization from #46 was authored against the pre-reword copy and the merge kept that older text. Markers resolved cleanly while the meaning regressed. After resolving copy conflicts, diff the resolved strings against BOTH sides' intent (reword vs parameterization), not just the markers.
- **Pin copy rewords with negative-match tests.** A regex test matching `/at least 3 hours/i` cannot catch a field-name regression. Pair every user-facing reword with `expect(error).not.toMatch(/<removedName>/i)` so the next stacked merge can't silently resurrect a deleted field name in 400 bodies.
- **Name every non-transient case in failure-classification comments.** A doc comment saying "False for 404/unsafe-id (truly gone)" understated a contract that also returns false for 401/403 and auth misconfiguration. Future readers "fix" classifications they don't understand — document the full decision table where the type is defined, including which UI copy each side drives.

## PR #52 consolidation review learnings, round 2 (2026-10-02, OpenCode on 9f890b9)

- **Dedupe the guard everywhere the consolidation touches, not just the quoted file.** The shared `SAFE_TASK_ID` export existed in `lib/video-urls.ts` while four byte-identical copies survived in sibling routes + `lib/engine-tasks.ts` — the reviewer quoted only the pattern, so grep the whole surface for the literal regex, not just the cited path. Pin the dedup with a source-level sync test (file-parsing, like the cross-app copy sync tests) that fails if any consumer redefines the guard.
- **Never reuse an aria-label key as button copy.** The delete modal's destructive button rendered `t('personas.delete')` ("Delete persona", the card button's aria-label) during the deleting phase and `t('personas.deleteConfirm')` ("Delete") otherwise — the label visibly mutated mid-flight. One key per surface: the button always renders its own copy key.
- **Transient copy must not describe permanent states.** The schedule card's window cell rendered "Preparing the next publishing times" for NULL start/end hours, but unified batch schedules always store NULL hours (times live per video) — every batch card permanently promised something that never arrives. Give the permanent state its own key (`home.perVideoTimes`), mirroring the `home.customDays` treatment the days cell got; keep `waitingForSchedule` for genuinely transient states (next-slot cell).

## PR #52 CodeQL learning (2026-10-02)

- **Never build a RegExp from an interpolated string — not even in tests.** CodeQL's "incomplete string escaping" rule fires on `new RegExp(...${path}...)` and fails the code-scanning check, even when the interpolated values are hardcoded constants. Use static string checks (`includes`/`toContain`) instead of dynamic regex construction.

## PR #52 consolidation review learnings, round 5 (2026-10-02, OpenCode on 876d37d)

- **A refund flag is written only when the refund actually landed.** The video-status poll wrote `tokens_refunded: true` unconditionally after calling `refundTokens` — but `refundTokens` returns `false` on both an RPC error and a soft failure (RPC answered, `refunded !== true`). The `terminalRecorded` gate requires the flag for failures, so one failed refund got marked refunded forever and the "next poll retries" backstop could never fire: silently lost tokens. Now the route passes `tokensRefunded: refunded ? true : undefined` (the updater already omits the key on `undefined`, mirroring the engine's settle), and a failed refund logs loudly so the retry is auditable. Same billing-rule class the engine already pins ("False is a real failure") — a soft failure now leaves zero-trail no longer.
- **Sync tests pin every consumer the consolidation actually produced, not just the ones quoted.** The SAFE_TASK_ID sync test listed 4 consumers while three more (`video-download`, `delete-preview`, the persona route) had imported the shared guard during the same consolidation — a future merge could regress exactly the unpinned files. When a dedup test is added, grep the whole surface for the literal import and pin all of them.

## Engine review learnings, PR #51 (2026-10-02)
- **Scrub-then-truncate is a repo-wide rule, not a one-file fix.** PR #38
  established "scrub the full free-text field before truncating"; PR #51
  reintroduced `scrub_secret_values(str(x)[:200])` in two new call sites
  (task.py `_fail_task`, generate.py batch dispatch failure). When a
  reviewer flags a banned pattern, grep the whole repo for siblings — a
  third pre-existing instance lives in publish.py (`video_publish_failed`
  reason, out of this PR's scope, flagged for a follow-up PR).
- **Funnel entry = accepted, not attempted.** `video_generation_requested`
  fired before `task_manager.add_task`, so 429 queue-full rejections
  entered the funnel with no terminal event. Requested now fires after a
  successful enqueue; the rejection path is covered by a test asserting
  requested is never emitted and the row is rolled back.
- **Every lifecycle event carries the full segmentation context.**
  Batch `video_generation_failed`/`video_generated` were missing
  `user_id`/`pipeline`, silently dropping batch rows from PostHog
  breakdowns. Guard optional ids (`if user_id is not None`) — pre-task
  slot failures (deleted persona, empty topic) have no user yet — and
  document at the call site that they sit outside the requested->failed
  funnel by design.
- **A reviewer's suggested test assertion can be wrong — verify it.**
  OpenCode suggested asserting the redacted reason "contains [redacted]"
  for a secret past position 200; on the fixed code the redaction lands
  beyond the 200-char cut, so the assertion fails either way. Pin the
  order white-box (scrub called with the full string) plus the behavioral
  invariant (raw secret absent, length bounded).

## Engine review learnings, PR #51 round 2 (2026-10-02)
- **Comments must describe the mechanism that exists, not the one you
  wish existed.** The milestone-dedup comment claimed "after a restart
  the reconciler fails orphan tasks before any progress write" — no such
  path exists. State the real invariants (empty dict per process, uuid4
  direct ids never reused, uuid5 batch ids never re-dispatched, terminal
  transitions pop the entry).
- **Never overclaim ordering in comments/tests.** `add_task` starts the
  worker synchronously when capacity is available, so
  `video_generation_started` can be timestamped before
  `video_generation_requested`; the test only proved mock call order.
  Reword to the actual guarantee (PostHog orders funnel steps by
  timestamp) instead of asserting an ordering the runtime doesn't give.
- **Degraded contexts fail closed, not open.** `_complete_task` gated
  batch reporting on `flow != "batch"`, but a failed state read degrades
  to `flow="unknown"` — which passed the guard and double-counted batch
  completions. Invert to `flow == "direct"` so only a confirmed direct
  flow reports here; the reconciler owns batch reporting.
- **Pin security orderings at every call site, not just the first.**
  The white-box scrub-then-truncate pin existed only for `_fail_task`;
  the batch dispatch site used a 43-char message where `[:200]` is a
  no-op, so a truncate-first revert there passed CI. Every scrub site
  gets a >200-char secret-bearing test asserting the scrubber received
  the full string.

## Engine review learnings, PR #51 round 3 (2026-10-02)
- **Dedup terminal events by notice, not by state.** The publish stage
  pre-writes FAILED before raising, so `_fail_task`'s "already failed"
  branch skipped the funnel event entirely — publish failures had no
  terminal event. A bounded emission set (`_should_emit_failed_event`,
  mirroring `_should_send_failure_alert`) makes the FIRST notice always
  emit while later notices stay deduped; the milestone cache now pops on
  every notice, not just the first.
- **Funnel entry ordering must be deterministic, not probable.** Firing
  requested after `add_task` returns still races the synchronously
  started worker thread. `TaskManager.add_task` takes an `on_accepted`
  callback fired after acceptance but before thread start (never on
  429) — pinned at the manager level with a fake that records
  callback-vs-execute order.
- **Degraded identity props use the "unknown" sentinel, never a
  plausible-looking value.** `user_id="internal"` read as a real person
  in PostHog breakdowns; it now degrades to "unknown" like flow.
- **A deferred pre-existing instance stops being "out of scope" when
  the reviewer re-flags it in the same event family.** publish.py's
  truncate-then-scrub on `video_publish_failed` was left for a follow-up
  in round 1; round 3 correctly called it a live leak in the same
  family — fixed here with the same white-box pin.

## PR #51 round-4 review learnings (2026-10-02, OpenCode on bb7dadc)

- **Deterministic ids need emission dedup, not just comments.** Batch task ids are uuid5 per slot, so a crash between dispatch and `update_slot(generating)` re-dispatches the SAME id — the "never re-dispatched" comment was false and the re-dispatch double-fired `video_generation_requested`, inflating the funnel denominator. Fix: bounded check-and-record guard (`_should_emit_requested_event`, mirroring `_should_emit_failed_event`) + honest comment. Process-local guards bound within-process damage; cross-crash duplicates are rare and documented.
- **New process-local guards break tests that reuse ids.** Two existing tests both used `"task-1"` — the second silently stopped emitting after the guard landed. Clear the guard deque in `setUp`, same as the failed-event guard pattern.
- **Degraded identity props must ALL use the "unknown" sentinel.** `user_id`/`flow` were converted in round 3 but `pipeline` kept the plausible `"video"` default — a failed state read on a `stop_at="subtitle"` task would silently re-segment into the video funnel. Extend the sentinel test to assert every prop.
- **Warm expensive lazy imports out from under locks.** The `on_accepted` funnel callback runs under the task-manager lock and the first `track_event` paid the `posthog` import + client construction there. `analytics.warm_client()` at controller startup moves the one-time cost out of the lock hold.

## PR #54 review learnings (2026-10-02, OpenCode on 67456d2)

- **Fix the trap on every surface that teaches it, not just the reported one.** Pinning `@latest` in `apps/mcp/README.md` while the root READMEs (EN + PT, the primary copy-paste snippets) still taught the bare `npx` command made the docs self-contradictory. When a fix addresses a user-facing trap, grep every advertised surface for the old pattern before calling it done.
- **Cross-app copy needs a sync test in the same PR — including install commands.** The 3h-window precedent (`docs-sync.test.ts`) now covers the npx command too: a file-parsing block asserts `post-engineer-mcp@latest` on all four surfaces (mcp README, web install prompt, both root READMEs), so a one-sided future edit can't silently reintroduce the stale-cache trap.
- **EN/PT parity tests must cover every pinned line, not just the headline one.** The parity test pinned the 3h window in both locales but not the `@latest` command line — extended it to find the `"command":` line per locale and assert the pin.
- **Every PR bumps VERSION — CI enforces it, not memory.** The `version-check` workflow fails any PR whose diff doesn't touch `VERSION`; a docs-only PR still needs `scripts/bump-version.sh patch`. (This PR initially shipped without the bump and had to add it after the failure.)
- **Two agents, one branch: a rebase can silently drop your commit.** The parent rebased the branch onto an earlier commit while this babysit had a version-bump commit pushed; the bump vanished from the branch and `version-check` failed again. Re-verify `git log origin/<branch>` after any concurrent work before assuming your commits are still there.

## Web review learnings, PR #55 (2026-10-02, production 500)

- **An insert key must exist in the table.** `POST /api/videos/generate-and-schedule` inserted `kind: 'batch'` into `schedules`, but the column never landed in `supabase/schema.sql` — PostgREST rejects the whole insert on an unknown key, so EVERY call 500d from the v1.12.0 merge until the fix. The route test even pinned `kind: 'batch'` as correct. Lesson: when a PR introduces a new insert, cross-check every key against the canonical schema file; a test asserting the insert shape should assert the ABSENCE of phantom keys, not just the presence of expected ones.
- **Stale comments outlive the schema they describe.** The `kind='batch'` line carried a comment about a `'recurring'` default and partial unique index — neither exists anymore. A comment that justifies a line by referencing dead schema is a smell: verify the schema objects it names still exist.

## Web review learnings, PR #55 follow-up (2026-10-02, OpenCode on 2613c4f)

- **Generalize the phantom-key pin into a schema sync test.** The PR pinned the absence of `kind`, but the supabase-js mock records any payload key — the next speculative key would sail through tests and 500 every production call again. New sync test parses the `create table public.schedules` column list from `supabase/schema.sql` and asserts every key of the route's insert payload is a real column (mutation-verified: re-adding `kind: 'batch'` fails it). Pattern mirrors the existing SQL-literal sync tests.

## Web review learnings, PR #55 round 2 (2026-10-02, OpenCode on 09c2c5d)

- **A DDL column parser must exclude constraint keywords.** The schema sync test took the first token of every non-comment line — a future table-level constraint (`unique (user_id, persona_id),`) would enter the column set, letting a phantom key named like a SQL keyword false-pass. Filter `primary/unique/foreign/check/constraint/exclude` and assert a sentinel stable column (`scheduled_at`) so a degraded parse can't pass vacuously.
- **Version-base drift note:** a reviewer flagged the PR "bumps 1.13.1 → 1.13.2 while main reads 1.13.3" — stale read; the merge had already re-bumped to 1.13.3 and `bump-version.sh check` confirmed all 5 locations in sync. Always verify the actual tree before acting on a version claim.

## Web review learnings, PR #57 (2026-10-02, OpenCode on c66748a)

- **Replacing brand assets means replacing EVERY icon surface.** The PR added `app/icon.png` but left the old `app/favicon.ico` — browsers default-request `/favicon.ico` first and its `sizes="any"` wins, so tabs kept the old mark. Lesson: when swapping brand assets, audit `favicon.ico`, `icon.png`, `apple-icon.png` together; a stale `.ico` silently defeats the new PNGs.
- **`app/icon.png` and `apple-icon.png` are served RAW by Next's metadata convention** — no `next/image` optimization. A 1 MB source means a 1 MB tab-icon download on every page. Lesson: keep metadata icons small at the source (icon ≤512, apple-icon 180x180 per Apple spec); never commit byte-identical duplicates of the same image.
- **Conflicting Tailwind utilities resolve by stylesheet order, not attribute order.** Hardcoding `rounded-2xl` in the base class string let it win over every caller's `rounded-lg`/`rounded-xl`. Lesson: overridable base classes go through `twMerge` (already a dependency); pin the override with a test.
- **`next/image` `priority` emits `<link rel="preload">` — reserve it for LCP.** Unconditional `priority` on small brand marks preloads them on every page including below-the-fold instances. Lesson: no `priority` unless the image is genuinely the LCP candidate; the mock swallows unknown DOM attrs, so pin its absence at the prop level via a capturing `vi.mock`.
- **`feat:` commits need a MINOR bump (1.13.x → 1.14.0), not patch.** `version-check` CI only enforces sync, not the level — the author owns the semver kind per the repo rule.

## Web review learnings, PR #57 round 2 (2026-10-02, OpenCode on 25d922f)

- **No CRITICAL/MAJOR on the follow-up head.** The round-1 fixes held up; the reviewer even verified the new favicon.ico pixels match the new logo.
- **A stale version-level flag is still worth checking, not applying.** The reviewer re-flagged "feat bumped as patch 1.13.4 → 1.13.5" against a head already at 1.14.0 — verify the tree before acting on version claims (same lesson as PR #55 round 2).
- **Dedupe identical binary assets instead of shipping twins.** `app/icon.png` was a byte-identical copy of `public/logo.png` — set `icons: { icon: '/logo.png' }` in the root layout metadata and delete the duplicate, so the next rebrand can't drift the two apart.
- **Pin logo usages per surface.** The login/landing suites didn't assert the new brand mark — one `getAllByTestId('app-logo')` assertion per surface (mutation-verified: reverting one usage fails the pin), mirroring the existing layout-suite pattern.

## Web review learnings, PR #58 (2026-10-02, OpenCode on 109a2ec)

- **Config `icons` and file-convention icons do NOT merge in Next.js 15.** Once any `icons` object exists in metadata, `resolve-metadata.ts` skips the file-convention icons entirely (`if (!resolvedMetadata.icons)` — favicon.ico survives via a separate special case). Declaring only `icon:` silently dropped the `apple-touch-icon` link. Lesson: declare EVERY icon role in config when using it; verify framework merge semantics in `node_modules/next/dist` before assuming additive behavior.
- **Give the tab-icon role its own small asset.** A 222 KB `logo.png` as the raw tab icon wastes bandwidth on a 16–32 px slot — export a 128 px variant for the `icon` role and keep the full logo for in-page display.

## Web review learnings, PR #58 round 2 (2026-10-02, OpenCode on 203f253)

- **No CRITICAL/MAJOR on the follow-up head.** Round-3 fixes verified in the tree.
- **Pin config-declared metadata in tests.** `metadata.icons` is the exact line whose omission once silently dropped the apple-touch-icon — a future rebrand can drop a role again with zero CI signal. `metadata` is a plain static export, so `app/__tests__/layout.test.tsx` pins it directly plus an existence check that each href resolves under `public/` (both mutation-verified).

## PR #58 round-6 review learnings (2026-10-02, CI web failure)
- **JWT tamper tests must flip a fully-significant base64url char.** `token.slice(0, -2) + "aa"` is a byte-level no-op ~1/256 of the time: an ES256 signature is 64 bytes = 86 base64url chars, and the last char carries only 2 data bits (low 4 are padding, ignored by decoders). When the 85th char is already `a` and the 86th's 2 significant bits match, the "tampered" token verifies fine — flaky CI failure. Fix: flip the FIRST signature char (fully significant). Proven with a 300-iteration loop asserting the signature bytes always change and verification always rejects.

## Web review learnings, PR #59 (2026-10-03, OpenCode on 4df1880)

- **Link cards by the lookup key, not the row PK.** Generation cards linked `/posts/${generation.id}` (DB row PK) while the detail endpoint filters `.eq('generation_id', ...)` — every manual generation 404'd. Lesson: the card href must use the same identifier the detail lookup resolves by; pin with DISTINCT id/generationId fixtures.
- **OAuth callers need the service client too.** `auth.isApiKey === true ? serviceClient : serverClient` excludes OAuth (MCP) callers — no cookie session → RLS returns zero rows → 404 on owned data. Lesson: branch `isApiKey === true || isOAuth === true` (matches sibling routes); add OAuth-path tests.
- **Distinguish DB-down from not-found at every .single().** `loadOwnedSlot` collapsed every error into 404 — a Supabase outage looked like "not found". Lesson: PGRST116 → 404, else logged 500 (mirrors the GET handler pattern in the same file).
- **Invalidate the detail query on mutation success.** `useUpdateSlotMutation` invalidated only the list key while the detail page reads `['schedule-slot', slotId]` (30s staleTime) — topic save showed stale values. Lesson: invalidate every query key the mutation's data feeds.
- **Cap engine fan-out on list endpoints.** `Promise.all(slots.map(enrichSlot))` with limit up to 500 = unbounded engine calls. Lesson: cap at 25 (ENGINE_LOOKUP_CAP) and degrade past the cap to progress 0.
- **Rate-limit expensive GETs.** New GET surfaces (slot detail, video download) need `applyRateLimit` like the POSTs — a GET that fans out to the engine is not free.
- **Check response.ok before response.json().** Vercel 502 HTML pages threw parse noise ("Unexpected token '<'") instead of the clean error. Lesson: guard the parse with a helper that returns null on non-JSON.
- **Delete dead i18n keys.** `posts.close`, `posts.coverPending`, `posts.coverGenerating` had zero usages — dead keys are a smell.
- **Include new providers end-to-end.** Bluesky account IDs were in the schema and the type but not in the slot detail API select/response or `resolveSlotAccounts` — Bluesky targets were silently dropped. Lesson: when adding a provider, grep every select, response shape, and account-resolution site.
- **Atomic guards for check-then-act.** DELETE's last-slot check was SELECT-then-DELETE — concurrent deletes could both pass. Lesson: `delete_slot_if_not_last(p_slot_id, p_user_id)` RPC locks the row and does check+delete in one transaction (same class as the primary-swap RPC).
- **Re-check status in the UPDATE predicate.** PATCH verified pending then UPDATE'd without the guard — a dispatch in between silently rewrote the topic. Lesson: `.eq('status', 'pending')` on the UPDATE; zero rows (PGRST116) → 409.
- **Validate enums at the narrowing boundary.** `narrowPublishLinks` cast any string to the provider union — unknown providers rendered as literal "undefined". Lesson: `isPublishProvider` guard drops unknowns like malformed entries.
- **Never render raw server English in localized UI.** The detail page passed `Error.message` straight to the UI — pt-BR users saw English. Lesson: map to i18n keys (`posts.detailLoadError`) with the English original staying in server logs.
- **Guard spreads against missing fields.** Adding `blueskyAccountIds` to the spread crashed on fixtures (and any API lagging the type) — `...(arr ?? [])` is defense in depth.
## Engine review learnings, PR #53 round-13 (2026-10-02, OpenCode on 31a39fb)

- **One redaction helper for every surface that sees the same secret.** `safe_reason` (Discord alerts, logs, client-visible task errors) had only a raw-substring webhook check while `_post` redacted four transport variants — the requoted/path-fragment forms this PR proved exist slipped into the key-anchored scrubber, which cannot match path-embedded tokens. Extracted `redact_known_url(message, url)` into `notify.py` and used it in both places.
- **Replace longest variants first.** The variant set contains both `/hooks/path` and `/hooks/path?sig=...` — replacing the path first splits the request target before it can match. `sorted(variants, key=len, reverse=True)`.
- **urllib3 embeds the request target, not just the path.** Connection-phase errors carry `/path?query=...`; the path-only variant left a query-string credential exposed. The helper adds the `path + ("?" + query)` variant and its requote.
- **A passing test can pass for the wrong reason.** My first query-string probe used `?token=secret-token` — the key-anchored scrubber matched `token=` and the test passed without the variant redaction. Probe values must dodge every other defense layer (`?sig=abc123xyz`) so the test pins the intended code path.

## Engine review learnings, PR #53 round-14 (2026-10-02, OpenCode on 1f60132)

- **Redaction variant sets need a length floor.** `redact_known_url` replaced `parsed.path` with no minimum length — a misconfigured webhook URL with a trivial path (`/`) rewrote every slash in `_post` log lines and collapsed every `safe_reason` to the bare type name (the `!= message` trigger fired on any message). Skip variants shorter than 8 chars; the full URL (always long) still redacts.
- **Probe the degenerate config, not just the happy path.** The first degenerate-path test passed trivially because its message had no slashes — the assertion was vacuous. A redaction test must include content the buggy code would actually mangle (`/var/log/app.log`).
- **Retitle the PR when a rebase changes the version.** The title said "(1.13.2)" from the original base while the rebased branch bumps 1.14.0 → 1.14.1 — cosmetic, but the title is the first thing a reviewer reads.
## Engine review learnings, PR #51 follow-up (2026-10-02, OpenCode on merged main)

Five MINORs on the merged funnel, fixed as a follow-up PR with one focused TDD commit each:

- **Every `video_generation_failed` producer must go through the task-id dedup guard.** The batch dispatch-failure path called `track_event` directly while `_fail_task` and `track_generation_requested` both deduped — a crash re-dispatch double-counted the failure numerator while requested stayed suppressed. Gate on `_should_emit_failed_event` (pre-task `task_id=None` failures still always emit: they have no requested event by design).
- **Scrub-then-truncate applies to STORED error text, not just telemetry.** Both failed-slot write sites (`generate.py`, `reconcile.py`) stored raw `str(exc)` while the same exception was scrubbed for PostHog — but the slot error column is client-visible via `/api/schedule/status`. A secret-bearing-message pin now guards both the stored error and the reason; an existing scrub test had to move from `assert_called_once_with` to a `call in call_args_list` membership check when a second scrub call site landed.
- **dict.get's default does not fire on explicit None.** `_task_tracking_context` used `task.get("user_id", "unknown")` — a row storing `None` slips a null prop into PostHog. Use `task.get("user_id") or "unknown"` for all three identity props; the sentinel test asserts every prop against explicit-None rows.
- **A one-line wiring fix needs a route-level pin.** The `_mark("publish")` insertion (which makes the generic handler pass `stage="publish"` to `_fail_task`) was covered only by tests calling `_fail_task` directly — a revert stayed green. Pin it by driving `start()` with the publish step raising and asserting the emitted event's stage; verified the pin fails with the line removed.
- **Import-time side effects belong in the server startup hook.** `video.py` warmed the PostHog client at import, so test collection and CLI entry points also constructed a real client. It now runs in asgi's `startup_event` (same pattern as the scheduler); pin both the `warm_client`-calls-`_get_client` unit and the startup wiring.
- **Never `git stash`/`pop` casually in a shared repo.** Pre-existing stashes from other agents' worktrees sit in the stash list; a bare `pop` grabbed one from another branch and conflicted the tree. Verify with `git stash list` first, and prefer explicit worktree/branch operations.
- **[SUPERSEDED — see guard-separation bullets below.]** ~~Release a dedup-guard entry when the retried operation succeeds.~~ The failed-event guard recorded a transiently failed dispatch id forever, so fail -> succeed -> fail suppressed the genuine pipeline failure's terminal event (the mirror image of the double-count the guard was built for). `discard_failed_event(task_id)` ran right after `_dispatch_generation` returned — not after the slot-marking write, so a fast-failing task couldn't beat the eviction during the DB round-trip. Pinned with a three-step test (dispatch fails -> re-dispatch succeeds -> genuine failure emits). **Superseded:** the `discard_failed_event` mechanism was deleted entirely; the three separate dispatch/pipeline/requested guards below replace it — do NOT resurrect it.
- **A white-box scrub-order pin needs a probe LONGER than the truncation cap.** The stored-error site truncates at 500; with a 321-char probe `[:500]` is a no-op and a truncate-first revert stays green. The behavioral check can't save you either: the key-anchored pattern matches partial values, so a secret straddling the boundary still gets redacted under truncate-first — only "the scrubber received the whole message" (all-calls `call(str(error))` check) detects the revert. Mutation-verify both sites.
- **Fix the shared summarizer, not each call site.** `safe_reason` fed Discord, log lines, AND client-visible task errors (via `_fail_task`) with an unscrubbed `message[:200]` — scrubbing centrally in `safe_reason` fixed every sink at once. When a helper's output fans out to multiple sinks, harden the helper.
- **Error dicts persisted to task state are client-visible.** `upload_post`'s `{"success": False, "error": str(e)}` lands in `cross_post_results`, persisted via `_complete_task` kwargs into the task row the web status poll reads — same leak class as the slot error column, same scrub treatment.
- **Name the residual race window at the decision site.** The discard-after-dispatch placement has a one-deque-remove window (worker fails before the evict line); evicting before dispatch would break the repeat-failure dedup instead. Document the accepted trade-off in the comment per the name-the-trade-off rule.
- **Verify a reviewer's suggested probe empirically before trusting it.** The suggested "secret value crossing the boundary" probe does NOT detect a truncate-first revert behaviorally — the key-anchored pattern matches partial values, so the cut fragment still gets redacted. Only the white-box "scrubber saw the whole message" check catches it; I confirmed this by reasoning through the regex, not by assuming the suggestion worked.
- **Verify the sink destination before acting on a "raw log leaks" claim.** A review flagged raw `str(e)` in ERROR log lines as leaking "to Bugsink" — but the asgi ERROR+ sink is PostHog's and scrubs (`_scrub_and_truncate`); the "Bugsink bridge" comments are stale from the pre-PostHog era. I applied the scrub anyway as cheap consistency hardening, but the learning stands: check what the sink actually does and where it sends before treating the claim as a leak.
- **Apply the None-sentinel pattern to every sibling in the diff.** This PR fixed explicit-None with `or` for the identity props but shipped `str(task.get("error", ""))` in the same diff — a None error persisted the literal "None" to the client-visible column. When you fix a None-handling pattern, grep the diff for every `.get(` with a default.
- **Comments describing guard invariants must name every eviction path.** The dedup comment said "ids are never reused" while `discard_failed_event` re-arms them mid-process — a future reader could "simplify" the discard away based on the stale sentence. Reworded to cover both deque aging and explicit release.
- **Two incident classes sharing one dedup guard can't be fixed with a release.** The batch dispatch-failure path and `_fail_task` emitted the same event for different incidents; the discard-after-success release re-armed ids recorded by the task's own pipeline failure, so a later failure notice double-counted (and the release raced a fast-failing worker). Gave the dispatch path its own bounded guard instead — neither path can now suppress or re-arm the other's terminal event, with no race windows to document.
- **Trace a reviewer's race-window claim mechanically before choosing the fix.** I hand-traced window (b): first-attempt dispatch succeeds → worker's `_fail_task` emits and records → the discard wipes the entry → a second failure notice re-emits. The trace confirmed the hole was real and that selective-release would still leave window (a); only guard separation closed both.
- **Probe filler needs a separator after the secret.** The scrub value pattern is greedy over non-whitespace (`[^\s,;\"']+`), so `" api_key=X" + "F"*200` reads as one 212-char secret and the scrubbed probe shrinks below the cap — the length pin silently stops pinning. Put a space between the secret and the filler (`" api_key=X " + "F"*200`).
- **A cap pin needs an over-cap probe — even when you wrote the rule yourself.** I shipped `[:500]` tests with ~40-char probes two rounds after establishing the "probe longer than the cap" rule for the 500-char slot-error sites. Apply your own rules to your own new code; the reviewer will check.
- **Name the denominator trade-off when two guards emit for one id.** Separated dispatch/pipeline guards mean one slot id can emit two `video_generation_failed` while `video_generation_requested` stays deduped — failure % can briefly exceed 100%. Document it at the guard so nobody "fixes" the dashboard anomaly in the wrong direction.
- **Grep the concept across the repo when declaring comments stale — in one pass.** The "Bugsink bridge" reword took three rounds (generate.py, then scheduler.py + test, then task.py + task_webhook.py) because each fix only covered the files already touched. When a comment is declared stale, `grep -rn` the phrase repo-wide immediately.
- **Replacing a mechanism stale-dates test comments too.** The guard separation left test comments describing "the same bounded guard _fail_task uses" and "the guard entry is released" — a future reader could "simplify" the separation based on them. Reword test comments with the same care as production comments.
- **Deferred with the reviewer's blessing, tracked:** a store blip between successful dispatch and `update_slot(generating)` misclassifies as a dispatch failure (task is live, slot marked failed). Pre-existing, rare, reviewer-marked non-blocking follow-up — left for a later PR.

## Web review learnings, PR #55 (2026-10-02, production 500)

- **An insert key must exist in the table.** `POST /api/videos/generate-and-schedule` inserted `kind: 'batch'` into `schedules`, but the column never landed in `supabase/schema.sql` — PostgREST rejects the whole insert on an unknown key, so EVERY call 500d from the v1.12.0 merge until the fix. The route test even pinned `kind: 'batch'` as correct. Lesson: when a PR introduces a new insert, cross-check every key against the canonical schema file; a test asserting the insert shape should assert the ABSENCE of phantom keys, not just the presence of expected ones.
- **Stale comments outlive the schema they describe.** The `kind='batch'` line carried a comment about a `'recurring'` default and partial unique index — neither exists anymore. A comment that justifies a line by referencing dead schema is a smell: verify the schema objects it names still exist.

## Web review learnings, PR #55 follow-up (2026-10-02, OpenCode on 2613c4f)

- **Generalize the phantom-key pin into a schema sync test.** The PR pinned the absence of `kind`, but the supabase-js mock records any payload key — the next speculative key would sail through tests and 500 every production call again. New sync test parses the `create table public.schedules` column list from `supabase/schema.sql` and asserts every key of the route's insert payload is a real column (mutation-verified: re-adding `kind: 'batch'` fails it). Pattern mirrors the existing SQL-literal sync tests.

## Web review learnings, PR #55 round 2 (2026-10-02, OpenCode on 09c2c5d)

- **A DDL column parser must exclude constraint keywords.** The schema sync test took the first token of every non-comment line — a future table-level constraint (`unique (user_id, persona_id),`) would enter the column set, letting a phantom key named like a SQL keyword false-pass. Filter `primary/unique/foreign/check/constraint/exclude` and assert a sentinel stable column (`scheduled_at`) so a degraded parse can't pass vacuously.
- **Version-base drift note:** a reviewer flagged the PR "bumps 1.13.1 → 1.13.2 while main reads 1.13.3" — stale read; the merge had already re-bumped to 1.13.3 and `bump-version.sh check` confirmed all 5 locations in sync. Always verify the actual tree before acting on a version claim.
- **Verify the reviewer's suggested fix actually fixes the finding.** The reviewer suggested `scrub_secret_values(str(exc))[:500]` for the webhook log — but the finding itself proved the key-anchored scrubber can't match path-embedded tokens, so the suggestion was a no-op for the actual leak. Mutation check confirmed: the test fails with the suggested fix, passes only with the known-URL redaction. When the finding invalidates the tool, the fix can't rely on that tool.
- **Redact the known credential, don't pattern-match it.** When the code holds the exact secret (a webhook URL), `str.replace(secret, "[redacted]")` beats any regex — no anchor to dodge, no greedy-value surprises. Reserve the pattern scrubber for unknown free text.
- **A mock that passes vacuously is worse than no test.** My first webhook log test asserted on `mock_logger.error` while the code calls `logger.bind(...).error` — the child mock got the call, the assertion saw nothing, and the test passed on unfixed code. Always assert the mock actually received calls (`assertTrue(call_args_list)`) before asserting on their content.
- **Don't "fix" config the user hasn't decided to kill.** When `.env.example` documented `BUGSINK_DSN` with no code reader, the entry stayed because the user hadn't decided Bugsink's fate (ingestion paused, not removed) — distinguishing dead code comments (safe to reword) from live config surface (leave for the user's call). Decided 2026-10-03: Bugsink retired (PostHog-only), entry removed; the lesson stands, the example is closed.
- **Patch the telemetry entry path in every test that drives dispatch.** Three batch tests drove `_generate_slot` without patching `track_generation_requested` — on any machine with `POSTHOG_API_KEY` set they'd capture real `video_generation_requested` events into production PostHog. When a helper under test fires telemetry, every test that reaches it must stub the entry point, not just the assertions' target.
- **Mutation checks are for MY verification, not the tree.** I ran a botched `sed` chain during a mutation check and it flipped six unrelated `return False` → `return True` in task.py plus left a marker line — caught only by inspecting the diff before committing. Rule: never use `sed -i` with a broad pattern for mutations; use python with exact-string anchors + immediate restore, and always `git diff` the production files before committing. (Damage was fully reverted; task.py has zero diff vs HEAD.)
- **`str.replace("", x)` interleaves `x` between every character.** Guard emptiness before redacting with a known secret: `if webhook_url: message.replace(...)`.
- **Redact every serialization the transport can produce, not just the configured string.** requests requotes webhook URLs when preparing them (`response.url`), so `str(exc)` can carry the percent-encoded form — redact `quote(url, safe=":/?&=%")` too (verified against PreparedRequest that it reproduces the requoted form exactly). Any known-credential redaction must cover the transport's normalization, not just the config value.
- **One redaction shape per failure family.** requests serializes the URL differently per error family: HTTP errors embed the full absolute URL, connection-phase errors (DNS/refused/TLS/timeout) embed only the requoted path fragment. A credential redaction must cover every family the handler can see — pin each with a behavioral test, because the uncovered family stays green in CI. Derive encoded variants from the transport's own requote (`requests.utils.requote_uri`), not a hand-enumerated safe-set that can diverge.

## Faceless persona 500 — root cause (2026-10-03)
- **The canonical `supabase/schema.sql` dropped a column DEFAULT during consolidation.** PR #52 copied `recent_image_ids uuid[] not null` from the `persona-images.sql` migration but lost its `default '{}'`. The web persona-creation insert never provided the column, so PostgreSQL rejected EVERY persona insert with a 23502 NOT NULL violation (500). Production had zero personas.
- **Fix both sides:** include `recent_image_ids: []` in the insert (works regardless of DB default) AND restore `default '{}'` in schema.sql so fresh installs match the migration chain.
- **Test pattern:** assert the insert payload contains every NOT NULL-without-default column — a focused regression test beats a generic schema-sync test for a single known column.

## Faceless persona 500 — OpenCode MINOR round (2026-10-03, review on e508785)
- **Comments describing schema state must stay in sync with the schema the same PR fixes.** The `recent_image_ids` line carried a comment saying "no DB default in the canonical schema" — while this PR restored `default '{}'` to that schema. Reworded to describe the actual mechanism: the insert supplies the column explicitly so creation works regardless of the DB default.
- **Restoring a dropped column DEFAULT in schema.sql only covers fresh installs.** `create table if not exists` never alters an existing table, and re-running the old migration is a no-op (`add column if not exists` on an existing column never re-attaches the default) — so deployed DBs (including production) keep the missing default forever. Ship the one-line idempotent `alter table ... alter column ... set default` as a manual-apply SQL file (repo convention: the user applies SQL in the dashboard) so deployed DBs converge with the migration chain.
- **Generalize the single-column pin into a two-direction schema-sync test.** The focused `recent_image_ids` regression test stayed, but a sibling test now parses the `public.personas` column list from schema.sql and asserts both directions: every insert key is a real column (phantom-key failure, cf. PR #55's `kind: 'batch'`) AND every NOT NULL-without-DEFAULT column is supplied (missing-column failure, cf. this PR's 500). ~25 lines, mirrors the existing schedules pattern, mutation-verified on the pre-fix tree. Caveat learned in TDD: the parse pins schema.sql, not production — DBs whose schema drifted from the file are invisible to it; the explicit insert column is what protects production.

## Faceless persona 500 — OpenCode round 2 (2026-10-03, review on 4fd370b)
- **Test names are subject to the same staleness rule as comments.** The regression test kept "(NOT NULL column without DB default)" in its name after the comment and schema were fixed — a reader trusts the name first. Grep test names too when declaring a mechanism stale (found only the one occurrence).
- **Schema-sync assertion failures must name the offending key.** `expect(columns.has(key)).toBe(true)` reports only `false` on a phantom key — the test's stated purpose is "the next column addition fails CI instead of production", so the failure must be self-identifying: vitest accepts a message as the second `expect` arg (mutation-verified: fails with `insert key "bogus_mutation_probe" is not a public.personas column`).

## Faceless persona 500 — OpenCode round 3 (2026-10-03, review on 2ed027d)
- **Pin the restored DEFAULT, not just the payload column.** The restored `default '{}'` in schema.sql was the point of the fix, yet nothing asserted it — dropping the default left every test green. Added sentinel `expect(columns.get('recent_image_ids')).toBe(false)`: dropping the default from schema.sql must fail CI (mutation-verified), so an accidental re-drop can't slip through.
- **Document the parser's one-column-per-line assumption.** The line-based DDL parser would misparse a wrapped column definition (fail-closed, spurious red, never a production escape). A one-line comment on the assumption stops a future reader from either "fixing" the schema format or mistrusting the test on the first false red.

## Faceless persona 500 — OpenCode round 4 (2026-10-03, review on 8fd0911)
- **Match whole words on comment-stripped DDL, not bare substrings.** `/default/i` on the whole line would silently drop a genuinely required column named `default_topic` (or a trailing comment mentioning "default") — exactly the production-500 class the sync test exists to catch. Strip trailing `--` comments and use `\bnot null\b` / `\bdefault\b` (mutation-verified with both trap lines).
- **Column-level PRIMARY KEY is implicitly NOT NULL.** A future `foo uuid primary key` without explicit `not null` and no default would parse as not-required while PostgREST rejects any insert omitting it. Count `/\bprimary key\b/i` as satisfying the not-null check (constraint-keyword filter only covers table-level constraints).

## Faceless persona 500 — OpenCode round 5 (2026-10-03, review on 370e971)
- **Pin parallel SQL literals by value, not just existence.** The restored `'{}'` default now lives in three SQL files (schema.sql, persona-images.sql, fix-recent-image-ids-default.sql); the existence sentinel couldn't see a value drift in the other two. Added a test asserting each file's exact literal via static `includes` — no dynamic RegExp (CodeQL rule). Mutation-verified: drifting the literal in persona-images.sql fails only the new test while the other 60 stay green.

## SSRF fix, PR #64 (2026-10-03, CodeQL #17 Critical)

- **SSRF guard shape for server-side fetches of attacker-controlled URLs:** DNS-resolve the host (`node:dns/promises` `lookup` with `{all:true}`), refuse when ANY resolved address is non-public (loopback/private/link-local incl. 169.254.169.254/CGNAT/multicast/reserved + IPv4-mapped IPv6), fail closed on DNS errors, and fetch with `redirect: 'error'` so a 3xx to an internal URL is never followed. Keep existing https-only + timeout guards. Name the DNS-rebinding residual in a comment at the check site.
- **Make the DNS lookup injectable for tests:** `fetchCimdDocument(clientId, fetchImpl = fetch, lookupImpl = defaultLookup)` — unit tests inject a fake lookup, no network in tests.
- **Decline reviewer suggestions that make failure modes worse.** OpenCode suggested `ipv4ToInt` throw instead of returning null — but the `addresses.some(...)` call site has no try/catch, so a throw would propagate uncaught to the authorize route (500). Null degrades safely (falls through to the IPv6 prefix checks, then allow). Verify where an exception would land before accepting a "throw instead of null" suggestion.
- **Worktree without node_modules:** a fresh `git worktree add` has no node_modules; symlink `apps/web/node_modules` from the main checkout to run vitest/tsc/eslint, and DELETE the symlink before committing (it would otherwise be staged as a symlink).
