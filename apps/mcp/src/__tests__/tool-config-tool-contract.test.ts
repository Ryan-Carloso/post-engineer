import { describe, expect, it } from 'vitest';
import { SaveToolConfigSchema } from '../tools-tool-config.js';
import { SaveToolConfigBodySchema } from '../contracts/tool-config.js';

//---------------
// tool_config tool↔contract equivalence (shared/contracts/tool-config.ts):
// the tool schema and the contract body schema must accept and reject the
// same inputs, so a call the tool allows is one the route accepts and a
// call the route rejects fails fast in the tool.
//
// Deliberate difference, pinned here so it stays deliberate:
// - Neither schema enforces the cross-field rule (a key only for the
//   tool/source it belongs to). The route's lib validation owns that rule
//   and 400s a mismatched key, so both schemas accept one and the save
//   fails server-side.
//---------------

const VALID = {
  searchTool: 'tavily',
  stockSources: ['pexels', 'pixabay'],
  keys: { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' },
};

describe('tool_config tool-contract equivalence', () => {
  it('save accepts a valid configuration on both sides', () => {
    expect(SaveToolConfigSchema.safeParse(VALID).success).toBe(true);
    expect(SaveToolConfigBodySchema.safeParse(VALID).success).toBe(true);
  });

  it('save accepts an empty configuration on both sides', () => {
    const empty = { searchTool: null, stockSources: [], keys: {} };
    expect(SaveToolConfigSchema.safeParse(empty).success).toBe(true);
    expect(SaveToolConfigBodySchema.safeParse(empty).success).toBe(true);
  });

  it('save rejects an unknown search tool on both sides', () => {
    const bad = { ...VALID, searchTool: 'google' };
    expect(SaveToolConfigSchema.safeParse(bad).success).toBe(false);
    expect(SaveToolConfigBodySchema.safeParse(bad).success).toBe(false);
  });

  it('save rejects an unknown stock source on both sides', () => {
    const bad = { ...VALID, stockSources: ['unsplash'] };
    expect(SaveToolConfigSchema.safeParse(bad).success).toBe(false);
    expect(SaveToolConfigBodySchema.safeParse(bad).success).toBe(false);
  });

  it('save rejects an unknown key name on both sides', () => {
    const bad = { ...VALID, keys: { google: 'x' } };
    expect(SaveToolConfigSchema.safeParse(bad).success).toBe(false);
    expect(SaveToolConfigBodySchema.safeParse(bad).success).toBe(false);
  });

  it('save rejects a blank key and an over-long key on both sides', () => {
    const blank = { ...VALID, keys: { tavily: '' } };
    expect(SaveToolConfigSchema.safeParse(blank).success).toBe(false);
    expect(SaveToolConfigBodySchema.safeParse(blank).success).toBe(false);
    const long = { ...VALID, keys: { tavily: 'x'.repeat(513) } };
    expect(SaveToolConfigSchema.safeParse(long).success).toBe(false);
    expect(SaveToolConfigBodySchema.safeParse(long).success).toBe(false);
  });

  it('both sides accept a mismatched key at the shape level; the route 400s it', () => {
    const mismatched = {
      searchTool: 'tavily',
      stockSources: [],
      keys: { exa: 'exa-fake-key-1234' },
    };
    expect(SaveToolConfigSchema.safeParse(mismatched).success).toBe(true);
    expect(SaveToolConfigBodySchema.safeParse(mismatched).success).toBe(true);
  });
});
