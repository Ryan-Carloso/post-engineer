import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { docSlugArticle, docSlugMetadata, docSlugParams, type DocSlugProps } from '@/lib/docs/slug-page';

export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return docSlugParams('docs');
}

export function generateMetadata(props: DocSlugProps): Promise<Metadata> {
  return docSlugMetadata('docs', 'en', props);
}

export default function DocSlugPage(props: DocSlugProps): Promise<ReactElement> {
  return docSlugArticle('docs', 'en', props);
}
