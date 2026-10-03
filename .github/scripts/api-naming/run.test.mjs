import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const CONFIG = path.resolve(HERE, '..', '..', 'api-naming.yml');

const FAIL_DIFF = `diff --git a/apps/web/app/api/demo/route.ts b/apps/web/app/api/demo/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/demo/route.ts
+++ b/apps/web/app/api/demo/route.ts
@@ -10,6 +10,8 @@ export async function POST() {
   return NextResponse.json({
     schedule: { id: "abc" },
+    replay: true,
+    retryCount: 2,
     slots: [],
   });
 }
`;

const PASS_DIFF = `diff --git a/apps/web/app/api/demo/route.ts b/apps/web/app/api/demo/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/demo/route.ts
+++ b/apps/web/app/api/demo/route.ts
@@ -10,6 +10,8 @@ export async function POST() {
   return NextResponse.json({
     schedule: { id: "abc" },
+    retryCount: 2,
+    attemptCount: 1,
     slots: [],
   });
 }
`;

function runLint(diffText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-naming-it-'));
  const diffFile = path.join(dir, 'test.diff');
  const findingsOut = path.join(dir, 'findings.json');
  fs.writeFileSync(diffFile, diffText);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(
      'node',
      [RUN, '--diff-file', diffFile, '--config', CONFIG, '--findings-out', findingsOut, '--repo-root', dir],
      { encoding: 'utf8', env: { ...process.env, API_NAMING_LLM_API_KEY: '' } },
    );
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = err.stdout?.toString() ?? '';
    stderr = err.stderr?.toString() ?? '';
  }
  const payload = JSON.parse(fs.readFileSync(findingsOut, 'utf8'));
  return { stdout, stderr, exitCode, payload };
}

describe('run.mjs integration', () => {
  it('fails with an ::error annotation for a denylisted name (replay)', () => {
    const { stdout, exitCode, payload } = runLint(FAIL_DIFF);
    assert.equal(exitCode, 1);
    assert.match(stdout, /::error file=apps\/web\/app\/api\/demo\/route\.ts,line=\d+::/);
    assert.match(stdout, /Field "replay"/);
    const names = payload.findings.map((f) => f.name);
    assert.ok(names.includes('replay'));
    assert.ok(!names.includes('retryCount'), 'retryCount must pass');
    assert.equal(payload.findings.find((f) => f.name === 'replay').severity, 'error');
  });

  it('passes for clear names (retryCount, attemptCount)', () => {
    const { stdout, exitCode, payload } = runLint(PASS_DIFF);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('::error'), `unexpected error annotation:\n${stdout}`);
    assert.deepEqual(payload.findings, []);
    assert.equal(payload.candidateCount, 2);
  });

  it('skips the LLM layer gracefully without a key (warning, not failure)', () => {
    const { exitCode, payload } = runLint(PASS_DIFF);
    assert.equal(exitCode, 0);
    assert.ok(payload.warnings.some((w) => w.includes('API_NAMING_LLM_API_KEY')));
  });
});
