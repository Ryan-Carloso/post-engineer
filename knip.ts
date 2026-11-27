import type { KnipConfig } from 'knip';
import { VENDORED_CALENDARCN_FILES } from './.github/scripts/file-size/vendored-calendarcn.mjs';

const EXPORT_ISSUES = ['exports', 'types', 'duplicates'];

const untouchableExports = [
  ...VENDORED_CALENDARCN_FILES,
  '**/*.gen.ts',
  'apps/mcp/src/__tests__/parity/**',
  '.github/scripts/parity-exclusions/**',
];

const ignoreIssues = Object.fromEntries(untouchableExports.map((pattern) => [pattern, EXPORT_ISSUES]));

const config: KnipConfig = {
  ignoreIssues,
  ignoreBinaries: ['uv', 'psql', 'mkfifo', 'vitest', 'cypress', 'next', 'stryker', 'dev'],
  workspaces: {
    '.': {
      entry: [
        '.github/scripts/**/*.test.mjs',
        '.github/scripts/frontend-ci/record-timings.mjs',
        'scripts/*.mjs',
        'scripts/db/*.mjs',
      ],
      project: ['.github/scripts/**/*.{mjs,ts}', 'scripts/**/*.mjs'],
    },
    'apps/web': {
      entry: ['scripts/*.{mjs,js}', 'cypress/e2e/**/*.cy.ts'],
      project: ['**/*.{ts,tsx,mjs,js,cjs,css}'],
      ignoreDependencies: ['eslint-config-next'],
    },
    'apps/mcp': {
      entry: ['scripts/*.mjs'],
      project: ['src/**/*.ts', 'scripts/**/*.mjs'],
    },
  },
};

export default config;
