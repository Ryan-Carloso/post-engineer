import DocArticle from '@/components/ui/doc-article';
import { docsIndex } from '@/lib/docs/content/docs-index';
import { buildDocMetadata } from '@/lib/docs/metadata';

export const metadata = buildDocMetadata(docsIndex, 'en');

export default function DocsPage() {
  return <DocArticle page={docsIndex} locale="en" />;
}
