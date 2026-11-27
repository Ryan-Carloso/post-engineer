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
  'post_metrics_set_prompt_version',
  'user_prompts_record_version',
]);

const SCHEDULER_LEASE_FUNCTIONS = new Set([
  'try_acquire_scheduler_lease',
  'get_scheduler_last_success',
  'record_scheduler_success',
  'release_scheduler_lease',
]);

interface ParsedFunction {
  name: string;
  isDefiner: boolean;
  isTrigger: boolean;
  index: number;
}

interface DroppedFunction {
  name: string;
  index: number;
}

function migrationSources(): { file: string; sql: string }[] {
  expect(existsSync(MIGRATIONS_DIR)).toBe(true);
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));
}

function parseFunctions(sql: string, offset = 0): ParsedFunction[] {
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
      index: offset + start.index,
    });
  }
  return found;
}

function parseDrops(sql: string, offset = 0): DroppedFunction[] {
  const found: DroppedFunction[] = [];
  const re = /drop\s+function\s+(if\s+exists\s+)?public\.([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const match of sql.matchAll(re)) {
    found.push({ name: (match[2] ?? '').toLowerCase(), index: offset + (match.index ?? 0) });
  }
  return found;
}

interface FinalSchema {
  definers: Set<string>;
  triggers: Set<string>;
  finalCreateIndex: Map<string, number>;
  recreated: Set<string>;
}

function finalSchema(): FinalSchema {
  const events: { kind: 'create' | 'drop'; name: string; index: number; fn?: ParsedFunction }[] = [];
  let offset = 0;
  for (const { sql } of migrationSources()) {
    for (const fn of parseFunctions(sql, offset)) events.push({ kind: 'create', name: fn.name, index: fn.index, fn });
    for (const drop of parseDrops(sql, offset)) events.push({ kind: 'drop', name: drop.name, index: drop.index });
    offset += sql.length + 1;
  }
  events.sort((a, b) => a.index - b.index);
  const live = new Map<string, ParsedFunction>();
  const dropped = new Set<string>();
  const recreated = new Set<string>();
  for (const event of events) {
    if (event.kind === 'drop') {
      live.delete(event.name);
      dropped.add(event.name);
      continue;
    }
    if (event.fn === undefined) continue;
    if (dropped.has(event.name)) recreated.add(event.name);
    live.set(event.name, event.fn);
  }
  const definers = new Set<string>();
  const triggers = new Set<string>();
  const finalCreateIndex = new Map<string, number>();
  for (const [name, fn] of live) {
    finalCreateIndex.set(name, fn.index);
    if (!fn.isDefiner) continue;
    if (fn.isTrigger) triggers.add(name);
    else definers.add(name);
  }
  return { definers, triggers, finalCreateIndex, recreated };
}

function chainText(): string {
  return migrationSources().map(({ sql }) => sql).join('\n');
}

function hasRevoke(chain: string, fn: string, role: 'anon' | 'authenticated'): boolean {
  return new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\b[^;]*from\\s+${role}\\b`, 'i').test(chain);
}

describe('definer-function-grants', () => {
  it('finds SECURITY DEFINER functions and classifies triggers without RPC exposure', () => {
    const { definers, triggers } = finalSchema();
    expect([...definers].sort()).toEqual(
      [
        'apply_subscription_access',
        'claim_next_publish_slot',
        'claim_owner_alert',
        'claim_publish_ledger',
        'create_share_link',
        'delete_slot_if_not_last',
        'expire_inactive_ready_slots',
        'find_post_metrics_daily_due',
        'find_post_metrics_due',
        'link_stripe_customer',
        'mark_publish_unknown',
        'record_publish_ledger',
        'register_mcp_refresh_token',
        'release_owner_alert',
        'reset_post_metrics_windows',
        'revoke_access',
        'rotate_mcp_refresh_token',
        'share_week_posts',
        'touch_publish_ledger',
      ].sort(),
    );
    expect([...triggers].sort()).toEqual([...DEFINER_TRIGGER_FUNCTIONS].sort());
    expect(definers.size).toBeGreaterThan(5);
  });

  it('revokes every non-trigger definer function from anon and authenticated', () => {
    const chain = chainText();
    const { definers, finalCreateIndex, recreated } = finalSchema();
    const restricted = new Set([...definers, ...SCHEDULER_LEASE_FUNCTIONS]);
    for (const name of restricted) {
      const scope = recreated.has(name) ? chain.slice(finalCreateIndex.get(name) ?? 0) : chain;
      expect(hasRevoke(scope, name, 'anon'), `${name} must revoke EXECUTE from anon`).toBe(true);
      expect(hasRevoke(scope, name, 'authenticated'), `${name} must revoke EXECUTE from authenticated`).toBe(true);
    }
    for (const name of restricted) {
      const scope = recreated.has(name) ? chain.slice(finalCreateIndex.get(name) ?? 0) : chain;
      expect(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\b[^;]*to\\s+service_role\\b`, 'i').test(scope),
        `${name} must grant EXECUTE to service_role`,
      ).toBe(true);
    }
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

  it('calls the service-only slot-delete RPC with the service client, never the cookie client', () => {
    const slotsRoute = readFileSync(
      join(root, 'apps', 'web', 'app', 'api', 'schedule', 'slots', '[slotId]', 'route.ts'),
      'utf8',
    );
    expect(slotsRoute).toContain("createSupabaseServiceClient().rpc('delete_slot_if_not_last'");
  });
});
