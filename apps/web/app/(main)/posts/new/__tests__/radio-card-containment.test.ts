import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// Each new-post option card is a Label wrapping an `sr-only` RadioGroupItem.
// `sr-only` is `position: absolute`; without a positioned card the input
// escapes the scrolling <main>, makes the document taller than the screen,
// and focusing it (a click on "No face") scrolls the whole window, leaving a
// blank strip on mobile. Every card must therefore be `relative`.
//---------------
const FILES = ['page.tsx', 'face-field.tsx'];

const countOf = (source: string, needle: string): number => source.split(needle).length - 1;

describe('new-post radio cards', () => {
  const dir = join(findRepoRoot(import.meta.url), 'apps/web/app/(main)/posts/new');

  it.each(FILES)('%s positions every card that holds an sr-only radio', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    const radios = countOf(source, '<RadioGroupItem');
    const srOnlyRadios = countOf(source, 'className="sr-only"');

    expect(radios).toBeGreaterThan(0);
    expect(srOnlyRadios).toBe(radios);
    expect(countOf(source, "'relative flex cursor-pointer")).toBe(radios);
  });
});
