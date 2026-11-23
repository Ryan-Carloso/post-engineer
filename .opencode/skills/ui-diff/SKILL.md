---
name: ui-diff
description: Before/after screenshots, highlighted pixel diffs and a short UX summary for pull requests that change UI, with the images in the PR body (UI changes section) and one sticky PR comment whose images stay private in the same repository. Use when someone wants reviewers to see a frontend change ("add before/after screenshots to the PR", "what does this PR look like", "visual diff", "UI review", "did this CSS change break anything"), or wants to compare design variants (?hero=1..4), record hover/transition clips, audit design-token usage, check accessibility regressions on changed screens, or capture auth-protected preview deployments.
---

# ui-diff

Renders the affected routes of a web app at the PR's **base** and **head**, diffs the
screenshots, and puts the `before | after | diff` images in the PR body (`UI changes`
section), plus one sticky PR comment with the same images and a UX summary. The body is
the deliverable; the comment never replaces it.
The mechanics are scripted; your job is the judgment: which routes matter, what the changes
mean for users, and whether it is OK to post.

`$SKILL` is the directory containing this file. Run the CLI as:

```bash
node "$SKILL/bin/ui-diff.mjs" <command> [options]
```

The first run installs dependencies and builds (about a minute); the first capture downloads
Playwright's Chromium. Every command prints JSON on stdout and progress on stderr. Output goes
to `.ui-diff/` at the repo root, which is added to `.git/info/exclude` automatically.

## Privacy rules (always)

- Screenshots never go to third-party hosts (no imgur, gists, Slack, CDNs, pastebins).
  The only upload target is the repository's own `ui-diff-assets` branch.
- On post-engineer the owner pre-authorized public uploads (2026-11-22): `publish.allowPublicRepo`
  is `true` in `apps/web/ui-diff.config.json`, so no per-PR OK is asked. Every capture masks
  account cards, the signed-in user's profile links and the persona photo area
  (`[data-ui-diff-mask]` on the head, plus base-compatible selectors in the config so a "before"
  capture of `main` is masked too); mark any new identity element with `[data-ui-diff-mask]`.
- `publish` still refuses when repository visibility is unknown; never pass `--assume-private` on your own.
- Never create Vercel share links, bypass URLs or URLs with tokens. Protected previews are
  reached with headers/cookies whose values come from environment variables (see `references/privacy.md`).
- Never print secret values or paste them into comments or summaries.

## 1. Context

```bash
gh pr view <n> --json number,url,baseRefName,headRefName,headRefOid   # or: gh pr view (current branch)
git status --short
```

- Look for `ui-diff.config.json` (repo root or the app's directory). If there is none, run
  `node "$SKILL/bin/ui-diff.mjs" init`, check the suggested `startCommand` and `routes`, and offer
  to commit the file. `doctor` checks git, gh, the browser, the config and repo visibility: FAIL
  blocks a run; WARN (no gh login, no remote) only matters for publishing or `--pr`.
- **Posting to a PR:** pass `--pr <n>` so head is the pushed commit. Mention uncommitted or unpushed
  work, because it will not appear.
- **Checking work in progress:** omit `--head`; the working tree (including uncommitted changes)
  is snapshotted into a worktree and labelled as such.
- **Deployed previews:** pass `--base-url` / `--head-url` (or `preview` in the config). For
  protected previews configure `auth` once; see `references/privacy.md`.

## 2. Detect changed UI and choose routes

```bash
node "$SKILL/bin/ui-diff.mjs" detect --pr <n>
```

It maps changed files to routes through `routes[].files` and `globalFiles` in the config, then
framework conventions (Next.js, SvelteKit, Nuxt, Astro, Remix, TanStack Router, plain HTML) and an import graph
(relative imports, tsconfig aliases, package.json `#` imports, workspace packages, CSS `@import`/`url()`, HTML `href`/`src`).
The JSON lists each route with `reasons` and `confidence`, plus:

- `unmatched`: UI files it could not place. Find their pages yourself (grep for imports) and pass
  them with `--routes`.
- `needsExample`: dynamic routes (`/blog/[slug]`). Find a real id and pass `--routes /blog/hello`.
- `notes`: e.g. routes beyond `detect.maxRoutes`.

If no UI file changed, say so and stop; do not produce an empty report. Tell the user in one or
two lines which routes you will capture and why. Remember routes that are affected but not
captured (login walls, modals, limits): they go in the summary so "no change" is not read as
an all-clear.

## 3. Capture and diff

```bash
node "$SKILL/bin/ui-diff.mjs" run --pr <n> [--routes "/,/pricing"] [--viewports desktop,mobile] [--themes light,dark] \
  [--variants hero=1..4] [--motion | --motion-all] [--tokens path/to/tokens.json | auto] [--a11y]
```

In one go it creates git worktrees for base (the merge base) and head, links or installs
dependencies, starts each app on a free port in its own process group, captures every
route × viewport × theme, diffs with pixelmatch, composes `before | after | diff` images (full
page plus zoomed crops of the changed areas), runs the enabled extras, and cleans up. Captures are
deterministic: animations and transitions finished, fonts and images awaited, `Math.random` and
`crypto` seeded, scrollbars hidden, scroll reset, optional frozen clock and masked selectors, and
each screenshot is retaken until consecutive shots match (if something keeps moving, the page's
JavaScript timers are paused for the final shots).

The JSON result has `stats`, `changed` (with image paths), `variants`, `motion`, `a11y`, `tokens`,
`warnings`, `notCaptured` and `unmatchedFiles`. Add `--themes light,dark` when colors or tokens
changed. If it fails, the error names the step and the log in `.ui-diff/logs/` (common causes and
fixes: `references/troubleshooting.md`); fix the cause
(missing env var, wrong `startCommand`, auth) and rerun. Never post a one-sided result. A capture
whose page returns HTTP 4xx/5xx is reported as failed, not as "unchanged".
A failed run keeps the previous report in `.ui-diff/` (`render` and `publish` warn that it is from
an earlier run): do not publish until a rerun succeeds.

## 4. Review and write the UX summary

Open the images before writing (focus crops `compare/*__focus-*.png` first, then the full
composites, `variants/*__strip.png` and `motion/*.gif`). Read `.ui-diff/report.json` for the
measured data, and start from `.ui-diff/summary.auto.md`. Write `.ui-diff/summary.md` for a
designer or PM who will not read the code:

```markdown
**What changed**
- **Primary button**: padding 8×14 → 10×18px, corner radius 4 → 8px. The link beside it shifts right, and the page below moves down 4px.
- **Newsletter label**: "Work email" is now brand blue.

**Worth a look**
- The label is 3.45:1 in dark mode (`#2563eb` on `#0f172a`).
- Button padding `10px` / `18px` and the 17px action gap are not spacing tokens.

**Not checked:** `/settings` (needs login).
```

Guidelines: lead "worth a look" with likely-unintended changes (a page changed without its files
changing, breakage at one viewport, new a11y issues, off-token values). Content that only moved
(a taller hero pushing sections down) is matched row by row and reported as "shifted down Npx"
(`diff.shifted` in `report.json`); it is not in the changed percentage, so mention the shift
without calling the moved sections changed. A "page did not settle" warning names an element that
kept moving by itself (carousel, ticker); when a capture says every difference is inside such an
area, do not describe it as a change: suggest the `capture.mask` the warning gives. Say "changed", not
"intentionally changed". Keep it proportional: a one-color tweak gets one bullet. If you cannot
view images, write from `report.json` and say the screenshots were not reviewed.

Preview the final comment locally:

```bash
node "$SKILL/bin/ui-diff.mjs" render     # writes .ui-diff/comment.preview.md
```

## 5. Publish one sticky comment

Posting writes to a shared PR and pushes a branch: show the user the summary and get a yes first,
unless the request already said to post.

```bash
node "$SKILL/bin/ui-diff.mjs" publish --pr <n> --dry-run   # lists uploads, writes .ui-diff/comment.md, pushes and posts nothing
node "$SKILL/bin/ui-diff.mjs" publish --pr <n>
```

- Read the dry run's `publishable` and `problems`: if its visibility is unknown or there is no
  GitHub remote, the real publish will stop there. Tell the user; do not add `--assume-private`
  on your own. A public repo publishes through `publish.allowPublicRepo` in the config; the
  `--allow-public-repo` flag stays an explicit per-run override.
- Images go to the orphan branch `ui-diff-assets` of the same repository (single commit, other PRs'
  files kept) and are linked as `https://github.com/<owner>/<repo>/raw/ui-diff-assets/…`, which
  renders only for people who can read the repo.
- The comment is found by a hidden marker (`<!-- ui-diff:sticky id=default -->`) and edited in place;
  reruns never stack comments, unchanged bodies are not re-sent, and ticked variant picks survive.
- Exit code 3 means git could not read or push the repository (no push access, e.g. a fork, or
  missing git credentials; the error says which): use `--no-upload` for a text-only comment, or
  `--no-comment` to upload and print the markdown without posting.
- No PR yet: use `render` (or `publish --dry-run`) to produce the comment and offer to post once
  the PR exists.

> Post Engineer local patch (upstream `3075b4c8` has no PR-body step): the body is required.

**PR body (required):** the sticky comment never replaces the PR body.

- After a successful publish, add the published image URLs to the PR body's `UI changes`
  section (`gh pr edit <n> --body-file ...`): one block per changed route — route, viewport,
  pixel % and area count, then the `before | after | diff` composite image. Verify the body
  shows the section and the URLs.
- When publish is not possible (the config has no `publish.allowPublicRepo` and no
  `--allow-public-repo` override, exit code 3, no remote), do not leave the PR without body
  screenshots: attach the composite images in chat so the owner can drag them into the body.

## 6. Wrap up

Report the PR body link and the comment link, the counts, the "worth a look" items and anything not captured. If you
worked out routes, masks or dynamic ids yourself, offer to save them in `ui-diff.config.json`.
After a PR closes, `node "$SKILL/bin/ui-diff.mjs" prune --closed` removes its images.

## Extras

| Feature | Enable | What you get |
|---|---|---|
| Variant compare | `--variants hero=1..4` or `routes[].variants` | Head captured once per `?hero=` value, shown side by side in one table with tick boxes reviewers use to pick. |
| Motion clips | `--motion` or `motion.enabled` + `routes[].motion.steps` | Short before/after GIF (and optional WebM) of a scripted hover/click/scroll, for transitions screenshots miss. Only routes with a visual change unless `--motion-all`; a single-frame clip is flagged "no motion detected". |
| Token audit | `--tokens tokens.json` or `tokens.enabled` | Computed colors, spacing, radii and type in changed areas that match no token (JSON, CSS variables or StyleX `*.stylex.ts`; `--tokens auto` finds them), with selectors and the nearest token. |
| Protected previews | `--base-url/--head-url` + `auth` | Captures behind Vercel Authentication and similar, with credentials from env vars sent only to the preview origin. |
| Accessibility delta | `--a11y` or `a11y.enabled` | axe-core on both sides; only new and fixed issues (contrast, labels, focus), plus tab-order changes. |

Details and examples: `references/extras.md`. All config options: `references/config.md`.
Hosting trade-offs and protected previews: `references/privacy.md`. Failures and flaky captures:
`references/troubleshooting.md`.
