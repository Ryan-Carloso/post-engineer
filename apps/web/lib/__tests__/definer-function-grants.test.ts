// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const root = findRepoRoot(import.meta.url);
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const SNAPSHOT_PATH = join(root, 'supabase', 'schema.snapshot.json');

const DEFINER_TRIGGER_FUNCTIONS = new Set([
  'post_metrics_set_persona',
  'post_metrics_set_experiment',
  'post_metrics_set_prompt_version',
  'user_prompts_record_version',
  'enforce_persona_image_limit',
]);

const AUTHENTICATED_DEFINER_RPCS = new Set(['set_primary_persona_image']);

const SCHEDULER_LEASE_FUNCTIONS = new Set([
  'try_acquire_scheduler_lease',
  'get_scheduler_last_success',
  'record_scheduler_success',
]);

interface ParsedFunction {
  name: string;
  isDefiner: boolean;
  isTrigger: boolean;
}

function migrationSources(): { file: string; sql: string }[] {
  expect(existsSync(MIGRATIONS_DIR)).toBe(true);
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));
}

function parseFunctions(sql: string): ParsedFunction[] {
  const found: ParsedFunction[] = [];
  const re = /create\s+(or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi;
  const starts: { index: number; name: string }[] = [];
  for (const match of sql.matchAll(re)) {
    starts.push({ index: match.index ?? 0, name: (match[2] ?? '').toLowerCase() });
  }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    if (start === undefined) continue;
    const end = i + 1 < starts.length ? (starts[i + 1]?.index ?? sql.length) : sql.length;
    const block = sql.slice(start.index, end);
    found.push({
      name: start.name,
      isDefiner: /security\s+definer/i.test(block),
      isTrigger: /returns\s+trigger/i.test(block),
    });
  }
  return found;
}

function chainText(): string {
  return migrationSources().map(({ sql }) => sql).join('\n');
}

function hasRevoke(chain: string, fn: string, role: 'anon' | 'authenticated'): boolean {
  return new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\b[^;]*from\\s+${role}\\b`, 'i').test(chain);
}

describe('definer-function-grants', () => {
  it('finds SECURITY DEFINER functions and classifies triggers without RPC exposure', () => {
    const definers = new Set<string>();
    const triggers = new Set<string>();
    for (const { sql } of migrationSources()) {
      for (const fn of parseFunctions(sql)) {
        if (!fn.isDefiner) continue;
        if (fn.isTrigger) triggers.add(fn.name);
        else definers.add(fn.name);
      }
    }
    expect([...definers].sort()).toEqual(
      [
        'claim_owner_alert',
        'claim_publish_ledger',
        'create_experiment',
        'delete_slot_if_not_last',
        'ensure_official_prompt_version',
        'find_post_metrics_daily_due',
        'find_post_metrics_due',
        'find_stuck_generations',
        'find_zombie_schedule_candidates',
        'mark_publish_unknown',
        'record_publish_ledger',
        'refund_batch_tokens',
        'register_mcp_refresh_token',
        'release_owner_alert',
        'reset_post_metrics_windows',
        'restore_batch_discount_credit',
        'rotate_mcp_refresh_token',
        'set_primary_persona_image',
        'settle_batch_clawback',
        'touch_publish_ledger',
      ].sort(),
    );
    expect([...triggers].sort()).toEqual([...DEFINER_TRIGGER_FUNCTIONS].sort());
    expect([...definers].length).toBeGreaterThan(5);
  });

  it('revokes every non-trigger definer function from anon and authenticated', () => {
    const chain = chainText();
    const definers = new Set<string>();
    for (const { sql } of migrationSources()) {
      for (const fn of parseFunctions(sql)) {
        if (fn.isDefiner && !fn.isTrigger) definers.add(fn.name);
      }
    }
    const restricted = new Set([...definers, ...SCHEDULER_LEASE_FUNCTIONS]);
    for (const name of AUTHENTICATED_DEFINER_RPCS) restricted.delete(name);
    for (const name of restricted) {
      expect(hasRevoke(chain, name, 'anon'), `${name} must revoke EXECUTE from anon`).toBe(true);
      expect(hasRevoke(chain, name, 'authenticated'), `${name} must revoke EXECUTE from authenticated`).toBe(true);
    }
    for (const name of restricted) {
      expect(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\b[^;]*to\\s+service_role\\b`, 'i').test(chain),
        `${name} must grant EXECUTE to service_role`,
      ).toBe(true);
    }
  });

  it('keeps set_primary_persona_image callable for the browser and enforces auth.uid() ownership', () => {
    const chain = chainText();
    expect(hasRevoke(chain, 'set_primary_persona_image', 'anon')).toBe(true);
    expect(hasRevoke(chain, 'set_primary_persona_image', 'authenticated')).toBe(false);
    expect(
      /grant\s+execute\s+on\s+function\s+public\.set_primary_persona_image\b[^;]*to\s+service_role\b/i.test(chain),
    ).toBe(true);
    expect(
      /grant\s+execute\s+on\s+function\s+public\.set_primary_persona_image\b[^;]*to\s+authenticated\b/i.test(chain),
    ).toBe(true);
    const grants065 = readFileSync(join(MIGRATIONS_DIR, '065_definer-function-grants.sql'), 'utf8');
    const latest = readFileSync(join(MIGRATIONS_DIR, '066_core-tables-rls.sql'), 'utf8');
    expect(grants065).toContain('coalesce(auth.uid(), p_user_id)');
    expect(grants065).not.toContain('coalesce(p_user_id, auth.uid())');
    expect(latest).toContain('coalesce(auth.uid(), p_user_id)');
    expect(latest).not.toContain('coalesce(p_user_id, auth.uid())');
    const definition = latest.match(
      /create\s+(?:or\s+replace\s+)?function\s+public\.set_primary_persona_image[\s\S]*?as\s+\$\$/i,
    );
    expect(definition?.[0]).toContain('security definer');
    expect(definition?.[0]).toContain('set search_path = public');
    const trigger = latest.match(
      /create\s+(?:or\s+replace\s+)?function\s+public\.enforce_persona_image_limit[\s\S]*?as\s+\$\$/i,
    );
    expect(trigger?.[0]).toContain('security definer');
    expect(trigger?.[0]).toContain('set search_path = public');
    expect(trigger?.[0]).toMatch(/returns\s+trigger/i);
  });

  it('restricts record_persona_image_use to service_role like other infrastructure RPCs', () => {
    const chain = chainText();
    expect(hasRevoke(chain, 'record_persona_image_use', 'anon')).toBe(true);
    expect(hasRevoke(chain, 'record_persona_image_use', 'authenticated')).toBe(true);
  });

  it('pins search_path on the slot-delete guard so a definer body cannot be hijacked', () => {
    const guardSql = readFileSync(join(MIGRATIONS_DIR, '065_definer-function-grants.sql'), 'utf8');
    expect(guardSql).toMatch(/function\s+public\.delete_slot_if_not_last\s*\(/i);
    const definition = guardSql.match(/create\s+(?:or\s+replace\s+)?function\s+public\.delete_slot_if_not_last[\s\S]*?as\s+\$\$/i);
    expect(definition?.[0]).toContain('set search_path = public');
  });

  it('enables RLS on mcp_oauth_clients so only the service role can touch the DCR allowlist', () => {
    const chain = chainText();
    expect(chain).toMatch(/alter\s+table\s+public\.mcp_oauth_clients\s+enable\s+row\s+level\s+security/i);
    expect(chain).toMatch(/revoke\s+.*?\s+on\s+table\s+public\.mcp_oauth_clients[^;]*from\s+anon\b/i);
    expect(chain).toMatch(/revoke\s+.*?\s+on\s+table\s+public\.mcp_oauth_clients[^;]*from\s+authenticated\b/i);
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
      tables: Record<string, { rls: boolean }>;
    };
    expect(snapshot.tables['mcp_oauth_clients']?.rls).toBe(true);
  });

  it('calls the service-only refund and slot-delete RPCs with the service client, never the cookie client', () => {
    const scheduleRoute = readFileSync(
      join(root, 'apps', 'web', 'app', 'api', 'schedule', 'route.ts'),
      'utf8',
    );
    expect(scheduleRoute).toContain('refundsAfterClawback(createSupabaseServiceClient()');
    const refundIndex = scheduleRoute.indexOf('refundSlotTokens({');
    expect(refundIndex).toBeGreaterThan(-1);
    expect(scheduleRoute.slice(refundIndex, refundIndex + 400)).toContain('createSupabaseServiceClient()');

    const slotsRoute = readFileSync(
      join(root, 'apps', 'web', 'app', 'api', 'schedule', 'slots', '[slotId]', 'route.ts'),
      'utf8',
    );
    expect(slotsRoute).toContain("createSupabaseServiceClient().rpc('delete_slot_if_not_last'");
  });
});
