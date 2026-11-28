import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOC_PAGES } from '../registry';

describe('lib/docs/freshness — stored fingerprints match the content', () => {
  it('stores a contentHash equal to sha256 of the page blocks', () => {
    for (const page of DOC_PAGES) {
      const hash = createHash('sha256').update(JSON.stringify(page.blocks)).digest('hex');
      expect(page.contentHash).toBe(hash);
    }
  });

  it('stores an updatedAt that is a valid date, not in the future, at or after 2026-11-25', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const page of DOC_PAGES) {
      expect(page.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(page.updatedAt))).toBe(false);
      expect(page.updatedAt <= today).toBe(true);
      expect(page.updatedAt >= '2026-11-25').toBe(true);
    }
  });
});
