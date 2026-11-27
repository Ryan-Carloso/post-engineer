## What changed

-

## Why

Link the issue(s): closes #

## How it was tested

- [ ] `pnpm test` green (web + MCP)
- [ ] `pnpm lint` green
- [ ] `pnpm typecheck` green
- [ ] New/updated tests cover the change (TDD)

## Verification evidence

The author does not grade their own change. The `verification` workflow posts mechanical evidence (deleted, skipped, or weakened tests, plus the diff-scoped commands). A separate reviewer grades `.github/REVIEW_RUBRIC.md` from the **base** branch.

Stamp (pick one): `repro` / `property` / `differential` / `e2e` / `delegated-ci` / `none`

- [ ] Command(s) and output are pasted below, or the workflow evidence comment is for this commit
- [ ] No test was deleted, skipped, weakened, or narrowed to make CI pass
- [ ] Rubric area ids this diff triggers, each with pass / fail / not-applicable
- [ ] `none` is explicit when the diff has no runtime behavior

```
command:
output:
rubric:
```

## UI changes

Delete this section if this PR does not change anything the user sees. Copy changes count as UI changes.

Before:

<!-- Screenshot of the screen before this change -->

After:

<!-- Screenshot of the screen after this change -->

Same screen, same locale, same viewport in both shots. Add mobile screenshots when the layout changes, and both locales when copy changes.

## Before / after (Excalidraw)

Required on every PR, including non-UI ones. This is the explanation diagram, not a UI screenshot: left = the problem before this change, right = the solution after it.

<!-- Excalidraw-style diagram: white background, sketchy stroke, in English, with colors. Upload it as a GitHub attachment (`gh pr edit <n> --attach <png>`, gh ≥ 2.99), never as a file in the repo or on `ui-diff-assets`. -->

![Before / after](<!-- paste the GitHub attachment URL here -->)

## Checklist

- [ ] No secrets, tokens, or credentials in the diff
- [ ] Comments are in English
- [ ] Docs updated if behavior changed (`README.md`, app READMEs, or `docs/`)
- [ ] Not a direct push to `main`
- [ ] UI change includes before/after screenshots in this PR body (or N/A — no UI change)
- [ ] PR body includes an Excalidraw before/after diagram (English, colors) explaining the change
