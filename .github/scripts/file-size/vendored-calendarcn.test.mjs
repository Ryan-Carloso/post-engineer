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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

//---------------
// The vendored CalendarCN list: the exact set the shadcn CLI copied from
// vmnog/calendarcn. The gates trust this list, so it must stay exact:
// every entry exists, and our own files in the same directories stay out.
//---------------
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
