//---------------
// The persona face mix is GONE (migration 007_personas-drop-face-mix.sql).
//
// `public.personas.face_mix_percent` used to be a persona attribute AND the
// "is this persona faceless?" marker read by the web (image-library gate, post
// pricing, engine payload) and by the engine's batch pipeline (the token cost
// it refunds a failed slot with). Personas are now always faced and "no face"
// is a per-post boolean on `scheduled_posts.faceless`.
//
// This test pins the removal at the source level: one straggler (a leftover
// `select`, a payload key, an engine read) would either 400 against the
// dropped column (PostgREST rejects unknown columns) or silently re-price a
// video, and neither fails a test on its own.
//---------------
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

//---------------
// Files under test: source (not tests, not build output) of the web app and
// the engine. The banned identifiers below must not survive anywhere in
// production code.
//---------------
// cwd is apps/web, so the engine lives at ../engine/app.
const SOURCE_ROOTS = ['app', 'lib', 'components', join('..', 'engine', 'app')];
// __tests__ is skipped on purpose: the assertions in this very file (and the
// store/insert shape pins) must name the removed identifiers to prove they are
// gone. Only production code is held to the ban.
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__pycache__', '.nx', '__tests__']);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|py)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root));

describe('the persona face mix is fully removed', () => {
  it('finds the source files it is scanning (a wrong root would pass vacuously)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(SOURCE_FILES.some((file) => file.endsWith('.py'))).toBe(true);
    expect(SOURCE_FILES.some((file) => file.endsWith('.ts'))).toBe(true);
  });

  for (const file of SOURCE_FILES) {
    it(`${file} never mentions face_mix_percent / faceMixPercent`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('face_mix_percent');
      expect(source).not.toContain('faceMixPercent');
    });
  }

  it('the migration drops the column and adds the per-post flag', () => {
    const sql = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations', '007_personas-drop-face-mix.sql'),
      'utf8',
    );
    expect(sql).toContain('add column if not exists faceless boolean not null default false');
    expect(sql).toContain('drop column if exists face_mix_percent');
  });

  it('the canonical schema still declares the column the migration drops', () => {
    // 001 is the append-only base snapshot: it must NOT be edited. The
    // divergence between it and the live DB is exactly what migration 007
    // reconciles, so pin both sides — editing 001 (or dropping 007) fails here.
    const schema = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations', '001_schema.sql'),
      'utf8',
    );
    expect(schema).toContain('face_mix_percent integer');
  });
});