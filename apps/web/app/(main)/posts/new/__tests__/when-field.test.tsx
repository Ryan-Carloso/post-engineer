import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

import { WhenField } from '../when-field';
import { I18nProvider } from '@/lib/i18n/provider';

function renderField(overrides: Partial<Parameters<typeof WhenField>[0]> = {}) {
  const onModeChange = vi.fn();
  const onPublishAtChange = vi.fn();
  const onTimezoneChange = vi.fn();
  const props: Parameters<typeof WhenField>[0] = {
    mode: 'asap',
    publishAt: '2026-12-02T20:00',
    timezone: 'Europe/Lisbon',
    min: '2026-12-01T03:00',
    max: '2026-12-31T00:00',
    issues: [],
    timezones: ['UTC', 'Europe/Lisbon'],
    disabled: false,
    onModeChange,
    onPublishAtChange,
    onTimezoneChange,
    ...overrides,
  };
  const utils = render(
    <I18nProvider>
      <WhenField {...props} />
    </I18nProvider>,
  );
  return { ...utils, onModeChange, onPublishAtChange, onTimezoneChange, props };
}

describe('WhenField', () => {
  it('renders both modes with the current one checked and no schedule inputs for asap', () => {
    renderField({ mode: 'asap' });
    expect(screen.getByText('composer.whenLabel')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'composer.modeAsap' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'composer.modeScheduled' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByLabelText('composer.scheduleAtLabel')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('composer.scheduleTimezoneLabel')).not.toBeInTheDocument();
  });

  it('calls onModeChange when the scheduled mode is picked', () => {
    const { onModeChange } = renderField({ mode: 'asap' });
    fireEvent.click(screen.getByRole('radio', { name: 'composer.modeScheduled' }));
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('scheduled');
  });

  it('renders the schedule inputs with bounds and the window hint', () => {
    renderField({ mode: 'scheduled' });
    const publishAt = screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement;
    expect(publishAt).toHaveValue('2026-12-02T20:00');
    expect(publishAt).toHaveAttribute('min', '2026-12-01T03:00');
    expect(publishAt).toHaveAttribute('max', '2026-12-31T00:00');
    expect(screen.getByLabelText('composer.scheduleTimezoneLabel')).toHaveTextContent('Europe/Lisbon');
    expect(screen.getByText('composer.scheduleWindowHint({"min":3,"max":30})')).toBeInTheDocument();
  });

  it('omits the min and max attributes when the bounds are empty', () => {
    renderField({ mode: 'scheduled', min: '', max: '' });
    const publishAt = screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement;
    expect(publishAt).not.toHaveAttribute('min');
    expect(publishAt).not.toHaveAttribute('max');
  });

  it('prepends a timezone that is not in the list', async () => {
    renderField({ mode: 'scheduled', timezone: 'America/Sao_Paulo' });
    const select = screen.getByLabelText('composer.scheduleTimezoneLabel');
    expect(select).toHaveTextContent('America/Sao_Paulo');
    await userEvent.setup().click(select);
    const names = screen.getAllByRole('option').map((option) => option.textContent);
    expect(names).toContain('UTC');
    expect(names).toContain('Europe/Lisbon');
    expect(names.filter((name) => name === 'America/Sao_Paulo')).toHaveLength(1);
  });

  it('calls onPublishAtChange and onTimezoneChange', async () => {
    const { onPublishAtChange, onTimezoneChange } = renderField({ mode: 'scheduled' });
    fireEvent.change(screen.getByLabelText('composer.scheduleAtLabel'), {
      target: { value: '2026-12-03T10:00' },
    });
    expect(onPublishAtChange).toHaveBeenCalledTimes(1);
    expect(onPublishAtChange).toHaveBeenCalledWith('2026-12-03T10:00');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('composer.scheduleTimezoneLabel'));
    await user.click(screen.getByRole('option', { name: 'UTC' }));
    expect(onTimezoneChange).toHaveBeenCalledTimes(1);
    expect(onTimezoneChange).toHaveBeenCalledWith('UTC');
  });

  it('selects a timezone by typing on the focused trigger', async () => {
    const { onTimezoneChange } = renderField({ mode: 'scheduled' });
    const user = userEvent.setup();
    screen.getByLabelText('composer.scheduleTimezoneLabel').focus();
    await user.keyboard('utc');
    expect(onTimezoneChange).toHaveBeenCalledWith('UTC');
  });

  it('renders every schedule issue', () => {
    renderField({ mode: 'scheduled', issues: ['composer.validationSchedule', 'composer.validationTimezone'] });
    expect(screen.getByText('composer.validationSchedule')).toBeInTheDocument();
    expect(screen.getByText('composer.validationTimezone')).toBeInTheDocument();
  });

  it('disables the mode buttons and the schedule inputs while disabled', () => {
    renderField({ mode: 'scheduled', disabled: true });
    expect(screen.getByRole('radio', { name: 'composer.modeAsap' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'composer.modeScheduled' })).toBeDisabled();
    expect(screen.getByLabelText('composer.scheduleAtLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.scheduleTimezoneLabel')).toBeDisabled();
  });
});
