import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromDiff, matchesGlob } from './extract.mjs';

const TS_DIFF = `diff --git a/apps/web/app/api/videos/generate-and-schedule/route.ts b/apps/web/app/api/videos/generate-and-schedule/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/videos/generate-and-schedule/route.ts
+++ b/apps/web/app/api/videos/generate-and-schedule/route.ts
@@ -10,6 +10,8 @@ export async function POST() {
   return NextResponse.json({
     schedule: { id: "abc" },
+    replay: true,
+    retryCount: 2,
   });
 }
`;

const PY_DIFF = `diff --git a/apps/engine/app/models/schema.py b/apps/engine/app/models/schema.py
index 1111111..2222222 100644
--- a/apps/engine/app/models/schema.py
+++ b/apps/engine/app/models/schema.py
@@ -300,5 +300,7 @@ class TaskResponseData(BaseModel):
     task_id: str
+    retry: int = 0
+    info: str = Field(default="", alias="infoText")
 
-def helper(not_a_field: int):
+def helper(still_not_a_field: int):
     pass
`;

const RENAME_DIFF = `diff --git a/apps/mcp/src/tools.ts b/apps/mcp/src/tools.ts
index 1111111..2222222 100644
--- a/apps/mcp/src/tools.ts
+++ b/apps/mcp/src/tools.ts
@@ -40,7 +40,7 @@ export const ScheduleShape = {
-  payload: z.string(),
+  schedulePayload: z.string(),
 };
`;

const NON_CONTRACT_DIFF = `diff --git a/apps/web/components/Foo.tsx b/apps/web/components/Foo.tsx
index 1111111..2222222 100644
--- a/apps/web/components/Foo.tsx
+++ b/apps/web/components/Foo.tsx
@@ -1,3 +1,4 @@ export function Foo() {
+  const data = { info: 1 };
   return null;
 }
`;

const NEW_FILE_DIFF = `diff --git a/apps/web/app/api/new-thing/route.ts b/apps/web/app/api/new-thing/route.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/apps/web/app/api/new-thing/route.ts
@@ -0,0 +1,5 @@
+export async function GET() {
+  return NextResponse.json({ ok: true });
+}
`;

const CONFIG = {
  apiPaths: [
    'apps/web/app/api/**/route.ts',
    'apps/mcp/src/tools.ts',
    'apps/engine/app/models/**/*.py',
    'apps/engine/app/controllers/**/*.py',
  ],
};

describe('matchesGlob', () => {
  it('matches ** across segments and * within a segment', () => {
    assert.ok(matchesGlob('apps/web/app/api/a/b/route.ts', 'apps/web/app/api/**/route.ts'));
    assert.ok(!matchesGlob('apps/web/app/other/route.ts', 'apps/web/app/api/**/route.ts'));
    assert.ok(matchesGlob('apps/engine/app/models/schema.py', 'apps/engine/app/models/**/*.py'));
    assert.ok(!matchesGlob('apps/engine/app/models.py', 'apps/engine/app/models/**/*.py'));
  });
});

describe('extractFromDiff', () => {
  it('extracts added TS field names with line numbers and context', () => {
    const { candidates } = extractFromDiff(TS_DIFF, CONFIG);
    const names = candidates.map((c) => c.name).sort();
    assert.deepEqual(names, ['replay', 'retryCount']);
    const replay = candidates.find((c) => c.name === 'replay');
    assert.equal(replay.file, 'apps/web/app/api/videos/generate-and-schedule/route.ts');
    assert.equal(replay.line, 13);
    assert.match(replay.context, /NextResponse\.json/);
  });

  it('ignores removed lines', () => {
    const { candidates } = extractFromDiff(RENAME_DIFF, CONFIG);
    assert.deepEqual(
      candidates.map((c) => c.name),
      ['schedulePayload'],
    );
    assert.equal(candidates[0].renamedFrom, 'payload');
  });

  it('extracts Pydantic fields incl. Field(alias=...), skips function params', () => {
    const { candidates } = extractFromDiff(PY_DIFF, CONFIG);
    const names = candidates.map((c) => c.name).sort();
    assert.deepEqual(names, ['info', 'infoText', 'retry']);
    assert.ok(!names.includes('still_not_a_field'));
  });

  it('ignores files outside the contract surface', () => {
    const { candidates, newEndpoints } = extractFromDiff(NON_CONTRACT_DIFF, CONFIG);
    assert.deepEqual(candidates, []);
    assert.deepEqual(newEndpoints, []);
  });

  it('flags added files under api_paths as new endpoints', () => {
    const { newEndpoints } = extractFromDiff(NEW_FILE_DIFF, CONFIG);
    assert.deepEqual(newEndpoints, [{ file: 'apps/web/app/api/new-thing/route.ts', kind: 'endpoint' }]);
  });

  it('returns no candidates for an empty diff', () => {
    assert.deepEqual(extractFromDiff('', CONFIG).candidates, []);
  });

  it('ignores object destructuring bindings (local variables, not contract names)', () => {
    const diff = `diff --git a/apps/web/app/api/x/route.ts b/apps/web/app/api/x/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/x/route.ts
+++ b/apps/web/app/api/x/route.ts
@@ -1,3 +1,5 @@
 export async function POST() {
+  const { data: existingSchedule, error: scheduleError } = await supabase.from('schedules').select();
+  const { count } = await supabase.from('schedules').select('*', { count: 'exact' });
   return NextResponse.json({ ok: true });
 }
`;
    const { candidates } = extractFromDiff(diff, CONFIG);
    assert.deepEqual(
      candidates.map((c) => c.name),
      [],
      'destructured locals must not be treated as contract names',
    );
  });

  it('ignores destructured function parameters', () => {
    const diff = `diff --git a/apps/web/app/api/x/route.ts b/apps/web/app/api/x/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/x/route.ts
+++ b/apps/web/app/api/x/route.ts
@@ -1,3 +1,4 @@
+function buildPayload({ data }: { data: string }) { return { payload: data }; }
 export async function POST() {
   return NextResponse.json({ ok: true });
 }
`;
    const { candidates } = extractFromDiff(diff, CONFIG);
    assert.ok(
      !candidates.some((c) => c.name === 'data'),
      'destructured params must not be treated as contract names',
    );
  });

  it('still extracts real response shapes next to destructuring', () => {
    const diff = `diff --git a/apps/web/app/api/x/route.ts b/apps/web/app/api/x/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/x/route.ts
+++ b/apps/web/app/api/x/route.ts
@@ -1,3 +1,5 @@
 export async function POST() {
+  const { data: existingSchedule } = await supabase.from('schedules').select();
   return NextResponse.json({
+    scheduleId: existingSchedule?.id,
     ok: true,
   });
 }
`;
    const { candidates } = extractFromDiff(diff, CONFIG);
    // Only the added scheduleId line is a candidate; `ok` is context, and the
    // destructured `data` is a local.
    assert.deepEqual(candidates.map((c) => c.name).sort(), ['scheduleId']);
  });
});
