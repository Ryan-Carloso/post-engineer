import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VENDORED_CALENDARCN_COMMIT,
  VENDORED_CALENDARCN_FILES,
  isVendoredCalendarCN,
} from './vendored-calendarcn.mjs';
import { VENDORED_UIDIFF_FILES } from './vendored-uidiff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

describe('vendored CalendarCN list', () => {
  it('pins the upstream commit', () => {
    assert.equal(VENDORED_CALENDARCN_COMMIT, '6e15924d');
  });

  it('lists only .ts/.tsx source files', () => {
    for (const p of VENDORED_CALENDARCN_FILES) {
      assert.match(p, /\.tsx?$/);
    }
  });

  it('is sorted with no duplicates', () => {
    const list = [...VENDORED_CALENDARCN_FILES];
    assert.deepEqual(list, [...list].sort());
  });

  it('every listed file exists in the repo', () => {
    for (const p of VENDORED_CALENDARCN_FILES) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, p)), `missing: ${p}`);
    }
  });

  it('matches vendored files and rejects our own files', () => {
    assert.equal(isVendoredCalendarCN('apps/web/components/calendar-provider.tsx'), true);
    assert.equal(isVendoredCalendarCN('apps/web/lib/event-utils.ts'), true);
    assert.equal(isVendoredCalendarCN('apps/web/hooks/use-calendar-shortcuts.ts'), true);
    assert.equal(isVendoredCalendarCN('apps/web/app/(main)/posts/calendar-provider.tsx'), false);
    assert.equal(isVendoredCalendarCN('apps/web/app/(main)/posts/calendar-adapter.ts'), false);
    assert.equal(isVendoredCalendarCN('apps/web/lib/i18n/posts-calendar-i18n.ts'), false);
    assert.equal(isVendoredCalendarCN('apps/web/components/ui/button.tsx'), false);
  });
});

describe('codecov ignore list', () => {
  it('matches the vendored lists exactly', () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, 'codecov.yml'), 'utf8');
    const lines = yml.split('\n');
    const coverageIdx = lines.findIndex((l) => l === 'coverage:');
    assert.ok(coverageIdx >= 0, 'codecov.yml has no coverage: section');
    const ignoreIdx = lines.findIndex((l, i) => i > coverageIdx && l === '  ignore:');
    assert.ok(ignoreIdx >= 0, 'codecov.yml coverage has no ignore list');
    const ignored = new Set();
    for (let i = ignoreIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^    - "([^"]+)"$/);
      if (!m) break;
      ignored.add(m[1]);
    }
    const expected = new Set([...VENDORED_CALENDARCN_FILES, ...VENDORED_UIDIFF_FILES]);
    assert.deepEqual([...ignored].sort(), [...expected].sort());
  });
});
