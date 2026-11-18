export const CYPRESS_UI_SCOPE = [
  'app/**/page.tsx',
  'app/**/layout.tsx',
  'app/providers.tsx',
  'components/**/*.tsx',
];

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
