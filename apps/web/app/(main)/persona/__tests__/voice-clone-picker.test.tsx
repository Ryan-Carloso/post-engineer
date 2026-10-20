import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PersonaVoiceClonePanel } from '../voice-clone-picker';
import type { ClonedVoicePublicRow } from '@/lib/cloned-voices-types';

const cloneMocks = vi.hoisted(() => ({
  list: [] as ClonedVoicePublicRow[],
  listError: false,
  fetchById: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  setVoiceId: vi.fn(),
  audioPlay: vi.fn(),
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
    data: [{ code: 'pt', label: 'Português' }],
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
    validateCloneReferenceBuffer: vi.fn(() => ({ ok: true as const })),
  };
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PersonaVoiceClonePanel personaLanguage="pt" />
    </QueryClientProvider>,
  );
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
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    cloneMocks.audioPlay.mockReset();
    cloneMocks.audioPlay.mockResolvedValue(undefined);
    vi.stubGlobal(
      'Audio',
      class MockAudio {
        play = cloneMocks.audioPlay;
        pause = vi.fn();
      },
    );
  });

  afterEach(() => {
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
});
