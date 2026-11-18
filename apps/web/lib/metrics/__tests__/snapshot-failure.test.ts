import { describe, it, expect } from 'vitest';

import { classifySnapshotFailure, snapshotFailureDetails } from '../snapshot-failure';
import { InstagramApiError, FacebookError, ThreadsError } from '@/lib/errors';

describe('classifySnapshotFailure', () => {
  it('maps a dead Meta token (400 + providerCode 190) to token_dead', () => {
    const error = new InstagramApiError('Error validating access token', 400, undefined, 190);
    expect(classifySnapshotFailure(error)).toBe('token_dead');
  });

  it('maps HTTP 401 to token_dead for non-Meta errors', () => {
    expect(classifySnapshotFailure({ response: { status: 401 } })).toBe('token_dead');
    expect(classifySnapshotFailure(Object.assign(new Error('x'), { statusCode: 401 }))).toBe('token_dead');
  });

  it('maps a deleted media (400 + code 100 + subcode 33) to media_gone', () => {
    const error = new InstagramApiError(
      'Unsupported get request. Object with ID \'123\' does not exist',
      400,
      undefined,
      100,
      33,
    );
    expect(classifySnapshotFailure(error)).toBe('media_gone');
  });

  it('maps HTTP 404 to media_gone', () => {
    expect(classifySnapshotFailure(new InstagramApiError('not found', 404))).toBe('media_gone');
    expect(classifySnapshotFailure({ response: { status: 404 } })).toBe('media_gone');
  });

  it('keeps code 100 without subcode 33 transient (generic invalid parameter)', () => {
    expect(classifySnapshotFailure(new InstagramApiError('invalid param', 400, undefined, 100))).toBe('transient');
    expect(
      classifySnapshotFailure(new InstagramApiError('invalid param', 400, undefined, 100, 34)),
    ).toBe('transient');
  });

  it('maps 429, 5xx, and unknown errors to transient', () => {
    expect(classifySnapshotFailure(new InstagramApiError('rate limited', 429))).toBe('transient');
    expect(classifySnapshotFailure({ response: { status: 500 } })).toBe('transient');
    expect(classifySnapshotFailure(new Error('socket hang up'))).toBe('transient');
    expect(classifySnapshotFailure(null)).toBe('transient');
  });

  it('treats Facebook and Threads 100/33 as media_gone and 190 as token_dead', () => {
    expect(classifySnapshotFailure(new FacebookError('gone', 400, 100, 33))).toBe('media_gone');
    expect(classifySnapshotFailure(new ThreadsError('gone', 400, 100, 33))).toBe('media_gone');
    expect(classifySnapshotFailure(new FacebookError('dead token', 400, 190))).toBe('token_dead');
    expect(classifySnapshotFailure(new ThreadsError('dead token', 400, 190))).toBe('token_dead');
  });
});

describe('snapshotFailureDetails', () => {
  it('reads status and Meta code from a typed error', () => {
    expect(snapshotFailureDetails(new InstagramApiError('m', 400, undefined, 190))).toEqual({
      status: 400,
      metaCode: 190,
      metaSubcode: undefined,
    });
  });

  it('reads status from an axios-shaped error and leaves Meta codes undefined', () => {
    expect(snapshotFailureDetails({ response: { status: 500 } })).toEqual({
      status: 500,
      metaCode: undefined,
      metaSubcode: undefined,
    });
  });
});
