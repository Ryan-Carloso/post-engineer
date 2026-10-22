//---------------
// Clone-name length parity — the web form and the engine must agree on
// MAX_CLONE_NAME_LENGTH, or the form silently accepts names the
// engine 400s (or truncates names the engine would accept). The two
// constants live in different languages, so this test parses the
// engine's constants.py and pins it against the web constant (the
// SQL-literals sync-test precedent).
//
// @vitest-environment node
//---------------
/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { MAX_CLONE_NAME_LENGTH } from '@/lib/cloned-voice-audio';

describe('clone name length parity (web vs engine)', () => {
  it('matches the engine MAX_CLONE_NAME_LENGTH', () => {
    const engineConstants = readFileSync(
      join(
        findRepoRoot(import.meta.url),
        'apps/engine/app/services/cloned_voices/constants.py',
      ),
      'utf8',
    );
    const match = engineConstants.match(/^MAX_CLONE_NAME_LENGTH = (\d+)$/m);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(MAX_CLONE_NAME_LENGTH);
  });
});
