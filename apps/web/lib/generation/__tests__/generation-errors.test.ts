import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  categorizeGenerationError,
  GENERATION_ERROR_CODES,
  GENERATION_ERROR_KEY,
  isRetryableGenerationError,
} from '../generation-errors';
import { enDictionary } from '@/lib/i18n/en';
import { ptDictionary } from '@/lib/i18n/pt';

//---------------
// resolveEngineStatePath — locates the engine's state.py for the
// cross-app error-code contract below. The engine source lives outside
// the web app, and runners that sandbox the web app (Stryker runs the
// dry run from apps/web/.stryker-tmp) change process.cwd() — so walk up
// from the start directory until apps/engine/app/services/state.py is
// found instead of assuming a fixed relative layout.
//---------------
function resolveEngineStatePath(startDir: string): string {
  const relative = join('apps', 'engine', 'app', 'services', 'state.py');
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `engine state.py not found: walked up from ${startDir} looking for ${relative}`,
      );
    }
    dir = parent;
  }
}

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

describe('resolveEngineStatePath', () => {
  it('finds the engine state.py from the web app directory', () => {
    const resolved = resolveEngineStatePath(process.cwd());
    expect(resolved.endsWith(join('apps', 'engine', 'app', 'services', 'state.py'))).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });

  it('walks up past a sandbox-like nested directory (Stryker .stryker-tmp)', () => {
    const nested = join(process.cwd(), '.stryker-tmp', 'nested');
    const resolved = resolveEngineStatePath(nested);
    expect(resolved.endsWith(join('apps', 'engine', 'app', 'services', 'state.py'))).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });
});

describe('engine error-code contract', () => {
  it('covers every error_code the engine writes to video_generations', () => {
    // Cross-app contract: the engine writes error_code literals in
    // apps/engine/app/services/state.py; each must be a member of the
    // web union or the UI falls back to the generic errorUnknown copy.
    const engineState = readFileSync(resolveEngineStatePath(process.cwd()), 'utf8');
    const written = [
      ...engineState.matchAll(/"error_code":\s*"([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const code of written) {
      expect(GENERATION_ERROR_CODES).toContain(code);
    }
  });

  it('maps every code to a key present in both dictionaries', () => {
    for (const code of GENERATION_ERROR_CODES) {
      const key = GENERATION_ERROR_KEY[code];
      expect(key, `missing map entry for ${code}`).toBeDefined();
      const [section, subKey] = key.split('.');
      expect(section).toBe('posts');
      expect(
        (enDictionary as Record<string, Record<string, string>>)[section]?.[subKey],
        `missing en key ${key}`,
      ).toBeTruthy();
      expect(
        (ptDictionary as Record<string, Record<string, string>>)[section]?.[subKey],
        `missing pt key ${key}`,
      ).toBeTruthy();
    }
  });

  it('treats engine_restart as retryable (transient infra blip)', () => {
    // The engine writes the code directly (it never passes through the
    // text scanner), so codes round-trip through the categorizer.
    expect(categorizeGenerationError('engine_restart')).toBe('engine_restart');
    expect(isRetryableGenerationError('engine_restart')).toBe(true);
  });

  it('recognizes the engine orphan sentence (the refund-backstop seam)', () => {
    // Cross-app contract: the engine's _ORPHAN_ERROR_MESSAGE is what the
    // web's video-status poll re-categorizes when the refund backstop runs.
    // Without this rule the stored engine_restart code would be downgraded
    // to unknown (generic copy, not retryable).
    const engineState = readFileSync(
      join(process.cwd(), '..', 'engine', 'app', 'services', 'state.py'),
      'utf8',
    );
    const match = engineState.match(/^_ORPHAN_ERROR_MESSAGE\s*=\s*"([^"]+)"/m);
    expect(match, 'engine _ORPHAN_ERROR_MESSAGE not found').not.toBeNull();
    const message = match![1];
    expect(categorizeGenerationError(message)).toBe('engine_restart');
    expect(isRetryableGenerationError(message)).toBe(true);
  });
});
