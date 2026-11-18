import { describe, expect, it } from 'vitest';
import {
  isCompletedVideoStatus,
  isFailedVideoStatus,
  isPendingVideoStatus,
} from '@/lib/engine-task-state';

const envelope = (body: Record<string, unknown>) => ({ status: 200, message: 'success', body });

describe('engine task status classification', () => {
  it('reads the numeric state first, inside the BaseResponse envelope', () => {
    expect(isFailedVideoStatus(envelope({ state: -1 }))).toBe(true);
    expect(isCompletedVideoStatus(envelope({ state: 1 }))).toBe(true);
    expect(isPendingVideoStatus(envelope({ state: 3 }))).toBe(true);
    expect(isPendingVideoStatus(envelope({ state: 4 }))).toBe(true);
  });

  it('lets the numeric state win over a contradicting string status', () => {
    const body = envelope({ state: 4, status: 'failed' });
    expect(isFailedVideoStatus(body)).toBe(false);
    expect(isPendingVideoStatus(body)).toBe(true);
  });

  it('falls back to the string status (case-insensitive) when no numeric state exists', () => {
    expect(isFailedVideoStatus(envelope({ status: 'FAILED' }))).toBe(true);
    expect(isFailedVideoStatus(envelope({ task_status: 'error' }))).toBe(true);
    expect(isCompletedVideoStatus(envelope({ status: 'done' }))).toBe(true);
    expect(isPendingVideoStatus(envelope({ task_status: 'Processing' }))).toBe(true);
  });

  it('classifies a non-terminal, non-pending string (publishing) as none of the three', () => {
    const body = envelope({ status: 'publishing' });
    expect(isFailedVideoStatus(body)).toBe(false);
    expect(isCompletedVideoStatus(body)).toBe(false);
    expect(isPendingVideoStatus(body)).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(isFailedVideoStatus(null)).toBe(false);
    expect(isCompletedVideoStatus('done')).toBe(false);
    expect(isPendingVideoStatus(undefined)).toBe(false);
  });
});
