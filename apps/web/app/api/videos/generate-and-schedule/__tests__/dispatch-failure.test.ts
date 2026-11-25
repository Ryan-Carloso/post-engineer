import { describe, expect, it } from 'vitest';

import { classifyDispatchFailure, isEngineRejection } from '../dispatch-failure';

describe('classifyDispatchFailure', () => {
  it('returns 400 ENGINE_REJECTED when every slot was rejected by the engine', () => {
    expect(classifyDispatchFailure([{ errorCode: 'engine_rejected' }, { errorCode: 'engine_rejected' }])).toEqual({
      status: 400,
      code: 'ENGINE_REJECTED',
    });
  });

  it('returns 502 ENGINE_UNAVAILABLE when every slot is a transient engine failure', () => {
    expect(classifyDispatchFailure([{ errorCode: 'engine_unavailable' }, { errorCode: 'no_task_id' }])).toEqual({
      status: 502,
      code: 'ENGINE_UNAVAILABLE',
    });
  });

  it('keeps 502 when a rejected slot is mixed with a transient engine failure', () => {
    expect(classifyDispatchFailure([{ errorCode: 'engine_rejected' }, { errorCode: 'engine_unavailable' }])).toEqual({
      status: 502,
      code: 'ENGINE_UNAVAILABLE',
    });
  });

  it('returns 500 INTERNAL_ERROR for a non-engine failure', () => {
    expect(classifyDispatchFailure([{ errorCode: 'bind_failed' }])).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('returns 500 INTERNAL_ERROR when there are no slot results', () => {
    expect(classifyDispatchFailure([])).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
  });
});

describe('isEngineRejection', () => {
  it('treats 4xx engine responses as rejections the client must fix', () => {
    expect(isEngineRejection(400)).toBe(true);
    expect(isEngineRejection(422)).toBe(true);
  });

  it('treats 5xx engine responses as transient', () => {
    expect(isEngineRejection(500)).toBe(false);
    expect(isEngineRejection(503)).toBe(false);
  });

  it('treats transient 4xx engine responses as retryable, not rejections', () => {
    expect(isEngineRejection(401)).toBe(false);
    expect(isEngineRejection(403)).toBe(false);
    expect(isEngineRejection(408)).toBe(false);
    expect(isEngineRejection(425)).toBe(false);
    expect(isEngineRejection(429)).toBe(false);
  });

  it('treats a missing status as transient', () => {
    expect(isEngineRejection(undefined)).toBe(false);
  });
});
