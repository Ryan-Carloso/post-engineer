import { describe, expect, it } from 'vitest';
import {
  createUserPrompt,
  deleteOwnUserPrompt,
  findOwnUserPrompt,
  findPublicUserPrompt,
  listOwnUserPrompts,
  listPublicUserPrompts,
  updateOwnUserPrompt,
  UserPromptStoreError,
} from '@/lib/user-prompts';
import { createFakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const draft = { slug: 'my-prompt', title: 'Title', description: 'About', prompt: 'Body text', visibility: 'private' as const };

describe('createUserPrompt', () => {
  it('stores a prompt owned by the caller with the text in the body column', async () => {
    const db = createFakeUserPromptsDb();
    const outcome = await createUserPrompt(db.client, ALICE, draft);
    expect(outcome.kind).toBe('saved');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ owner_id: ALICE, slug: 'my-prompt', body: 'Body text', visibility: 'private' });
  });

  it('can create a prompt that is public from the start', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, { ...draft, visibility: 'public' });
    expect(db.rows[0].visibility).toBe('public');
  });

  it('reports a taken slug when the owner reuses it, and keeps the original', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, draft);
    expect(await createUserPrompt(db.client, ALICE, { ...draft, title: 'Other' })).toEqual({ kind: 'slug_taken' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].title).toBe('Title');
  });

  it('lets two owners keep the same private slug', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, draft);
    expect((await createUserPrompt(db.client, BOB, draft)).kind).toBe('saved');
  });

  it('refuses a second public prompt with a slug that is already public', async () => {
    const db = createFakeUserPromptsDb();
    await createUserPrompt(db.client, ALICE, { ...draft, visibility: 'public' });
    expect(await createUserPrompt(db.client, BOB, { ...draft, visibility: 'public' })).toEqual({ kind: 'slug_taken' });
    expect(db.rows).toHaveLength(1);
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
    const outcome = await updateOwnUserPrompt(db.client, ALICE, 'mine', { title: 'Renamed', prompt: 'new body' });
    expect(outcome).toMatchObject({ kind: 'saved', row: { title: 'Renamed', body: 'new body' } });
    expect(db.rows.find((row) => row.owner_id === BOB)?.title).toBe('Bobs');
  });

  it('never lets one user change another user prompt, public or not', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: BOB, slug: 'bobs', title: 'Bobs', body: 'b', visibility: 'public' },
    ]);
    expect(await findOwnUserPrompt(db.client, ALICE, 'bobs')).toBeNull();
    expect(await updateOwnUserPrompt(db.client, ALICE, 'bobs', { title: 'Taken over', prompt: 'mine now' })).toEqual({ kind: 'not_found' });
    expect(await deleteOwnUserPrompt(db.client, ALICE, 'bobs')).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ title: 'Bobs', body: 'b', owner_id: BOB });
  });

  it('keeps a public prompt public when its text is edited, with no review step', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', visibility: 'public' }]);
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { prompt: 'edited' });
    expect(db.rows[0]).toMatchObject({ visibility: 'public', body: 'edited' });
  });

  it('makes a prompt public and private again', async () => {
    const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a' }]);
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { visibility: 'public' });
    expect(db.rows[0].visibility).toBe('public');
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { visibility: 'private' });
    expect(db.rows[0].visibility).toBe('private');
  });

  it('reports slug_taken when making a prompt public while another public prompt owns the slug', async () => {
    const db = createFakeUserPromptsDb([
      { owner_id: BOB, slug: 'same', title: 'Bobs', body: 'b', visibility: 'public' },
      { owner_id: ALICE, slug: 'same', title: 'Mine', body: 'a' },
    ]);
    expect(await updateOwnUserPrompt(db.client, ALICE, 'same', { visibility: 'public' })).toEqual({ kind: 'slug_taken' });
    expect(db.rows[1].visibility).toBe('private');
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

describe('public reads', () => {
  const seed = [
    { owner_id: ALICE, slug: 'shared', title: 'T', body: 'a', visibility: 'public' as const },
    { owner_id: BOB, slug: 'hidden', title: 'T', body: 'a' },
  ];

  it('lists only public prompts and finds only a public prompt by slug', async () => {
    const db = createFakeUserPromptsDb(seed);
    expect((await listPublicUserPrompts(db.client)).map((row) => row.slug)).toEqual(['shared']);
    expect((await findPublicUserPrompt(db.client, 'shared'))?.owner_id).toBe(ALICE);
    expect(await findPublicUserPrompt(db.client, 'hidden')).toBeNull();
  });
});

describe('database failures', () => {
  const failing: Array<[string, (db: ReturnType<typeof createFakeUserPromptsDb>) => Promise<unknown>]> = [
    ['finding an own prompt', (db) => findOwnUserPrompt(db.client, ALICE, 'mine')],
    ['listing own prompts', (db) => listOwnUserPrompts(db.client, ALICE)],
    ['listing public prompts', (db) => listPublicUserPrompts(db.client)],
    ['finding a public prompt', (db) => findPublicUserPrompt(db.client, 'shared')],
    ['updating a prompt', (db) => updateOwnUserPrompt(db.client, ALICE, 'mine', { title: 'T' })],
    ['deleting a prompt', (db) => deleteOwnUserPrompt(db.client, ALICE, 'mine')],
  ];

  it.each(failing)('throws a store error when %s fails, never a silent empty result', async (_label, run) => {
    const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'T', body: 'a', visibility: 'public' }]);
    db.failNext('XX000');
    await expect(run(db)).rejects.toBeInstanceOf(UserPromptStoreError);
  });

  it('keeps the original database error as the cause of the store error', async () => {
    const db = createFakeUserPromptsDb();
    db.failNext('XX000');
    const error = await listOwnUserPrompts(db.client, ALICE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UserPromptStoreError);
    expect((error as UserPromptStoreError).cause).toMatchObject({ code: 'XX000' });
  });
});
