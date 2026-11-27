import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${JSON.stringify(vars)})`;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt' as const, setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { PersonaField } from '../persona-field';
import { I18nProvider } from '@/lib/i18n/provider';
import type { PersonaRecord } from '@/lib/persona-record';

const PERSONAS: PersonaRecord[] = [
  { id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false },
  { id: 'persona-2', name: 'Beto', createdAt: '2026-01-01T00:00:00Z', aiLabel: false },
];

function renderField(overrides: Partial<Parameters<typeof PersonaField>[0]> = {}) {
  const onChange = vi.fn();
  const props: Parameters<typeof PersonaField>[0] = {
    personas: PERSONAS,
    loading: false,
    value: null,
    boundCount: 2,
    disabled: false,
    onChange,
    ...overrides,
  };
  const utils = render(
    <I18nProvider>
      <PersonaField {...props} />
    </I18nProvider>,
  );
  return { ...utils, onChange, props };
}

describe('PersonaField', () => {
  it('renders the label, hint and persona options', () => {
    renderField();
    expect(screen.getByText('composer.personaLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.personaHint')).toBeInTheDocument();
    expect(screen.getByText('composer.personaNone')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.personaLabel')).toHaveValue('');
  });

  it('selects the current persona value', () => {
    renderField({ value: 'persona-2' });
    expect(screen.getByLabelText('composer.personaLabel')).toHaveValue('persona-2');
    expect(screen.queryByText('composer.personaNoBound')).not.toBeInTheDocument();
  });

  it('calls onChange with the chosen persona id', () => {
    const { onChange } = renderField();
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('persona-1');
  });

  it('calls onChange with null when the empty option is chosen', () => {
    const { onChange } = renderField({ value: 'persona-1' });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables the select while loading or disabled', () => {
    const first = renderField({ loading: true });
    expect(screen.getByLabelText('composer.personaLabel')).toBeDisabled();
    first.unmount();
    renderField({ disabled: true });
    expect(screen.getByLabelText('composer.personaLabel')).toBeDisabled();
  });

  it('warns when the persona has no bound accounts, linking to the persona edit', () => {
    renderField({ value: 'persona-1', boundCount: 0 });
    expect(screen.getByText('composer.personaNoBound')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.personaNoBoundAction' })).toHaveAttribute(
      'href',
      '/persona?edit=persona-1',
    );
  });

  it('links to the persona page without an edit id when no persona is chosen', () => {
    renderField({ value: null, boundCount: 0 });
    expect(screen.getByRole('link', { name: 'composer.personaNoBoundAction' })).toHaveAttribute(
      'href',
      '/persona?edit=',
    );
  });

  it('shows no warning when the bound count is unknown', () => {
    renderField({ boundCount: null });
    expect(screen.queryByText('composer.personaNoBound')).not.toBeInTheDocument();
  });
});
