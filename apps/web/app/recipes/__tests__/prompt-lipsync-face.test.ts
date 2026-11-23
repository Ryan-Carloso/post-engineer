import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARED_PROMPT_BASE } from '@/lib/generation/prompt-base';
import { findRepoRoot } from '../../../test/repo-root';

const repoRoot = findRepoRoot(import.meta.url);
const baseText = SHARED_PROMPT_BASE.join('\n');

function engineSeconds(relativePath: string, name: string): string {
  const source = readFileSync(join(repoRoot, relativePath), 'utf8');
  const line = source.split('\n').find((candidate) => candidate.startsWith(`${name} = `));
  if (line === undefined) throw new Error(`${name} not found in ${relativePath}`);
  const value = Number(line.slice(name.length + 3).trim());
  if (!Number.isFinite(value)) throw new Error(`${name} is not a number in ${relativePath}`);
  return String(value);
}

describe('shared prompt base: the lip-sync face', () => {
  it('says the first photo of the video is the face that talks in hook_lipsync only', () => {
    expect(baseText).toContain('Lip-sync face: in hook_lipsync, the first photo of the video is the face that talks.');
    expect(baseText).not.toContain('in full_lipsync and hook_lipsync, the first photo of the video is the face');
    expect(baseText).toContain('the first photo of the first segment that carries media; a video clip never counts');
    expect(baseText).toContain("clear, front-facing photo of the persona's own face");
  });

  it('says a faceless or unloadable first photo fails the video', () => {
    expect(baseText).toContain('A first photo with no detectable face, or one that fails to load, fails the video.');
  });

  it('says full_lipsync talks through options.lipsyncPhotos, never the segment photos', () => {
    expect(baseText).toContain('In full_lipsync the segment photos never talk: the faces are options.lipsyncPhotos');
    expect(baseText).toContain('full_lipsync requires options.lipsyncPhotos');
    expect(baseText).not.toContain('does the persona photo talk instead');
  });

  it('states the hook lip-sync ceiling the engine enforces', () => {
    const intro = engineSeconds('apps/engine/app/services/task.py', 'PERSONA_LIPSYNC_MAX_SECONDS');
    const hook = engineSeconds('apps/engine/app/services/persona_hook.py', 'PERSONA_HOOK_MAX_SECONDS');
    expect(hook).toBe(intro);
    expect(baseText).toContain(`The face talks through the hook only (at most ${intro} seconds)`);
  });

  it('names the hookPanel option the generate_video options really accept', () => {
    const shapes = readFileSync(join(repoRoot, 'apps/mcp/src/schedule-shapes.ts'), 'utf8');
    expect(shapes).toContain('  hookPanel: z');
    expect(baseText).toContain('options.hookPanel false keeps the face alone on screen during the hook');
  });
});
