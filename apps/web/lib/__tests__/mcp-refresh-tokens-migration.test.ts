import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/033_mcp-refresh-tokens.sql — the invariant the
// OAuth token route depends on for every offline_access grant.
//
// apps/web/app/oauth/token/route.ts calls two RPCs and fails closed
// (500) when registration fails, but no versioned migration ever
// created them: the route comment cited "migration 0026", yet 026 is
// the post-metrics-dimensions migration and contains no refresh
// token object. Until this migration, every offline_access grant
// failed closed and no refresh token could ever be rotated.
//
// These assertions pin the two halves of the contract:
//
//   1. the SQL file declares the allowlist table and both functions
//      with the exact signatures the route calls, plus the
//      single-use rotation semantics the route's test mock mirrors
//      (unknown / expired / already-consumed jti -> rotation
//      returns false, which the route maps to invalid_grant), and
//   2. the route passes exactly those p_ arguments to both RPCs.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '033_mcp-refresh-tokens.sql',
);

const tokenRoutePath = join(
  repoRoot,
  'apps',
  'web',
  'app',
  'oauth',
  'token',
  'route.ts',
);

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('supabase/migrations/033_mcp-refresh-tokens.sql', () => {
  it('exists and declares the allowlist table idempotently', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readSql();
    expect(sql).toContain(
      'create table if not exists public.mcp_oauth_refresh_tokens',
    );
    // Identifier only: the token value itself is never stored.
    expect(sql).toContain('jti text not null primary key');
    expect(sql).toContain('user_id uuid not null');
    expect(sql).toContain('client_id text not null');
    expect(sql).toContain('resource text not null');
    expect(sql).toContain('scope text not null');
    expect(sql).toContain('expires_at timestamptz not null');
    expect(sql).toContain('consumed_at timestamptz');
  });

  it('backfills missing columns as nullable so a populated pre-existing table survives', () => {
    const sql = readSql();
    // A NOT NULL add without a default aborts on a table that already
    // holds rows — exactly the out-of-band-with-rows case the backfill
    // exists for. Only created_at keeps NOT NULL, because its default
    // fills existing rows. Rows predating a backfilled column carry
    // NULL there and fail the rotate predicate with invalid_grant
    // (fail closed), never an error leak.
    for (const col of [
      'add column user_id uuid',
      'add column client_id text',
      'add column resource text',
      'add column scope text',
      'add column expires_at timestamptz',
      'add column consumed_at timestamptz',
    ]) {
      expect(sql).toContain(
        `execute 'alter table public.mcp_oauth_refresh_tokens ${col}';`,
      );
    }
    expect(sql).toContain(
      "execute 'alter table public.mcp_oauth_refresh_tokens add column created_at timestamptz not null default now()';",
    );
  });

  it('is service-role only: RLS on, no owner policy', () => {
    const sql = readSql();
    expect(sql).toContain(
      'alter table public.mcp_oauth_refresh_tokens enable row level security',
    );
    // No policy is created for this table anywhere in the migration:
    // only the service-role RPCs below may read or write it.
    expect(sql).not.toContain('create policy');
  });

  it('declares register_mcp_refresh_token with the exact signature the route calls', () => {
    const sql = readSql();
    expect(sql).toContain(
      'create or replace function public.register_mcp_refresh_token',
    );
    expect(sql).toContain('p_jti text');
    expect(sql).toContain('p_user_id uuid');
    expect(sql).toContain('p_client_id text');
    expect(sql).toContain('p_resource text');
    expect(sql).toContain('p_scope text');
    expect(sql).toContain('p_expires_at timestamptz');
    // The route checks only `error`, so registration answers void;
    // a re-registration of the same jti is a no-op, never an error.
    expect(sql).toContain('returns void');
    expect(sql).toContain('on conflict (jti) do nothing');
  });

  it('declares rotate_mcp_refresh_token with the exact signature the route calls', () => {
    const sql = readSql();
    expect(sql).toContain(
      'create or replace function public.rotate_mcp_refresh_token',
    );
    expect(sql).toContain('p_old_jti text');
    expect(sql).toContain('p_new_jti text');
    expect(sql).toContain('p_user_id uuid');
    expect(sql).toContain('p_client_id text');
    expect(sql).toContain('p_resource text');
    expect(sql).toContain('p_scope text');
    expect(sql).toContain('p_expires_at timestamptz');
    // The route treats `data === true` as accepted and anything else
    // as invalid_grant, so rotation answers a boolean.
    expect(sql).toContain('returns boolean');
  });

  it('rotates atomically: consumes only a live jti, then registers the replacement', () => {
    const sql = readSql();
    // Consume-once: the UPDATE predicate re-checks unconsumed and
    // unexpired, so concurrent replays race on the row and all but
    // one see zero rows and return false.
    expect(sql).toContain('consumed_at is null');
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('set consumed_at = now()');
    expect(sql).toContain('return false');
    expect(sql).toContain('return true');
  });

  it('runs as the owner like the sibling service-role RPCs', () => {
    const sql = readSql();
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
  });

  it('revokes the RPCs from public/anon/authenticated and grants them to service_role', () => {
    const sql = readSql();
    for (const fn of [
      'register_mcp_refresh_token(text, uuid, text, text, text, timestamptz)',
      'rotate_mcp_refresh_token(text, text, uuid, text, text, text, timestamptz)',
    ]) {
      expect(sql).toContain(`revoke execute on function public.${fn} from public`);
      expect(sql).toContain(`revoke execute on function public.${fn} from anon`);
      expect(sql).toContain(`revoke execute on function public.${fn} from authenticated`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });
});

describe('oauth token route call sites', () => {
  it('passes exactly the six register arguments', () => {
    const src = readFileSync(tokenRoutePath, 'utf8');
    expect(src).toContain("rpc('register_mcp_refresh_token'");
    for (const p of [
      'p_jti:',
      'p_user_id:',
      'p_client_id:',
      'p_resource:',
      'p_scope:',
      'p_expires_at:',
    ]) {
      expect(src).toContain(p);
    }
  });

  it('passes exactly the seven rotate arguments', () => {
    const src = readFileSync(tokenRoutePath, 'utf8');
    expect(src).toContain("rpc('rotate_mcp_refresh_token'");
    for (const p of [
      'p_old_jti:',
      'p_new_jti:',
      'p_user_id:',
      'p_client_id:',
      'p_resource:',
      'p_scope:',
      'p_expires_at:',
    ]) {
      expect(src).toContain(p);
    }
  });

  it('fails closed when registration fails', () => {
    const src = readFileSync(tokenRoutePath, 'utf8');
    expect(src).toContain('fail closed');
    expect(src).toContain("return NextResponse.json({ error: 'server_error' }, { status: 500 })");
  });
});
