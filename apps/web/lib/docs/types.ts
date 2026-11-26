import type { SocialProvider } from '@/lib/contracts/providers';

export type DocLocale = 'pt' | 'en';

export type LocalizedText = { pt?: string; en: string };

export function localize(text: LocalizedText, locale: DocLocale): string {
  if (locale === 'pt') return text.pt ?? text.en;
  return text.en;
}

export type DocBlock =
  | { kind: 'heading'; level: 2 | 3; text: LocalizedText }
  | { kind: 'paragraph'; text: LocalizedText }
  | { kind: 'list'; items: LocalizedText[] }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'link'; href: LocalizedText; text: LocalizedText }
  | { kind: 'toolList' }
  | { kind: 'providerList'; providers: readonly SocialProvider[] }
  | { kind: 'tokenCostTable' };

export interface DocPage {
  section: 'docs' | 'help';
  slug: string | null;
  title: LocalizedText;
  description: LocalizedText;
  updatedAt: string;
  contentHash: string;
  blocks: DocBlock[];
}
