import { notFound } from 'next/navigation';
import DocArticle from '@/components/ui/doc-article';
import { buildDocMetadata } from '@/lib/docs/metadata';
import { DOC_PAGES, findDocPage } from '@/lib/docs/registry';
import type { DocPage } from '@/lib/docs/types';

export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return DOC_PAGES.filter(
    (page): page is DocPage & { slug: string } => page.section === 'docs' && page.slug !== null,
  ).map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findDocPage('docs', slug);
  if (page === undefined) return {};
  return buildDocMetadata(page, 'en');
}

export default async function DocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findDocPage('docs', slug);
  if (page === undefined) notFound();
  return <DocArticle page={page} locale="en" />;
}
