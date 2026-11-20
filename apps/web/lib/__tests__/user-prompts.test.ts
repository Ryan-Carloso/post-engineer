import { describe, expect, it } from 'vitest';
import {
  createUserPrompt,
  deleteOwnUserPrompt,
  findApprovedUserPrompt,
  findOwnUserPrompt,
  listApprovedUserPrompts,
  listOwnUserPrompts,
  listPendingUserPrompts,
  PROMPT_REVIEW_QUEUE_LIMIT,
  requestPublication,
  reviewUserPrompt,
  updateOwnUserPrompt,
  UserPromptStoreError,
  withdrawPublication,
} from '@/lib/user-prompts';
import { contentHashOf, createFakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const draft = { slug: 'my-prompt', title: 'Title', description: 'About', prompt: 'Body text' };

describe('createUserPrompt', () => {
  it('stores a private prompt owned by the caller with the body in the prompt field', async () => {
    const db = createFakeUserPromptsDb();
    const outcome = await createUserPrompt(db.client, ALICE, draft);
    expect(outcome.kind).toBe('created');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ owner_id: ALICE, slug: 'my-prompt', body: 'Body text', status: 'private' });
  });

  it('reports a taken slug when the owner reuses it, and keeps the original', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, draft);
    const outcome = await createUserPrompt(db.client, ALICE, { ...draft, title: 'Other' });
    expect(outcome).toEqual({ kind: 'slug_taken' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].title).toBe('Title');
  });

  it('lets two owners keep the same private slug', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, draft);
    expect((await createUserPrompt(db.client, BOB, draft)).kind).toBe('created');
  });

  it('throws a store error for any other database failure', async () => {
    const db = createFakeUserPromptsDb();
    db.failNext('XX000');
    await expect(createUserPrompt(db.client, ALICE, draft)).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('own prompts', () => {
  it('finds, lists and edits only the caller prompts', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' },
      { owner_id: BOB, slug: 'mine', title: 'Bobs', body: 'b' },
    ]);
    expect((await findOwnUserPrompt(db.client, ALICE, 'mine'))?.title).toBe('Mine');
    expect((await listOwnUserPrompts(db.client, ALICE)).map((row) => row.title)).toEqual(['Mine']);
    const edited = await updateOwnUserPrompt(db.client, ALICE, 'mine', { title: 'Renamed', prompt: 'new body' });
    expect(edited).toMatchObject({ title: 'Renamed', body: 'new body' });
    expect(db.rows.find((row) => row.owner_id === BOB)?.title).toBe('Bobs');
  });

  it('returns null when editing or finding a slug that is not the caller own', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b' }]);
    expect(await findOwnUserPrompt(db.client, ALICE, 'bobs')).toBeNull();
    expect(await updateOwnUserPrompt(db.client, ALICE, 'bobs', { title: 'Taken over' })).toBeNull();
    expect(db.rows[0].title).toBe('Bobs');
  });

  it('deletes only the caller prompt and reports whether a row went away', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, slug: 'mine', title: 'Mine', body: 'a' },
      { owner_id: BOB, slug: 'mine', title: 'Bobs', body: 'b' },
    ]);
    expect(await deleteOwnUserPrompt(db.client, ALICE, 'mine')).toBe(true);
    expect(await deleteOwnUserPrompt(db.client, ALICE, 'mine')).toBe(false);
    expect(db.rows.map((row) => row.owner_id)).toEqual([BOB]);
  });
});

describe('publication requests', () => {
  it('moves a private prompt to pending and clears an old rejection', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', status: 'rejected', rejection_reason: 'too vague', reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() },
    ]);
    const outcome = await requestPublication(db.client, ALICE, 'mine');
    expect(outcome).toMatchObject({ kind: 'updated', changed: true });
    expect(db.rows[0]).toMatchObject({ status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null });
  });

  it('answers with the current row when the prompt is already pending (a retry is not an error)', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', status: 'pending' }]);
    const outcome = await requestPublication(db.client, ALICE, 'mine');
    expect(outcome).toMatchObject({ kind: 'updated', changed: false });
    expect(db.rows[0].status).toBe('pending');
  });

  it('refuses to request publication of an approved prompt', async () => {
    const hash = contentHashOf('T', '', 'a');
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', status: 'approved', approved_hash: hash, reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() },
    ]);
    expect(await requestPublication(db.client, ALICE, 'mine')).toEqual({ kind: 'conflict', status: 'approved' });
  });

  it('reports not_found for a prompt of another owner without touching it', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: BOB, slug: 'bobs', title: 'T', body: 'a' }]);
    expect(await requestPublication(db.client, ALICE, 'bobs')).toEqual({ kind: 'not_found' });
    expect(db.rows[0].status).toBe('private');
  });

  it('withdraws an approved prompt to private and clears the approval', async () => {
    const hash = contentHashOf('T', '', 'a');
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', status: 'approved', approved_hash: hash, reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() },
    ]);
    const outcome = await withdrawPublication(db.client, ALICE, 'mine');
    expect(outcome).toMatchObject({ kind: 'updated', changed: true });
    expect(db.rows[0]).toMatchObject({ status: 'private', approved_hash: null, reviewed_by: null });
  });

  it('treats withdrawing a private prompt as already done', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a' }]);
    expect(await withdrawPublication(db.client, ALICE, 'mine')).toMatchObject({ kind: 'updated', changed: false });
  });
});

describe('review', () => {
  function pending() {
    return createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', description: 'D', body: 'text', status: 'pending' }]);
  }

  it('approves the exact content hash the reviewer read and records the reviewer', async () => {
    const db = pending();
    const hash = db.rows[0].content_hash;
    const outcome = await reviewUserPrompt(db.client, { id: db.rows[0].id, reviewerId: REVIEWER, contentHash: hash, decision: 'approve' });
    expect(outcome.kind).toBe('reviewed');
    expect(db.rows[0]).toMatchObject({ status: 'approved', approved_hash: hash, reviewed_by: REVIEWER });
  });

  it('refuses a stale approval when the owner edited the text after the reviewer read it', async () => {
    const db = pending();
    const readHash = db.rows[0].content_hash;
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { prompt: 'swapped text' });
    const outcome = await reviewUserPrompt(db.client, { id: db.rows[0].id, reviewerId: REVIEWER, contentHash: readHash, decision: 'approve' });
    expect(outcome).toEqual({ kind: 'stale' });
    expect(db.rows[0].status).toBe('pending');
  });

  it('refuses to review a prompt that is no longer pending', async () => {
    const db = pending();
    const request = { id: db.rows[0].id, reviewerId: REVIEWER, contentHash: db.rows[0].content_hash, decision: 'approve' as const };
    await reviewUserPrompt(db.client, request);
    expect(await reviewUserPrompt(db.client, request)).toEqual({ kind: 'stale' });
  });

  it('rejects with the reason and no approved hash', async () => {
    const db = pending();
    const outcome = await reviewUserPrompt(db.client, {
      id: db.rows[0].id,
      reviewerId: REVIEWER,
      contentHash: db.rows[0].content_hash,
      decision: 'reject',
      reason: 'Too vague',
    });
    expect(outcome.kind).toBe('reviewed');
    expect(db.rows[0]).toMatchObject({ status: 'rejected', rejection_reason: 'Too vague', approved_hash: null });
  });

  it('reports not_found for an unknown id', async () => {
    const db = pending();
    const outcome = await reviewUserPrompt(db.client, {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      reviewerId: REVIEWER,
      contentHash: db.rows[0].content_hash,
      decision: 'approve',
    });
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('reports slug_taken when another approved prompt already owns the slug', async () => {
    const taken = contentHashOf('Other', '', 'x');
    const db = createFakeUserPromptsDb([
      { owner_id: BOB, slug: 'mine', title: 'Other', body: 'x', status: 'approved', approved_hash: taken, reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() },
      { owner_id: ALICE, slug: 'mine', title: 'T', body: 'text', status: 'pending' },
    ]);
    const candidate = db.rows[1];
    const outcome = await reviewUserPrompt(db.client, { id: candidate.id, reviewerId: REVIEWER, contentHash: candidate.content_hash, decision: 'approve' });
    expect(outcome).toEqual({ kind: 'slug_taken' });
    expect(candidate.status).toBe('pending');
  });

  it('sends an approved prompt back to pending when the owner edits it', async () => {
    const db = pending();
    await reviewUserPrompt(db.client, { id: db.rows[0].id, reviewerId: REVIEWER, contentHash: db.rows[0].content_hash, decision: 'approve' });
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { prompt: 'edited after approval' });
    expect(db.rows[0]).toMatchObject({ status: 'pending', approved_hash: null, reviewed_by: null });
    expect(await findApprovedUserPrompt(db.client, 'mine')).toBeNull();
  });
});

describe('public reads', () => {
  const hash = contentHashOf('T', '', 'a');
  const approved = { slug: 'shared', title: 'T', body: 'a', status: 'approved' as const, approved_hash: hash, reviewed_by: REVIEWER, reviewed_at: new Date().toISOString() };

  it('lists only approved prompts whose approved hash still matches the text', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: ALICE, ...approved },
      { owner_id: BOB, ...approved, slug: 'tampered', approved_hash: 'f'.repeat(64) },
      { owner_id: BOB, slug: 'hidden', title: 'T', body: 'a', status: 'private' },
      { owner_id: BOB, slug: 'waiting', title: 'T', body: 'a', status: 'pending' },
    ]);
    expect((await listApprovedUserPrompts(db.client)).map((row) => row.slug)).toEqual(['shared']);
    expect(await findApprovedUserPrompt(db.client, 'tampered')).toBeNull();
    expect(await findApprovedUserPrompt(db.client, 'hidden')).toBeNull();
    expect((await findApprovedUserPrompt(db.client, 'shared'))?.owner_id).toBe(ALICE);
  });

  it('lists the review queue oldest first and flags truncation', async () => {
    const seed = Array.from({ length: PROMPT_REVIEW_QUEUE_LIMIT + 1 }, (_, index) => ({
      owner_id: ALICE,
      slug: `p-${index}`,
      title: 'T',
      body: 'a',
      status: 'pending' as const,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const db = createFakeUserPromptsDb([...seed, { owner_id: BOB, slug: 'private-one', title: 'T', body: 'a' }]);
    const queue = await listPendingUserPrompts(db.client);
    expect(queue.truncated).toBe(true);
    expect(queue.rows).toHaveLength(PROMPT_REVIEW_QUEUE_LIMIT);
    expect(queue.rows[0].slug).toBe('p-0');
    expect(queue.rows.every((row) => row.status === 'pending')).toBe(true);
  });
});
