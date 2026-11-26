import { helpConnectAccounts } from './content/help-conectar-contas';
import { helpIndex } from './content/help-index';
import { helpFirstSteps } from './content/help-primeiros-passos';
import { helpTokens } from './content/help-tokens';
import { apiGuide } from './content/api';
import { docsIndex } from './content/docs-index';
import { integrationsGuide } from './content/integrations';
import { mcpGuide } from './content/mcp';
import { useCasesGuide } from './content/use-cases';
import type { DocLocale, DocPage } from './types';

export const DOC_PAGES: DocPage[] = [
  docsIndex,
  mcpGuide,
  apiGuide,
  useCasesGuide,
  integrationsGuide,
  helpIndex,
  helpFirstSteps,
  helpTokens,
  helpConnectAccounts,
];

export function findDocPage(section: DocPage['section'], slug: string | null): DocPage | undefined {
  return DOC_PAGES.find((page) => page.section === section && page.slug === slug);
}

export function docLocales(page: DocPage): DocLocale[] {
  return page.section === 'help' ? ['pt', 'en'] : ['en'];
}

export function docPath(page: DocPage, locale: DocLocale): string {
  const suffix = page.slug === null ? '' : `/${page.slug}`;
  if (page.section === 'docs') return `/docs${suffix}`;
  if (locale === 'en') return `/en/help${suffix}`;
  return `/help${suffix}`;
}
