import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { docSlugArticle, docSlugMetadata, docSlugParams, type DocSlugProps } from '@/lib/docs/slug-page';

export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return docSlugParams('help');
}

export function generateMetadata(props: DocSlugProps): Promise<Metadata> {
  return docSlugMetadata('help', 'pt', props);
}

export default function HelpSlugPage(props: DocSlugProps): Promise<ReactElement> {
  return docSlugArticle('help', 'pt', props);
}
