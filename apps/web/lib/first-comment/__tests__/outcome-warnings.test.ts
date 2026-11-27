import { describe, expect, it } from 'vitest';

import { appendFirstComment, narrowFirstCommentWarnings } from '../form-field';
import { commentWarningsFromOutcomes } from '../outcome-warnings';

describe('commentWarningsFromOutcomes', () => {
  it('lists the warnings of published outcomes once each', () => {
    const outcomes = [
      { provider: 'youtube', accountId: 'yt-1', status: 'published', warnings: ['FIRST_COMMENT_RECONNECT_REQUIRED'] },
      { provider: 'youtube', accountId: 'yt-1', status: 'published', warnings: ['FIRST_COMMENT_RECONNECT_REQUIRED'] },
      { provider: 'telegram', accountId: 'c-1', status: 'published', warnings: ['FIRST_COMMENT_UNSUPPORTED_CHAT', 'nope'] },
    ];
    expect(commentWarningsFromOutcomes(outcomes)).toEqual([
      { provider: 'youtube', accountId: 'yt-1', code: 'FIRST_COMMENT_RECONNECT_REQUIRED' },
      { provider: 'telegram', accountId: 'c-1', code: 'FIRST_COMMENT_UNSUPPORTED_CHAT' },
    ]);
  });

  it('ignores outcomes that are not published or carry no list', () => {
    expect(
      commentWarningsFromOutcomes([
        { provider: 'youtube', accountId: 'a', status: 'failed', warnings: ['FIRST_COMMENT_FAILED'] },
        { provider: 'youtube', accountId: 'a', status: 'published', warnings: 'FIRST_COMMENT_FAILED' },
        { provider: 'youtube', accountId: 'a', status: 'published' },
        null,
        'x',
      ]),
    ).toEqual([]);
    expect(commentWarningsFromOutcomes(null)).toEqual([]);
  });
});

describe('form field helpers', () => {
  it('appends the comment only for a comment network and a non-empty text', () => {
    const youtube = new FormData();
    appendFirstComment(youtube, 'youtube', 'Hello');
    expect(youtube.get('firstComment')).toBe('Hello');

    const pinterest = new FormData();
    appendFirstComment(pinterest, 'pinterest', 'Hello');
    expect(pinterest.has('firstComment')).toBe(false);

    const empty = new FormData();
    appendFirstComment(empty, 'youtube', '');
    appendFirstComment(empty, 'youtube', null);
    appendFirstComment(empty, 'youtube', undefined);
    expect(empty.has('firstComment')).toBe(false);
  });

  it('keeps only known warning codes from a handler answer', () => {
    expect(narrowFirstCommentWarnings(['FIRST_COMMENT_FAILED', 'other', 4])).toEqual(['FIRST_COMMENT_FAILED']);
    expect(narrowFirstCommentWarnings('FIRST_COMMENT_FAILED')).toEqual([]);
  });
});
