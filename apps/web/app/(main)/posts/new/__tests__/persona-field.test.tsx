import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('renders the label, hint and the none option as the current value', () => {
    renderField();
    expect(screen.getByText('composer.personaLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.personaHint')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.personaLabel')).toHaveTextContent('composer.personaNone');
  });

  it('lists the none option and every persona once opened', async () => {
    renderField();
    await userEvent.setup().click(screen.getByLabelText('composer.personaLabel'));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'composer.personaNone',
      'Ana',
      'Beto',
    ]);
  });

  it('shows the current persona as the value', () => {
    renderField({ value: 'persona-2' });
    expect(screen.getByLabelText('composer.personaLabel')).toHaveTextContent('Beto');
    expect(screen.queryByText('composer.personaNoBound')).not.toBeInTheDocument();
  });

  it('calls onChange with the chosen persona id', async () => {
    const { onChange } = renderField();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('composer.personaLabel'));
    await user.click(screen.getByRole('option', { name: 'Ana' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('persona-1');
  });

  it('calls onChange with null when the none option is chosen', async () => {
    const { onChange } = renderField({ value: 'persona-1' });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('composer.personaLabel'));
    await user.click(screen.getByRole('option', { name: 'composer.personaNone' }));
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
