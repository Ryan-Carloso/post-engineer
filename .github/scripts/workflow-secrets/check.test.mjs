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

describe('bare env values', () => {
  it('flags an env value that is a bare shell variable', () => {
    const text = 'on: push\njobs:\n  a:\n    steps:\n      - env:\n          INPUT_SCOPE: $INPUT_SCOPE\n          OK: ${{ inputs.x }}\n        run: echo\n';
    const found = violationsOf('w.yml', text, []);
    assert.equal(found.length, 1);
    assert.match(found[0].message, /bare shell variable/);
  });
  it('does not flag a shell assignment inside a run block', () => {
    assert.deepEqual(violationsOf('w.yml', 'on: push\njobs:\n  a:\n    steps:\n      - run: |\n          cat <<EOF\n          key: $VALUE\n          EOF\n', []), []);
  });
  it('fails when mutation.yml self-references INPUT_SCOPE again', () => {
    const file = '.github/workflows/mutation.yml';
    const text = readFileSync(join(root, file), 'utf8').replace('INPUT_SCOPE: ${{ inputs.scope }}', 'INPUT_SCOPE: $INPUT_SCOPE');
    assert.match(violationsOf(file, text, [])[0].message, /bare shell variable/);
  });
});

describe('bracket syntax', () => {
  it('reads secrets[...] as a secret reference', () => {
    const text = "on: pull_request\njobs:\n  a:\n    steps:\n      - env:\n          K: ${{ secrets['K'] }}\n        run: echo\n";
    assert.match(violationsOf('w.yml', text, [])[0].message, /reads secrets\.K/);
  });
  it('flags inputs[...] and github.event[...] inside run', () => {
    const one = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ${{ inputs[\'x\'] }}\n';
    const two = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ${{ github.event[\'pull_request\'].title }}\n';
    assert.equal(violationsOf('w.yml', one, []).length, 1);
    assert.equal(violationsOf('w.yml', two, []).length, 1);
  });
});

const targetWorkflow = ({ checkout = '          ref: refs/pull/${{ github.event.pull_request.number }}/merge\n          path: pr\n', run = '          python3 "$GITHUB_WORKSPACE/.github/scripts/x.py"\n' } = {}) => `name: x
on:
  pull_request_target:
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@abc
        with:
${checkout}      - name: go
        env:
          K: \${{ secrets.K }}
        run: |
${run}`;

describe('pull_request_target jobs', () => {
  it('pass when the PR is checked out as data and only base scripts run, with no environment', () => {
    assert.deepEqual(violationsOf('w.yml', targetWorkflow(), []), []);
  });
  it('flag a PR checkout at the workspace root', () => {
    const found = violationsOf('w.yml', targetWorkflow({ checkout: '          ref: ${{ github.event.pull_request.head.sha }}\n' }), []);
    assert.match(found[0].message, /checks out the PR at the workspace root/);
  });
  it('flag running a script from the PR directory', () => {
    assert.match(violationsOf('w.yml', targetWorkflow({ run: '          python3 pr/.github/scripts/x.py\n' }), [])[0].message, /runs python3 on a path from the checked-out PR/);
    assert.equal(violationsOf('w.yml', targetWorkflow({ run: '          node ./pr/x.mjs\n' }), []).length, 1);
  });
  it('flag a relative interpreter call after cd into the PR directory', () => {
    assert.equal(violationsOf('w.yml', targetWorkflow({ run: '          cd pr\n          python3 -c "print(1)"\n' }), []).length, 1);
    assert.equal(violationsOf('w.yml', targetWorkflow({ run: '          (cd pr && node scripts/x.mjs)\n' }), []).length, 1);
  });
  it('allow a base script by absolute path and other tools after cd into the PR directory', () => {
    const run = '          (cd pr && python3 "$GITHUB_WORKSPACE/.github/scripts/x.py" ../a.md)\n          (\n            cd pr\n            git diff HEAD^1 HEAD > ../pr.diff\n            opencode run --agent reviewer\n          )\n';
    assert.deepEqual(violationsOf('w.yml', targetWorkflow({ run }), []), []);
  });
  it('leave the PR directory on cd ..', () => {
    assert.deepEqual(violationsOf('w.yml', targetWorkflow({ run: '          cd pr\n          cd ..\n          python3 .github/scripts/x.py\n' }), []), []);
  });
  it('flag installing dependencies next to a PR checkout', () => {
    assert.match(violationsOf('w.yml', targetWorkflow({ run: '          pnpm install --frozen-lockfile\n' }), [])[0].message, /installs dependencies/);
  });
});

describe('the repository pull_request_target workflows', () => {
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const review = '.github/workflows/opencode-review.yml';
  it('opencode-review reads only the PR as data', () => {
    const text = read(review);
    assert.ok(text.includes('pull_request_target:'));
    assert.deepEqual(violationsOf(review, text, []), []);
  });
  it('opencode-review fails when the PR is checked out at the root', () => {
    const text = read(review).replace('          path: pr\n', '');
    assert.match(violationsOf(review, text, [])[0].message, /workspace root/);
  });
  it('opencode-review fails when a helper script runs from the PR directory again', () => {
    const text = read(review).replace('python3 .github/scripts/review-context.py', 'python3 pr/.github/scripts/review-context.py');
    assert.match(violationsOf(review, text, [])[0].message, /path from the checked-out PR/);
  });
  it('opencode-review fails when it goes back to a pull_request trigger', () => {
    const text = read(review).replace('pull_request_target:', 'pull_request:');
    assert.match(violationsOf(review, text, [])[0].message, /reads secrets\./);
  });
  it('api-naming fails when it goes back to a pull_request trigger', () => {
    const file = '.github/workflows/api-naming.yml';
    const text = read(file).replace('pull_request_target:', 'pull_request:');
    assert.match(violationsOf(file, text, [])[0].message, /reads secrets\./);
  });
  it('api-naming has no workflow_dispatch trigger', () => {
    assert.ok(!read('.github/workflows/api-naming.yml').includes('workflow_dispatch'));
  });
  it('deploy runs on push to main with no pull_request dependency', () => {
    const text = read('.github/workflows/deploy.yml');
    assert.ok(text.includes('  push:\n    branches: [main]'));
    assert.ok(!text.includes('github.event.pull_request'));
  });
  it('the reviewer agent does not tell the agent to read the checkout copies of the review prompts', () => {
    assert.ok(!read('.opencode/agent/reviewer.md').includes('First read'));
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
});
