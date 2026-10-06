import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALUATE = fileURLToPath(new URL('./evaluate.mjs', import.meta.url));

describe('evaluate.mjs CLI', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-gates-eval-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function run(args) {
    try {
      execFileSync('node', [EVALUATE, ...args], { encoding: 'utf8' });
      return 0;
    } catch (err) {
      return err.status;
    }
  }

  it('creates a missing output directory and exits 0 when no UI files changed', () => {
    // Regression: the gate job failed with ENOENT because the artifact
    // download step (which created /tmp/ui-gates) was skipped.
    const out = path.join(tmp, 'nested', 'dir', 'findings.json');
    const code = run(['--ui-files', '', '--out', out]);
    assert.equal(code, 0);
    const findings = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(findings.pass, true);
    assert.equal(findings.vitest.status, 'na');
  });

  it('fails closed (exit 1) when UI files changed but reports are missing', () => {
    const out = path.join(tmp, 'findings.json');
    const code = run([
      '--ui-files',
      'apps/web/app/page.tsx',
      '--cobertura',
      path.join(tmp, 'nope.xml'),
      '--lcov',
      path.join(tmp, 'nope.info'),
      '--mutation',
      path.join(tmp, 'nope.json'),
      '--out',
      out,
    ]);
    assert.equal(code, 1);
    const findings = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(findings.pass, false);
    assert.equal(findings.vitest.status, 'missing');
  });
});
