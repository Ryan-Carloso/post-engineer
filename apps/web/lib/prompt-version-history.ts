import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { PROMPT_VERSION_PREVIEW_LENGTH } from '@/lib/contracts/prompts';
import { currentUserPromptVersion } from '@/lib/prompt-versions';
import { findOwnUserPrompt, UserPromptStoreError, type UserPromptRow } from '@/lib/user-prompts';

type Db = SupabaseClient<Database>;

const PROMPT_COLUMNS = 'id, owner_id, slug, title, description, body, visibility, verified, created_at, updated_at';

interface PromptVersionSummary {
  versionId: string;
  version: number;
  title: string;
  createdAt: string;
  preview: string;
  previewTruncated: boolean;
  bodyLength: number;
  current: boolean;
}

export interface PromptVersionPage {
  currentVersion: number;
  versions: PromptVersionSummary[];
  truncated: boolean;
  nextCursor: number | null;
}

export interface PromptVersionDetail {
  versionId: string;
  version: number;
  title: string;
  createdAt: string;
  body: string;
  current: boolean;
}

export type RestoreOutcome =
  | { kind: 'not_found' }
  | { kind: 'version_not_found' }
  | { kind: 'conflict' }
  | { kind: 'unchanged'; row: UserPromptRow }
  | { kind: 'restored'; row: UserPromptRow };

export function previewOf(body: string): { preview: string; previewTruncated: boolean } {
  const points = Array.from(body);
  if (points.length <= PROMPT_VERSION_PREVIEW_LENGTH) return { preview: body, previewTruncated: false };
  return { preview: points.slice(0, PROMPT_VERSION_PREVIEW_LENGTH).join(''), previewTruncated: true };
}

export async function listUserPromptVersions(
  db: Db,
  promptId: string,
  options: { limit: number; before?: number },
): Promise<PromptVersionPage> {
  const { version: currentVersion } = await currentUserPromptVersion(db, promptId);
  const base = db.from('prompt_versions').select('id, version, title, body, created_at').eq('prompt_id', promptId);
  const { data, error } = await (options.before === undefined ? base : base.lt('version', options.before))
    .order('version', { ascending: false })
    .limit(options.limit + 1);
  if (error !== null) throw new UserPromptStoreError('list versions', error);
  const truncated = data.length > options.limit;
  const versions = data.slice(0, options.limit).map((row) => ({
    versionId: row.id,
    version: row.version,
    title: row.title,
    createdAt: row.created_at,
    ...previewOf(row.body),
    bodyLength: Array.from(row.body).length,
    current: row.version === currentVersion,
  }));
  return { currentVersion, versions, truncated, nextCursor: truncated ? versions[versions.length - 1].version : null };
}

export async function readUserPromptVersion(
  db: Db,
  promptId: string,
  version: number,
): Promise<{ id: string; version: number; title: string; body: string; created_at: string } | null> {
  const { data, error } = await db
    .from('prompt_versions')
    .select('id, version, title, body, created_at')
    .eq('prompt_id', promptId)
    .eq('version', version)
    .maybeSingle();
  if (error !== null) throw new UserPromptStoreError('read version', error);
  return data;
}

export async function getUserPromptVersion(db: Db, promptId: string, version: number): Promise<PromptVersionDetail | null> {
  const row = await readUserPromptVersion(db, promptId, version);
  if (row === null) return null;
  const current = await currentUserPromptVersion(db, promptId);
  return {
    versionId: row.id,
    version: row.version,
    title: row.title,
    createdAt: row.created_at,
    body: row.body,
    current: row.version === current.version,
  };
}

export async function restoreUserPromptVersion(
  db: Db,
  ownerId: string,
  slug: string,
  version: number,
  expectedCurrentVersion: number,
): Promise<RestoreOutcome> {
  const row = await findOwnUserPrompt(db, ownerId, slug);
  if (row === null) return { kind: 'not_found' };
  const current = await currentUserPromptVersion(db, row.id);
  if (current.version !== expectedCurrentVersion) return { kind: 'conflict' };
  const target = await readUserPromptVersion(db, row.id, version);
  if (target === null) return { kind: 'version_not_found' };
  if (target.body === row.body) return { kind: 'unchanged', row };
  const { data, error } = await db
    .from('user_prompts')
    .update({ body: target.body })
    .eq('id', row.id)
    .eq('owner_id', ownerId)
    .eq('updated_at', row.updated_at)
    .select(PROMPT_COLUMNS)
    .maybeSingle();
  if (error !== null) throw new UserPromptStoreError('restore version', error);
  return data === null ? { kind: 'conflict' } : { kind: 'restored', row: data };
}
