import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  FACELESS_PRICE,
  FACE_QUALITY_PRICES,
  FULL_LIPSYNC_PRICES,
  VIDEO_TYPE_ERROR_SUFFIX,
  VIDEO_TYPE_REQUIRED_MESSAGE,
  unknownVideoTypeMessage,
} from '@/lib/tokens';

//---------------
// The video_type error suffix must match the engine's exactly: the
// engine (apps/engine/app/models/schema.py) and the MCP
// (apps/mcp/src/video-type.ts, pinned by its own video-type sync test)
// carry the same literal, and the numbers in it must stay the price
// table in lib/tokens.ts — the agent chooses the mode knowing the
// cost, and the server charges from the type, never from the client.
//---------------
const root = findRepoRoot(import.meta.url);
const engineSchema = readFileSync(join(root, 'apps/engine/app/models/schema.py'), 'utf8');
const engineSuffix = engineSchema.match(/VIDEO_TYPE_ERROR_SUFFIX = "([^"]+)"/)?.[1];
if (engineSuffix === undefined) throw new Error('VIDEO_TYPE_ERROR_SUFFIX not found in engine schema.py');

describe('video_type error suffix matches the engine and the price table', () => {
  it('is the same literal as the engine', () => {
    expect(VIDEO_TYPE_ERROR_SUFFIX).toBe(engineSuffix);
    expect(VIDEO_TYPE_REQUIRED_MESSAGE).toBe(`videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`);
  });

  it('lists the costs from the price table, not a hand-typed copy', () => {
    expect(VIDEO_TYPE_ERROR_SUFFIX).toBe(
      `use full_lipsync (${FULL_LIPSYNC_PRICES.ok}/${FULL_LIPSYNC_PRICES.very_good}), ` +
        `hook_lipsync (${FACE_QUALITY_PRICES.ok}/${FACE_QUALITY_PRICES.very_good}) or faceless (${FACELESS_PRICE})`,
    );
  });

  it('survives the MCP 200-char relay cap whole', () => {
    expect(unknownVideoTypeMessage('sideways').length).toBeLessThan(200);
    expect(unknownVideoTypeMessage('x'.repeat(100)).length).toBeLessThan(200);
  });
});
