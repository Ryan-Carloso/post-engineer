import { isFirstCommentWarningCode } from '@/lib/contracts/first-comment';
import type { FirstCommentOutcomeWarning } from '@/lib/first-comment/outcome-warnings';
import { isPublishProvider, type PublishLink } from '@/lib/publish-links';

function narrowPublishLinks(value: unknown): PublishLink[] {
  if (!Array.isArray(value)) return [];
  const links: PublishLink[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const provider = record.provider;
    const url = record.url;
    if (!isPublishProvider(provider) || typeof url !== 'string') continue;
    if (!url.startsWith('https://')) continue;
    links.push({ provider, url });
  }
  return links;
}

export interface PostPromptFacts {
  slug: string;
  title: string;
  version: number;
  source: 'official' | 'user';
}

export type SlotMediaKind = 'upload' | 'image';

export function displayMediaKind(
  storageKind: SlotMediaKind | null,
  contentType: string | null,
): SlotMediaKind | null {
  if (contentType !== null && contentType.startsWith('image/')) return 'image';
  return storageKind;
}

export interface SlotMedia {
  kind: SlotMediaKind;
  url: string | null;
  contentType: string | null;
}

export function narrowSlotMedia(value: unknown): SlotMedia | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'upload' && record.kind !== 'image') return null;
  return {
    kind: record.kind,
    url: typeof record.url === 'string' && record.url.length > 0 ? record.url : null,
    contentType: typeof record.contentType === 'string' ? record.contentType : null,
  };
}

export function narrowCommentWarnings(value: unknown): FirstCommentOutcomeWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: FirstCommentOutcomeWarning[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.provider !== 'string' || typeof record.accountId !== 'string') continue;
    if (!isFirstCommentWarningCode(record.code)) continue;
    warnings.push({ provider: record.provider, accountId: record.accountId, code: record.code });
  }
  return warnings;
}

export interface NarrowedSlotFields {
  publishLinks: PublishLink[];
  firstComment: string | null;
  commentWarnings: FirstCommentOutcomeWarning[];
  media: SlotMedia | null;
}

export function narrowSlotFields(slot: object): NarrowedSlotFields {
  const record = slot as Record<string, unknown>;
  return {
    publishLinks: narrowPublishLinks(record.publishLinks),
    firstComment: typeof record.firstComment === 'string' ? record.firstComment : null,
    commentWarnings: narrowCommentWarnings(record.commentWarnings),
    media: narrowSlotMedia(record.media),
  };
}

export function narrowPostPrompt(value: unknown): PostPromptFacts | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { slug, title, version, source } = record;
  if (typeof slug !== 'string' || typeof title !== 'string' || typeof version !== 'number') return null;
  if (source !== 'official' && source !== 'user') return null;
  return { slug, title, version, source };
}
