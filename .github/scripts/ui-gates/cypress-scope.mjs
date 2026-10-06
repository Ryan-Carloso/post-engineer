//---------------
// Cypress coverage scope.
//
// The cypress-coverage job only reports coverage for files matching the
// `codeCoverage.include` list in apps/web/cypress.config.ts. Only the
// UI-relevant entries are listed here (app/** and components/**); a
// changed UI file outside this scope is EXEMPT from the cypress gate.
// Paths are relative to apps/web.
//
// CYPRESS_UI_SCOPE must stay in sync with cypress.config.ts — the drift
// test in cypress-scope.test.mjs fails the suite when they diverge.
//---------------

export const CYPRESS_UI_SCOPE = [
  'app/**/page.tsx',
  'app/**/layout.tsx',
  'app/providers.tsx',
  'components/**/*.tsx',
];

//---------------
// matchesGlob — minimal glob matcher supporting **, *, ? and {a,b}.
// **/ matches zero or more directories; * never crosses /.
//---------------
export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path);
}

export function inCypressScope(webRelativePath) {
  return CYPRESS_UI_SCOPE.some((glob) => matchesGlob(webRelativePath, glob));
}

function globToRegExp(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**/' consumes zero or more whole directories.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        re += escapeRegExp(c);
        i += 1;
      } else {
        const options = glob.slice(i + 1, close).split(',').map(escapeRegExp).join('|');
        re += `(?:${options})`;
        i = close + 1;
      }
    } else {
      re += escapeRegExp(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRegExp(c) {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
