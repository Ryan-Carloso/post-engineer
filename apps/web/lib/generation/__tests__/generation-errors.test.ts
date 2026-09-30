import { describe, expect, it } from 'vitest';
import { categorizeGenerationError, isRetryableGenerationError } from '../generation-errors';

describe('categorizeGenerationError', () => {
  it('maps custom audio failures (including the new detailed reason)', () => {
    expect(categorizeGenerationError('custom audio file is invalid')).toBe('custom_audio_invalid');
    expect(
      categorizeGenerationError(
        'custom audio file is invalid: custom audio file does not exist or is not a file',
      ),
    ).toBe('custom_audio_invalid');
  });

  it('maps engine availability and rejection messages', () => {
    expect(categorizeGenerationError('Video service is unavailable.')).toBe('engine_unavailable');
    expect(categorizeGenerationError('Video service rejected the job.')).toBe('engine_rejected');
  });

  it('maps task plumbing failures', () => {
    expect(categorizeGenerationError('Video service returned no task ID.')).toBe('no_task_id');
    expect(categorizeGenerationError('Engine returned an invalid task response.')).toBe(
      'invalid_task_response',
    );
  });

  it('falls back to unknown for empty or unrecognized text', () => {
    expect(categorizeGenerationError(null)).toBe('unknown');
    expect(categorizeGenerationError(undefined)).toBe('unknown');
    expect(categorizeGenerationError('')).toBe('unknown');
    expect(categorizeGenerationError('something completely unexpected')).toBe('unknown');
  });

  it('matches case-insensitively', () => {
    expect(categorizeGenerationError('CUSTOM AUDIO FILE IS INVALID')).toBe('custom_audio_invalid');
  });
});

describe('isRetryableGenerationError', () => {
  it('treats transient categories as retryable', () => {
    expect(isRetryableGenerationError('Video service is unavailable.')).toBe(true);
    expect(isRetryableGenerationError('Engine returned an invalid task response.')).toBe(true);
  });

  it('treats validation/rejection/plumbing failures as not retryable', () => {
    expect(isRetryableGenerationError('custom audio file is invalid')).toBe(false);
    expect(isRetryableGenerationError('Video service rejected the job.')).toBe(false);
    expect(isRetryableGenerationError('Video service returned no task ID.')).toBe(false);
  });

  it('scans unknown errors for transient keywords', () => {
    expect(isRetryableGenerationError('Rate limit exceeded, retry later')).toBe(true);
    expect(isRetryableGenerationError('network timeout while uploading')).toBe(true);
    expect(isRetryableGenerationError('something completely unexpected')).toBe(false);
  });

  it('fails closed on empty input', () => {
    expect(isRetryableGenerationError(null)).toBe(false);
    expect(isRetryableGenerationError(undefined)).toBe(false);
    expect(isRetryableGenerationError('')).toBe(false);
  });
});
