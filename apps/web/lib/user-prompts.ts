import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import type { PromptVisibility } from '@/lib/contracts/prompts';
import { searchOrClause } from '@/lib/prompt-search';

type Db = SupabaseClient<Database>;

export type UserPromptRow = Database['public']['Tables']['user_prompts']['Row'];

export const USER_PROMPT_LIST_LIMIT = 200;

const COLUMNS = 'id, owner_id, slug, title, description, body, visibility, created_at, updated_at';

const UNIQUE_VIOLATION = '23505';

export class UserPromptStoreError extends Error {
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`user_prompts ${operation} failed`);
    this.name = 'UserPromptStoreError';
    this.cause = cause;
  }
}

export interface NewUserPrompt {
  slug: string;
  title: string;
  description: string;
  prompt: string;
  visibility: PromptVisibility;
}

export interface UserPromptPatch {
  title?: string;
  description?: string;
  prompt?: string;
  visibility?: PromptVisibility;
}

export type WriteOutcome =
  | { kind: 'saved'; row: UserPromptRow }
  | { kind: 'not_found' }
  | { kind: 'slug_taken' };

function fail(operation: string, error: unknown): never {
  throw new UserPromptStoreError(operation, error);
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export async function createUserPrompt(db: Db, ownerId: string, input: NewUserPrompt): Promise<WriteOutcome> {
  const { data, error } = await db
    .from('user_prompts')
    .insert({
      owner_id: ownerId,
      slug: input.slug,
      title: input.title,
      description: input.description,
      body: input.prompt,
      visibility: input.visibility,
    })
    .select(COLUMNS)
    .single();
  if (error !== null) {
    if (isUniqueViolation(error)) return { kind: 'slug_taken' };
    return fail('insert', error);
  }
  return { kind: 'saved', row: data };
}

export async function findOwnUserPrompt(db: Db, ownerId: string, slug: string): Promise<UserPromptRow | null> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .maybeSingle();
  if (error !== null) return fail('find own', error);
  return data;
}

function withSearchTerms<Query extends { or: (filters: string) => Query }>(query: Query, terms: string[]): Query {
  return terms.reduce((next, term) => next.or(searchOrClause(term)), query);
}

export async function listOwnUserPrompts(db: Db, ownerId: string, terms: string[] = []): Promise<UserPromptRow[]> {
  const { data, error } = await withSearchTerms(db.from('user_prompts').select(COLUMNS).eq('owner_id', ownerId), terms)
    .order('created_at', { ascending: false })
    .limit(USER_PROMPT_LIST_LIMIT);
  if (error !== null) return fail('list own', error);
  return data;
}

export async function listOwnPromptSlugs(db: Db, ownerId: string): Promise<string[]> {
  const { data, error } = await db.from('user_prompts').select('slug').eq('owner_id', ownerId).limit(USER_PROMPT_LIST_LIMIT);
  if (error !== null) return fail('list own slugs', error);
  return data.map((row) => row.slug);
}

export async function listPublicUserPrompts(db: Db, terms: string[] = []): Promise<UserPromptRow[]> {
  const { data, error } = await withSearchTerms(db.from('user_prompts').select(COLUMNS).eq('visibility', 'public'), terms)
    .order('created_at', { ascending: false })
    .limit(USER_PROMPT_LIST_LIMIT);
  if (error !== null) return fail('list public', error);
  return data;
}

export async function findPublicUserPrompt(db: Db, slug: string): Promise<UserPromptRow | null> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('visibility', 'public')
    .eq('slug', slug)
    .maybeSingle();
  if (error !== null) return fail('find public', error);
  return data;
}

export async function updateOwnUserPrompt(
  db: Db,
  ownerId: string,
  slug: string,
  patch: UserPromptPatch,
): Promise<WriteOutcome> {
  const columns: Database['public']['Tables']['user_prompts']['Update'] = {};
  if (patch.title !== undefined) columns.title = patch.title;
  if (patch.description !== undefined) columns.description = patch.description;
  if (patch.prompt !== undefined) columns.body = patch.prompt;
  if (patch.visibility !== undefined) columns.visibility = patch.visibility;
  const { data, error } = await db
    .from('user_prompts')
    .update(columns)
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) {
    if (isUniqueViolation(error)) return { kind: 'slug_taken' };
    return fail('update own', error);
  }
  return data === null ? { kind: 'not_found' } : { kind: 'saved', row: data };
}

export async function deleteOwnUserPrompt(db: Db, ownerId: string, slug: string): Promise<boolean> {
  const { data, error } = await db
    .from('user_prompts')
    .delete()
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .select('id');
  if (error !== null) return fail('delete own', error);
  return data.length > 0;
}
