import type { ReactElement } from 'react';
import LegalPage from '@/components/legal-page';

export default function PrivacyPage(): ReactElement {
  return <LegalPage titleKey="legal.privacyTitle" updatedKey="legal.privacyUpdated" bodyKey="legal.privacyBody" />;
}
