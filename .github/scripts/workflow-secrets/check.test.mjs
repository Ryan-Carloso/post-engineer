import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkFiles, run } from './check.mjs';
import { parseWorkflow, staleEntries, violationsOf } from './parse.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const workflow = ({ on = 'pull_request:', environment = '', step = '' } = {}) => `name: x
on:
  ${on}
jobs:
  deploy:
    runs-on: ubuntu-latest
${environment}    steps:
      - name: go
        env:
          TOKEN: \${{ secrets.TOKEN }}
        run: |
          echo hi
${step}`;

describe('parseWorkflow', () => {
  it('reads block, inline and list triggers', () => {
    assert.deepEqual([...parseWorkflow('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n').triggers], ['push', 'workflow_dispatch']);
    assert.deepEqual([...parseWorkflow('on: [push, pull_request]\njobs:\n').triggers], ['push', 'pull_request']);
    assert.deepEqual([...parseWorkflow('on:\n  - push\njobs:\n').triggers], ['push']);
  });
  it('finds job ids, environments, secrets and run lines', () => {
    const [job] = parseWorkflow(workflow({ environment: '    environment: production\n' })).jobs;
    assert.equal(job.id, 'deploy');
    assert.equal(job.environment, true);
    assert.deepEqual(job.secrets.map((secret) => secret.name), ['TOKEN']);
    assert.deepEqual(job.runs.map((entry) => entry.text.trim()), ['echo hi', '']);
  });
  it('ignores GITHUB_TOKEN and commented secrets', () => {
    const [job] = parseWorkflow('on: push\njobs:\n  a:\n    steps:\n      # secrets.X\n      - run: echo ${{ secrets.GITHUB_TOKEN }}\n').jobs;
    assert.deepEqual(job.secrets, []);
  });
});

describe('violationsOf', () => {
  it('flags a job that reads secrets under pull_request with no environment', () => {
    const found = violationsOf('w.yml', workflow(), []);
    assert.equal(found.length, 1);
    assert.match(found[0].message, /job deploy reads secrets\.TOKEN under pull_request with no environment/);
  });
  it('flags workflow_dispatch too', () => {
    assert.equal(violationsOf('w.yml', workflow({ on: 'workflow_dispatch:' }), []).length, 1);
  });
  it('passes a job with an environment', () => {
    assert.deepEqual(violationsOf('w.yml', workflow({ environment: '    environment: production\n' }), []), []);
  });
  it('passes a job on an allowlist entry', () => {
    assert.deepEqual(violationsOf('w.yml', workflow(), [{ workflow: 'w.yml', job: 'deploy', reason: 'r' }]), []);
  });
  it('passes secrets under a push-only trigger', () => {
    assert.deepEqual(violationsOf('w.yml', workflow({ on: 'push:' }), []), []);
  });
  it('flags workflow-level env secrets under a risky trigger', () => {
    const text = 'on: pull_request\nenv:\n  K: ${{ secrets.K }}\njobs:\n  a:\n    environment: p\n    steps:\n      - run: echo\n';
    assert.match(violationsOf('w.yml', text, [])[0].message, /workflow-level env reads secrets\.K/);
  });
  it('flags inputs and github.event expressions inside a run block', () => {
    const block = violationsOf('w.yml', workflow({ on: 'push:', step: '          echo "${{ inputs.base }}"\n' }), []);
    assert.match(block[0].message, /inputs\.\* or github\.event\.\*/);
    const inline = violationsOf('w.yml', 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ${{ github.event.pull_request.title }}\n', []);
    assert.equal(inline.length, 1);
  });
  it('allows github.event_name and env-passed values inside run', () => {
    const text = 'on: push\njobs:\n  a:\n    steps:\n      - env:\n          B: ${{ inputs.base }}\n        run: |\n          [ "${{ github.event_name }}" = push ] && echo "$B"\n';
    assert.deepEqual(violationsOf('w.yml', text, []), []);
  });
});

describe('checkFiles', () => {
  it('rejects an allowlist entry without a reason', () => {
    const found = checkFiles(new Map([['w.yml', workflow()]]), [{ workflow: 'w.yml', job: 'deploy', reason: ' ' }]);
    assert.match(found[0].message, /has no reason/);
  });
  it('rejects a stale allowlist entry', () => {
    const files = new Map([['w.yml', workflow({ environment: '    environment: production\n' })]]);
    assert.match(checkFiles(files, [{ workflow: 'w.yml', job: 'deploy', reason: 'r' }])[0].message, /no longer matches/);
    assert.equal(staleEntries(new Map(), [{ workflow: 'gone.yml', job: 'a', reason: 'r' }]).length, 1);
  });
});

describe('the repository workflows', () => {
  it('are clean', () => {
    assert.deepEqual(run(root), []);
  });
  it('fail when the deploy environment is removed', () => {
    const file = '.github/workflows/deploy.yml';
    const text = readFileSync(join(root, file), 'utf8').replace('    environment: production\n', '');
    assert.notEqual(text, readFileSync(join(root, file), 'utf8'));
    assert.match(violationsOf(file, text, [])[0].message, /job migrate reads secrets\.SUPABASE_ACCESS_TOKEN/);
  });
  it('fail when the faceless flight loses its environment', () => {
    const file = '.github/workflows/test-flight-faceless.yml';
    const text = readFileSync(join(root, file), 'utf8').replace('    environment: test-flight\n', '');
    assert.equal(violationsOf(file, text, []).length, 1);
  });
  it('fail when api-naming interpolates its inputs into the shell again', () => {
    const file = '.github/workflows/api-naming.yml';
    const text = readFileSync(join(root, file), 'utf8').replace('base="$INPUT_BASE"', 'base="${{ inputs.base }}"');
    assert.match(violationsOf(file, text, JSON.parse(readFileSync(join(root, '.github/scripts/workflow-secrets/allowlist.json'), 'utf8')))[0].message, /interpolates/);
  });
  it('run the review scripts from the base checkout', () => {
    const text = readFileSync(join(root, '.github/workflows/opencode-review.yml'), 'utf8');
    assert.ok(text.includes('python3 .base/.github/scripts/select-review-models.py'));
    assert.ok(text.includes('cp .base/.opencode/agent/reviewer.md'));
    assert.ok(text.includes('python3 .base/.github/scripts/verify-review-grounding.py'));
    assert.ok(!text.includes('cp .opencode/agent/reviewer.md'));
  });
});
