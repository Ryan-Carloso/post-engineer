import { isPublishProvider, type PublishLink } from '@/lib/publish-links';

export interface ProgressHistoryEntry {
  progress: number;
  stage: string | null;
  recordedAt: string;
}

export interface GenerationFacts {
  faceless: boolean;
  language: string | null;
  voiceId: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  niche: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
}

export function narrowPublishLinks(value: unknown): PublishLink[] {
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

export function narrowProgressHistory(value: unknown): ProgressHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ProgressHistoryEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.progress !== 'number' || !Number.isFinite(record.progress)) continue;
    if (typeof record.recordedAt !== 'string') continue;
    entries.push({
      progress: record.progress,
      stage: typeof record.stage === 'string' ? record.stage : null,
      recordedAt: record.recordedAt,
    });
  }
  return entries;
}

export function narrowGeneration(value: unknown): GenerationFacts {
  const fallback: GenerationFacts = {
    faceless: false,
    language: null,
    voiceId: null,
    videoAspect: null,
    videoLayout: null,
    niche: null,
    paragraphNumber: null,
    faceQuality: null,
  };
  if (typeof value !== 'object' || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof record[key] === 'string' ? (record[key] as string) : null;
  const paragraphNumber = record.paragraphNumber;
  return {
    faceless: record.faceless === true,
    language: text('language'),
    voiceId: text('voiceId'),
    videoAspect: text('videoAspect'),
    videoLayout: text('videoLayout'),
    niche: text('niche'),
    paragraphNumber:
      typeof paragraphNumber === 'number' && Number.isFinite(paragraphNumber)
        ? paragraphNumber
        : null,
    faceQuality: text('faceQuality'),
  };
}
