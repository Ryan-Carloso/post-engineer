// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const webRoot = join(findRepoRoot(import.meta.url), 'apps', 'web');
const css = readFileSync(join(webRoot, 'app', 'globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
}

function vars(body: string): string[] {
  return [...body.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]);
}

// Brand constants that intentionally keep one value in both themes.
const THEME_INVARIANT = new Set(['--harbor-blue', '--signal-coral', '--live-mint']);

describe('theme tokens', () => {
  const light = vars(block(':root'));
  const dark = new Set(vars(block('.dark')));

  it('defines every light token in the dark set unless it is a brand constant', () => {
    const missing = light.filter((name) => !dark.has(name) && !THEME_INVARIANT.has(name));
    expect(missing).toEqual([]);
  });

  it('does not define a dark token without a light counterpart', () => {
    const lightSet = new Set(light);
    expect([...dark].filter((name) => !lightSet.has(name))).toEqual([]);
  });

  it('maps every @theme color to a variable defined in :root', () => {
    const theme = block('@theme inline');
    const refs = [...theme.matchAll(/--color-[a-z-]+:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(20);
    const lightSet = new Set(light);
    expect(refs.filter((name) => !lightSet.has(name))).toEqual([]);
  });

  it('keeps no literal colors in @theme, borders or outlines', () => {
    expect(block('@theme inline')).not.toMatch(/--color-[a-z-]+:\s*#/);
    expect(css).not.toMatch(/border-color:\s*#/);
    expect(css).not.toMatch(/outline-color:\s*#/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

// Logos keep their brand colors in both themes.
const BRAND_FIXED = ['agent-logos.tsx', 'whatsapp-button.tsx', 'insufficient-tokens-dialog.tsx', 'checkout-cancel-dialog.tsx'];

describe('shared UI uses theme tokens only', () => {
  const files = sourceFiles(join(webRoot, 'components', 'ui')).filter(
    (f) => !BRAND_FIXED.some((name) => f.endsWith(name)),
  );

  it('scans the shared UI files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s has no fixed light-only colors', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/\bbg-white\b/);
    expect(source).not.toMatch(/\b(?:bg|text|border|ring|divide)-(?:neutral|slate|gray|zinc)-\d/);
    expect(source).not.toMatch(/\b(?:bg|text|border|ring|divide|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/);
  });
});

// Fills that invert in dark mode (bg-ink / bg-accent / bg-primary) need
// text-on-ink; a literal text-white would render light-on-light there.
const INVERTING_FILL = /(?<![\w:-])bg-(?:ink|accent|primary)(?![\w/-])/;
const LITERAL_WHITE_TEXT = /(?<![\w-])text-white(?![\w/-])/;

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : allSourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('inverting fills use text-on-ink', () => {
  const files = ['app', 'components', 'lib'].flatMap((dir) => allSourceFiles(join(webRoot, dir)));

  it('scans the app, components and lib sources', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no text-white on a bg-ink / bg-accent / bg-primary element', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => INVERTING_FILL.test(text) && LITERAL_WHITE_TEXT.test(text))
        .map(({ file: f, line }) => `${f.replace(webRoot, '')}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps no fixed hex hover on the destructive buttons', () => {
    const detail = readFileSync(join(webRoot, 'app', '(main)', 'posts', '[id]', 'page.tsx'), 'utf8');
    expect(detail.includes('hover:bg-[#')).toBe(false);
  });
});
