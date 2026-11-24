import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import type { UserPromptRow } from '@/lib/user-prompts';

interface DbError {
  code: string;
  message: string;
}

interface Outcome {
  data: unknown;
  error: DbError | null;
}

type Operation = 'select' | 'insert' | 'update' | 'delete';

export interface FakePromptVersion {
  id: string;
  prompt_id: string | null;
  owner_id: string;
  source: 'user';
  slug: string;
  title: string;
  version: number;
  body: string;
  body_hash: string;
  created_at: string;
}

export interface FakeUserPromptsDb {
  client: SupabaseClient<Database>;
  rows: UserPromptRow[];
  versions: FakePromptVersion[];
  queries: string[];
  failNext: (code: string) => void;
  beforeNextUpdate: (hook: () => void) => void;
}

export function createFakeUserPromptsDb(seed: Partial<UserPromptRow>[] = []): FakeUserPromptsDb {
  const rows: UserPromptRow[] = [];
  const versions: FakePromptVersion[] = [];
  const queries: string[] = [];
  let pendingFailure: string | null = null;
  let pendingUpdateHook: (() => void) | null = null;
  let clock = Date.now();
  const now = (): string => new Date(++clock).toISOString();

  function insertRow(values: Partial<UserPromptRow>): UserPromptRow {
    const stamp = now();
    const base: UserPromptRow = {
      id: randomUUID(),
      owner_id: '',
      slug: '',
      title: '',
      description: '',
      body: '',
      visibility: 'private',
      verified: false,
      created_at: stamp,
      updated_at: stamp,
      ...values,
    };
    return base;
  }

  function recordVersion(row: UserPromptRow): void {
    const latest = versions.filter((entry) => entry.prompt_id === row.id).sort((a, b) => b.version - a.version)[0];
    if (latest !== undefined && latest.body === row.body) return;
    versions.push({
      id: randomUUID(),
      prompt_id: row.id,
      owner_id: row.owner_id,
      source: 'user',
      slug: row.slug,
      title: row.title,
      version: (latest?.version ?? 0) + 1,
      body: row.body,
      body_hash: createHash('sha256').update(row.body, 'utf8').digest('hex'),
      created_at: now(),
    });
  }

  for (const entry of seed) {
    const row = insertRow(entry);
    rows.push(row);
    recordVersion(row);
  }

  function violatesUnique(candidate: UserPromptRow, ignoreId: string | null): boolean {
    return rows.some(
      (other) =>
        other.id !== ignoreId &&
        ((other.owner_id === candidate.owner_id && other.slug === candidate.slug) ||
          (candidate.visibility === 'public' && other.visibility === 'public' && other.slug === candidate.slug)),
    );
  }

  function applyUpdate(before: UserPromptRow, values: Partial<UserPromptRow>): UserPromptRow {
    return { ...before, ...values, updated_at: now() };
  }

  class Query implements PromiseLike<Outcome> {
    private operation: Operation = 'select';
    private values: Partial<UserPromptRow> = {};
    private filters: Array<(row: UserPromptRow) => boolean> = [];
    private sorting: Array<{ column: keyof UserPromptRow; ascending: boolean }> = [];
    private max: number | null = null;
    private returning = false;
    private shape: 'many' | 'single' | 'maybe' = 'many';
    private label: string[] = [];

    select(columns: string): this {
      if (this.operation === 'select') this.label.push(`select ${columns}`);
      this.returning = true;
      return this;
    }

    insert(values: Partial<UserPromptRow>): this {
      this.operation = 'insert';
      this.values = values;
      this.label.push('insert');
      return this;
    }

    update(values: Partial<UserPromptRow>): this {
      this.operation = 'update';
      this.values = values;
      this.label.push('update');
      return this;
    }

    delete(): this {
      this.operation = 'delete';
      this.label.push('delete');
      return this;
    }

    eq(column: keyof UserPromptRow, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      this.label.push(`eq ${String(column)}=${String(value)}`);
      return this;
    }

    in(column: keyof UserPromptRow, values: unknown[]): this {
      this.filters.push((row) => values.includes(row[column]));
      this.label.push(`in ${String(column)}=${values.join('|')}`);
      return this;
    }

    or(expression: string): this {
      const conditions = expression.split(',').map((condition) => {
        const [column, operator, pattern] = condition.split('.');
        if (operator !== 'ilike') throw new Error(`unsupported or condition ${condition}`);
        return { column: column as keyof UserPromptRow, needle: pattern.split('%').join('').toLowerCase() };
      });
      this.filters.push((row) => conditions.some(({ column, needle }) => String(row[column]).toLowerCase().includes(needle)));
      this.label.push(`or ${expression}`);
      return this;
    }

    order(column: keyof UserPromptRow, options: { ascending: boolean }): this {
      this.sorting.push({ column, ascending: options.ascending });
      return this;
    }

    limit(count: number): this {
      this.max = count;
      return this;
    }

    single(): this {
      this.shape = 'single';
      return this;
    }

    maybeSingle(): this {
      this.shape = 'maybe';
      return this;
    }

    private run(): Outcome {
      queries.push(this.label.join(' '));
      if (this.operation === 'update' && pendingUpdateHook !== null) {
        const hook = pendingUpdateHook;
        pendingUpdateHook = null;
        hook();
      }
      if (pendingFailure !== null) {
        const code = pendingFailure;
        pendingFailure = null;
        return { data: null, error: { code, message: 'forced failure' } };
      }
      const matches = rows.filter((row) => this.filters.every((filter) => filter(row)));
      let affected: UserPromptRow[] = matches;
      if (this.operation === 'insert') {
        const created = insertRow(this.values);
        if (violatesUnique(created, null)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        rows.push(created);
        recordVersion(created);
        affected = [created];
      } else if (this.operation === 'update') {
        const updated: UserPromptRow[] = [];
        for (const row of matches) {
          const next = applyUpdate(row, this.values);
          if (violatesUnique(next, row.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          rows[rows.indexOf(row)] = next;
          recordVersion(next);
          updated.push(next);
        }
        affected = updated;
      } else if (this.operation === 'delete') {
        for (const row of matches) {
          rows.splice(rows.indexOf(row), 1);
          for (const entry of versions) if (entry.prompt_id === row.id) entry.prompt_id = null;
        }
      }
      if (this.operation !== 'select' && !this.returning) return { data: null, error: null };
      const ordered = [...affected].sort((left, right) => {
        for (const { column, ascending } of this.sorting) {
          const compared = String(left[column]).localeCompare(String(right[column]));
          if (compared !== 0) return ascending ? compared : -compared;
        }
        return 0;
      });
      const limited = this.max === null ? ordered : ordered.slice(0, this.max);
      if (this.shape === 'many') return { data: limited, error: null };
      if (limited.length === 0) {
        return this.shape === 'single'
          ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          : { data: null, error: null };
      }
      return { data: limited[0], error: null };
    }

    then<Result1 = Outcome, Result2 = never>(
      onfulfilled?: ((value: Outcome) => Result1 | PromiseLike<Result1>) | null,
      onrejected?: ((reason: unknown) => Result2 | PromiseLike<Result2>) | null,
    ): PromiseLike<Result1 | Result2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  type VersionColumn = keyof FakePromptVersion;

  class VersionQuery implements PromiseLike<Outcome> {
    private columns: VersionColumn[] | null = null;
    private filters: Array<(entry: FakePromptVersion) => boolean> = [];
    private descending = false;
    private max: number | null = null;
    private shape: 'many' | 'maybe' = 'many';
    private label: string[] = ['prompt_versions'];

    select(columns: string): this {
      this.columns = columns.split(',').map((column) => column.trim() as VersionColumn);
      this.label.push(`select ${columns}`);
      return this;
    }

    eq(column: string, value: unknown): this {
      if (column !== 'prompt_id' && column !== 'version') throw new Error(`unsupported prompt_versions filter ${column}`);
      this.filters.push((entry) => entry[column] === value);
      this.label.push(`eq ${column}=${String(value)}`);
      return this;
    }

    lt(column: string, value: number): this {
      if (column !== 'version') throw new Error(`unsupported prompt_versions filter ${column}`);
      this.filters.push((entry) => entry.version < value);
      this.label.push(`lt ${column}=${value}`);
      return this;
    }

    order(column: string, options: { ascending: boolean }): this {
      if (column !== 'version') throw new Error(`unsupported prompt_versions order ${column}`);
      this.descending = !options.ascending;
      this.label.push(`order ${column} ${options.ascending ? 'asc' : 'desc'}`);
      return this;
    }

    limit(count: number): this {
      this.max = count;
      this.label.push(`limit ${count}`);
      return this;
    }

    maybeSingle(): this {
      this.shape = 'maybe';
      return this;
    }

    private run(): Outcome {
      queries.push(this.label.join(' '));
      if (pendingFailure !== null) {
        const code = pendingFailure;
        pendingFailure = null;
        return { data: null, error: { code, message: 'forced failure' } };
      }
      const ordered = versions
        .filter((entry) => this.filters.every((filter) => filter(entry)))
        .sort((a, b) => (this.descending ? b.version - a.version : a.version - b.version));
      const limited = this.max === null ? ordered : ordered.slice(0, this.max);
      const columns = this.columns;
      const project = (entry: FakePromptVersion): Partial<FakePromptVersion> =>
        columns === null ? entry : Object.fromEntries(columns.map((column) => [column, entry[column]]));
      if (this.shape === 'many') return { data: limited.map(project), error: null };
      return { data: limited.length === 0 ? null : project(limited[0]), error: null };
    }

    then<Result1 = Outcome, Result2 = never>(
      onfulfilled?: ((value: Outcome) => Result1 | PromiseLike<Result1>) | null,
      onrejected?: ((reason: unknown) => Result2 | PromiseLike<Result2>) | null,
    ): PromiseLike<Result1 | Result2> {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from(table: string): Query | VersionQuery {
      if (table === 'prompt_versions') return new VersionQuery();
      if (table !== 'user_prompts') throw new Error(`unexpected table ${table}`);
      return new Query();
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    rows,
    versions,
    queries,
    failNext: (code: string) => {
      pendingFailure = code;
    },
    beforeNextUpdate: (hook: () => void) => {
      pendingUpdateHook = hook;
    },
  };
}
