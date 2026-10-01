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
  updates `VERSION`, `apps/mcp/package.json`, `apps/web/package.json` and
  `apps/engine/pyproject.toml` in one go. CI (`version-check` workflow)
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
