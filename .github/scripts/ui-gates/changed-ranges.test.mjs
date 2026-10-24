//---------------
// changed-ranges tests — the diff→line-range extractor that scopes the
// web/mcp Stryker runs to the PR's changed lines (mutation.yml and the
// ui-coverage-gates Stryker step).
//---------------

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedMutateArgument,
  escapeBrackets,
  isTestishPath,
  mutateArgument,
  parseChangedRanges,
} from './changed-ranges.mjs';

const ADDITIONS_ONLY = `diff --git a/lib/voices.ts b/lib/voices.ts
index 1111111..2222222 100644
--- a/lib/voices.ts
+++ b/lib/voices.ts
@@ -10,0 +11,3 @@ export function voiceLabel() {
+export const a = 1;
+export const b = 2;
+export const c = 3;
`;

const MODIFICATION = `diff --git a/lib/voices.ts b/lib/voices.ts
index 1111111..2222222 100644
--- a/lib/voices.ts
+++ b/lib/voices.ts
@@ -4,1 +4,1 @@
-const x = 1;
+const x = 2;
`;

describe('parseChangedRanges', () => {
  it('extracts ranges for additions-only hunks', () => {
    const entries = parseChangedRanges(ADDITIONS_ONLY);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, 'lib/voices.ts');
    assert.equal(entries[0].wholeFile, false);
    assert.deepEqual(entries[0].ranges, [[11, 13]]);
  });

  it('extracts ranges for modifications', () => {
    const entries = parseChangedRanges(MODIFICATION);
    assert.deepEqual(entries[0].ranges, [[4, 4]]);
  });

  it('keeps distant changed lines as separate ranges', () => {
    const diff = `diff --git a/lib/voices.ts b/lib/voices.ts
index 1111111..2222222 100644
--- a/lib/voices.ts
+++ b/lib/voices.ts
@@ -10,0 +11,2 @@
+const a = 1;
+const b = 2;
@@ -40,0 +43,1 @@
+const c = 3;
@@ -90,0 +94,1 @@
+const d = 4;
`;
    const entries = parseChangedRanges(diff, { mergeGap: 3 });
    // 11-12, 43 and 94 are 30+ lines apart: never merged.
    assert.deepEqual(entries[0].ranges, [[11, 12], [43, 43], [94, 94]]);
  });

  it('merges changed lines within the gap', () => {
    const diff = `diff --git a/lib/voices.ts b/lib/voices.ts
index 1111111..2222222 100644
--- a/lib/voices.ts
+++ b/lib/voices.ts
@@ -10,0 +11,1 @@
+const a = 1;
@@ -13,0 +14,1 @@
+const b = 2;
`;
    // Line 14 is adjacent to 11: one merged range.
    const entries = parseChangedRanges(diff, { mergeGap: 3 });
    assert.deepEqual(entries[0].ranges, [[11, 14]]);
  });

  it('a new file mutates whole', () => {
    const diff = `diff --git a/lib/new.ts b/lib/new.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/lib/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries[0].wholeFile, true);
    assert.equal(entries[0].ranges, null);
  });

  it('a deleted file is ignored', () => {
    const diff = `diff --git a/lib/gone.ts b/lib/gone.ts
deleted file mode 100644
index 1111111..0000000
--- a/lib/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries.length, 0);
  });

  it('a pure rename with no content edits is ignored', () => {
    const diff = `diff --git a/lib/old.ts b/lib/new.ts
similarity index 100%
rename from lib/old.ts
rename to lib/new.ts
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries.length, 0);
  });

  it('a rename WITH content edits ranges the new path', () => {
    const diff = `diff --git a/lib/old.ts b/lib/new.ts
similarity index 80%
rename from lib/old.ts
rename to lib/new.ts
index 1111111..2222222
--- a/lib/old.ts
+++ b/lib/new.ts
@@ -4,1 +4,1 @@
-const x = 1;
+const x = 2;
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries[0].path, 'lib/new.ts');
    assert.deepEqual(entries[0].ranges, [[4, 4]]);
  });

  it('a binary file is ignored', () => {
    const diff = `diff --git a/assets/logo.ts b/assets/logo.ts
index 1111111..2222222 100644
Binary files a/assets/logo.ts and b/assets/logo.ts differ
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries.length, 0);
  });

  it('an unparseable hunk header falls back to whole file', () => {
    const diff = `diff --git a/lib/voices.ts b/lib/voices.ts
index 1111111..2222222 100644
--- a/lib/voices.ts
+++ b/lib/voices.ts
@@ ??? @@
+const a = 1;
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries[0].wholeFile, true);
  });

  it('test files are filtered out', () => {
    const diff = `diff --git a/components/ui/account-panel.tsx b/components/ui/account-panel.tsx
index 1111111..2222222 100644
--- a/components/ui/account-panel.tsx
+++ b/components/ui/account-panel.tsx
@@ -4,1 +4,1 @@
-const x = 1;
+const x = 2;
diff --git a/components/ui/__tests__/account-panel.test.tsx b/components/ui/__tests__/account-panel.test.tsx
index 1111111..2222222 100644
--- a/components/ui/__tests__/account-panel.test.tsx
+++ b/components/ui/__tests__/account-panel.test.tsx
@@ -4,1 +4,1 @@
-const x = 1;
+const x = 2;
`;
    const entries = parseChangedRanges(diff);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, 'components/ui/account-panel.tsx');
  });

  it('a file exploding past maxRanges mutates whole', () => {
    let hunks = '';
    for (let i = 0; i < 60; i += 1) {
      hunks += `\n@@ -${10 * i + 1},0 +${10 * i + 1},1 @@\n+const v${i} = 1;`;
    }
    const diff = `diff --git a/lib/big.ts b/lib/big.ts
index 1111111..2222222 100644
--- a/lib/big.ts
+++ b/lib/big.ts${hunks}
`;
    const entries = parseChangedRanges(diff, { maxRanges: 50 });
    assert.equal(entries[0].wholeFile, true);
  });
});

describe('mutateArgument', () => {
  it('renders one entry per range with the bracket escaping', () => {
    const patterns = mutateArgument([
      { path: 'app/[taskId]/page.tsx', wholeFile: false, ranges: [[4, 6], [10, 12]] },
      { path: 'lib/new.ts', wholeFile: true, ranges: null },
    ]);
    assert.equal(
      patterns,
      'app/[[]taskId[]]/page.tsx:4-6 app/[[]taskId[]]/page.tsx:10-12 lib/new.ts',
    );
  });

  it('strips the app prefix when asked', () => {
    const patterns = mutateArgument(
      [{ path: 'apps/web/lib/new.ts', wholeFile: false, ranges: [[2, 3]] }],
      { stripPrefix: 'apps/web/' },
    );
    assert.equal(patterns, 'lib/new.ts:2-3');
  });
});

describe('changedMutateArgument', () => {
  it('runs git with the scope and filters by app', () => {
    const calls = [];
    const runGit = (args) => {
      calls.push(args);
      return ADDITIONS_ONLY;
    };
    const result = changedMutateArgument('origin/main', 'HEAD', runGit, {
      appFilter: (path) => path.startsWith('apps/web/'),
      stripPrefix: 'apps/web/',
    });
    assert.equal(calls[0][0], 'diff');
    assert.ok(calls[0].includes('-U0'));
    assert.ok(calls[0].includes('origin/main...HEAD'));
    // lib/voices.ts does not start with apps/web/ — filtered out.
    assert.equal(result, '');
  });

  it('emits the app-relative mutate string', () => {
    const runGit = () => ADDITIONS_ONLY.replaceAll('lib/voices.ts', 'apps/web/lib/voices.ts');
    const result = changedMutateArgument('origin/main', 'HEAD', runGit, {
      appFilter: (path) => path.startsWith('apps/web/'),
      stripPrefix: 'apps/web/',
    });
    assert.equal(result, 'lib/voices.ts:11-13');
  });
});

describe('isTestishPath', () => {
  it('drops tests, cypress and d.ts', () => {
    assert.equal(isTestishPath('components/ui/__tests__/x.test.tsx'), true);
    assert.equal(isTestishPath('cypress/e2e/main-layout.cy.ts'), true);
    assert.equal(isTestishPath('lib/types.d.ts'), true);
    assert.equal(isTestishPath('lib/voices.ts'), false);
  });
});

describe('escapeBrackets', () => {
  it('escapes minimatch classes in one pass', () => {
    assert.equal(escapeBrackets('app/[taskId]/page.tsx'), 'app/[[]taskId[]]/page.tsx');
  });
});
