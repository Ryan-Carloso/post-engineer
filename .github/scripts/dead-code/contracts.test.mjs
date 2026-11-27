import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { describeFinding, exportedNames, findDeadContractExports, fixContractText, run } from './contracts.mjs';

const CONTRACT = 'shared/contracts/things.ts';

describe('exportedNames', () => {
  it('lists exported consts, functions, types and interfaces, not locals or re-exports', () => {
    const text = [
      "export * from './other.js';",
      "export { a } from './a.js';",
      'export const ONE = 1, TWO = 2;',
      'export function make() {}',
      'export type Kind = string;',
      'export interface Shape { x: number }',
      'const hidden = 3;',
    ].join('\n');
    assert.deepEqual(exportedNames(CONTRACT, text), ['ONE', 'TWO', 'make', 'Kind', 'Shape']);
  });
});

describe('findDeadContractExports', () => {
  it('passes an export another app file imports', () => {
    const files = {
      [CONTRACT]: 'export const LIMIT = 5;\n',
      'apps/web/lib/x.ts': "import { LIMIT } from '@/lib/contracts/things';\nLIMIT;\n",
    };
    assert.deepEqual(findDeadContractExports(files), []);
  });

  it('passes an export another contract uses', () => {
    const files = {
      [CONTRACT]: 'export const LIMIT = 5;\n',
      'shared/contracts/other.ts': "import { LIMIT } from './things.js';\nexport const DOUBLE = LIMIT * 2;\n",
      'apps/mcp/src/y.ts': 'DOUBLE;\n',
    };
    assert.deepEqual(findDeadContractExports(files), []);
  });

  it('flags an export nobody uses as unused', () => {
    const files = { [CONTRACT]: 'export const LIMIT = 5;\n', 'apps/web/lib/x.ts': 'const other = 1;\n' };
    assert.deepEqual(findDeadContractExports(files), [{ file: CONTRACT, name: 'LIMIT', kind: 'unused' }]);
  });

  it('flags an export used only inside its own file as a needless export', () => {
    const files = { [CONTRACT]: 'export const LIMIT = 5;\nexport const SchemaLimit = LIMIT;\n', 'apps/web/lib/x.ts': 'SchemaLimit;\n' };
    assert.deepEqual(findDeadContractExports(files), [{ file: CONTRACT, name: 'LIMIT', kind: 'needless-export' }]);
  });

  it('does not count a self-reference inside the declaration as a use', () => {
    const files = { [CONTRACT]: 'export type Tree = { children: Tree[] };\n' };
    assert.deepEqual(findDeadContractExports(files), [{ file: CONTRACT, name: 'Tree', kind: 'unused' }]);
  });

  it('keeps a provider subset exported in the providers home, which the provider-lists lint reads', () => {
    const home = 'shared/contracts/providers.ts';
    const files = { [home]: "export const SUBSET = ['a', 'b'] as const;\nexport function inSubset(x: string) { return SUBSET.includes(x); }\n", 'apps/web/z.ts': 'inSubset;\n' };
    assert.deepEqual(findDeadContractExports(files), []);
  });
});

describe('fixContractText', () => {
  it('deletes an unused export and drops the export keyword from a needless one', () => {
    const text = 'export const LIMIT = 5;\n\nexport const DEAD = 1;\n\nexport const Schema = LIMIT;\n';
    const findings = [
      { file: CONTRACT, name: 'LIMIT', kind: 'needless-export' },
      { file: CONTRACT, name: 'DEAD', kind: 'unused' },
    ];
    assert.equal(fixContractText(CONTRACT, text, findings), 'const LIMIT = 5;\n\nexport const Schema = LIMIT;\n');
  });
});

describe('describeFinding', () => {
  it('names the file, the export and the fix', () => {
    assert.match(describeFinding({ file: CONTRACT, name: 'X', kind: 'unused' }), /things\.ts: X .*delete it/);
    assert.match(describeFinding({ file: CONTRACT, name: 'X', kind: 'needless-export' }), /drop the export/);
  });
});

describe('the repository', () => {
  it('has no dead shared contract export', () => {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    assert.deepEqual(run(root).map(describeFinding), []);
  });
});
