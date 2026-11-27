import type { ReactElement } from 'react';
import LegalPage from '@/components/legal-page';

export default function TermsPage(): ReactElement {
  return <LegalPage titleKey="legal.termsTitle" updatedKey="legal.termsUpdated" bodyKey="legal.termsBody" />;
}
