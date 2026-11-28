import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findRepoRoot } from '@/test/repo-root';
import {
  FIRST_COMMENT_FIELD,
  FIRST_COMMENT_MAX_LENGTH,
  FIRST_COMMENT_WARNING_CODES,
  checkFirstComment,
} from '@/lib/contracts/first-comment';
import { COMMENT_PROVIDERS, SOCIAL_PROVIDERS, isCommentProvider } from '@/lib/contracts/providers';
import { FIRST_COMMENT_MAX } from '@/lib/first-comment/limits';
import { appendFirstComment } from '@/lib/first-comment/form-field';
import { THREADS_SCOPES } from '@/lib/threads';
import { FACEBOOK_SCOPES } from '@/lib/facebook';
import { GOOGLE_OAUTH_SCOPES } from '@/lib/youtube';

const root = findRepoRoot(import.meta.url);

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('first comment storage limit', () => {
  it('pins the migration check to FIRST_COMMENT_MAX_LENGTH', () => {
    const migration = read('supabase/migrations/093_scheduled-posts-first-comment.sql');
    const match = /char_length\(first_comment\) between 1 and (\d+)/.exec(migration);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(FIRST_COMMENT_MAX_LENGTH);
    expect(migration).toContain('add column if not exists first_comment text');
    expect(migration).toContain('pg_constraint');
  });

  it('pins the schema snapshot to the same limit and a nullable column', () => {
    const snapshot = JSON.parse(read('supabase/schema.snapshot.json')) as {
      tables: Record<string, { columns: Array<{ name: string; type: string; notNull: boolean }>; constraints: Record<string, string> }>;
    };
    const table = snapshot.tables.scheduled_posts;
    expect(table.columns.find((column) => column.name === 'first_comment')).toEqual(
      expect.objectContaining({ type: 'text', notNull: false }),
    );
    const check = table.constraints.scheduled_posts_first_comment_length_check;
    expect(check).toContain(`char_length(first_comment) <= ${FIRST_COMMENT_MAX_LENGTH}`);
    expect(check).toContain('char_length(first_comment) >= 1');
  });

  it('is listed in the migration README', () => {
    expect(read('supabase/README.md')).toContain('093_scheduled-posts-first-comment.sql');
  });
});

describe('checkFirstComment', () => {
  it('accepts the limit and refuses one character more', () => {
    expect(checkFirstComment('x'.repeat(FIRST_COMMENT_MAX_LENGTH))).toEqual({ ok: true, value: 'x'.repeat(FIRST_COMMENT_MAX_LENGTH) });
    expect(checkFirstComment('x'.repeat(FIRST_COMMENT_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('measures the trimmed text', () => {
    expect(checkFirstComment(` ${'x'.repeat(FIRST_COMMENT_MAX_LENGTH)} `).ok).toBe(true);
  });

  it.each([undefined, null, '', '  \n '])('reads %j as no comment', (value) => {
    expect(checkFirstComment(value)).toEqual({ ok: true, value: null });
  });

  it.each([5, true, {}, []])('refuses %j, which is not text', (value) => {
    expect(checkFirstComment(value).ok).toBe(false);
  });
});

describe('comment networks', () => {
  it('is a strict subset of the social providers', () => {
    expect(COMMENT_PROVIDERS.length).toBeLessThan(SOCIAL_PROVIDERS.length);
    for (const provider of COMMENT_PROVIDERS) expect(SOCIAL_PROVIDERS).toContain(provider);
  });

  it.each(['pinterest', 'rumble', 'fanvue', '3speak'])('leaves %s out, it has no comment API on this path', (provider) => {
    expect(isCommentProvider(provider)).toBe(false);
  });

  it('keeps a network limit for every comment network and none above the shared limit by accident', () => {
    expect(Object.keys(FIRST_COMMENT_MAX).sort()).toEqual([...COMMENT_PROVIDERS].sort());
    for (const limit of Object.values(FIRST_COMMENT_MAX)) expect(limit).toBeGreaterThan(0);
  });

  it('names a stable warning code per outcome', () => {
    expect(FIRST_COMMENT_WARNING_CODES).toEqual([
      'FIRST_COMMENT_FAILED',
      'FIRST_COMMENT_RECONNECT_REQUIRED',
      'FIRST_COMMENT_UNSUPPORTED_CHAT',
      'FIRST_COMMENT_TOO_LONG',
    ]);
  });
});

describe('the wire field the publisher sends', () => {
  it('carries the text under FIRST_COMMENT_FIELD for a commenting provider', () => {
    const form = new FormData();
    appendFirstComment(form, 'youtube', 'hello');
    expect(form.get(FIRST_COMMENT_FIELD)).toBe('hello');
  });
});

describe('scopes the comment calls need', () => {
  it('requests YouTube force-ssl, Facebook pages_manage_engagement and Threads threads_manage_replies', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain('https://www.googleapis.com/auth/youtube.force-ssl');
    expect(FACEBOOK_SCOPES).toContain('pages_manage_engagement');
    expect(THREADS_SCOPES).toContain('threads_manage_replies');
  });
});
