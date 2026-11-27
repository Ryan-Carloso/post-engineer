import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import DocArticle from '@/components/ui/doc-article';
import { buildDocMetadata } from '@/lib/docs/metadata';
import { DOC_PAGES, findDocPage } from '@/lib/docs/registry';
import type { DocLocale, DocPage } from '@/lib/docs/types';

export interface DocSlugProps {
  params: Promise<{ slug: string }>;
}

export function docSlugParams(section: DocPage['section']): Array<{ slug: string }> {
  return DOC_PAGES.filter(
    (page): page is DocPage & { slug: string } => page.section === section && page.slug !== null,
  ).map((page) => ({ slug: page.slug }));
}

export async function docSlugMetadata(section: DocPage['section'], locale: DocLocale, { params }: DocSlugProps): Promise<Metadata> {
  const { slug } = await params;
  const page = findDocPage(section, slug);
  if (page === undefined) return {};
  return buildDocMetadata(page, locale);
}

export async function docSlugArticle(section: DocPage['section'], locale: DocLocale, { params }: DocSlugProps): Promise<ReactElement> {
  const { slug } = await params;
  const page = findDocPage(section, slug);
  if (page === undefined) notFound();
  return <DocArticle page={page} locale={locale} />;
}
