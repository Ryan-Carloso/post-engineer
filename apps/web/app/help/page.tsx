import DocArticle from '@/components/ui/doc-article';
import { helpIndex } from '@/lib/docs/content/help-index';
import { buildDocMetadata } from '@/lib/docs/metadata';

export const metadata = buildDocMetadata(helpIndex, 'pt');

export default function HelpPage() {
  return <DocArticle page={helpIndex} locale="pt" />;
}
