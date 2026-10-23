import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APPROVAL_LABEL, CODE_OWNER, evaluateApproval } from './approval.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const BOT = 'joaodev904-tech';

const labeled = (login) => ({ event: 'labeled', label: { name: APPROVAL_LABEL }, actor: { login } });
const unlabeled = (login) => ({ event: 'unlabeled', label: { name: APPROVAL_LABEL }, actor: { login } });
const review = (login, state, commit) => ({ user: { login }, state, commit_id: commit });

test('approves when the owner labeled last and approved the current head', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(CODE_OWNER)],
    reviews: [review(CODE_OWNER, 'APPROVED', HEAD)],
    headSha: HEAD,
  });
  assert.deepEqual(result, { approved: true, reasons: [] });
});

test('stale approval: commits pushed after the owner approved fail again', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(CODE_OWNER)],
    reviews: [review(CODE_OWNER, 'APPROVED', OLD_HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, false);
  assert.match(result.reasons.join('\n'), /not the current head/);
});

test('label presence alone is not approval (applied by the bot)', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(BOT)],
    reviews: [review(CODE_OWNER, 'APPROVED', HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, false);
  assert.match(result.reasons.join('\n'), /last applied by joaodev904-tech/);
});

test('an owner label removed and re-added by someone else no longer counts', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(CODE_OWNER), unlabeled(BOT), labeled(BOT)],
    reviews: [review(CODE_OWNER, 'APPROVED', HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, false);
});

test('a removed label fails even with an owner labeled event in the past', () => {
  const result = evaluateApproval({
    labels: [],
    timeline: [labeled(CODE_OWNER), unlabeled(CODE_OWNER)],
    reviews: [review(CODE_OWNER, 'APPROVED', HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, false);
});

test('a later changes-requested or dismissed review revokes the approval', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) {
    const result = evaluateApproval({
      labels: [APPROVAL_LABEL],
      timeline: [labeled(CODE_OWNER)],
      reviews: [review(CODE_OWNER, 'APPROVED', HEAD), review(CODE_OWNER, state, HEAD)],
      headSha: HEAD,
    });
    assert.equal(result.approved, false, state);
  }
});

test('a comment-only review after the approval does not revoke it', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(CODE_OWNER)],
    reviews: [review(CODE_OWNER, 'APPROVED', HEAD), review(CODE_OWNER, 'COMMENTED', HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, true);
});

test('another user’s approval on the head does not count', () => {
  const result = evaluateApproval({
    labels: [APPROVAL_LABEL],
    timeline: [labeled(CODE_OWNER)],
    reviews: [review(BOT, 'APPROVED', HEAD)],
    headSha: HEAD,
  });
  assert.equal(result.approved, false);
});
