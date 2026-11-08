import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { PersonaHouseVoicePicker } from '../voice-picker';
import type { VoiceOption } from '@/lib/voice-catalog';

const pickerMocks = vi.hoisted(() => ({
  voices: [] as VoiceOption[],
  voiceId: null as string | null,
  setVoiceId: vi.fn(),
}));

const previewMocks = vi.hoisted(() => ({
  fetchHouseVoicePreview: vi.fn(),
}));

vi.mock('@/lib/house-voice-preview-client', () => ({
  fetchHouseVoicePreview: previewMocks.fetchHouseVoicePreview,
  HOUSE_PREVIEW_TEXT_MAX_CHARS: 300,
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

const HOUSE_VOICE: VoiceOption = {
  id: 'chatterbox:phonon_zoey',
  label: 'Zoey',
  provider: 'chatterbox',
  gender: 'female',
  accent: null,
  kind: 'standard',
  description: null,
};

const OTHER_HOUSE_VOICE: VoiceOption = {
  id: 'chatterbox:kokoro_af_heart',
  label: 'Heart',
  provider: 'chatterbox',
  gender: 'female',
  accent: null,
  kind: 'standard',
  description: null,
};

class FakeAudio {
  static instances: FakeAudio[] = [];

  url: string;
  onended: (() => void) | null = null;
  playCalled = false;

  constructor(url: string) {
    this.url = url;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCalled = true;
    return Promise.resolve();
  }

  pause(): void {}
}

describe('PersonaHouseVoicePicker custom-text preview', () => {
  beforeEach(() => {
    pickerMocks.voices = [HOUSE_VOICE, OTHER_HOUSE_VOICE];
    pickerMocks.voiceId = HOUSE_VOICE.id;
    pickerMocks.setVoiceId.mockReset();
    previewMocks.fetchHouseVoicePreview.mockReset();
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderPicker() {
    const user = userEvent.setup();
    const rendered = render(<PersonaHouseVoicePicker />);
    const textField = screen.getByLabelText('persona.voicePreviewTextLabel');
    const listenButton = screen.getByRole('button', { name: 'persona.voicePreviewListen' });
    return { user, rendered, textField, listenButton };
  }

  it('shows the text field and listen button for a house voice', () => {
    renderPicker();
    expect(screen.getByLabelText('persona.voicePreviewTextLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'persona.voicePreviewListen' })).toBeInTheDocument();
    expect(screen.getByText('0/300')).toBeInTheDocument();
  });

  it('hides the custom preview for a cloned voice', () => {
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
    expect(screen.queryByLabelText('persona.voicePreviewTextLabel')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'persona.voicePreviewListen' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the typed text when the selected voice changes', async () => {
    const { user, rendered, textField } = renderPicker();
    await user.type(textField, 'Hello there');
    expect(textField).toHaveValue('Hello there');

    pickerMocks.voiceId = OTHER_HOUSE_VOICE.id;
    rendered.rerender(<PersonaHouseVoicePicker />);

    expect(screen.getByLabelText('persona.voicePreviewTextLabel')).toHaveValue('Hello there');
  });

  it('disables the listen button while the text is blank', () => {
    const { listenButton } = renderPicker();
    expect(listenButton).toBeDisabled();
  });

  it('fetches the preview for the selected voice and plays the returned audio', async () => {
    previewMocks.fetchHouseVoicePreview.mockResolvedValue({
      success: true,
      audio: new Blob(['mp3'], { type: 'audio/mpeg' }),
    });
    const { user, textField, listenButton } = renderPicker();
    await user.type(textField, 'Hello there');
    await user.click(listenButton);

    await waitFor(() => {
      expect(previewMocks.fetchHouseVoicePreview).toHaveBeenCalledWith(
        'chatterbox:phonon_zoey',
        'Hello there',
      );
    });
    await waitFor(() => {
      expect(FakeAudio.instances).toHaveLength(1);
    });
    expect(FakeAudio.instances[0].url).toBe('blob:fake');
    expect(FakeAudio.instances[0].playCalled).toBe(true);
  });

  it('disables the button and shows the synthesizing label while loading', async () => {
    let resolvePreview!: (value: { success: true; audio: Blob }) => void;
    const pending = new Promise<{ success: true; audio: Blob }>((resolve) => {
      resolvePreview = resolve;
    });
    previewMocks.fetchHouseVoicePreview.mockReturnValue(pending);
    const { user, textField } = renderPicker();
    await user.type(textField, 'Hello there');
    await user.click(screen.getByRole('button', { name: 'persona.voicePreviewListen' }));

    expect(screen.getByRole('button', { name: 'persona.voicePreviewListening' })).toBeDisabled();
    resolvePreview({ success: true, audio: new Blob(['mp3'], { type: 'audio/mpeg' }) });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'persona.voicePreviewListen' }),
      ).not.toBeDisabled();
    });
  });

  it('shows the rate-limit message on 429', async () => {
    previewMocks.fetchHouseVoicePreview.mockResolvedValue({
      success: false,
      status: 429,
      error: 'Too many requests.',
    });
    const { user, textField, listenButton } = renderPicker();
    await user.type(textField, 'Hello there');
    await user.click(listenButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voicePreviewRateLimited');
    });
  });

  it('shows the too-long message on 400 and keeps the button enabled past the cap', async () => {
    previewMocks.fetchHouseVoicePreview.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Preview text must be 1 to 300 characters after trimming.',
    });
    const { textField, listenButton } = renderPicker();
    fireEvent.change(textField, { target: { value: 'x'.repeat(301) } });

    expect(screen.getByText('301/300')).toBeInTheDocument();
    expect(screen.getByText('301/300').className).toContain('text-destructive');
    expect(listenButton).not.toBeDisabled();
    await userEvent.setup().click(listenButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voicePreviewTextTooLong');
    });
  });

  it('shows the failed message when the preview request fails', async () => {
    previewMocks.fetchHouseVoicePreview.mockResolvedValue({
      success: false,
      status: 0,
      error: 'Could not play the preview.',
    });
    const { user, textField, listenButton } = renderPicker();
    await user.type(textField, 'Hello there');
    await user.click(listenButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voicePreviewFailed');
    });
  });
});
