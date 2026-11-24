// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getUserPromptVersion,
  listUserPromptVersions,
  previewOf,
  readUserPromptVersion,
  restoreUserPromptVersion,
} from '@/lib/prompt-version-history';
import { updateOwnUserPrompt, UserPromptStoreError } from '@/lib/user-prompts';
import { createFakeUserPromptsDb, type FakeUserPromptsDb } from '@/lib/__tests__/support/fake-user-prompts-db';
import { PROMPT_VERSION_PREVIEW_LENGTH } from '@/lib/contracts/prompts';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function seedHistory(bodies: string[]): Promise<{ db: FakeUserPromptsDb; promptId: string }> {
  const db = createFakeUserPromptsDb([{ owner_id: ALICE, slug: 'mine', title: 'Title', body: bodies[0] }]);
  for (const body of bodies.slice(1)) await updateOwnUserPrompt(db.client, ALICE, 'mine', { prompt: body });
  db.queries.length = 0;
  return { db, promptId: db.rows[0].id };
}

describe('previewOf', () => {
  it('returns short text whole and not truncated', () => {
    expect(previewOf('hello')).toEqual({ preview: 'hello', previewTruncated: false });
  });

  it('keeps a text of exactly the preview length whole', () => {
    const text = 'a'.repeat(PROMPT_VERSION_PREVIEW_LENGTH);
    expect(previewOf(text)).toEqual({ preview: text, previewTruncated: false });
  });

  it('cuts longer text at the preview length and flags it', () => {
    const result = previewOf('a'.repeat(PROMPT_VERSION_PREVIEW_LENGTH + 1));
    expect(result.preview).toBe('a'.repeat(PROMPT_VERSION_PREVIEW_LENGTH));
    expect(result.previewTruncated).toBe(true);
  });

  it('never splits a surrogate pair at the cut', () => {
    const text = `${'a'.repeat(PROMPT_VERSION_PREVIEW_LENGTH - 1)}😀tail`;
    const result = previewOf(text);
    expect(result.preview).toBe(`${'a'.repeat(PROMPT_VERSION_PREVIEW_LENGTH - 1)}😀`);
    expect(result.previewTruncated).toBe(true);
    expect(Array.from(result.preview)).toHaveLength(PROMPT_VERSION_PREVIEW_LENGTH);
  });
});

describe('listUserPromptVersions', () => {
  it('lists the versions newest first with the current one marked', async () => {
    const { db, promptId } = await seedHistory(['one', 'two', 'three']);
    const page = await listUserPromptVersions(db.client, promptId, { limit: 20 });
    expect(page.currentVersion).toBe(3);
    expect(page.versions.map((entry) => [entry.version, entry.current, entry.preview])).toEqual([
      [3, true, 'three'],
      [2, false, 'two'],
      [1, false, 'one'],
    ]);
    expect(page.truncated).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('pages with a cursor and reports truncation', async () => {
    const { db, promptId } = await seedHistory(Array.from({ length: 25 }, (_, index) => `body ${index + 1}`));
    const first = await listUserPromptVersions(db.client, promptId, { limit: 20 });
    expect(first.versions).toHaveLength(20);
    expect(first.versions[0].version).toBe(25);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBe(6);
    const second = await listUserPromptVersions(db.client, promptId, { limit: 20, before: first.nextCursor ?? 0 });
    expect(second.versions.map((entry) => entry.version)).toEqual([5, 4, 3, 2, 1]);
    expect(second.truncated).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('never returns the full body, only the preview and its length', async () => {
    const body = 'x'.repeat(5000);
    const { db, promptId } = await seedHistory(['small', body]);
    const page = await listUserPromptVersions(db.client, promptId, { limit: 20 });
    const long = page.versions[0];
    expect(long.bodyLength).toBe(5000);
    expect(long.preview).toHaveLength(PROMPT_VERSION_PREVIEW_LENGTH);
    expect(long.previewTruncated).toBe(true);
    expect(JSON.stringify(page)).not.toContain(body);
  });

  it('filters by prompt id only and reads one extra row to detect truncation', async () => {
    const { db, promptId } = await seedHistory(['a', 'b', 'c']);
    db.queries.length = 0;
    await listUserPromptVersions(db.client, promptId, { limit: 2, before: 3 });
    const query = db.queries.find((entry) => entry.includes('select id, version, title, body, created_at'));
    expect(query).toBe(
      `prompt_versions select id, version, title, body, created_at eq prompt_id=${promptId} lt version=3 order version desc limit 3`,
    );
  });

  it('carries the title the prompt had when the version was written', async () => {
    const { db, promptId } = await seedHistory(['one']);
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { title: 'Renamed', prompt: 'two' });
    const page = await listUserPromptVersions(db.client, promptId, { limit: 20 });
    expect(page.versions.map((entry) => entry.title)).toEqual(['Renamed', 'Title']);
  });

  it('throws a store error when the read fails', async () => {
    const { db, promptId } = await seedHistory(['one']);
    db.failNext('XX000');
    await expect(listUserPromptVersions(db.client, promptId, { limit: 20 })).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('readUserPromptVersion and getUserPromptVersion', () => {
  it('reads one version by prompt id and number', async () => {
    const { db, promptId } = await seedHistory(['one', 'two']);
    const row = await readUserPromptVersion(db.client, promptId, 1);
    expect(row).toMatchObject({ version: 1, body: 'one', title: 'Title' });
  });

  it('returns null for a version that does not exist', async () => {
    const { db, promptId } = await seedHistory(['one']);
    expect(await readUserPromptVersion(db.client, promptId, 9)).toBeNull();
    expect(await getUserPromptVersion(db.client, promptId, 9)).toBeNull();
  });

  it('returns the full body and marks the current version', async () => {
    const { db, promptId } = await seedHistory(['one', 'two']);
    expect(await getUserPromptVersion(db.client, promptId, 1)).toMatchObject({ version: 1, body: 'one', current: false });
    expect(await getUserPromptVersion(db.client, promptId, 2)).toMatchObject({ version: 2, body: 'two', current: true });
  });

  it('throws a store error when the read fails', async () => {
    const { db, promptId } = await seedHistory(['one']);
    db.failNext('XX000');
    await expect(readUserPromptVersion(db.client, promptId, 1)).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('restoreUserPromptVersion', () => {
  it('writes the old text as a new version and keeps the current title', async () => {
    const { db } = await seedHistory(['one', 'two', 'three']);
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { title: 'Newer title' });
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 3);
    expect(outcome.kind).toBe('restored');
    expect(db.versions.map((entry) => [entry.version, entry.body, entry.title])).toEqual([
      [1, 'one', 'Title'],
      [2, 'two', 'Title'],
      [3, 'three', 'Title'],
      [4, 'one', 'Newer title'],
    ]);
    expect(db.rows[0]).toMatchObject({ body: 'one', title: 'Newer title' });
  });

  it('answers not_found for an unknown slug and for another owner', async () => {
    const { db } = await seedHistory(['one', 'two']);
    expect((await restoreUserPromptVersion(db.client, ALICE, 'other', 1, 2)).kind).toBe('not_found');
    expect((await restoreUserPromptVersion(db.client, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mine', 1, 2)).kind).toBe('not_found');
    expect(db.versions).toHaveLength(2);
  });

  it('answers conflict when the expected current version is stale, without writing', async () => {
    const { db } = await seedHistory(['one', 'two', 'three']);
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 2);
    expect(outcome.kind).toBe('conflict');
    expect(db.versions).toHaveLength(3);
    expect(db.queries.some((entry) => entry.startsWith('update'))).toBe(false);
  });

  it('answers version_not_found for a version that does not exist, without writing', async () => {
    const { db } = await seedHistory(['one', 'two']);
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 7, 2);
    expect(outcome.kind).toBe('version_not_found');
    expect(db.queries.some((entry) => entry.startsWith('update'))).toBe(false);
  });

  it('answers unchanged without writing when the text already is the current one', async () => {
    const { db } = await seedHistory(['one', 'two']);
    const before = db.rows[0].updated_at;
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 2, 2);
    expect(outcome.kind).toBe('unchanged');
    expect(db.versions).toHaveLength(2);
    expect(db.rows[0].updated_at).toBe(before);
    expect(db.queries.some((entry) => entry.startsWith('update'))).toBe(false);
  });

  it('answers unchanged for an old version whose text equals the current text', async () => {
    const { db } = await seedHistory(['a', 'b', 'a']);
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 3);
    expect(outcome.kind).toBe('unchanged');
    expect(db.versions).toHaveLength(3);
    expect(db.queries.some((entry) => entry.startsWith('update'))).toBe(false);
  });

  it('re-checks updated_at inside the update and answers conflict after a concurrent write', async () => {
    const { db } = await seedHistory(['one', 'two']);
    db.beforeNextUpdate(() => {
      void db.client.from('user_prompts').update({ title: 'Edited elsewhere' }).eq('slug', 'mine').then(() => undefined);
    });
    const outcome = await restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 2);
    expect(outcome.kind).toBe('conflict');
    expect(db.versions).toHaveLength(2);
    expect(db.rows[0]).toMatchObject({ body: 'two', title: 'Edited elsewhere' });
    const update = db.queries.find((entry) => entry.startsWith('update eq id='));
    expect(update).toContain('eq updated_at=');
    expect(update).toContain('eq owner_id=');
  });

  it('turns a unique violation on the version insert into a store error, not a slug conflict', async () => {
    const { db } = await seedHistory(['one', 'two']);
    db.beforeNextUpdate(() => {
      db.failNext('23505');
    });
    const failure = await restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 2).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UserPromptStoreError);
    expect((failure as UserPromptStoreError).cause).toMatchObject({ code: '23505' });
  });

  it('throws a store error when the update fails', async () => {
    const { db } = await seedHistory(['one', 'two']);
    db.beforeNextUpdate(() => {
      db.failNext('XX000');
    });
    await expect(restoreUserPromptVersion(db.client, ALICE, 'mine', 1, 2)).rejects.toBeInstanceOf(UserPromptStoreError);
  });
});

describe('fake database mirrors the version trigger', () => {
  it('skips a version when the body equals the latest one', async () => {
    const { db } = await seedHistory(['one']);
    await updateOwnUserPrompt(db.client, ALICE, 'mine', { prompt: 'one', title: 'Other' });
    expect(db.versions).toHaveLength(1);
  });

  it('detaches versions from a deleted prompt like on delete set null', async () => {
    const { db } = await seedHistory(['one', 'two']);
    await db.client.from('user_prompts').delete().eq('slug', 'mine');
    expect(db.versions).toHaveLength(2);
    expect(db.versions.every((entry) => entry.prompt_id === null)).toBe(true);
    expect(db.versions.every((entry) => entry.slug === 'mine' && entry.owner_id === ALICE)).toBe(true);
  });
});
