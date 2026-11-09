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

  it('keeps the base border color inside @layer base so border-* utilities can override it', () => {
    // Unlayered author CSS beats layered utilities: a bare `* { border-color }`
    // would silently defeat every border-* utility (radio-group's
    // border-primary, the calendar's photo rings, ...). Inside @layer base
    // the default still applies, but utilities in @layer utilities win.
    expect(block('@layer base')).toContain('border-color: var(--border)');
    expect(css.match(/border-color:\s*var\(--border\)/g)).toHaveLength(1);
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

  it('keeps dark code panels on the always-dark bg-code token', () => {
    // border-white/10 is the divider of a permanently dark panel; such a
    // panel must use bg-code, which stays dark in both themes (bg-ink inverts).
    const offenders = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('border-white/10') && !source.includes('bg-code');
      })
      .map((file) => file.replace(webRoot, ''));
    expect(offenders).toEqual([]);
  });

  it('keeps no fixed hex hover on the destructive buttons', () => {
    const detail = readFileSync(join(webRoot, 'app', '(main)', 'posts', '[id]', 'page.tsx'), 'utf8');
    expect(detail.includes('hover:bg-[#')).toBe(false);
  });
});

// Pastel palette backgrounds and dark palette text are light-only: in dark mode
// they leave a light patch (or unreadable text). Status UI uses the
// success / info / warning / destructive tokens instead. Solid -500..-700
// fills (status dots, brand buttons) are deliberately allowed.
const LIGHT_ONLY_PALETTE =
  /(?<![\w-])(?:bg-(?:red|emerald|green|amber|blue|sky|violet|purple|pink)-(?:50|100)|text-(?:red|emerald|green|amber|blue|sky|violet|purple|pink)-(?:600|700|800|900|950)|border-(?:red|emerald|green|amber|blue|sky|violet|purple|pink)-(?:200|300))(?![\w-])/;

describe('status colors use tokens, not the light-only palette', () => {
  const files = ['app', 'components', 'lib'].flatMap((dir) => allSourceFiles(join(webRoot, dir)));

  it('has no pastel palette backgrounds, dark palette text or palette borders', () => {
    const offenders = files.filter((file) => LIGHT_ONLY_PALETTE.test(readFileSync(file, 'utf8'))).map((f) => f.replace(webRoot, ''));
    expect(offenders).toEqual([]);
  });

  it('keeps overlays on bg-scrim, never an inverting ink alpha', () => {
    const offenders = files.filter((file) => /(?<![\w-])bg-ink\/\d+/.test(readFileSync(file, 'utf8'))).map((f) => f.replace(webRoot, ''));
    expect(offenders).toEqual([]);
  });
});
