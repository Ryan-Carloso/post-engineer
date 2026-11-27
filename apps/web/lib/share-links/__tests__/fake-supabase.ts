import type { SupabaseClient } from '@supabase/supabase-js';

type Call = [string, ...unknown[]];

export interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface TableCalls {
  table: string;
  calls: Call[];
}

export interface FakeSupabase {
  client: SupabaseClient;
  queries: TableCalls[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

export function fakeSupabase(options: {
  results?: Record<string, QueryResult[]>;
  rpc?: Record<string, QueryResult>;
}): FakeSupabase {
  const queries: TableCalls[] = [];
  const rpcCalls: FakeSupabase['rpcCalls'] = [];
  const remaining: Record<string, QueryResult[]> = {};
  for (const [table, results] of Object.entries(options.results ?? {})) remaining[table] = [...results];

  const from = (table: string): unknown => {
    const record: TableCalls = { table, calls: [] };
    queries.push(record);
    const next = (): QueryResult => remaining[table]?.shift() ?? { data: null, error: { message: `no result queued for ${table}` } };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'is', 'or', 'order', 'update', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        record.calls.push([method, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      record.calls.push(['maybeSingle']);
      return Promise.resolve(next());
    };
    builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve, reject);
    return builder;
  };

  const rpc = (fn: string, args: Record<string, unknown>): Promise<QueryResult> => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(options.rpc?.[fn] ?? { data: null, error: { message: `no rpc result for ${fn}` } });
  };

  return { client: { from, rpc } as unknown as SupabaseClient, queries, rpcCalls };
}
