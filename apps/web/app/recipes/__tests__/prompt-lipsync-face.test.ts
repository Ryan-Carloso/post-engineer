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
  it('says the first photo of the video is the face that talks in both face modes', () => {
    expect(baseText).toContain(
      'Lip-sync face: in full_lipsync and hook_lipsync, the first photo of the video is the face that talks.',
    );
    expect(baseText).toContain('the first photo of the first segment that carries media; a video clip never counts');
    expect(baseText).toContain("clear, front-facing photo of the persona's own face");
  });

  it('says a faceless or unloadable first photo fails the video and when the persona photo talks', () => {
    expect(baseText).toContain('A first photo with no detectable face, or one that fails to load, fails the video.');
    expect(baseText).toContain(
      'Only when no segment carries a photo (possible in full_lipsync only) does the persona photo talk instead.',
    );
  });

  it('states the hook lip-sync ceiling the engine enforces', () => {
    const intro = engineSeconds('apps/engine/app/services/task.py', 'PERSONA_LIPSYNC_MAX_SECONDS');
    const hook = engineSeconds('apps/engine/app/services/persona_hook.py', 'PERSONA_HOOK_MAX_SECONDS');
    expect(hook).toBe(intro);
    expect(baseText).toContain(`In hook_lipsync the face talks through the hook only (at most ${intro} seconds)`);
  });

  it('names the hookPanel option the generate_video options really accept', () => {
    const shapes = readFileSync(join(repoRoot, 'apps/mcp/src/schedule-shapes.ts'), 'utf8');
    expect(shapes).toContain('  hookPanel: z');
    expect(baseText).toContain('options.hookPanel false keeps the face alone on screen during the hook');
  });
});
