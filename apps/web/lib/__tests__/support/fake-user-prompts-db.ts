import { randomUUID } from 'node:crypto';
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

export interface FakeUserPromptsDb {
  client: SupabaseClient<Database>;
  rows: UserPromptRow[];
  queries: string[];
  failNext: (code: string) => void;
}

export function createFakeUserPromptsDb(seed: Partial<UserPromptRow>[] = []): FakeUserPromptsDb {
  const rows: UserPromptRow[] = [];
  const queries: string[] = [];
  let pendingFailure: string | null = null;
  const now = (): string => new Date().toISOString();

  function insertRow(values: Partial<UserPromptRow>): UserPromptRow {
    const base: UserPromptRow = {
      id: randomUUID(),
      owner_id: '',
      slug: '',
      title: '',
      description: '',
      body: '',
      visibility: 'private',
      created_at: now(),
      updated_at: now(),
      ...values,
    };
    return base;
  }

  for (const entry of seed) rows.push(insertRow(entry));

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
    private sorting: { column: keyof UserPromptRow; ascending: boolean } | null = null;
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
      this.sorting = { column, ascending: options.ascending };
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
        affected = [created];
      } else if (this.operation === 'update') {
        const updated: UserPromptRow[] = [];
        for (const row of matches) {
          const next = applyUpdate(row, this.values);
          if (violatesUnique(next, row.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          rows[rows.indexOf(row)] = next;
          updated.push(next);
        }
        affected = updated;
      } else if (this.operation === 'delete') {
        for (const row of matches) rows.splice(rows.indexOf(row), 1);
      }
      if (this.operation !== 'select' && !this.returning) return { data: null, error: null };
      const sorting = this.sorting;
      const ordered =
        sorting === null
          ? affected
          : [...affected].sort((left, right) => {
            const a = String(left[sorting.column]);
            const b = String(right[sorting.column]);
            return sorting.ascending ? a.localeCompare(b) : b.localeCompare(a);
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

  const client = {
    from(table: string): Query {
      if (table !== 'user_prompts') throw new Error(`unexpected table ${table}`);
      return new Query();
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    rows,
    queries,
    failNext: (code: string) => {
      pendingFailure = code;
    },
  };
}
