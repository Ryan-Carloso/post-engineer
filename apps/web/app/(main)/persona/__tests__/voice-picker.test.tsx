import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { PersonaHouseVoicePicker } from '../voice-picker';
import type { VoiceOption } from '@/lib/voice-catalog';

const pickerMocks = vi.hoisted(() => ({
  voices: [] as VoiceOption[],
  voiceId: null as string | null,
  setVoiceId: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useVoicesQuery: () => ({ data: pickerMocks.voices }),
}));

vi.mock('@/lib/store', () => {
  const state = {
    get voiceId() {
      return pickerMocks.voiceId;
    },
    setVoiceId: pickerMocks.setVoiceId,
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

vi.mock('../voice-picker-dialog', () => ({
  VoicePickerDialog: () => null,
  VoiceTags: () => null,
}));

const CLONE_KEY = 'uaaaaaaaabbbb_cccccccccccc';

describe('PersonaHouseVoicePicker selected card', () => {
  beforeEach(() => {
    pickerMocks.voices = [];
    pickerMocks.voiceId = null;
    pickerMocks.setVoiceId.mockReset();
  });

  it('shows a legacy clone persona as Cloned with no sample button', () => {
    // The catalog serves the clone under chatterbox_nano: while the persona
    // stored it before the rename under chatterbox:. The card must still
    // render the "Cloned" tag — not the raw clone key — and must not offer
    // a sample button for a /voice-samples/<clone_key>.mp3 that does not exist.
    pickerMocks.voices = [
      {
        id: `chatterbox_nano:${CLONE_KEY}`,
        label: null,
        provider: 'chatterbox_nano',
        gender: null,
        accent: null,
        kind: 'cloned',
        description: null,
      },
    ];
    pickerMocks.voiceId = `chatterbox:${CLONE_KEY}`;
    render(<PersonaHouseVoicePicker />);
    expect(screen.getByText('persona.voiceTagCloned')).toBeInTheDocument();
    expect(screen.queryByText(`${CLONE_KEY.split('_')[0]} ${CLONE_KEY.split('_')[1]}`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('persona.voicePlaySample')).not.toBeInTheDocument();
  });

  it('still shows a legacy house voice id with its sample button', () => {
    pickerMocks.voices = [];
    pickerMocks.voiceId = 'chatterbox:en_us_male_01';
    render(<PersonaHouseVoicePicker />);
    expect(screen.getByText('en us male 01')).toBeInTheDocument();
    expect(screen.getByLabelText('persona.voicePlaySample')).toBeInTheDocument();
  });
});
