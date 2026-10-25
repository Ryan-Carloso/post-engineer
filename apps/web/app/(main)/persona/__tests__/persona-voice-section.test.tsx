import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { PersonaVoiceSection } from '../persona-voice-section';

const sectionMocks = vi.hoisted(() => ({
  result: null as { success: boolean; error: string } | null,
  voiceId: null as string | null,
  voices: [] as Array<{ id: string; label: string | null; provider: string; gender: string | null; accent: string | null; kind: string; description: string | null }>,
}));

vi.mock('@/lib/api', () => ({
  useVoicesQuery: vi.fn(() => ({ data: sectionMocks.voices, isLoading: false, isError: false })),
}));

vi.mock('@/lib/store', () => {
  const state = {
    get result() {
      return sectionMocks.result;
    },
    get voiceId() {
      return sectionMocks.voiceId;
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
  PersonaHouseVoicePicker: () => <div data-testid="house-picker" />,
}));

vi.mock('../voice-clone-picker', () => ({
  PersonaVoiceClonePanel: () => <div data-testid="clone-panel" />,
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
    sectionMocks.voiceId = null;
    sectionMocks.voices = [
      { id: 'chatterbox:kokoro_af_heart', label: 'Heart', provider: 'kokoro', gender: 'female', accent: 'us', kind: 'standard', description: null },
    ];
  });

  it('shows the house picker by default and hides the clone panel', () => {
    const { container } = render(<PersonaVoiceSection />);
    const houseTab = screen.getByRole('tab', { name: 'persona.voiceHouseTab' });
    const cloneTab = screen.getByRole('tab', { name: 'persona.voiceCloneTab' });
    expect(houseTab).toHaveAttribute('aria-selected', 'true');
    expect(cloneTab).toHaveAttribute('aria-selected', 'false');
    const houseWrapper = screen.getByTestId('house-picker').parentElement;
    const cloneWrapper = screen.getByTestId('clone-panel').parentElement;
    expect(houseWrapper?.hidden).toBe(false);
    expect(cloneWrapper?.hidden).toBe(true);
    expect(container.querySelector('section')).toHaveAttribute('data-error-field', 'voice');
  });

  it('switches to the clone tab and back when the tab buttons are clicked', async () => {
    const user = userEvent.setup();
    render(<PersonaVoiceSection />);

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

  it('warns when the saved voice is no longer in the served catalog', () => {
    sectionMocks.voiceId = 'chatterbox:retired_voice';
    render(<PersonaVoiceSection />);
    const warning = screen.getByTestId('persona-voice-fallback-warning');
    // Amber, never red: a swap with a visible path forward, not an error.
    expect(warning.className).toContain('amber');
    expect(warning).toHaveTextContent('persona.voiceFallbackWarning');
  });

  it('does not warn for a house voice the catalog serves', () => {
    sectionMocks.voiceId = 'chatterbox:kokoro_af_heart';
    render(<PersonaVoiceSection />);
    expect(screen.queryByTestId('persona-voice-fallback-warning')).not.toBeInTheDocument();
  });

  it('does not warn while the catalog has not loaded', () => {
    sectionMocks.voices = [];
    sectionMocks.voiceId = 'chatterbox:kokoro_af_heart';
    render(<PersonaVoiceSection />);
    // An empty catalog is a loading/failed state, not proof of retirement:
    // warning here would flag every valid house voice.
    expect(screen.queryByTestId('persona-voice-fallback-warning')).not.toBeInTheDocument();
  });

  it('does not warn that a clone is unavailable when the catalog listed no clones', () => {
    sectionMocks.voiceId = 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb';
    // House-only catalog: clone merge degraded, not proof the clone is gone.
    render(<PersonaVoiceSection />);
    expect(screen.queryByTestId('persona-voice-fallback-warning')).not.toBeInTheDocument();
  });

  it('warns with the missing-voice copy when the saved voice is empty', () => {
    sectionMocks.voiceId = '';
    render(<PersonaVoiceSection />);
    const warning = screen.getByTestId('persona-voice-fallback-warning');
    expect(warning).toHaveTextContent('persona.voiceFallbackMissingWarning');
  });

  it('warns that a clone is unavailable when the catalog lists other clones', () => {
    sectionMocks.voices = [
      { id: 'chatterbox:kokoro_af_heart', label: 'Heart', provider: 'kokoro', gender: 'female', accent: 'us', kind: 'standard', description: null },
      { id: 'chatterbox_nano:ucccccccccccc_dddddddddddd', label: 'Other clone', provider: 'chatterbox', gender: null, accent: null, kind: 'clone', description: null },
    ];
    sectionMocks.voiceId = 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb';
    render(<PersonaVoiceSection />);
    expect(screen.getByTestId('persona-voice-fallback-warning')).toHaveTextContent(
      'persona.voiceFallbackWarning',
    );
  });
});
