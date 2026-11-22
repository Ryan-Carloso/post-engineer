import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { VIDEO_TRANSITION_MODES } from '@/lib/contracts/videos';

const root = findRepoRoot(import.meta.url);
const engineSchema = readFileSync(join(root, 'apps/engine/app/models/schema.py'), 'utf8');
const engineBlock = engineSchema.match(/class VideoTransitionMode\(str, Enum\):([\s\S]*?)\n\n/)?.[1];
if (engineBlock === undefined) throw new Error('VideoTransitionMode not found in engine schema.py');
const engineModes = [...engineBlock.matchAll(/^\s*\w+ = "([^"]+)"/gm)].map((match) => match[1]);

describe('video transition modes match the engine', () => {
  it('lists the same string-valued modes in the same order as the engine enum', () => {
    expect([...VIDEO_TRANSITION_MODES]).toEqual(engineModes);
  });

  it('parses a non-empty, duplicate-free engine mode list', () => {
    expect(engineModes.length).toBeGreaterThan(0);
    expect(new Set(engineModes).size).toBe(engineModes.length);
  });
});
