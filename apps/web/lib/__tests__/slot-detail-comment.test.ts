import { describe, expect, it } from 'vitest';

import { narrowCommentWarnings, narrowSlotFields } from '@/lib/slot-detail';

describe('narrowCommentWarnings', () => {
  it('keeps well-formed warnings and drops the rest', () => {
    expect(
      narrowCommentWarnings([
        { provider: 'youtube', accountId: 'UC1', code: 'FIRST_COMMENT_RECONNECT_REQUIRED' },
        { provider: 'youtube', accountId: 'UC1', code: 'made_up' },
        { provider: 5, accountId: 'x', code: 'FIRST_COMMENT_FAILED' },
        { provider: 'x', accountId: 6, code: 'FIRST_COMMENT_FAILED' },
        null,
        'text',
      ]),
    ).toEqual([{ provider: 'youtube', accountId: 'UC1', code: 'FIRST_COMMENT_RECONNECT_REQUIRED' }]);
    expect(narrowCommentWarnings(undefined)).toEqual([]);
  });
});

describe('narrowSlotFields first comment', () => {
  it('reads the first comment and the warnings from the slot payload', () => {
    const fields = narrowSlotFields({
      firstComment: 'Link in bio',
      commentWarnings: [{ provider: 'threads', accountId: 't1', code: 'FIRST_COMMENT_FAILED' }],
    });
    expect(fields.firstComment).toBe('Link in bio');
    expect(fields.commentWarnings).toHaveLength(1);
  });

  it('defaults to no comment and no warnings', () => {
    const fields = narrowSlotFields({});
    expect(fields.firstComment).toBeNull();
    expect(fields.commentWarnings).toEqual([]);
  });
});
