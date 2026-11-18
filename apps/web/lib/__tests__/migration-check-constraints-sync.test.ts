import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { GENERATION_PUBLISH_MODES } from '@/lib/generation/video-generation';
import { PUBLISH_LEDGER_STATUSES } from '@/lib/upload/publish-ledger';
import { ANALYTICS_STATUSES, METRICS_WINDOWS } from '@/lib/metrics/metrics-query';
import { VIDEO_LAYOUTS } from '@/lib/persona-schema';
import { VIDEO_TYPES } from '@/lib/tokens';
import { VIDEO_UPLOAD_STATUSES } from '@/lib/videos/signed-upload';
import { UPLOAD_CONTENT_TYPES } from '@/lib/contracts/videos';
import { SCHEDULED_MEDIA_KINDS } from '@/app/api/media/publish-existing/schema';

interface SnapshotTable {
  constraints: Record<string, string>;
}

interface Snapshot {
  tables: Record<string, SnapshotTable>;
}

interface EnumCheck {
  table: string;
  column: string;
  values: string[];
}

const repoRoot = findRepoRoot(import.meta.url);
const snapshot = JSON.parse(readFileSync(join(repoRoot, 'supabase', 'schema.snapshot.json'), 'utf8')) as Snapshot;

function parseEnumChecks(): Map<string, EnumCheck> {
  const checks = new Map<string, EnumCheck>();
  for (const [table, definition] of Object.entries(snapshot.tables)) {
    for (const [name, text] of Object.entries(definition.constraints)) {
      if (!text.startsWith('CHECK')) continue;
      const list = /(\w+) = ANY \(ARRAY\[([^\]]*)\]\)/.exec(text);
      if (list !== null) {
        const values = [...list[2].matchAll(/'([^']*)'::text/g)].map((value) => value[1]);
        checks.set(name, { table, column: list[1], values });
        continue;
      }
      const single = /(\w+) = '([^']*)'::text/.exec(text);
      if (single !== null) {
        checks.set(name, { table, column: single[1], values: [single[2]] });
      }
    }
  }
  return checks;
}

const EXPECTED: Record<string, readonly string[]> = {
  social_accounts_provider_check: SOCIAL_PROVIDERS,
  post_metrics_provider_check: SOCIAL_PROVIDERS,
  schedules_publish_mode_check: GENERATION_PUBLISH_MODES,
  video_generations_publish_mode_check: GENERATION_PUBLISH_MODES,
  personas_video_layout_check: VIDEO_LAYOUTS,
  scheduled_posts_faceless_material_check: ['images'],
  scheduled_posts_video_type_check: VIDEO_TYPES,
  post_metrics_metrics_window_check: METRICS_WINDOWS,
  post_metrics_done_metrics_window_check: METRICS_WINDOWS,
  post_metrics_analytics_status_check: ANALYTICS_STATUSES,
  cloned_voices_status_check: ['pending', 'ready', 'failed'],
  experiments_variable_check: ['hook'],
  publish_ledger_status_check: PUBLISH_LEDGER_STATUSES,
  video_uploads_status_check: VIDEO_UPLOAD_STATUSES,
  video_uploads_declared_content_type_check: UPLOAD_CONTENT_TYPES,
  video_uploads_detected_content_type_check: UPLOAD_CONTENT_TYPES,
  scheduled_posts_media_kind_check: SCHEDULED_MEDIA_KINDS,
};

describe('database enum checks match the code', () => {
  const checks = parseEnumChecks();

  it('parses the known constraints (the parser is not vacuous)', () => {
    expect(checks.size).toBeGreaterThanOrEqual(Object.keys(EXPECTED).length);
    expect(checks.get('social_accounts_provider_check')?.values).toContain('threads');
  });

  it('registers every enum check the database has', () => {
    const unregistered = [...checks.keys()].filter((name) => !(name in EXPECTED));
    expect(unregistered, `add these to EXPECTED with the TS list they mirror: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('finds every registered constraint in the snapshot', () => {
    const missing = Object.keys(EXPECTED).filter((name) => !checks.has(name));
    expect(missing, `no migration creates: ${missing.join(', ')}`).toEqual([]);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} accepts exactly what the code accepts`, () => {
      const check = checks.get(name);
      expect(check, `${name} is not in the schema snapshot`).toBeDefined();
      expect([...(check?.values ?? [])].sort()).toEqual([...expected].sort());
    });
  }
});

describe('upsert targets have their unique key', () => {
  it('social_accounts has the unique key the upsert targets', () => {
    expect(snapshot.tables.social_accounts.constraints['social_accounts_user_provider_account_key']).toBe(
      'UNIQUE (user_id, provider, provider_account_id)',
    );
  });
});
