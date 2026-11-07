// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceClientMock, trackMock, loggerMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  trackMock: vi.fn(),
  loggerMock: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: serviceClientMock }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: trackMock }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

import { checkSchemaDrift, describeDrift, reportSchemaDrift } from '@/lib/schema-drift';

type Existing = Record<string, string[] | 'missing-table' | 'unreachable'>;

// A fake PostgREST client: select(cols).limit(0) errors the way PostgREST
// does when a requested column (42703) or the table (42P01) does not exist.
function fakeClient(existing: Existing): SupabaseClient {
  return {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: async () => {
          const have = existing[table];
          if (have === 'unreachable') return { error: { code: '08006', message: 'connection failure' } };
          if (have === undefined || have === 'missing-table') {
            return { error: { code: '42P01', message: `relation ${table} does not exist` } };
          }
          const absent = columns.split(',').find((column) => !have.includes(column));
          return absent === undefined
            ? { error: null }
            : { error: { code: '42703', message: `column ${table}.${absent} does not exist` } };
        },
      }),
    }),
  } as unknown as SupabaseClient;
}

const EXPECTED = { scheduled_posts: ['faceless_material', 'full_lipsync'], personas: ['cta_text'] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkSchemaDrift', () => {
  it('reports nothing when every expected column exists', async () => {
    const client = fakeClient({ scheduled_posts: ['faceless_material', 'full_lipsync'], personas: ['cta_text'] });
    expect(await checkSchemaDrift(client, EXPECTED)).toEqual({ missing: {}, unverified: [] });
  });

  it('names exactly the missing column, not the whole table', async () => {
    const client = fakeClient({ scheduled_posts: ['full_lipsync'], personas: ['cta_text'] });
    const report = await checkSchemaDrift(client, EXPECTED);
    expect(report.missing).toEqual({ scheduled_posts: ['faceless_material'] });
  });

  it('reports every column of a table that does not exist', async () => {
    const client = fakeClient({ scheduled_posts: ['faceless_material', 'full_lipsync'], personas: 'missing-table' });
    expect((await checkSchemaDrift(client, EXPECTED)).missing).toEqual({ personas: ['cta_text'] });
  });

  it('does not call an unreachable database drift', async () => {
    const client = fakeClient({ scheduled_posts: 'unreachable', personas: ['cta_text'] });
    expect(await checkSchemaDrift(client, EXPECTED)).toEqual({ missing: {}, unverified: ['scheduled_posts'] });
  });
});

describe('checkSchemaDrift per-column probes', () => {
  // The combined probe says a column is missing (42703), then the per-column
  // probes answer whatever the script says, in order.
  function scriptedClient(perColumn: Array<string | null>): SupabaseClient {
    let calls = 0;
    return {
      from: () => ({
        select: () => ({
          limit: async () => {
            const code = calls === 0 ? '42703' : perColumn[calls - 1];
            calls += 1;
            return code === null ? { error: null } : { error: { code, message: 'probe' } };
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  const ONE_TABLE = { scheduled_posts: ['faceless_material', 'full_lipsync'] };

  it('leaves the table unverified when a per-column probe fails for a reason that is not drift', async () => {
    const report = await checkSchemaDrift(scriptedClient(['08006', null]), ONE_TABLE);
    expect(report).toEqual({ missing: {}, unverified: ['scheduled_posts'] });
  });

  it('reports no drift when every column answers fine after a transient combined failure', async () => {
    const report = await checkSchemaDrift(scriptedClient([null, null]), ONE_TABLE);
    expect(report).toEqual({ missing: {}, unverified: [] });
  });

  it('still names the confirmed missing column when another probe fails', async () => {
    const report = await checkSchemaDrift(scriptedClient(['42703', '08006']), ONE_TABLE);
    expect(report.missing).toEqual({ scheduled_posts: ['faceless_material'] });
    expect(report.unverified).toEqual([]);
  });
});

describe('describeDrift', () => {
  it('formats table.column pairs', () => {
    expect(describeDrift({ a: ['x', 'y'], b: ['z'] })).toBe('a.x, a.y, b.z');
  });
});

describe('reportSchemaDrift', () => {
  it('logs an error naming the missing column and tracks one event when the database is behind', async () => {
    serviceClientMock.mockReturnValue(fakeClient({ scheduled_posts: ['full_lipsync'], personas: 'missing-table' }));
    await reportSchemaDrift();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    const [message, cause] = loggerMock.error.mock.calls[0] as [string, Error];
    expect(message).toContain('apply the pending supabase migrations');
    expect(cause.message).toContain('scheduled_posts.faceless_material');
    expect(trackMock).toHaveBeenCalledWith(
      'schema_drift_detected',
      expect.objectContaining({ tables: expect.arrayContaining(['scheduled_posts']) }),
    );
  });

  it('is silent when the schema is current', async () => {
    const { REQUIRED_COLUMNS } = await import('@/lib/schema-expectations.gen');
    serviceClientMock.mockReturnValue(fakeClient(Object.fromEntries(Object.entries(REQUIRED_COLUMNS).map(([t, c]) => [t, [...c]]))));
    await reportSchemaDrift();
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('warns, without a drift event, when a table could not be verified', async () => {
    const { REQUIRED_COLUMNS } = await import('@/lib/schema-expectations.gen');
    const existing: Existing = Object.fromEntries(Object.entries(REQUIRED_COLUMNS).map(([t, c]) => [t, [...c]]));
    existing.personas = 'unreachable';
    serviceClientMock.mockReturnValue(fakeClient(existing));
    await reportSchemaDrift();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('never throws when the check itself fails', async () => {
    serviceClientMock.mockImplementation(() => {
      throw new Error('missing SUPABASE_SERVICE_ROLE_KEY');
    });
    await expect(reportSchemaDrift()).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalledWith('[schema-drift] check failed', expect.any(Error));
  });
});
