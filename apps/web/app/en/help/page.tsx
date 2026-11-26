import DocArticle from '@/components/ui/doc-article';
import { helpIndex } from '@/lib/docs/content/help-index';
import { buildDocMetadata } from '@/lib/docs/metadata';

export const metadata = buildDocMetadata(helpIndex, 'en');

export default function EnHelpPage() {
  return <DocArticle page={helpIndex} locale="en" />;
}
