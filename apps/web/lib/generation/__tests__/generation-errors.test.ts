import { describe, expect, it } from 'vitest';
import { categorizeGenerationError } from '../generation-errors';

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
