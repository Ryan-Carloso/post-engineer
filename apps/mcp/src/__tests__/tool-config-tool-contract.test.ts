import { describe, expect, it } from 'vitest';
import { SaveToolConfigSchema } from '../tools-tool-config.js';
import { SaveToolConfigBodySchema } from '../contracts/tool-config.js';

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

  it("save accepts 'own' as the search tool on both sides", () => {
    const own = { searchTool: 'own', stockSources: [], keys: {} };
    expect(SaveToolConfigSchema.safeParse(own).success).toBe(true);
    expect(SaveToolConfigBodySchema.safeParse(own).success).toBe(true);
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

  it('both sides accept a whitespace-only key at the shape level; the route trims and 400s it', () => {
    const whitespace = { ...VALID, keys: { tavily: '   ' } };
    expect(SaveToolConfigSchema.safeParse(whitespace).success).toBe(true);
    expect(SaveToolConfigBodySchema.safeParse(whitespace).success).toBe(true);
  });
});
