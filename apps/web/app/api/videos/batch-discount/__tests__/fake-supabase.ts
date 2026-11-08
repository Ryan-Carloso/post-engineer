//---------------
// fake-supabase — an in-memory PostgREST stand-in for the batch discount
// tests. Filters (eq, in, is) really filter, update really patches the
// matching rows (so check-then-act predicates are exercised), and the
// builder is awaitable at any point of the chain like supabase-js. delete
// removes the matching rows.
//---------------

export type Row = Record<string, unknown>;

interface Filter {
  column: string;
  op: 'eq' | 'in' | 'is';
  value: unknown;
}

export interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

export interface FakeOptions {
  tables: Record<string, Row[]>;
  rpc?: (call: RpcCall) => { data: unknown; error: unknown };
  /** Make a table's selects fail with this error. */
  selectError?: Record<string, unknown>;
  /** Make a table's updates fail with this error. */
  updateError?: Record<string, unknown>;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    if (filter.op === 'eq') return value === filter.value;
    if (filter.op === 'is') return filter.value === null ? value === null || value === undefined : value === filter.value;
    return Array.isArray(filter.value) && filter.value.includes(value);
  });
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

/**
 * In-memory stand-in for settle_batch_clawback: refunds are recorded as
 * credited, and each recharge updates the slot only when the check-then-act
 * predicate still matches. The real cap lives in the SQL function; this
 * only has to move the slot the way that function does.
 */
export function simulateSettleBatchClawback(
  tables: Record<string, Row[]>,
  params: Record<string, unknown>,
): { data: unknown; error: unknown } {
  const userId = params.p_user_id;
  let credited = 0;
  const refunds: Row[] = [];
  for (const refund of asRows(params.p_refunds)) {
    const amount = refund.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return { data: null, error: { message: 'clawback refund amount must be positive' } };
    }
    credited += amount;
    refunds.push({
      slot_id: refund.slot_id,
      refunded: true,
      already_refunded: false,
      amount,
    });
  }
  const recharges: Row[] = [];
  const rows = tables.scheduled_posts ?? [];
  for (const recharge of asRows(params.p_recharges)) {
    const requested = recharge.take;
    if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 0) {
      return { data: null, error: { message: 'batch clawback take must be a whole number of tokens' } };
    }
    const take = Math.min(requested, credited);
    if (take <= 0) continue;
    const row = rows.find(
      (candidate) =>
        candidate.id === recharge.slot_id &&
        candidate.user_id === userId &&
        candidate.status !== 'failed' &&
        candidate.charged_tokens === recharge.expected_charged &&
        candidate.discount_tokens === recharge.expected_discount &&
        typeof candidate.discount_tokens === 'number' &&
        candidate.discount_tokens >= take,
    );
    if (!row) continue;
    row.charged_tokens = (row.charged_tokens as number) + take;
    row.discount_tokens = (row.discount_tokens as number) - take;
    credited -= take;
    recharges.push({ slot_id: recharge.slot_id, take });
  }
  return { data: { ok: true, refunds, recharges }, error: null };
}

export function createFakeSupabase(options: FakeOptions) {
  const rpcCalls: RpcCall[] = [];
  const updates: { table: string; patch: Row; filters: Filter[] }[] = [];

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let returning = false;
    const orders: { column: string; ascending: boolean }[] = [];

    function run(): { data: unknown; error: unknown } {
      const rows = options.tables[table] ?? [];
      if (mode === 'delete') {
        const keep = rows.filter((row) => !matches(row, filters));
        rows.splice(0, rows.length, ...keep);
        return { data: null, error: null };
      }
      if (mode === 'update') {
        const failure = options.updateError?.[table];
        if (failure !== undefined) return { data: null, error: failure };
        const hit = rows.filter((row) => matches(row, filters));
        for (const row of hit) Object.assign(row, patch);
        updates.push({ table, patch, filters: [...filters] });
        return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
      }
      const failure = options.selectError?.[table];
      if (failure !== undefined) return { data: null, error: failure };
      const hit = rows.filter((row) => matches(row, filters)).map((row) => ({ ...row }));
      for (const order of [...orders].reverse()) {
        hit.sort((a, b) => {
          const left = String(a[order.column]);
          const right = String(b[order.column]);
          return order.ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      return { data: hit, error: null };
    }

    const api = {
      select(_columns?: string) {
        if (mode === 'update') returning = true;
        return api;
      },
      update(values: Row) {
        mode = 'update';
        patch = values;
        return api;
      },
      delete() {
        mode = 'delete';
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, op: 'eq', value });
        return api;
      },
      in(column: string, value: unknown[]) {
        filters.push({ column, op: 'in', value });
        return api;
      },
      is(column: string, value: unknown) {
        filters.push({ column, op: 'is', value });
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orders.push({ column, ascending: opts?.ascending !== false });
        return api;
      },
      then<T>(resolve: (value: { data: unknown; error: unknown }) => T, reject?: (reason: unknown) => T) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, params: Record<string, unknown>) => {
      const call = { name, params };
      rpcCalls.push(call);
      if (options.rpc) return options.rpc(call);
      if (name === 'settle_batch_clawback') return simulateSettleBatchClawback(options.tables, params);
      return { data: { refunded: true }, error: null };
    },
  };
  return { client, rpcCalls, updates, tables: options.tables };
}

/** A scheduled_posts row with every column the batch rules read. */
export function slotRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    schedule_id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    user_id: 'user-1',
    faceless: false,
    status: 'generating',
    charged_tokens: 2,
    discount_tokens: 0,
    created_at: '2026-11-08T10:00:00.000Z',
    task_id: `task-${id}`,
    batch_id: null,
    ...overrides,
  };
}
