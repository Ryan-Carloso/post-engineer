import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PersonaVoiceClonePanel, VoiceTabButton } from '../voice-clone-picker';
import type { ClonedVoicePublicRow } from '@/lib/cloned-voices-types';

const cloneMocks = vi.hoisted(() => ({
  list: [] as ClonedVoicePublicRow[],
  listError: false,
  fetchById: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  setVoiceId: vi.fn(),
  audioPlay: vi.fn(),
  audioPause: vi.fn(),
  audioUrls: [] as (string | undefined)[],
  validateResult: { ok: true } as { ok: true } | { ok: false; error: string },
  sampleLanguages: [{ code: 'pt', label: 'Português' }] as { code: string; label: string }[],
}));

vi.mock('@/lib/cloned-voices-client', () => ({
  fetchClonedVoices: vi.fn(async () => {
    if (cloneMocks.listError) {
      throw new Error('list failed');
    }
    return cloneMocks.list;
  }),
  fetchClonedVoice: vi.fn((id: string) => cloneMocks.fetchById(id)),
  createClonedVoice: vi.fn((...args: unknown[]) => cloneMocks.create(...args)),
  deleteClonedVoice: vi.fn((id: string) => cloneMocks.delete(id)),
  clonedVoicePreviewUrl: vi.fn((id: string) => `/api/persona/cloned-voices/${id}/preview`),
}));

vi.mock('@/lib/api', () => ({
  useVoiceSampleLanguagesQuery: vi.fn(() => ({
    data: cloneMocks.sampleLanguages,
    isPending: false,
    isError: false,
  })),
}));

vi.mock('@/lib/store', () => {
  const state = { voiceId: 'voice-1', setVoiceId: cloneMocks.setVoiceId };
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

vi.mock('@/lib/cloned-voice-audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cloned-voice-audio')>();
  return {
    ...actual,
    validateCloneReferenceBuffer: vi.fn(() => cloneMocks.validateResult),
  };
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PersonaVoiceClonePanel personaLanguage="pt" />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

interface FakeRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string;
  mimeType: string;
  streamArg: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

/** Installs a fake MediaRecorder + getUserMedia the way the component uses them. */
function setupRecordingEnv(options?: { mimeSupported?: boolean; deny?: boolean }) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = options?.deny
    ? vi.fn(async () => {
      throw new Error('Permission denied');
    })
    : vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  const instances: FakeRecorder[] = [];
  class FakeMediaRecorder {
    static isTypeSupported = vi.fn(
      (mime: string) => (options?.mimeSupported ?? true) && mime === 'audio/webm;codecs=opus',
    );

    ondataavailable: FakeRecorder['ondataavailable'] = null;
    onstop: FakeRecorder['onstop'] = null;
    state = 'inactive';
    mimeType: string;
    streamArg: unknown;
    start = vi.fn((_timeslice?: number) => {
      this.state = 'recording';
    });
    stop = vi.fn(() => {
      this.state = 'inactive';
      this.onstop?.();
    });

    constructor(streamArg: unknown, recorderOptions?: { mimeType?: string }) {
      this.streamArg = streamArg;
      this.mimeType = recorderOptions?.mimeType ?? '';
      instances.push(this);
    }
  }
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  return { track, stream, getUserMedia, instances };
}

/** Minimal WAV header (44 bytes) for upload tests. */
function makeWavFile(name = 'sample.wav'): File {
  const bytes = new Uint8Array(44);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0);
  return new File([bytes], name, { type: 'audio/wav' });
}

function publicRow(
  overrides: Partial<ClonedVoicePublicRow> & Pick<ClonedVoicePublicRow, 'id' | 'status'>,
): ClonedVoicePublicRow {
  return {
    language: 'pt',
    voice_id: null,
    error_code: null,
    consent_at: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('PersonaVoiceClonePanel', () => {
  beforeEach(() => {
    cloneMocks.list = [];
    cloneMocks.listError = false;
    cloneMocks.fetchById.mockReset();
    cloneMocks.create.mockReset();
    cloneMocks.delete.mockReset();
    cloneMocks.setVoiceId.mockReset();
    cloneMocks.validateResult = { ok: true };
    cloneMocks.sampleLanguages = [{ code: 'pt', label: 'Português' }];
    cloneMocks.audioUrls = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    cloneMocks.audioPlay.mockReset();
    cloneMocks.audioPlay.mockResolvedValue(undefined);
    cloneMocks.audioPause.mockReset();
    vi.stubGlobal(
      'Audio',
      class MockAudio {
        play = cloneMocks.audioPlay;
        pause = cloneMocks.audioPause;
        constructor(url?: string) {
          cloneMocks.audioUrls.push(url);
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('blocks submit without consent', async () => {
    const user = userEvent.setup();
    renderPanel();
    const panel = screen.getByTestId('voice-clone-panel');
    const fileInput = panel.querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceCloneConsentRequired');
    expect(cloneMocks.create).not.toHaveBeenCalled();
  });

  it('clears local preview when rerecord is chosen', async () => {
    const user = userEvent.setup();
    renderPanel();
    const panel = screen.getByTestId('voice-clone-panel');
    const fileInput = panel.querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    expect(screen.getByRole('button', { name: 'persona.voiceCloneRerecord' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneRerecord' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(screen.queryByRole('button', { name: 'persona.voiceCloneSubmit' })).not.toBeInTheDocument();
  });

  it('clears the pending audio when a new pick fails validation', async () => {
    const user = userEvent.setup();
    renderPanel();
    const panel = screen.getByTestId('voice-clone-panel');
    const fileInput = panel.querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    expect(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' })).toBeInTheDocument();
    cloneMocks.validateResult = {
      ok: false,
      error: 'Only MP3, WAV, M4A, or WebM reference audio is accepted.',
    };
    const badFile = new File(['not audio at all'], 'fake.wav', { type: 'audio/wav' });
    await user.upload(fileInput as HTMLInputElement, badFile);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only MP3, WAV, M4A, or WebM reference audio is accepted.',
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(screen.queryByRole('button', { name: 'persona.voiceCloneSubmit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'persona.voiceCloneRerecord' })).not.toBeInTheDocument();
  });

  it('uploads when consent is checked', async () => {
    const user = userEvent.setup();
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-pending', status: 'pending' }));
    renderPanel();
    await user.click(screen.getByRole('checkbox'));
    const panel = screen.getByTestId('voice-clone-panel');
    const fileInput = panel.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(cloneMocks.create).toHaveBeenCalledTimes(1));
    expect(cloneMocks.create.mock.calls[0]?.[2]).toBe(true);
  });

  it('shows pending status while polling', async () => {
    cloneMocks.fetchById.mockResolvedValue(publicRow({ id: 'clone-pending', status: 'pending' }));
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-pending', status: 'pending' }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('persona.voiceClonePending'));
  });

  it('renders ready clone actions and applies voice to persona', async () => {
    const ready = publicRow({
      id: 'clone-ready',
      status: 'ready',
      voice_id: 'chatterbox:uabc_123',
    });
    cloneMocks.list = [ready];
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'persona.voiceCloneUseOnPersona' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneUseOnPersona' }));
    expect(cloneMocks.setVoiceId).toHaveBeenCalledWith('chatterbox:uabc_123');
    await user.click(screen.getByRole('button', { name: 'persona.voiceClonePlayPreview' }));
    expect(cloneMocks.audioPlay).toHaveBeenCalled();
  });

  it('deletes a clone from the list', async () => {
    cloneMocks.list = [
      publicRow({
        id: 'clone-del',
        status: 'ready',
        voice_id: 'chatterbox:ux',
      }),
    ];
    cloneMocks.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'persona.voiceCloneDelete' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneDelete' }));
    await waitFor(() => expect(cloneMocks.delete).toHaveBeenCalledWith('clone-del'));
  });

  it('renders the tab button active and inactive states and fires onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<VoiceTabButton active label="Clone" onSelect={onSelect} />);
    const tab = screen.getByRole('tab', { name: 'Clone' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab.className).toContain('bg-white');
    await user.click(tab);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<VoiceTabButton active={false} label="Clone" onSelect={onSelect} />);
    expect(tab).toHaveAttribute('aria-selected', 'false');
    expect(tab.className).toContain('text-neutral-500');
  });

  it('shows the list error when loading cloned voices fails', async () => {
    cloneMocks.listError = true;
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText('persona.voiceCloneListError')).toBeInTheDocument(),
    );
  });

  it('renders pending and failed clones in the list without ready actions', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-pend', status: 'pending', language: null }),
      publicRow({ id: 'clone-fail', status: 'failed', language: 'en' }),
    ];
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText('persona.voiceCloneStatusPending')).toBeInTheDocument(),
    );
    expect(screen.getByText('persona.voiceCloneStatusFailed')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'persona.voiceCloneUseOnPersona' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'persona.voiceClonePlayPreview' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'persona.voiceCloneDelete' })).toHaveLength(2);
  });

  it('marks the clone matching the persona voice as active', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-active', status: 'ready', voice_id: 'voice-1' }),
    ];
    renderPanel();
    const useButton = await screen.findByRole('button', {
      name: 'persona.voiceCloneUseOnPersona',
    });
    expect(useButton.closest('li')?.className).toContain('border-accent');
  });

  it('does not set a voice when a ready clone has no voice_id', async () => {
    cloneMocks.list = [publicRow({ id: 'clone-novoice', status: 'ready', voice_id: null })];
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole('button', { name: 'persona.voiceCloneUseOnPersona' }),
    );
    expect(cloneMocks.setVoiceId).not.toHaveBeenCalled();
  });

  it('shows the preview failure error when audio playback rejects', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-ready', status: 'ready', voice_id: 'chatterbox:u1', language: 'pt' }),
    ];
    cloneMocks.audioPlay.mockRejectedValueOnce(new Error('decode failed'));
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole('button', { name: 'persona.voiceClonePlayPreview' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceClonePreviewFailed'),
    );
    expect(cloneMocks.audioUrls).toEqual(['/api/persona/cloned-voices/clone-ready/preview']);
  });

  it('pauses the previous preview when playing another one', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-a', status: 'ready', voice_id: 'chatterbox:ua', language: 'pt' }),
      publicRow({ id: 'clone-b', status: 'ready', voice_id: 'chatterbox:ub', language: 'en' }),
    ];
    const user = userEvent.setup();
    renderPanel();
    const playButtons = await screen.findAllByRole('button', {
      name: 'persona.voiceClonePlayPreview',
    });
    await user.click(playButtons[0]);
    await user.click(playButtons[1]);
    expect(cloneMocks.audioPause).toHaveBeenCalledTimes(1);
    expect(cloneMocks.audioUrls).toEqual([
      '/api/persona/cloned-voices/clone-a/preview',
      '/api/persona/cloned-voices/clone-b/preview',
    ]);
  });

  it('surfaces the create error message when the mutation fails', async () => {
    cloneMocks.create.mockRejectedValue(new Error('Quota exceeded.'));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Quota exceeded.'));
    expect(cloneMocks.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces the delete error message when the mutation fails', async () => {
    cloneMocks.list = [publicRow({ id: 'clone-del', status: 'ready', voice_id: 'chatterbox:ux' })];
    cloneMocks.delete.mockRejectedValue(new Error('Delete failed.'));
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole('button', { name: 'persona.voiceCloneDelete' }),
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Delete failed.'));
  });

  it('shows the failed status when polling resolves to failed and invalidates persona voices', async () => {
    cloneMocks.fetchById.mockResolvedValue(publicRow({ id: 'clone-new', status: 'failed' }));
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-new', status: 'pending' }));
    const { queryClient } = renderPanel();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceCloneFailed'),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['persona-voices'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cloned-voices'] });
  });

  it('invalidates persona voices when polling resolves to ready', async () => {
    cloneMocks.fetchById.mockResolvedValue(
      publicRow({ id: 'clone-new', status: 'ready', voice_id: 'chatterbox:unew' }),
    );
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-new', status: 'pending' }));
    const { queryClient } = renderPanel();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['persona-voices'] }),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rejects a picked file that fails reference validation', async () => {
    cloneMocks.validateResult = {
      ok: false,
      error: 'Only MP3, WAV, M4A, or WebM reference audio is accepted.',
    };
    const user = userEvent.setup();
    renderPanel();
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Only MP3, WAV, M4A, or WebM reference audio is accepted.',
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'persona.voiceCloneSubmit' }),
    ).not.toBeInTheDocument();
    expect(cloneMocks.create).not.toHaveBeenCalled();
  });

  it('revokes the previous preview url when a second file is picked', async () => {
    const user = userEvent.setup();
    renderPanel();
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile('one.wav'));
    await user.upload(fileInput as HTMLInputElement, makeWavFile('two.wav'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
  });

  it('clears the current error and keeps the preview when the file pick is empty', async () => {
    const user = userEvent.setup();
    renderPanel();
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceCloneConsentRequired');
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [] } });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' })).toBeInTheDocument();
    expect(cloneMocks.create).not.toHaveBeenCalled();
  });

  it('submits with the language chosen in the select', async () => {
    cloneMocks.sampleLanguages = [
      { code: 'pt', label: 'Português' },
      { code: 'en', label: 'English' },
    ];
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-en', status: 'pending' }));
    const user = userEvent.setup();
    renderPanel();
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'en');
    expect((select as HTMLSelectElement).value).toBe('en');
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(cloneMocks.create).toHaveBeenCalledTimes(1));
    expect(cloneMocks.create.mock.calls[0]?.[1]).toBe('en');
    expect(cloneMocks.create.mock.calls[0]?.[2]).toBe(true);
  });

  it('shows the mic unavailable error when mediaDevices is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceCloneMicUnavailable'),
    );
    expect(
      screen.getByRole('button', { name: 'persona.voiceCloneRecord' }),
    ).toBeInTheDocument();
  });

  it('shows the mic denied error when getUserMedia rejects', async () => {
    setupRecordingEnv({ deny: true });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('persona.voiceCloneMicDenied'),
    );
  });

  it('records audio, ticks the timer, and submits the recorded blob', async () => {
    const env = setupRecordingEnv();
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-rec', status: 'pending' }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
    const stopButton = await screen.findByRole('button', { name: /persona\.voiceCloneStop/ });
    expect(stopButton).toHaveTextContent('(0:00 / 1:00)');
    expect(env.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(env.instances).toHaveLength(1);
    const recorder = env.instances[0];
    expect(recorder.mimeType).toBe('audio/webm;codecs=opus');
    expect(recorder.streamArg).toBe(env.stream);
    expect(recorder.start).toHaveBeenCalledWith(250);

    await waitFor(() => expect(stopButton).toHaveTextContent('(0:01 / 1:00)'), {
      timeout: 3000,
    });

    act(() => {
      recorder.ondataavailable?.({ data: new Blob([]) });
      recorder.ondataavailable?.({ data: new Blob(['hello']) });
    });
    await user.click(stopButton);
    expect(env.track.stop).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(cloneMocks.create).toHaveBeenCalledTimes(1));
    const sentBlob = cloneMocks.create.mock.calls[0]?.[0] as Blob;
    expect(sentBlob.type).toBe('audio/webm;codecs=opus');
    expect(sentBlob.size).toBe(5);
    expect(cloneMocks.create.mock.calls[0]?.[1]).toBe('pt');
    expect(cloneMocks.create.mock.calls[0]?.[2]).toBe(true);
  });

  it('falls back to plain audio/webm when the opus mime is unsupported', async () => {
    const env = setupRecordingEnv({ mimeSupported: false });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
    const stopButton = await screen.findByRole('button', { name: /persona\.voiceCloneStop/ });
    expect(env.instances[0]?.mimeType).toBe('audio/webm');
    const recorder = env.instances[0];
    act(() => {
      recorder.ondataavailable?.({ data: new Blob(['xy']) });
    });
    await user.click(stopButton);
    await user.click(screen.getByRole('checkbox'));
    cloneMocks.create.mockResolvedValue(publicRow({ id: 'clone-rec2', status: 'pending' }));
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() => expect(cloneMocks.create).toHaveBeenCalledTimes(1));
    const sentBlob = cloneMocks.create.mock.calls[0]?.[0] as Blob;
    expect(sentBlob.type).toBe('audio/webm');
    expect(sentBlob.size).toBe(2);
  });

  it('stops recording automatically when the max duration is reached', async () => {
    vi.useFakeTimers();
    try {
      const env = setupRecordingEnv();
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
      await act(async () => {});
      expect(
        screen.getByRole('button', { name: /persona\.voiceCloneStop/ }),
      ).toHaveTextContent('(0:00 / 1:00)');
      act(() => {
        env.instances[0]?.ondataavailable?.({ data: new Blob(['hello']) });
      });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(
        screen.getByRole('button', { name: 'persona.voiceCloneRecord' }),
      ).toBeInTheDocument();
      expect(env.track.stop).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops recording and releases the mic when unmounted mid-recording', async () => {
    vi.useFakeTimers();
    try {
      const env = setupRecordingEnv();
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'persona.voiceCloneRecord' }));
      await act(async () => {});
      const stopButton = screen.getByRole('button', { name: /persona\.voiceCloneStop/ });
      expect(stopButton).toHaveTextContent('(0:00 / 1:00)');
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(stopButton).toHaveTextContent('(0:03 / 1:00)');
      const recorder = env.instances[0];
      expect(recorder.stop).not.toHaveBeenCalled();
      expect(env.track.stop).not.toHaveBeenCalled();
      const clearIntervalCallsBeforeUnmount = clearIntervalSpy.mock.calls.length;
      unmount();
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(env.track.stop).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(
        clearIntervalCallsBeforeUnmount,
      );
      act(() => {
        vi.advanceTimersByTime(65_000);
      });
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(env.track.stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling when the tracked pending clone is deleted', async () => {
    const pending = publicRow({ id: 'clone-pending', status: 'pending' });
    cloneMocks.list = [pending];
    cloneMocks.fetchById.mockResolvedValue(pending);
    cloneMocks.create.mockResolvedValue(pending);
    cloneMocks.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('checkbox'));
    const fileInput = screen.getByTestId('voice-clone-panel').querySelector('input[type="file"]');
    await user.upload(fileInput as HTMLInputElement, makeWavFile());
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneSubmit' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('persona.voiceClonePending'),
    );
    await waitFor(() =>
      expect(cloneMocks.fetchById).toHaveBeenCalledWith('clone-pending'),
    );
    await user.click(screen.getByRole('button', { name: 'persona.voiceCloneDelete' }));
    await waitFor(() => expect(cloneMocks.delete).toHaveBeenCalledWith('clone-pending'));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const fetchByIdCallsAfterDelete = cloneMocks.fetchById.mock.calls.length;
    await new Promise((resolve) => {
      setTimeout(resolve, 2800);
    });
    expect(cloneMocks.fetchById).toHaveBeenCalledTimes(fetchByIdCallsAfterDelete);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }, 15_000);

  it('clears the persona voice when the selected clone is deleted', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-selected', status: 'ready', voice_id: 'voice-1' }),
    ];
    cloneMocks.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole('button', { name: 'persona.voiceCloneDelete' }),
    );
    await waitFor(() => expect(cloneMocks.delete).toHaveBeenCalledWith('clone-selected'));
    await waitFor(() => expect(cloneMocks.setVoiceId).toHaveBeenCalledWith(null));
    expect(cloneMocks.setVoiceId).toHaveBeenCalledTimes(1);
    expect(cloneMocks.setVoiceId).toHaveBeenCalledWith(null);
  });

  it('keeps the persona voice when a different clone is deleted', async () => {
    cloneMocks.list = [
      publicRow({ id: 'clone-other', status: 'ready', voice_id: 'chatterbox:other' }),
    ];
    cloneMocks.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { queryClient } = renderPanel();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(
      await screen.findByRole('button', { name: 'persona.voiceCloneDelete' }),
    );
    await waitFor(() => expect(cloneMocks.delete).toHaveBeenCalledWith('clone-other'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cloned-voices'] }),
    );
    expect(cloneMocks.setVoiceId).not.toHaveBeenCalled();
  });
});
