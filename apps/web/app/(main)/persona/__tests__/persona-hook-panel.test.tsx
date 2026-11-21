import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'pt', setLocale: () => undefined, t: (key: string) => key }),
}));

import { usePersonaStore } from '@/lib/store';
import { PersonaPreferencesSection } from '../persona-preferences-section';

const WithForm = ({ children }: { children: ReactNode }) => {
  const methods = useForm();
  return <FormProvider {...methods}>{children}</FormProvider>;
};

describe('persona hook panel switch', () => {
  beforeEach(() => {
    usePersonaStore.getState().resetForm();
  });

  it('starts on and turns the persona default off when toggled', () => {
    render(
      <WithForm>
        <PersonaPreferencesSection />
      </WithForm>,
    );
    const toggle = screen.getByRole('switch', { name: 'personas.hookPanelLabel' });
    expect(screen.getByText('personas.hookPanelHint')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(usePersonaStore.getState().hookPanel).toBe(false);
  });

  it('reflects a persona loaded with the panel off', () => {
    usePersonaStore.getState().setHookPanel(false);
    render(
      <WithForm>
        <PersonaPreferencesSection />
      </WithForm>,
    );
    expect(screen.getByRole('switch', { name: 'personas.hookPanelLabel' })).toHaveAttribute('aria-checked', 'false');
  });
});
