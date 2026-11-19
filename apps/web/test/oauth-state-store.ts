export interface OAuthStateRow {
  state_hash: string;
  user_id: string;
  provider: string;
  nonce: string;
  redirect_uri: string;
  expires_at: string;
  code_verifier?: string | null;
}

type RowColumn = keyof OAuthStateRow;
type RowPredicate = (row: OAuthStateRow) => boolean;

export interface FakeOAuthStateStore {
  rows: Map<string, OAuthStateRow>;
  tables: string[];
  from: (table: string) => FakeOAuthStatesTable;
}

interface DeleteChain {
  eq: (column: RowColumn, value: string) => DeleteChain;
  gt: (column: 'expires_at', value: string) => DeleteChain;
  lte: (column: 'expires_at', value: string) => Promise<{ error: null }>;
  select: (columns: string) => Promise<{ data: Array<Partial<OAuthStateRow>>; error: null }>;
}

interface FakeOAuthStatesTable {
  insert: (row: OAuthStateRow) => Promise<{ error: null }>;
  delete: () => DeleteChain;
  select: (columns: string) => {
    eq: (
      column: RowColumn,
      value: string
    ) => { maybeSingle: () => Promise<{ data: Partial<OAuthStateRow> | null; error: null }> };
  };
}

function isoTime(value: string): number {
  return new Date(value).getTime();
}

function pickColumns(row: OAuthStateRow, columns: string): Partial<OAuthStateRow> {
  const picked: Partial<OAuthStateRow> = {};
  for (const raw of columns.split(',')) {
    const column = raw.trim();
    if (column === 'code_verifier') {
      picked.code_verifier = row.code_verifier ?? null;
    } else if (column === 'state_hash' || column === 'user_id' || column === 'provider' ||
        column === 'nonce' || column === 'redirect_uri' || column === 'expires_at') {
      picked[column] = row[column];
    }
  }
  return picked;
}

export function makeOAuthStateStore(
  rows: Map<string, OAuthStateRow> = new Map()
): FakeOAuthStateStore {
  const tables: string[] = [];

  function matching(predicates: RowPredicate[]): OAuthStateRow[] {
    return [...rows.values()].filter((row) => predicates.every((p) => p(row)));
  }

  function removeMatching(predicates: RowPredicate[]): OAuthStateRow[] {
    const removed = matching(predicates);
    for (const row of removed) rows.delete(row.state_hash);
    return removed;
  }

  function deleteChain(predicates: RowPredicate[]): DeleteChain {
    return {
      eq: (column, value) => deleteChain([...predicates, (row) => row[column] === value]),
      gt: (column, value) =>
        deleteChain([...predicates, (row) => isoTime(row[column]) > isoTime(value)]),
      lte: async (column, value) => {
        removeMatching([...predicates, (row) => isoTime(row[column]) <= isoTime(value)]);
        return { error: null };
      },
      select: async (columns) => ({
        data: removeMatching(predicates).map((row) => pickColumns(row, columns)),
        error: null,
      }),
    };
  }

  return {
    rows,
    tables,
    from(table: string): FakeOAuthStatesTable {
      tables.push(table);
      if (table !== 'oauth_states') {
        throw new Error(`fake oauth_states store queried for unexpected table ${table}`);
      }
      return {
        insert: async (row) => {
          rows.set(row.state_hash, row);
          return { error: null };
        },
        delete: () => deleteChain([]),
        select: (columns) => ({
          eq: (column, value) => ({
            maybeSingle: async () => {
              const row = [...rows.values()].find((r) => r[column] === value);
              return { data: row === undefined ? null : pickColumns(row, columns), error: null };
            },
          }),
        }),
      };
    },
  };
}
