import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VENDORED_UIDIFF_COMMIT,
  VENDORED_UIDIFF_FILES,
  isVendoredUiDiff,
} from './vendored-uidiff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

describe('vendored ui-diff list', () => {
  it('pins the upstream commit', () => {
    assert.equal(VENDORED_UIDIFF_COMMIT, '3075b4c8');
  });

  it('lists only .ts/.mjs source files', () => {
    for (const p of VENDORED_UIDIFF_FILES) {
      assert.match(p, /\.(mjs|tsx?)$/);
    }
  });

  it('is sorted with no duplicates', () => {
    const list = [...VENDORED_UIDIFF_FILES];
    assert.deepEqual(list, [...list].sort());
  });

  it('every listed file exists in the repo', () => {
    for (const p of VENDORED_UIDIFF_FILES) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, p)), `missing: ${p}`);
    }
  });

  it('matches vendored files and rejects our own files', () => {
    assert.equal(isVendoredUiDiff('.opencode/skills/ui-diff/src/pipeline.ts'), true);
    assert.equal(isVendoredUiDiff('.opencode/skills/ui-diff/src/cli.ts'), true);
    assert.equal(isVendoredUiDiff('.opencode/skills/ui-diff/bin/ui-diff.mjs'), true);
    assert.equal(isVendoredUiDiff('.opencode/skills/preview-ui/SKILL.md'), false);
    assert.equal(isVendoredUiDiff('apps/web/lib/api.ts'), false);
    assert.equal(isVendoredUiDiff('.github/scripts/file-size/vendored-uidiff.mjs'), false);
  });
});
