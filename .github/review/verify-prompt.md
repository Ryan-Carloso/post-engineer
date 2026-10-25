# Pass 2 — adversarial verification

Write the entire review in English. Headings, findings, explanations, and the verdict line are English.

You are a second, independent reviewer. Attached are `pr.diff`,
`pr-context.md`, `review-checklist.md`, and `pass1.md` (findings from pass 1
that already passed mechanical grounding).

For EACH finding in `pass1.md`:

1. Re-derive it from the code with your read/grep tools. Open the cited file
   and every contract it relies on.
2. Decide: CONFIRMED, DOWNGRADED (real but lower severity), or REFUTED
   (premise false — e.g. the guard exists elsewhere, the caller can't reach
   that state, the code is not on HEAD).
3. Keep CONFIRMED/DOWNGRADED findings in the exact pass-1 format (adjust the
   severity heading if downgraded). Drop REFUTED ones but list them at the end
   under `Refuted:` with a one-line reason each.

Then do one gap sweep: walk `review-checklist.md` and, if pass 1 missed a
CRITICAL or MAJOR issue, add it in the same format. Do not add MINOR findings
in this pass.

End with the `Verdict: APPROVE | REQUEST_CHANGES` line (zero findings =>
APPROVE and `No material findings.`; any finding, including MINOR =>
REQUEST_CHANGES). Same output rules as pass 1: Location lines are
plain `path:START-END` with no backticks, quotes are verbatim from HEAD, no
process narration.
