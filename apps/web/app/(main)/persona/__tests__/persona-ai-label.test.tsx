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

describe('persona AI label switch', () => {
  beforeEach(() => {
    usePersonaStore.getState().resetForm();
  });

  it('starts off and turns the persona AI label on when toggled', () => {
    render(
      <WithForm>
        <PersonaPreferencesSection />
      </WithForm>,
    );
    const toggle = screen.getByRole('switch', { name: 'personas.aiLabelLabel' });
    expect(screen.getByText('personas.aiLabelHint')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(usePersonaStore.getState().aiLabel).toBe(true);
  });

  it('reflects a persona loaded with the AI label on', () => {
    usePersonaStore.getState().setAiLabel(true);
    render(
      <WithForm>
        <PersonaPreferencesSection />
      </WithForm>,
    );
    expect(screen.getByRole('switch', { name: 'personas.aiLabelLabel' })).toHaveAttribute('aria-checked', 'true');
  });

  it('sends aiLabel in create and edit form data', () => {
    usePersonaStore.getState().setAiLabel(true);
    expect(usePersonaStore.getState().buildPersonaFormData().get('aiLabel')).toBe('true');
    expect(usePersonaStore.getState().buildPersonaEditFormData().get('aiLabel')).toBe('true');
  });
});
