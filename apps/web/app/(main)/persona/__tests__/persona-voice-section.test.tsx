import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { PersonaVoiceSection } from '../persona-voice-section';

const sectionMocks = vi.hoisted(() => ({
  result: null as { success: boolean; error: string } | null,
}));

vi.mock('@/lib/store', () => {
  const state = {
    get result() {
      return sectionMocks.result;
    },
  };
  const usePersonaStore = Object.assign(
    vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
    { getState: () => state },
  );
  return { usePersonaStore };
});

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    I18nProvider,
    useI18n: () => ({
      t: (key: string) => key,
      locale: 'pt',
      setLocale: vi.fn(),
    }),
  };
});

vi.mock('../voice-picker', () => ({
  PersonaHouseVoicePicker: ({ personaLanguage }: { personaLanguage?: string }) => (
    <div data-testid="house-picker">{personaLanguage ?? 'no-language'}</div>
  ),
}));

vi.mock('../voice-clone-picker', () => ({
  PersonaVoiceClonePanel: ({ personaLanguage }: { personaLanguage?: string }) => (
    <div data-testid="clone-panel">{personaLanguage ?? 'no-language'}</div>
  ),
  VoiceTabButton: ({
    active,
    label,
    onSelect,
  }: {
    active: boolean;
    label: string;
    onSelect: () => void;
  }) => (
    <button type="button" role="tab" aria-selected={active} onClick={onSelect}>
      {label}
    </button>
  ),
}));

describe('PersonaVoiceSection', () => {
  beforeEach(() => {
    sectionMocks.result = null;
  });

  it('shows the house picker by default and hides the clone panel', () => {
    const { container } = render(<PersonaVoiceSection personaLanguage="en" />);
    const houseTab = screen.getByRole('tab', { name: 'persona.voiceHouseTab' });
    const cloneTab = screen.getByRole('tab', { name: 'persona.voiceCloneTab' });
    expect(houseTab).toHaveAttribute('aria-selected', 'true');
    expect(cloneTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('house-picker')).toHaveTextContent('en');
    expect(screen.getByTestId('clone-panel')).toHaveTextContent('en');
    const houseWrapper = screen.getByTestId('house-picker').parentElement;
    const cloneWrapper = screen.getByTestId('clone-panel').parentElement;
    expect(houseWrapper?.hidden).toBe(false);
    expect(cloneWrapper?.hidden).toBe(true);
    expect(container.querySelector('section')).toHaveAttribute('data-error-field', 'voice');
  });

  it('switches to the clone tab and back when the tab buttons are clicked', async () => {
    const user = userEvent.setup();
    render(<PersonaVoiceSection personaLanguage="pt" />);

    await user.click(screen.getByRole('tab', { name: 'persona.voiceCloneTab' }));
    expect(screen.getByRole('tab', { name: 'persona.voiceCloneTab' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'persona.voiceHouseTab' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByTestId('house-picker').parentElement?.hidden).toBe(true);
    expect(screen.getByTestId('clone-panel').parentElement?.hidden).toBe(false);

    await user.click(screen.getByRole('tab', { name: 'persona.voiceHouseTab' }));
    expect(screen.getByRole('tab', { name: 'persona.voiceHouseTab' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('house-picker').parentElement?.hidden).toBe(false);
    expect(screen.getByTestId('clone-panel').parentElement?.hidden).toBe(true);
  });

  it('renders the inline voice error when the store result failed with the voice error', () => {
    sectionMocks.result = { success: false, error: 'persona.errVoice' };
    render(<PersonaVoiceSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('persona.errVoice');
  });

  it('does not render an inline error for a successful result', () => {
    sectionMocks.result = { success: true, error: 'persona.errVoice' };
    render(<PersonaVoiceSection />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not render an inline error for a different failure', () => {
    sectionMocks.result = { success: false, error: 'persona.errName' };
    render(<PersonaVoiceSection />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
