import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONSUMERS: { file: string; importFrom: string }[] = [
  { file: 'app/api/persona/video-events/[taskId]/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'app/api/persona/video-status/[taskId]/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'app/api/persona/video-task/[taskId]/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'app/api/persona/video-download/[taskId]/[...path]/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'app/api/persona/delete-preview/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'app/api/persona/route.ts', importFrom: '@/lib/video-urls' },
  { file: 'lib/engine-tasks.ts', importFrom: './video-urls' },
];

describe('SAFE_TASK_ID single source of truth', () => {
  for (const { file, importFrom } of CONSUMERS) {
    it(`${file} imports SAFE_TASK_ID instead of defining its own copy`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/^\s*(export\s+)?const\s+SAFE_TASK_ID\s*=/m);
      expect(source).toContain('SAFE_TASK_ID');
      const fromClause =
        source.includes(`from '${importFrom}'`) || source.includes(`from "${importFrom}"`);
      expect(fromClause).toBe(true);
    });
  }

  it('the shared export still guards the documented id shapes', async () => {
    const { SAFE_TASK_ID } = await import('../video-urls');
    expect(SAFE_TASK_ID.test('82024119-d80b-4759-83df-395ab044680a')).toBe(true);
    expect(SAFE_TASK_ID.test('../../etc/passwd')).toBe(false);
  });
});
