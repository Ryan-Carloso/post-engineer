# Bugbot

Grade the diff against `.github/REVIEW_RUBRIC.md`. Cite `path:line` for every finding. A finding with no location and no quoted line is not a finding.

Do not claim a command ran, a test passed, or coverage moved unless the pull request or the `verification` check shows that output. If you cannot run a command, say so.

Flag, as must-fix when the diff introduces them:

- A test deleted, unconditionally skipped, focused (`.only`), or rewritten from a value assertion to a truthiness check so CI goes green.
- A coverage floor lowered (`fail_under`, Codecov target/threshold, a vitest floor) or a new coverage-ignore pragma.
- Secrets, app passwords, or webhook URLs in the diff, logs, or analytics properties. Free-text PostHog properties must be scrubbed.
- Refunds that recompute a price instead of using stored `charged_tokens`.
- Provider auth failures that are not reported (`401`, Meta code 190, Bluesky `invalid_credentials`).
- A migration that edits a shipped file, or a provider value added to one check and not the others.
- `pull_request_target` combined with a checkout of pull-request code, or a secret passed into a job that runs that code.

Do not treat the workflow's evidence comment as a rubber stamp for billing, publishing, or migrations. Those areas need their own look. Pre-existing bugs are noted, not charged to the author.
