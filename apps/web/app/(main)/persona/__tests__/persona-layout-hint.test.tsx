import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'pt', setLocale: () => undefined, t: (key: string) => key }),
}));

import { PersonaPreferencesSection } from '../persona-preferences-section';

const WithForm = ({ children }: { children: ReactNode }) => {
  const methods = useForm();
  return <FormProvider {...methods}>{children}</FormProvider>;
};

describe('persona layout hint', () => {
  it('says the bottom half uses the material chosen per post', () => {
    render(
      <WithForm>
        <PersonaPreferencesSection />
      </WithForm>,
    );
    expect(screen.getByText('personas.layoutHint')).toBeInTheDocument();
  });
});
