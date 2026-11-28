export const APPROVAL_LABEL = 'parity-exclusion-approved';
export const CODE_OWNER = 'Ryan-Carloso';

const DECISIVE = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

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
