import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

//---------------
// The "persona on top" layout puts the post's chosen material (real clips
// or drawings) in the bottom half, not always stock: the layout picker says
// so, so a lip-sync video never implies footage the user did not choose.
//---------------
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
