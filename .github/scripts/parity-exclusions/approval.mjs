//---------------
// Code-owner approval for a guarded parity change.
//
// Approval is valid only when all of these hold:
//   1. The `parity-exclusion-approved` label is on the PR now.
//   2. The most recent `labeled` event for that label was by the code
//      owner. The account that opens PRs here has triage and can apply
//      labels, so presence alone proves nothing, and an owner's old
//      `labeled` event does not survive a later remove + re-add by anyone
//      else.
//   3. The code owner's latest decisive review (APPROVED, CHANGES_REQUESTED
//      or DISMISSED) is APPROVED and was submitted on the PR's current head
//      commit. Any push after the approval moves the head, so a later
//      exclusion change fails again until the owner reviews the new head.
//
// Labels can be re-applied without looking at the code; a review is bound
// to a commit SHA by GitHub, which is what makes approval expire.
//
// Kept dependency-free so `node --test` can exercise it in CI.
//---------------

export const APPROVAL_LABEL = 'parity-exclusion-approved';
export const CODE_OWNER = 'Ryan-Carloso';

const DECISIVE = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * @typedef {{ event?: string, label?: { name?: string }, actor?: { login?: string }, created_at?: string }} TimelineEvent
 * @typedef {{ user?: { login?: string }, state?: string, commit_id?: string, submitted_at?: string }} Review
 */

/**
 * @param {{
 *   labels: string[],
 *   timeline: TimelineEvent[],
 *   reviews: Review[],
 *   headSha: string,
 *   owner?: string,
 *   label?: string,
 * }} input timeline and reviews in API order (oldest first)
 * @returns {{ approved: boolean, reasons: string[] }}
 */
export function evaluateApproval({ labels, timeline, reviews, headSha, owner = CODE_OWNER, label = APPROVAL_LABEL }) {
  const reasons = [];

  if (!labels.includes(label)) {
    reasons.push(`the '${label}' label is not on the PR`);
  }

  const labeled = timeline.filter((e) => e.event === 'labeled' && e.label?.name === label);
  const lastLabeled = labeled[labeled.length - 1];
  if (lastLabeled === undefined) {
    reasons.push(`no '${label}' labeled event in the timeline`);
  } else if (lastLabeled.actor?.login !== owner) {
    reasons.push(`the '${label}' label was last applied by ${lastLabeled.actor?.login ?? 'unknown'}, not by ${owner}`);
  }

  const decisive = reviews.filter((r) => r.user?.login === owner && DECISIVE.has(r.state ?? ''));
  const lastReview = decisive[decisive.length - 1];
  if (lastReview === undefined) {
    reasons.push(`${owner} has not approved the PR in a review`);
  } else if (lastReview.state !== 'APPROVED') {
    reasons.push(`${owner}'s latest review is ${lastReview.state}, not APPROVED`);
  } else if (lastReview.commit_id !== headSha) {
    reasons.push(`${owner} approved ${lastReview.commit_id?.slice(0, 7) ?? 'unknown'}, not the current head ${headSha.slice(0, 7)}; review the new commits and approve again`);
  }

  return { approved: reasons.length === 0, reasons };
}
