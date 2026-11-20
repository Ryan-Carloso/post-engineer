import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { UserPromptStatusSchema, type UserPromptStatus } from '@/lib/contracts/prompts';

type Db = SupabaseClient<Database>;

export type UserPromptRow = Database['public']['Tables']['user_prompts']['Row'];

export const USER_PROMPT_LIST_LIMIT = 200;
export const PROMPT_REVIEW_QUEUE_LIMIT = 100;

const COLUMNS =
  'id, owner_id, slug, title, description, body, status, content_hash, approved_hash, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at';

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
}

export interface UserPromptPatch {
  title?: string;
  description?: string;
  prompt?: string;
}

export type CreateOutcome = { kind: 'created'; row: UserPromptRow } | { kind: 'slug_taken' };

export type VisibilityOutcome =
  | { kind: 'updated'; row: UserPromptRow; changed: boolean }
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: UserPromptStatus };

export type ReviewOutcome =
  | { kind: 'reviewed'; row: UserPromptRow }
  | { kind: 'not_found' }
  | { kind: 'stale' }
  | { kind: 'slug_taken' };

export interface ReviewRequest {
  id: string;
  reviewerId: string;
  contentHash: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

function fail(operation: string, error: unknown): never {
  throw new UserPromptStoreError(operation, error);
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export function isApprovedAndUnchanged(row: UserPromptRow): boolean {
  return row.status === 'approved' && row.approved_hash !== null && row.approved_hash === row.content_hash;
}

export async function createUserPrompt(db: Db, ownerId: string, input: NewUserPrompt): Promise<CreateOutcome> {
  const { data, error } = await db
    .from('user_prompts')
    .insert({ owner_id: ownerId, slug: input.slug, title: input.title, description: input.description, body: input.prompt })
    .select(COLUMNS)
    .single();
  if (error !== null) {
    if (isUniqueViolation(error)) return { kind: 'slug_taken' };
    return fail('insert', error);
  }
  return { kind: 'created', row: data };
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

export async function listOwnUserPrompts(db: Db, ownerId: string): Promise<UserPromptRow[]> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(USER_PROMPT_LIST_LIMIT);
  if (error !== null) return fail('list own', error);
  return data;
}

export async function listApprovedUserPrompts(db: Db): Promise<UserPromptRow[]> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(USER_PROMPT_LIST_LIMIT);
  if (error !== null) return fail('list approved', error);
  return data.filter(isApprovedAndUnchanged);
}

export async function findApprovedUserPrompt(db: Db, slug: string): Promise<UserPromptRow | null> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('status', 'approved')
    .eq('slug', slug)
    .maybeSingle();
  if (error !== null) return fail('find approved', error);
  if (data === null || !isApprovedAndUnchanged(data)) return null;
  return data;
}

export async function updateOwnUserPrompt(
  db: Db,
  ownerId: string,
  slug: string,
  patch: UserPromptPatch,
): Promise<UserPromptRow | null> {
  const columns: Database['public']['Tables']['user_prompts']['Update'] = {};
  if (patch.title !== undefined) columns.title = patch.title;
  if (patch.description !== undefined) columns.description = patch.description;
  if (patch.prompt !== undefined) columns.body = patch.prompt;
  const { data, error } = await db
    .from('user_prompts')
    .update(columns)
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) return fail('update own', error);
  return data;
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

async function explainMissedTransition(
  db: Db,
  ownerId: string,
  slug: string,
  acceptable: UserPromptStatus,
): Promise<VisibilityOutcome> {
  const current = await findOwnUserPrompt(db, ownerId, slug);
  if (current === null) return { kind: 'not_found' };
  if (current.status === acceptable) return { kind: 'updated', row: current, changed: false };
  return { kind: 'conflict', status: UserPromptStatusSchema.parse(current.status) };
}

export async function requestPublication(db: Db, ownerId: string, slug: string): Promise<VisibilityOutcome> {
  const { data, error } = await db
    .from('user_prompts')
    .update({ status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null })
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .in('status', ['private', 'rejected'])
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) return fail('request publication', error);
  if (data !== null) return { kind: 'updated', row: data, changed: true };
  return explainMissedTransition(db, ownerId, slug, 'pending');
}

export async function withdrawPublication(db: Db, ownerId: string, slug: string): Promise<VisibilityOutcome> {
  const { data, error } = await db
    .from('user_prompts')
    .update({ status: 'private', approved_hash: null, rejection_reason: null, reviewed_by: null, reviewed_at: null })
    .eq('owner_id', ownerId)
    .eq('slug', slug)
    .in('status', ['pending', 'approved', 'rejected'])
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) return fail('withdraw publication', error);
  if (data !== null) return { kind: 'updated', row: data, changed: true };
  return explainMissedTransition(db, ownerId, slug, 'private');
}

export async function listPendingUserPrompts(db: Db): Promise<{ rows: UserPromptRow[]; truncated: boolean }> {
  const { data, error } = await db
    .from('user_prompts')
    .select(COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(PROMPT_REVIEW_QUEUE_LIMIT + 1);
  if (error !== null) return fail('list pending', error);
  return { rows: data.slice(0, PROMPT_REVIEW_QUEUE_LIMIT), truncated: data.length > PROMPT_REVIEW_QUEUE_LIMIT };
}

export async function reviewUserPrompt(db: Db, request: ReviewRequest): Promise<ReviewOutcome> {
  const reviewedAt = new Date().toISOString();
  const decision: Database['public']['Tables']['user_prompts']['Update'] =
    request.decision === 'approve'
      ? { status: 'approved', approved_hash: request.contentHash, rejection_reason: null }
      : { status: 'rejected', approved_hash: null, rejection_reason: request.reason ?? null };
  const { data, error } = await db
    .from('user_prompts')
    .update({ ...decision, reviewed_by: request.reviewerId, reviewed_at: reviewedAt })
    .eq('id', request.id)
    .eq('status', 'pending')
    .eq('content_hash', request.contentHash)
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) {
    if (isUniqueViolation(error)) return { kind: 'slug_taken' };
    return fail('review', error);
  }
  if (data !== null) return { kind: 'reviewed', row: data };
  const { data: existing, error: lookupError } = await db
    .from('user_prompts')
    .select('id')
    .eq('id', request.id)
    .maybeSingle();
  if (lookupError !== null) return fail('review lookup', lookupError);
  return existing === null ? { kind: 'not_found' } : { kind: 'stale' };
}
